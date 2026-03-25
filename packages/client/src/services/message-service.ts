import { createHash, randomUUID } from 'node:crypto';

import {
  type ConversationSummary,
  ErrorCodes,
  TelagentError,
  hashDid,
  isDidClaw,
  type Envelope,
} from '../protocol/index.js';

import { getGlobalLogger } from '../logger.js';
import type { ContactService } from './contact-service.js';
import type { GroupService } from './group-service.js';
import type { PeerProfileRepository } from '../storage/peer-profile-repository.js';
import type { KeyLifecycleService, KeySuite } from './key-lifecycle-service.js';
import { localPeerAvatarUrl } from '../utils/avatar-url.js';
import { SequenceAllocator } from './sequence-allocator.js';
import type {
  MailboxStore,
  ProvisionalRetractionRecord,
  StoredEnvelopeRecord,
} from '../storage/mailbox-store.js';

export interface SendMessageInput {
  envelopeId?: string;
  senderDid: string;
  conversationId: string;
  conversationType: 'direct' | 'group';
  targetDomain?: string;
  targetDid: string;
  mailboxKeyId: string;
  sealedHeader: string;
  ciphertext: string;
  contentType: 'text' | 'image' | 'file' | 'control';
  attachmentManifestHash?: string;
  epoch?: number;
  ttlSec: number;
}

export interface IngestEnvelopeInput {
  envelopeId: string;
  conversationId: string;
  conversationType: 'direct' | 'group';
  routeHint: {
    targetDomain?: string;
    targetDid: string;
    mailboxKeyId: string;
  };
  sealedHeader: string;
  seq: bigint;
  epoch?: number;
  ciphertext: string;
  contentType: 'text' | 'image' | 'file' | 'control';
  attachmentManifestHash?: string;
  sentAtMs: number;
  ttlSec: number;
  provisional?: boolean;
}

export interface MessageServiceClock {
  now(): number;
}

export interface MessageDidRevocationEvent {
  did: string;
  didHash: string;
  revokedAtMs: number;
  source: string;
}

export interface MessageIdentityService {
  assertActiveDid(rawDid: string): Promise<unknown>;
  subscribeDidRevocations?(listener: (event: MessageDidRevocationEvent) => void): () => void;
}

const SystemClock: MessageServiceClock = {
  now: () => Date.now(),
};

export interface CleanupReport {
  removed: number;
  remaining: number;
  sweptAtMs: number;
}

export interface ProvisionalRetractionReport {
  retracted: number;
  checkedAtMs: number;
}

export interface MessageMaintenanceReport {
  cleanup: CleanupReport;
  retraction: ProvisionalRetractionReport;
}

export interface MessageAuditRetractionSample {
  envelopeIdHash: string;
  conversationIdHash: string;
  reason: 'REORGED_BACK';
  retractedAtMs: number;
}

export interface MessageSessionIsolationRecord {
  conversationId: string;
  conversationIdHash: string;
  revokedDidHash: string;
  isolatedAtMs: number;
  source: string;
}

export interface MessageDidIsolationEvent {
  didHash: string;
  revokedAtMs: number;
  source: string;
  isolatedConversationCount: number;
  evictedConversationCount: number;
  isolatedConversationIdHashes: string[];
}

export interface MessageAuditSnapshot {
  activeEnvelopeCount: number;
  retractedCount: number;
  retractedByReason: Record<'REORGED_BACK', number>;
  sampledRetractions: MessageAuditRetractionSample[];
  revokedDidCount: number;
  isolatedConversationCount: number;
  isolationEventCount: number;
  sampledIsolations: Array<{
    conversationIdHash: string;
    revokedDidHash: string;
    isolatedAtMs: number;
    source: string;
  }>;
  sampledIsolationEvents: Array<{
    didHash: string;
    revokedAtMs: number;
    source: string;
    isolatedConversationCount: number;
    evictedConversationCount: number;
  }>;
  sampleSize: number;
  retractionScanLimit: number;
}

interface GlobalPullCursorKey {
  sentAtMs: number;
  conversationId: string;
  seq: bigint;
  envelopeId: string;
}

const GLOBAL_PULL_CURSOR_PREFIX = 'g1.';

export class MessageService {
  private envelopes: Envelope[] = [];
  private readonly envelopeById = new Map<string, Envelope>();
  private readonly idempotencySignatureByEnvelopeId = new Map<string, string>();
  private readonly retractedByEnvelopeId = new Map<string, ProvisionalRetractionRecord>();
  private readonly sequenceAllocator: SequenceAllocator;
  private readonly clock: MessageServiceClock;
  private readonly repository?: MailboxStore;
  private readonly keyLifecycleService?: KeyLifecycleService;
  private readonly identityService?: MessageIdentityService;
  private readonly conversationIdsByDidHash = new Map<string, Set<string>>();
  private readonly directConversationParticipantDidHashes = new Map<string, Set<string>>();
  private readonly activeConversationIds = new Set<string>();
  private readonly isolatedConversationById = new Map<string, MessageSessionIsolationRecord>();
  private readonly isolationEvents: MessageDidIsolationEvent[] = [];
  private readonly revokedDidHashes = new Set<string>();
  private readonly privateConversationUpdatedAtById = new Map<string, number>();
  private disposeRevocationSubscription?: () => void;

  private readonly contactService?: ContactService;
  private readonly peerProfileRepository?: PeerProfileRepository;

  constructor(
    private readonly groups: GroupService,
    options?: {
      sequenceAllocator?: SequenceAllocator;
      clock?: MessageServiceClock;
      repository?: MailboxStore;
      keyLifecycleService?: KeyLifecycleService;
      identityService?: MessageIdentityService;
      contactService?: ContactService;
      peerProfileRepository?: PeerProfileRepository;
    },
  ) {
    this.sequenceAllocator = options?.sequenceAllocator ?? new SequenceAllocator();
    this.clock = options?.clock ?? SystemClock;
    this.repository = options?.repository;
    this.keyLifecycleService = options?.keyLifecycleService;
    this.identityService = options?.identityService;
    this.contactService = options?.contactService;
    this.peerProfileRepository = options?.peerProfileRepository;

    if (this.identityService?.subscribeDidRevocations) {
      this.disposeRevocationSubscription = this.identityService.subscribeDidRevocations((event) => {
        this.recordDidRevocation(event);
      });
    }
  }

  async send(input: SendMessageInput): Promise<Envelope> {
    const nowMs = this.clock.now();
    await this.runMaintenance(nowMs);

    const envelopeId = input.envelopeId ?? randomUUID();
    const signature = this.buildIdempotencySignature(input);

    const existing = await this.getEnvelopeById(envelopeId);
    if (existing) {
      const existingSignature = await this.getIdempotencySignature(envelopeId);
      if (existingSignature !== signature) {
        throw new TelagentError(
          ErrorCodes.CONFLICT,
          `envelopeId(${envelopeId}) already exists with a different payload`,
        );
      }
      return existing;
    }
    const existingSignature = await this.getIdempotencySignature(envelopeId);
    if (existingSignature) {
      if (existingSignature !== signature) {
        throw new TelagentError(
          ErrorCodes.CONFLICT,
          `envelopeId(${envelopeId}) already exists with a different payload`,
        );
      }
      const retracted = await this.getRetraction(envelopeId);
      if (retracted) {
        throw new TelagentError(
          ErrorCodes.CONFLICT,
          `envelopeId(${envelopeId}) was retracted due to ${retracted.reason}`,
        );
      }
      throw new TelagentError(ErrorCodes.CONFLICT, `envelopeId(${envelopeId}) already exists`);
    }

    if (!isDidClaw(input.senderDid)) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'senderDid must use did:claw format');
    }
    const senderDidHash = this.normalizeHash(hashDid(input.senderDid));
    this.assertConversationNotIsolated(input.conversationId);
    this.assertDidNotRevoked(input.senderDid, senderDidHash);

    if (this.identityService) {
      await this.identityService.assertActiveDid(input.senderDid);
    }

    if (this.keyLifecycleService) {
      const suite: KeySuite = input.conversationType === 'direct' ? 'signal' : 'mls';
      // Only enforce key validation when keys have been explicitly registered for this
      // DID+suite. An empty keystore (fresh install / key management not configured)
      // is treated as "no restriction" so out-of-the-box usage works without setup.
      const registeredKeys = this.keyLifecycleService.listKeys(input.senderDid, suite);
      if (registeredKeys.length > 0) {
        this.keyLifecycleService.assertCanUseKey({
          did: input.senderDid,
          suite,
          keyId: input.mailboxKeyId,
          atMs: nowMs,
        });
      }
    }

    let provisional = false;
    if (input.conversationType === 'group') {
      const groupId = this.resolveGroupId(input.conversationId);
      const chainState = this.groups.getChainState(groupId);
      if (chainState.state === 'REORGED_BACK') {
        throw new TelagentError(ErrorCodes.CONFLICT, 'Group chain state is REORGED_BACK');
      }
      provisional = chainState.state !== 'ACTIVE';

      const members = this.groups.listMembers(groupId);
      const senderRecord = members.find((item) => this.normalizeHash(item.didHash) === senderDidHash);

      if (!senderRecord) {
        throw new TelagentError(ErrorCodes.FORBIDDEN, 'Sender is not a group member');
      }

      if (senderRecord.state === 'REMOVED') {
        throw new TelagentError(ErrorCodes.FORBIDDEN, 'Sender membership has been removed');
      }
      if (senderRecord.state === 'PENDING') {
        provisional = true;
      }
    } else {
      await this.assertDirectConversationParticipant({
        conversationId: input.conversationId,
        senderDidHash,
        nowMs,
      });
    }

    const seq = await this.nextSequence(input.conversationId);

    const envelope: Envelope = {
      envelopeId,
      conversationId: input.conversationId,
      conversationType: input.conversationType,
      routeHint: {
        targetDomain: input.targetDomain,
        targetDid: input.targetDid,
        mailboxKeyId: input.mailboxKeyId,
      },
      sealedHeader: input.sealedHeader,
      seq,
      epoch: input.epoch,
      ciphertext: input.ciphertext,
      contentType: input.contentType,
      attachmentManifestHash: input.attachmentManifestHash,
      sentAtMs: nowMs,
      ttlSec: input.ttlSec,
      provisional,
      read: true,
    };

    await this.persistEnvelope({
      envelope,
      idempotencySignature: signature,
    });
    await this.upsertConversationSummaryFromEnvelope(envelope);
    this.recordConversationActivity(senderDidHash, input.conversationId);
    this.autoEnsureContact(input.targetDid);

    return envelope;
  }

  async ingestFederatedEnvelope(raw: Record<string, unknown>, sourceDid?: string): Promise<Envelope> {
    const nowMs = this.clock.now();
    await this.runMaintenance(nowMs);

    const envelope = this.normalizeEnvelopeForIngestion(raw);
    if (sourceDid) {
      getGlobalLogger().info('[message-service] Ingesting envelope %s from P2P sourceDid=%s', envelope.envelopeId, sourceDid);
    }
    const signature = this.buildEnvelopeIdempotencySignature(envelope);

    const existing = await this.getEnvelopeById(envelope.envelopeId);
    if (existing) {
      const existingSignature = await this.getIdempotencySignature(envelope.envelopeId);
      if (existingSignature !== signature) {
        throw new TelagentError(
          ErrorCodes.CONFLICT,
          `envelopeId(${envelope.envelopeId}) already exists with a different payload`,
        );
      }
      return existing;
    }

    const existingSignature = await this.getIdempotencySignature(envelope.envelopeId);
    if (existingSignature) {
      if (existingSignature !== signature) {
        throw new TelagentError(
          ErrorCodes.CONFLICT,
          `envelopeId(${envelope.envelopeId}) already exists with a different payload`,
        );
      }
      const retracted = await this.getRetraction(envelope.envelopeId);
      if (retracted) {
        throw new TelagentError(
          ErrorCodes.CONFLICT,
          `envelopeId(${envelope.envelopeId}) was retracted due to ${retracted.reason}`,
        );
      }
      throw new TelagentError(ErrorCodes.CONFLICT, `envelopeId(${envelope.envelopeId}) already exists`);
    }

    await this.persistEnvelope({
      envelope,
      idempotencySignature: signature,
    });
    await this.upsertConversationSummaryFromEnvelope(envelope, { sourceDid });
    this.activeConversationIds.add(envelope.conversationId);
    if (sourceDid) this.autoEnsureContact(sourceDid);

    return envelope;
  }

  private autoEnsureContact(did: string): void {
    if (!this.contactService || !isDidClaw(did)) return;
    try {
      const peer = this.peerProfileRepository?.get(did as Parameters<PeerProfileRepository['get']>[0]);
      const displayName = peer?.nickname || did.split(':').at(-1)!.slice(0, 12);
      this.contactService.ensureContact({ did, displayName, avatarUrl: peer?.avatarUrl ?? undefined });
    } catch (err) {
      getGlobalLogger().warn('[message-service] autoEnsureContact failed for %s: %s', did, (err as Error).message);
    }
  }

  async pull(params: { cursor?: string; limit?: number; conversationId?: string; unread?: boolean }): Promise<{
    items: Envelope[];
    nextCursor: string | null;
  }> {
    await this.runMaintenance();

    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const cursor = this.parsePullCursor(params.cursor, params.conversationId);
    const itemsWithProbe = await this.listEnvelopes({
      conversationId: params.conversationId,
      limit: limit + 1,
      afterSeq: cursor.afterSeq,
      afterKey: cursor.afterKey,
      unread: params.unread,
    });
    const hasMore = itemsWithProbe.length > limit;
    const items = hasMore ? itemsWithProbe.slice(0, limit) : itemsWithProbe;
    const tail = items[items.length - 1];

    return {
      items,
      nextCursor:
        hasMore && tail
          ? params.conversationId
            ? tail.seq.toString()
            : this.encodeGlobalPullCursor(tail)
      : null,
    };
  }

  async markAsRead(envelopeIds: string[]): Promise<number> {
    if (envelopeIds.length === 0) return 0;

    if (this.repository?.markAsRead) {
      return this.repository.markAsRead(envelopeIds);
    }

    // In-memory fallback
    let count = 0;
    for (const id of envelopeIds) {
      const envelope = this.envelopeById.get(id);
      if (envelope && !envelope.read) {
        envelope.read = true;
        count++;
      }
    }
    return count;
  }

  async listConversations(params?: { scanLimit?: number }): Promise<ConversationSummary[]> {
    if (this.repository?.listConversationSummaries) {
      const limit = Math.min(10_000, Math.max(1, params?.scanLimit ?? 200));
      const items = await this.repository.listConversationSummaries({ limit });
      return items.map((item) => this.enrichConversationSummary(item));
    }

    // Fallback: scan envelopes (in-memory mode without persistent repository)
    const scanLimit = Math.min(10_000, Math.max(100, params?.scanLimit ?? 5_000));
    const pageSize = 200;
    const latestByConversation = new Map<string, Envelope>();
    const privateConversationIds = await this.listPrivateConversationIds(scanLimit);
    const privateConversationSet = new Set(privateConversationIds);
    let scanned = 0;
    let afterKey: GlobalPullCursorKey | undefined;

    while (scanned < scanLimit) {
      const remaining = scanLimit - scanned;
      const batch = await this.listEnvelopes({
        limit: Math.min(pageSize, remaining),
        afterKey,
      });
      if (batch.length === 0) {
        break;
      }

      scanned += batch.length;
      for (const envelope of batch) {
        const existing = latestByConversation.get(envelope.conversationId);
        if (!existing || existing.sentAtMs <= envelope.sentAtMs) {
          latestByConversation.set(envelope.conversationId, envelope);
        }
      }

      const tail = batch[batch.length - 1];
      afterKey = {
        sentAtMs: tail.sentAtMs,
        conversationId: tail.conversationId,
        seq: tail.seq,
        envelopeId: tail.envelopeId,
      };
      if (batch.length < Math.min(pageSize, remaining)) {
        break;
      }
    }

    return [...latestByConversation.values()]
      .map((envelope) => this.toConversationSummary(envelope, privateConversationSet.has(envelope.conversationId)))
      .map((item) => this.enrichConversationSummary(item))
      .sort((left, right) => (right.lastMessageAtMs ?? 0) - (left.lastMessageAtMs ?? 0));
  }

  private enrichConversationSummary(item: ConversationSummary): ConversationSummary {
    if (item.conversationType !== 'direct' || !item.peerDid) return item;
    const peer = this.peerProfileRepository?.get(item.peerDid as Parameters<PeerProfileRepository['get']>[0]);
    const contact = this.contactService?.getContact(item.peerDid);
    const displayName = peer?.nickname || contact?.displayName || item.displayName;
    const rawAvatarUrl = peer?.avatarUrl ?? contact?.avatarUrl ?? item.avatarUrl ?? undefined;
    const avatarUrl = (item.peerDid ? localPeerAvatarUrl(item.peerDid, rawAvatarUrl) : undefined) ?? null;
    if (displayName === item.displayName && avatarUrl === item.avatarUrl) return item;
    return { ...item, displayName, avatarUrl };
  }

  async setConversationPrivacy(
    conversationId: string,
    isPrivate: boolean,
  ): Promise<{ conversationId: string; private: boolean; updatedAtMs: number }> {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'conversationId is required');
    }

    const updatedAtMs = this.clock.now();
    if (this.repository?.setConversationPrivacy) {
      await this.repository.setConversationPrivacy({
        conversationId: normalizedConversationId,
        isPrivate,
        updatedAtMs,
      });
    }

    if (isPrivate) {
      this.privateConversationUpdatedAtById.set(normalizedConversationId, updatedAtMs);
    } else {
      this.privateConversationUpdatedAtById.delete(normalizedConversationId);
    }

    return {
      conversationId: normalizedConversationId,
      private: isPrivate,
      updatedAtMs,
    };
  }

  async createConversation(params: {
    conversationId: string;
    conversationType: 'direct' | 'group';
    peerDid?: string;
    groupId?: string;
    displayName: string;
  }): Promise<ConversationSummary> {
    const nowMs = this.clock.now();
    if (this.repository?.upsertConversationSummary) {
      await this.repository.upsertConversationSummary({
        conversationId: params.conversationId,
        conversationType: params.conversationType,
        peerDid: params.peerDid,
        groupId: params.groupId,
        displayName: params.displayName,
        lastMessagePreview: null,
        lastMessageAtMs: nowMs,
        updatedAtMs: nowMs,
      });
    }
    return {
      conversationId: params.conversationId,
      conversationType: params.conversationType,
      peerDid: params.peerDid,
      groupId: params.groupId,
      displayName: params.displayName,
      lastMessagePreview: null,
      lastMessageAtMs: nowMs,
      unreadCount: 0,
      private: false,
    };
  }

  async deleteConversation(conversationId: string): Promise<void> {
    if (this.repository?.deleteConversation) {
      await this.repository.deleteConversation(conversationId);
    }
    this.privateConversationUpdatedAtById.delete(conversationId);
  }

  async listPrivateConversationIds(limit = 5_000): Promise<string[]> {
    const normalizedLimit = Math.max(1, Math.min(100_000, Math.floor(limit)));
    if (this.repository?.listPrivateConversationIds) {
      return this.repository.listPrivateConversationIds(normalizedLimit);
    }

    return [...this.privateConversationUpdatedAtById.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, normalizedLimit)
      .map(([conversationId]) => conversationId);
  }

  async runMaintenance(nowMs = this.clock.now()): Promise<MessageMaintenanceReport> {
    return {
      cleanup: await this.cleanupExpired(nowMs),
      retraction: await this.retractProvisionalOnReorg(nowMs),
    };
  }

  dispose(): void {
    if (this.disposeRevocationSubscription) {
      this.disposeRevocationSubscription();
      this.disposeRevocationSubscription = undefined;
    }
  }

  async listRetracted(limit = 50): Promise<ProvisionalRetractionRecord[]> {
    if (this.repository) {
      return this.repository.listRetractions(limit);
    }

    return Array.from(this.retractedByEnvelopeId.values())
      .sort((a, b) => b.retractedAtMs - a.retractedAtMs)
      .slice(0, Math.max(1, limit));
  }

  listIsolatedConversations(limit = 50): MessageSessionIsolationRecord[] {
    return Array.from(this.isolatedConversationById.values())
      .sort((left, right) => right.isolatedAtMs - left.isolatedAtMs)
      .slice(0, Math.max(1, limit))
      .map((item) => ({ ...item }));
  }

  listIsolationEvents(limit = 50): MessageDidIsolationEvent[] {
    return this.isolationEvents
      .slice()
      .sort((left, right) => right.revokedAtMs - left.revokedAtMs)
      .slice(0, Math.max(1, limit))
      .map((item) => ({
        ...item,
        isolatedConversationIdHashes: [...item.isolatedConversationIdHashes],
      }));
  }

  recordDidRevocation(event: MessageDidRevocationEvent): MessageDidIsolationEvent {
    if (!isDidClaw(event.did)) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'DID must use did:claw format');
    }

    const didHash = this.normalizeHash(event.didHash);
    const revokedAtMs = this.normalizePositiveInt(event.revokedAtMs, this.clock.now(), Number.MAX_SAFE_INTEGER);
    const source = event.source.trim() || 'unknown';

    this.revokedDidHashes.add(didHash);

    const relatedConversationIds = new Set<string>([
      ...this.listTrackedConversationsByDidHash(didHash),
      ...this.findGroupConversationsByDidHash(didHash),
    ]);

    let evictedConversationCount = 0;
    const isolatedConversationIdHashes: string[] = [];
    for (const conversationId of relatedConversationIds) {
      if (!this.isolatedConversationById.has(conversationId)) {
        this.isolatedConversationById.set(conversationId, {
          conversationId,
          conversationIdHash: this.digestForAudit(conversationId),
          revokedDidHash: didHash,
          isolatedAtMs: revokedAtMs,
          source,
        });
      }
      const current = this.isolatedConversationById.get(conversationId)!;
      isolatedConversationIdHashes.push(current.conversationIdHash);

      if (this.activeConversationIds.delete(conversationId)) {
        evictedConversationCount += 1;
      }
    }

    const isolationEvent: MessageDidIsolationEvent = {
      didHash,
      revokedAtMs,
      source,
      isolatedConversationCount: relatedConversationIds.size,
      evictedConversationCount,
      isolatedConversationIdHashes,
    };
    this.isolationEvents.push(isolationEvent);

    return {
      ...isolationEvent,
      isolatedConversationIdHashes: [...isolationEvent.isolatedConversationIdHashes],
    };
  }

  async buildAuditSnapshot(options?: {
    sampleSize?: number;
    retractionScanLimit?: number;
  }): Promise<MessageAuditSnapshot> {
    const sampleSize = this.normalizePositiveInt(options?.sampleSize, 20, 100);
    const retractionScanLimit = this.normalizePositiveInt(options?.retractionScanLimit, 2000, 100_000);

    const [activeEnvelopeCount, retractions] = await Promise.all([
      this.countEnvelopes(),
      this.listRetracted(retractionScanLimit),
    ]);

    const retractedByReason: Record<'REORGED_BACK', number> = {
      REORGED_BACK: 0,
    };
    for (const entry of retractions) {
      retractedByReason[entry.reason] += 1;
    }

    return {
      activeEnvelopeCount,
      retractedCount: retractions.length,
      retractedByReason,
      sampledRetractions: retractions.slice(0, sampleSize).map((entry) => ({
        envelopeIdHash: this.digestForAudit(entry.envelopeId),
        conversationIdHash: this.digestForAudit(entry.conversationId),
        reason: entry.reason,
        retractedAtMs: entry.retractedAtMs,
      })),
      revokedDidCount: this.revokedDidHashes.size,
      isolatedConversationCount: this.isolatedConversationById.size,
      isolationEventCount: this.isolationEvents.length,
      sampledIsolations: this.listIsolatedConversations(sampleSize).map((entry) => ({
        conversationIdHash: entry.conversationIdHash,
        revokedDidHash: entry.revokedDidHash,
        isolatedAtMs: entry.isolatedAtMs,
        source: entry.source,
      })),
      sampledIsolationEvents: this.listIsolationEvents(sampleSize).map((entry) => ({
        didHash: entry.didHash,
        revokedAtMs: entry.revokedAtMs,
        source: entry.source,
        isolatedConversationCount: entry.isolatedConversationCount,
        evictedConversationCount: entry.evictedConversationCount,
      })),
      sampleSize,
      retractionScanLimit,
    };
  }

  async cleanupExpired(nowMs = this.clock.now()): Promise<CleanupReport> {
    if (this.repository) {
      const result = await this.repository.deleteExpired(nowMs);
      return {
        removed: result.removed,
        remaining: result.remaining,
        sweptAtMs: nowMs,
      };
    }

    let removed = 0;
    const retained: Envelope[] = [];

    for (const envelope of this.envelopes) {
      if (this.isExpired(envelope, nowMs)) {
        removed++;
        this.envelopeById.delete(envelope.envelopeId);
        this.idempotencySignatureByEnvelopeId.delete(envelope.envelopeId);
      } else {
        retained.push(envelope);
      }
    }

    this.envelopes = retained;
    return {
      removed,
      remaining: retained.length,
      sweptAtMs: nowMs,
    };
  }

  async retractProvisionalOnReorg(nowMs = this.clock.now()): Promise<ProvisionalRetractionReport> {
    if (this.repository) {
      let retracted = 0;
      const provisionalRecords = await this.repository.listProvisionalGroupRecords();

      for (const record of provisionalRecords) {
        const groupId = this.resolveGroupId(record.envelope.conversationId);
        const chainState = this.groups.getChainState(groupId);
        if (chainState.state !== 'REORGED_BACK') {
          continue;
        }

        retracted++;
        await this.repository.retractEnvelope({
          envelope: record.envelope,
          idempotencySignature: record.idempotencySignature,
          retractedAtMs: nowMs,
          reason: 'REORGED_BACK',
        });
      }

      return {
        retracted,
        checkedAtMs: nowMs,
      };
    }

    let retracted = 0;
    const retained: Envelope[] = [];

    for (const envelope of this.envelopes) {
      if (envelope.conversationType !== 'group' || !envelope.provisional) {
        retained.push(envelope);
        continue;
      }

      const groupId = this.resolveGroupId(envelope.conversationId);
      const chainState = this.groups.getChainState(groupId);
      if (chainState.state !== 'REORGED_BACK') {
        retained.push(envelope);
        continue;
      }

      retracted++;
      this.envelopeById.delete(envelope.envelopeId);
      this.retractedByEnvelopeId.set(envelope.envelopeId, {
        envelopeId: envelope.envelopeId,
        conversationId: envelope.conversationId,
        reason: 'REORGED_BACK',
        retractedAtMs: nowMs,
      });
    }

    this.envelopes = retained;
    return {
      retracted,
      checkedAtMs: nowMs,
    };
  }

  private isExpired(envelope: Envelope, nowMs: number): boolean {
    const expiresAtMs = envelope.sentAtMs + envelope.ttlSec * 1000;
    return expiresAtMs <= nowMs;
  }

  private buildIdempotencySignature(input: SendMessageInput): string {
    return JSON.stringify({
      senderDid: input.senderDid,
      conversationId: input.conversationId,
      conversationType: input.conversationType,
      targetDomain: input.targetDomain ?? null,
      targetDid: input.targetDid,
      mailboxKeyId: input.mailboxKeyId,
      sealedHeader: input.sealedHeader,
      ciphertext: input.ciphertext,
      contentType: input.contentType,
      attachmentManifestHash: input.attachmentManifestHash ?? null,
      epoch: input.epoch ?? null,
      ttlSec: input.ttlSec,
    });
  }

  private buildEnvelopeIdempotencySignature(envelope: Envelope): string {
    return JSON.stringify({
      envelopeId: envelope.envelopeId,
      conversationId: envelope.conversationId,
      conversationType: envelope.conversationType,
      routeHint: {
        targetDomain: envelope.routeHint.targetDomain ?? null,
        targetDid: envelope.routeHint.targetDid,
        mailboxKeyId: envelope.routeHint.mailboxKeyId,
      },
      sealedHeader: envelope.sealedHeader,
      seq: envelope.seq.toString(),
      epoch: envelope.epoch ?? null,
      ciphertext: envelope.ciphertext,
      contentType: envelope.contentType,
      attachmentManifestHash: envelope.attachmentManifestHash ?? null,
      sentAtMs: envelope.sentAtMs,
      ttlSec: envelope.ttlSec,
      provisional: envelope.provisional ?? false,
    });
  }

  private normalizeEnvelopeForIngestion(raw: Record<string, unknown>): Envelope {
    const envelopeId = this.requiredString(raw.envelopeId, 'envelopeId');
    const conversationId = this.requiredString(raw.conversationId, 'conversationId');
    const conversationType = this.requiredConversationType(raw.conversationType);
    const routeHint = this.requiredRecord(raw.routeHint, 'routeHint');
    const targetDomain = this.optionalString(routeHint.targetDomain);
    const targetDid = this.requiredString(routeHint.targetDid, 'routeHint.targetDid');
    const mailboxKeyId = this.requiredString(routeHint.mailboxKeyId, 'routeHint.mailboxKeyId');
    const sealedHeader = this.requiredString(raw.sealedHeader, 'sealedHeader');
    const seq = this.requiredBigInt(raw.seq, 'seq');
    const epoch = this.optionalInteger(raw.epoch, 'epoch');
    const ciphertext = this.requiredString(raw.ciphertext, 'ciphertext');
    const contentType = this.requiredContentType(raw.contentType);
    const attachmentManifestHash = this.optionalString(raw.attachmentManifestHash);
    const sentAtMs = this.requiredNonNegativeInteger(raw.sentAtMs, 'sentAtMs');
    const ttlSec = this.requiredPositiveInteger(raw.ttlSec, 'ttlSec');
    const provisional = this.optionalBoolean(raw.provisional, 'provisional');

    return {
      envelopeId,
      conversationId,
      conversationType,
      routeHint: {
        targetDomain,
        targetDid,
        mailboxKeyId,
      },
      sealedHeader,
      seq,
      epoch,
      ciphertext,
      contentType,
      attachmentManifestHash,
      sentAtMs,
      ttlSec,
      provisional,
    };
  }

  private requiredRecord(input: unknown, field: string): Record<string, unknown> {
    if (!input || typeof input !== 'object') {
      throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be an object`);
    }
    return input as Record<string, unknown>;
  }

  private requiredString(input: unknown, field: string): string {
    if (typeof input !== 'string' || !input.trim()) {
      throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be a non-empty string`);
    }
    return input;
  }

  private optionalString(input: unknown): string | undefined {
    if (typeof input === 'undefined' || input === null) {
      return undefined;
    }
    if (typeof input !== 'string' || !input.trim()) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'attachmentManifestHash must be a non-empty string when provided');
    }
    return input;
  }

  private requiredBigInt(input: unknown, field: string): bigint {
    if (typeof input === 'bigint') {
      if (input < 0n) {
        throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be non-negative`);
      }
      return input;
    }
    if (typeof input === 'number' && Number.isInteger(input) && input >= 0) {
      return BigInt(input);
    }
    if (typeof input === 'string' && /^\d+$/.test(input)) {
      return BigInt(input);
    }
    throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be a non-negative integer`);
  }

  private requiredConversationType(input: unknown): 'direct' | 'group' {
    if (input === 'direct' || input === 'group') {
      return input;
    }
    throw new TelagentError(ErrorCodes.VALIDATION, 'conversationType must be direct or group');
  }

  private requiredContentType(input: unknown): 'text' | 'image' | 'file' | 'control' {
    if (input === 'text' || input === 'image' || input === 'file' || input === 'control') {
      return input;
    }
    throw new TelagentError(ErrorCodes.VALIDATION, 'contentType must be one of text|image|file|control');
  }

  private optionalInteger(input: unknown, field: string): number | undefined {
    if (typeof input === 'undefined' || input === null) {
      return undefined;
    }
    if (typeof input !== 'number' || !Number.isInteger(input) || input < 0) {
      throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be a non-negative integer when provided`);
    }
    return input;
  }

  private requiredNonNegativeInteger(input: unknown, field: string): number {
    if (typeof input !== 'number' || !Number.isInteger(input) || input < 0) {
      throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be a non-negative integer`);
    }
    return input;
  }

  private requiredPositiveInteger(input: unknown, field: string): number {
    if (typeof input !== 'number' || !Number.isInteger(input) || input <= 0) {
      throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be a positive integer`);
    }
    return input;
  }

  private optionalBoolean(input: unknown, field: string): boolean | undefined {
    if (typeof input === 'undefined' || input === null) {
      return undefined;
    }
    if (typeof input !== 'boolean') {
      throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be boolean when provided`);
    }
    return input;
  }

  private resolveGroupId(conversationId: string): string {
    if (conversationId.startsWith('group:')) {
      return conversationId.slice('group:'.length);
    }
    return conversationId;
  }

  private async assertDirectConversationParticipant(params: {
    conversationId: string;
    senderDidHash: string;
    nowMs: number;
  }): Promise<void> {
    const check = this.repository
      ? await this.repository.ensureDirectConversationParticipant({
        conversationId: params.conversationId,
        didHash: params.senderDidHash,
        observedAtMs: params.nowMs,
      })
      : this.ensureDirectConversationParticipantInMemory(params.conversationId, params.senderDidHash);

    if (check.allowed) {
      return;
    }

    throw new TelagentError(
      ErrorCodes.FORBIDDEN,
      `senderDid is not a direct conversation participant for conversation(${params.conversationId})`,
    );
  }

  private ensureDirectConversationParticipantInMemory(
    conversationId: string,
    didHash: string,
  ): { allowed: boolean; participants: string[] } {
    const bucket = this.directConversationParticipantDidHashes.get(conversationId);
    if (!bucket) {
      this.directConversationParticipantDidHashes.set(conversationId, new Set([didHash]));
      return {
        allowed: true,
        participants: [didHash],
      };
    }

    if (bucket.has(didHash)) {
      return {
        allowed: true,
        participants: [...bucket],
      };
    }

    if (bucket.size >= 2) {
      return {
        allowed: false,
        participants: [...bucket],
      };
    }

    bucket.add(didHash);
    return {
      allowed: true,
      participants: [...bucket],
    };
  }

  private recordConversationActivity(didHash: string, conversationId: string): void {
    this.activeConversationIds.add(conversationId);

    const bucket = this.conversationIdsByDidHash.get(didHash);
    if (bucket) {
      bucket.add(conversationId);
      return;
    }

    this.conversationIdsByDidHash.set(didHash, new Set([conversationId]));
  }

  private listTrackedConversationsByDidHash(didHash: string): string[] {
    return [...(this.conversationIdsByDidHash.get(didHash) ?? [])];
  }

  private findGroupConversationsByDidHash(didHash: string): string[] {
    const groupReader = this.groups as unknown as {
      listGroups?: () => Array<{ groupId: string }>;
      listMembers?: (groupId: string) => Array<{ didHash: string; state: string }>;
    };

    if (typeof groupReader.listGroups !== 'function' || typeof groupReader.listMembers !== 'function') {
      return [];
    }

    const matched: string[] = [];
    for (const group of groupReader.listGroups()) {
      if (!group?.groupId) {
        continue;
      }

      try {
        const members = groupReader.listMembers(group.groupId);
        const containsDid = members.some((member) =>
          this.normalizeHash(member.didHash) === didHash && member.state !== 'REMOVED'
        );
        if (containsDid) {
          matched.push(`group:${group.groupId}`);
        }
      } catch {
        // group may not be queryable for all adapters/mocks; skip best-effort
      }
    }

    return matched;
  }

  private assertConversationNotIsolated(conversationId: string): void {
    if (!this.isolatedConversationById.has(conversationId)) {
      return;
    }
    throw new TelagentError(
      ErrorCodes.UNPROCESSABLE,
      `conversation(${conversationId}) is isolated due to revoked DID`,
    );
  }

  private assertDidNotRevoked(senderDid: string, didHash: string): void {
    if (!this.revokedDidHashes.has(didHash)) {
      return;
    }
    throw new TelagentError(
      ErrorCodes.UNPROCESSABLE,
      `senderDid(${senderDid}) is revoked and isolated`,
    );
  }

  private async persistEnvelope(record: StoredEnvelopeRecord): Promise<void> {
    if (this.repository) {
      await this.repository.saveEnvelope(record);
      return;
    }

    this.envelopeById.set(record.envelope.envelopeId, record.envelope);
    this.idempotencySignatureByEnvelopeId.set(record.envelope.envelopeId, record.idempotencySignature);
    this.envelopes.push(record.envelope);
  }

  private async upsertConversationSummaryFromEnvelope(
    envelope: Envelope,
    options?: { sourceDid?: string },
  ): Promise<void> {
    if (!this.repository?.upsertConversationSummary) {
      return;
    }

    const conversationType = envelope.conversationType;
    const conversationId = envelope.conversationId;
    const groupId = conversationType === 'group'
      ? conversationId.startsWith('group:')
        ? conversationId.slice('group:'.length)
        : conversationId
      : undefined;
    const peerDid = conversationType === 'direct'
      ? this.resolveDirectPeerDid(conversationId, options?.sourceDid)
      : undefined;
    const isPrivate = this.privateConversationUpdatedAtById.has(conversationId);

    await this.repository.upsertConversationSummary({
      conversationId,
      conversationType,
      peerDid,
      groupId,
      displayName: this.displayNameForConversation(conversationId, conversationType, peerDid),
      lastMessagePreview: isPrivate ? null : this.previewFromEnvelope(envelope),
      lastMessageAtMs: envelope.sentAtMs,
      updatedAtMs: envelope.sentAtMs,
    });
  }

  private async getEnvelopeById(envelopeId: string): Promise<Envelope | null> {
    if (this.repository) {
      return (await this.repository.getEnvelopeRecord(envelopeId))?.envelope ?? null;
    }
    return this.envelopeById.get(envelopeId) ?? null;
  }

  private async getIdempotencySignature(envelopeId: string): Promise<string | null> {
    if (this.repository) {
      return this.repository.getIdempotencySignature(envelopeId);
    }
    return this.idempotencySignatureByEnvelopeId.get(envelopeId) ?? null;
  }

  private async getRetraction(envelopeId: string): Promise<ProvisionalRetractionRecord | null> {
    if (this.repository) {
      return this.repository.getRetraction(envelopeId);
    }
    return this.retractedByEnvelopeId.get(envelopeId) ?? null;
  }

  private async countEnvelopes(conversationId?: string): Promise<number> {
    if (this.repository) {
      return this.repository.countEnvelopes(conversationId);
    }

    if (!conversationId) {
      return this.envelopes.length;
    }
    return this.envelopes.filter((item) => item.conversationId === conversationId).length;
  }

  private async listEnvelopes(params: {
    conversationId?: string;
    limit: number;
    afterSeq?: bigint;
    afterKey?: GlobalPullCursorKey;
    unread?: boolean;
  }): Promise<Envelope[]> {
    if (this.repository) {
      return this.repository.listEnvelopes(params);
    }

    const filtered = this.envelopes.filter((item) => {
      if (params.conversationId && item.conversationId !== params.conversationId) {
        return false;
      }
      if (typeof params.unread === 'boolean') {
        const isRead = item.read ?? false;
        if (params.unread && isRead) return false;
        if (!params.unread && !isRead) return false;
      }
      return true;
    });

    const sorted = filtered.sort((left, right) => {
      if (params.conversationId) {
        if (left.seq !== right.seq) {
          return left.seq < right.seq ? -1 : 1;
        }
        return left.envelopeId.localeCompare(right.envelopeId);
      }

      if (left.sentAtMs !== right.sentAtMs) {
        return left.sentAtMs - right.sentAtMs;
      }
      if (left.conversationId !== right.conversationId) {
        return left.conversationId.localeCompare(right.conversationId);
      }
      if (left.seq !== right.seq) {
        return left.seq < right.seq ? -1 : 1;
      }
      return left.envelopeId.localeCompare(right.envelopeId);
    });

    const sliced = sorted.filter((item) => {
      if (params.conversationId) {
        if (typeof params.afterSeq === 'undefined') {
          return true;
        }
        return item.seq > params.afterSeq;
      }

      if (!params.afterKey) {
        return true;
      }

      if (item.sentAtMs !== params.afterKey.sentAtMs) {
        return item.sentAtMs > params.afterKey.sentAtMs;
      }
      if (item.conversationId !== params.afterKey.conversationId) {
        return item.conversationId > params.afterKey.conversationId;
      }
      if (item.seq !== params.afterKey.seq) {
        return item.seq > params.afterKey.seq;
      }
      return item.envelopeId > params.afterKey.envelopeId;
    });

    return sliced.slice(0, params.limit);
  }

  private toConversationSummary(envelope: Envelope, isPrivate: boolean): ConversationSummary {
    const conversationId = envelope.conversationId;
    const conversationType = envelope.conversationType;
    const groupId = conversationType === 'group'
      ? conversationId.startsWith('group:')
        ? conversationId.slice('group:'.length)
        : conversationId
      : undefined;
    const peerDid = conversationType === 'direct'
      ? this.extractPeerDid(conversationId)
      : undefined;

    return {
      conversationId,
      conversationType,
      peerDid,
      groupId,
      displayName: this.displayNameForConversation(conversationId, conversationType, peerDid),
      lastMessagePreview: isPrivate ? null : this.previewFromEnvelope(envelope),
      lastMessageAtMs: envelope.sentAtMs,
      unreadCount: 0,
      private: isPrivate,
      avatarUrl: null,
    };
  }

  private previewFromEnvelope(envelope: Envelope): string {
    if (envelope.contentType === 'text') {
      const normalized = envelope.ciphertext.replace(/\s+/g, ' ').trim();
      if (!normalized) {
        return '[text]';
      }
      return normalized.length <= 80 ? normalized : `${normalized.slice(0, 77)}...`;
    }

    if (envelope.contentType === 'control') {
      return '[control]';
    }
    return `[${envelope.contentType}]`;
  }

  private displayNameForConversation(
    conversationId: string,
    conversationType: 'direct' | 'group',
    peerDid?: string,
  ): string {
    if (conversationType === 'group') {
      const groupId = conversationId.startsWith('group:')
        ? conversationId.slice('group:'.length)
        : conversationId;
      return `Group ${groupId.slice(0, 12)}`;
    }

    if (peerDid) {
      return peerDid;
    }

    return `Direct ${conversationId.slice(0, 12)}`;
  }

  private extractPeerDid(conversationId: string): string | undefined {
    const matches = conversationId.match(/did:claw:[a-zA-Z0-9._:-]+/g);
    if (!matches || matches.length === 0) {
      return undefined;
    }
    return matches[0];
  }

  private resolveDirectPeerDid(conversationId: string, sourceDid?: string): string | undefined {
    // Inbound P2P envelopes should trust transport metadata to identify the peer.
    // This avoids mis-routing replies when conversationId only encodes the recipient DID
    // (for example: direct:<receiverDid>).
    if (sourceDid && isDidClaw(sourceDid)) {
      return sourceDid;
    }
    return this.extractPeerDid(conversationId);
  }

  private parsePullCursor(cursorRaw: string | undefined, conversationId?: string): {
    afterSeq?: bigint;
    afterKey?: GlobalPullCursorKey;
  } {
    if (!cursorRaw || !cursorRaw.trim()) {
      return {};
    }

    const cursor = cursorRaw.trim();
    if (conversationId) {
      if (!/^\d+$/.test(cursor)) {
        throw new TelagentError(
          ErrorCodes.VALIDATION,
          'cursor must be a non-negative integer sequence for conversation pull',
        );
      }
      return {
        afterSeq: BigInt(cursor),
      };
    }

    if (!cursor.startsWith(GLOBAL_PULL_CURSOR_PREFIX)) {
      throw new TelagentError(
        ErrorCodes.VALIDATION,
        'cursor must use keyset format when conversation_id is omitted',
      );
    }

    const encoded = cursor.slice(GLOBAL_PULL_CURSOR_PREFIX.length);
    if (!encoded) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'cursor payload is empty');
    }

    try {
      const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>;
      const sentAtMs = parsed.sentAtMs;
      const cursorConversationId = parsed.conversationId;
      const seq = parsed.seq;
      const envelopeId = parsed.envelopeId;

      if (typeof sentAtMs !== 'number' || !Number.isInteger(sentAtMs) || sentAtMs < 0) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'cursor.sentAtMs must be a non-negative integer');
      }
      if (typeof cursorConversationId !== 'string' || !cursorConversationId.trim()) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'cursor.conversationId must be a non-empty string');
      }
      if (typeof seq !== 'string' || !/^\d+$/.test(seq)) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'cursor.seq must be a non-negative integer string');
      }
      if (typeof envelopeId !== 'string' || !envelopeId.trim()) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'cursor.envelopeId must be a non-empty string');
      }

      return {
        afterKey: {
          sentAtMs,
          conversationId: cursorConversationId,
          seq: BigInt(seq),
          envelopeId,
        },
      };
    } catch (error) {
      if (error instanceof TelagentError) {
        throw error;
      }
      throw new TelagentError(ErrorCodes.VALIDATION, 'cursor is malformed');
    }
  }

  private encodeGlobalPullCursor(envelope: Envelope): string {
    const payload = {
      sentAtMs: envelope.sentAtMs,
      conversationId: envelope.conversationId,
      seq: envelope.seq.toString(),
      envelopeId: envelope.envelopeId,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${GLOBAL_PULL_CURSOR_PREFIX}${encoded}`;
  }

  private async nextSequence(conversationId: string): Promise<bigint> {
    if (this.repository) {
      return this.repository.nextSequence(conversationId);
    }
    return this.sequenceAllocator.next(conversationId);
  }

  private normalizePositiveInt(value: number | undefined, fallback: number, max: number): number {
    if (typeof value === 'undefined' || !Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(max, Math.max(1, Math.floor(value)));
  }

  private normalizeHash(value: string): string {
    return value.trim().toLowerCase();
  }

  private digestForAudit(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }
}
