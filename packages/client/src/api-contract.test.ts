import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { ErrorCodes, TelagentError, hashDid } from './protocol/index.js';

import { ApiServer } from './api/server.js';
import type { RuntimeContext } from './api/types.js';

const AUTH_HEADERS = { authorization: 'Bearer tses_test_token' };

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

class FakeIdentityService {
  getSelfDid(): string {
    return 'did:claw:zSelf';
  }

  private readonly revokedDidHashes = new Set<string>();
  private readonly revocationSubscribers = new Set<
    (event: { did: string; didHash: string; revokedAtMs: number; source: string }) => void
  >();

  async getSelf() {
    return {
      did: 'did:claw:zSelf',
      didHash: '0x' + '1'.repeat(64),
      controller: '0x' + '1'.repeat(40),
      publicKey: '0x11',
      isActive: true,
      resolvedAtMs: Date.now(),
    };
  }

  async resolve(did: string) {
    return {
      did,
      didHash: '0x' + '2'.repeat(64),
      controller: '0x' + '2'.repeat(40),
      publicKey: '0x22',
      isActive: true,
      resolvedAtMs: Date.now(),
    };
  }

  subscribeDidRevocations(listener: (event: {
    did: string;
    didHash: string;
    revokedAtMs: number;
    source: string;
  }) => void): () => void {
    this.revocationSubscribers.add(listener);
    return () => {
      this.revocationSubscribers.delete(listener);
    };
  }

  notifyDidRevoked(
    did: string,
    options?: {
      source?: string;
      revokedAtMs?: number;
    },
  ) {
    const didHash = hashDid(did);
    this.revokedDidHashes.add(didHash);
    const event = {
      did,
      didHash,
      revokedAtMs: options?.revokedAtMs ?? Date.now(),
      source: options?.source?.trim() || 'manual',
    };
    for (const subscriber of this.revocationSubscribers) {
      subscriber(event);
    }
    return event;
  }

  async assertActiveDid(did: string) {
    if (this.revokedDidHashes.has(hashDid(did))) {
      throw new TelagentError(ErrorCodes.UNPROCESSABLE, 'DID is revoked or inactive');
    }
    return this.resolve(did);
  }
}

class FakeGroupService {
  async createGroup(_input: unknown) {
    return {
      txHash: '0x' + 'a'.repeat(64),
      group: {
        groupId: '0x' + 'b'.repeat(64),
        creatorDid: 'did:claw:zSelf',
        creatorDidHash: '0x' + '1'.repeat(64),
        groupDomain: 'alpha.tel',
        domainProofHash: '0x' + '3'.repeat(64),
        initialMlsStateHash: '0x' + '4'.repeat(64),
        state: 'ACTIVE',
        createdAtMs: Date.now(),
        txHash: '0x' + 'a'.repeat(64),
        blockNumber: 100,
      },
    };
  }

  async inviteMember() {
    return { txHash: '0x' + 'c'.repeat(64) };
  }

  async acceptInvite() {
    return { txHash: '0x' + 'd'.repeat(64) };
  }

  async removeMember() {
    return { txHash: '0x' + 'e'.repeat(64) };
  }

  getGroup(groupId: string) {
    return {
      groupId,
      creatorDid: 'did:claw:zSelf',
      creatorDidHash: '0x' + '1'.repeat(64),
      groupDomain: 'alpha.tel',
      domainProofHash: '0x' + '3'.repeat(64),
      initialMlsStateHash: '0x' + '4'.repeat(64),
      state: 'ACTIVE',
      createdAtMs: Date.now(),
      txHash: '0x' + '5'.repeat(64),
      blockNumber: 100,
    };
  }

  listGroups() {
    return [
      this.getGroup('0x' + 'b'.repeat(64)),
      {
        ...this.getGroup('0x' + 'c'.repeat(64)),
        groupDomain: 'beta.tel',
        state: 'PENDING_ONCHAIN' as const,
      },
    ];
  }

  listMembers(groupId?: string) {
    if (groupId === '0x' + 'c'.repeat(64)) {
      return [
        {
          groupId: '0x' + 'c'.repeat(64),
          did: 'did:claw:zM3',
          didHash: '0x' + '9'.repeat(64),
          state: 'PENDING',
          joinedAtMs: Date.now(),
        },
      ];
    }
    return [
      {
        groupId: '0x' + 'b'.repeat(64),
        did: 'did:claw:zM1',
        didHash: '0x' + '6'.repeat(64),
        state: 'FINALIZED',
        joinedAtMs: Date.now(),
      },
      {
        groupId: '0x' + 'b'.repeat(64),
        did: 'did:claw:zM2',
        didHash: '0x' + '7'.repeat(64),
        state: 'PENDING',
        joinedAtMs: Date.now(),
      },
    ];
  }

  getChainState(groupId: string) {
    return {
      groupId,
      state: 'ACTIVE',
      finalizedTxHash: '0x' + '5'.repeat(64),
      blockNumber: 100,
      updatedAtMs: Date.now(),
    };
  }
}

class FakeMessageService {
  private nextSeq = 1n;
  private readonly privateConversations = new Set<string>();
  private readonly trackedConversationIdsByDidHash = new Map<string, Set<string>>();
  private readonly isolatedConversationById = new Map<string, {
    didHash: string;
    isolatedAtMs: number;
    source: string;
  }>();
  private readonly isolationEvents: Array<{
    didHash: string;
    revokedAtMs: number;
    source: string;
    isolatedConversationCount: number;
    evictedConversationCount: number;
  }> = [];
  private readonly revokedDidHashes = new Set<string>();

  constructor(private readonly identityService: FakeIdentityService) {
    this.identityService.subscribeDidRevocations((event) => {
      this.revokedDidHashes.add(event.didHash);
      const relatedConversationIds = [...(this.trackedConversationIdsByDidHash.get(event.didHash) ?? [])];
      for (const conversationId of relatedConversationIds) {
        this.isolatedConversationById.set(conversationId, {
          didHash: event.didHash,
          isolatedAtMs: event.revokedAtMs,
          source: event.source,
        });
      }
      this.isolationEvents.push({
        didHash: event.didHash,
        revokedAtMs: event.revokedAtMs,
        source: event.source,
        isolatedConversationCount: relatedConversationIds.length,
        evictedConversationCount: relatedConversationIds.length,
      });
    });
  }

  async send(input: {
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
    ttlSec: number;
  }) {
    if (this.isolatedConversationById.has(input.conversationId)) {
      throw new TelagentError(
        ErrorCodes.UNPROCESSABLE,
        `conversation(${input.conversationId}) is isolated due to revoked DID`,
      );
    }

    const senderDidHash = hashDid(input.senderDid);
    if (this.revokedDidHashes.has(senderDidHash)) {
      throw new TelagentError(ErrorCodes.UNPROCESSABLE, `senderDid(${input.senderDid}) is revoked and isolated`);
    }
    await this.identityService.assertActiveDid(input.senderDid);

    const tracked = this.trackedConversationIdsByDidHash.get(senderDidHash);
    if (tracked) {
      tracked.add(input.conversationId);
    } else {
      this.trackedConversationIdsByDidHash.set(senderDidHash, new Set([input.conversationId]));
    }

    const seq = this.nextSeq;
    this.nextSeq += 1n;
    return {
      envelopeId: input.envelopeId ?? `env-${seq}`,
      conversationId: input.conversationId,
      conversationType: input.conversationType,
      routeHint: {
        targetDomain: input.targetDomain,
        targetDid: input.targetDid,
        mailboxKeyId: input.mailboxKeyId,
      },
      sealedHeader: input.sealedHeader,
      seq,
      ciphertext: input.ciphertext,
      contentType: input.contentType,
      sentAtMs: Date.now(),
      ttlSec: input.ttlSec,
      provisional: false,
    };
  }

  async ingestFederatedEnvelope(raw: Record<string, unknown>) {
    const routeHint = raw.routeHint as Record<string, unknown>;
    const seqRaw = raw.seq;
    const seq = typeof seqRaw === 'bigint'
      ? seqRaw
      : typeof seqRaw === 'number'
        ? BigInt(seqRaw)
        : BigInt(typeof seqRaw === 'string' ? seqRaw : '0');

    const contentType = raw.contentType === 'image'
      || raw.contentType === 'file'
      || raw.contentType === 'control'
      ? raw.contentType
      : 'text';
    const conversationType = raw.conversationType === 'group' ? 'group' : 'direct';

    return {
      envelopeId: String(raw.envelopeId ?? ''),
      conversationId: String(raw.conversationId ?? ''),
      conversationType,
      routeHint: {
        targetDomain: routeHint.targetDomain ? String(routeHint.targetDomain) : undefined,
        targetDid: String(routeHint.targetDid ?? ''),
        mailboxKeyId: String(routeHint.mailboxKeyId ?? ''),
      },
      sealedHeader: String(raw.sealedHeader ?? ''),
      seq,
      epoch: typeof raw.epoch === 'number' ? raw.epoch : undefined,
      ciphertext: String(raw.ciphertext ?? ''),
      contentType,
      attachmentManifestHash: typeof raw.attachmentManifestHash === 'string' ? raw.attachmentManifestHash : undefined,
      sentAtMs: typeof raw.sentAtMs === 'number' ? raw.sentAtMs : Date.now(),
      ttlSec: typeof raw.ttlSec === 'number' ? raw.ttlSec : 3600,
      provisional: typeof raw.provisional === 'boolean' ? raw.provisional : false,
    };
  }

  pull() {
    return {
      items: [],
      nextCursor: null,
    };
  }

  listRetracted() {
    return [
      {
        envelopeId: 'env-retracted-1',
        conversationId: 'group:0x' + 'b'.repeat(64),
        reason: 'REORGED_BACK',
        retractedAtMs: Date.now(),
      },
    ];
  }

  async buildAuditSnapshot(options?: { sampleSize?: number; retractionScanLimit?: number }) {
    const sampleSize = Math.max(1, Math.min(100, options?.sampleSize ?? 20));
    return {
      activeEnvelopeCount: 1,
      retractedCount: 1,
      retractedByReason: {
        REORGED_BACK: 1,
      },
      sampledRetractions: [
        {
          envelopeIdHash: 'a'.repeat(64),
          conversationIdHash: 'b'.repeat(64),
          reason: 'REORGED_BACK',
          retractedAtMs: Date.now(),
        },
      ].slice(0, sampleSize),
      revokedDidCount: this.revokedDidHashes.size,
      isolatedConversationCount: this.isolatedConversationById.size,
      isolationEventCount: this.isolationEvents.length,
      sampledIsolations: [...this.isolatedConversationById.entries()]
        .slice(0, sampleSize)
        .map(([conversationId, isolation]) => ({
          conversationIdHash: digest(conversationId),
          revokedDidHash: isolation.didHash,
          isolatedAtMs: isolation.isolatedAtMs,
          source: isolation.source,
        })),
      sampledIsolationEvents: this.isolationEvents
        .slice(0, sampleSize)
        .map((event) => ({
          didHash: event.didHash,
          revokedAtMs: event.revokedAtMs,
          source: event.source,
          isolatedConversationCount: event.isolatedConversationCount,
          evictedConversationCount: event.evictedConversationCount,
        })),
      sampleSize,
      retractionScanLimit: Math.max(1, Math.min(100_000, options?.retractionScanLimit ?? 2_000)),
    };
  }

  async listConversations() {
    const conversationId = 'direct:did:claw:zSelf:did:claw:zPeer';
    const isPrivate = this.privateConversations.has(conversationId);
    return [
      {
        conversationId,
        conversationType: 'direct',
        peerDid: 'did:claw:zPeer',
        displayName: 'did:claw:zPeer',
        lastMessagePreview: isPrivate ? null : 'hello',
        lastMessageAtMs: Date.now(),
        unreadCount: 0,
        private: isPrivate,
        avatarUrl: null,
      },
    ];
  }

  async setConversationPrivacy(conversationId: string, isPrivate: boolean) {
    if (isPrivate) {
      this.privateConversations.add(conversationId);
    } else {
      this.privateConversations.delete(conversationId);
    }

    return {
      conversationId,
      private: isPrivate,
      updatedAtMs: Date.now(),
    };
  }

  async listPrivateConversationIds() {
    return [...this.privateConversations];
  }
}

class FakeAttachmentService {
  initUpload() {
    return {
      objectKey: 'attachments/o1',
      uploadUrl: 'https://uploads.telagent.local/attachments%2Fo1',
      expiresInSec: 900,
    };
  }

  completeUpload() {
    return {
      objectKey: 'attachments/o1',
      manifestHash: '0x' + '8'.repeat(64),
      checksum: '0x' + '9'.repeat(64),
      completedAtMs: Date.now(),
    };
  }
}

class FakeMonitoringService {
  recordHttpRequest() {}

  recordMailboxMaintenance() {}

  snapshot() {
    return {
      generatedAt: new Date().toISOString(),
      uptimeSec: 120,
      totals: {
        requests: 12,
        status2xx: 11,
        status4xx: 1,
        status5xx: 0,
        statusOther: 0,
        errorRateRatio: 0,
        avgLatencyMs: 4.2,
        p95LatencyMs: 7.3,
      },
      routes: [
        {
          path: '/api/v1/messages',
          count: 3,
          errorRateRatio: 0,
          avgLatencyMs: 3.5,
          p95LatencyMs: 5.8,
          lastStatus: 201,
          lastSeenAt: new Date().toISOString(),
        },
      ],
      mailboxMaintenance: {
        runs: 2,
        totalCleanupRemoved: 0,
        totalRetracted: 0,
        lastRunAt: new Date().toISOString(),
        lastCleanupRemoved: 0,
        lastRemaining: 0,
        lastRetracted: 0,
        staleSec: 2,
      },
      alerts: [
        {
          code: 'HTTP_5XX_RATE',
          level: 'OK',
          title: 'HTTP 5xx rate',
          value: 0,
          threshold: 0.02,
          message: 'ok',
        },
      ],
    };
  }
}

class FakeKeyLifecycleService {
  private readonly keys = new Map<string, Array<{
    did: string;
    suite: 'signal' | 'mls';
    keyId: string;
    publicKey: string;
    state: 'ACTIVE' | 'ROTATING' | 'REVOKED' | 'RECOVERED';
    createdAtMs: number;
    activatedAtMs: number;
    revokeReason?: string;
  }>>();

  registerKey(input: {
    did: string;
    suite: 'signal' | 'mls';
    keyId: string;
    publicKey: string;
    expiresAtMs?: number;
  }) {
    const record = {
      did: input.did,
      suite: input.suite,
      keyId: input.keyId,
      publicKey: input.publicKey,
      state: 'ACTIVE' as const,
      createdAtMs: Date.now(),
      activatedAtMs: Date.now(),
      expiresAtMs: input.expiresAtMs,
    };
    const bucket = this.keys.get(input.did) ?? [];
    bucket.push(record);
    this.keys.set(input.did, bucket);
    return record;
  }

  rotateKey(input: {
    did: string;
    suite: 'signal' | 'mls';
    fromKeyId: string;
    toKeyId: string;
    publicKey: string;
  }) {
    const previous = this.registerKey({
      did: input.did,
      suite: input.suite,
      keyId: input.fromKeyId,
      publicKey: '0x' + '1'.repeat(64),
    });
    const current = this.registerKey({
      did: input.did,
      suite: input.suite,
      keyId: input.toKeyId,
      publicKey: input.publicKey,
    });
    return {
      previous: {
        ...previous,
        state: 'ROTATING' as const,
      },
      current,
    };
  }

  revokeKey(input: {
    did: string;
    suite: 'signal' | 'mls';
    keyId: string;
    reason: string;
  }) {
    return {
      did: input.did,
      suite: input.suite,
      keyId: input.keyId,
      publicKey: '0x' + '1'.repeat(64),
      state: 'REVOKED' as const,
      createdAtMs: Date.now(),
      activatedAtMs: Date.now(),
      revokedAtMs: Date.now(),
      revokeReason: input.reason,
    };
  }

  recoverKey(input: {
    did: string;
    suite: 'signal' | 'mls';
    revokedKeyId: string;
    recoveredKeyId: string;
    publicKey: string;
  }) {
    return {
      revoked: {
        did: input.did,
        suite: input.suite,
        keyId: input.revokedKeyId,
        publicKey: '0x' + '1'.repeat(64),
        state: 'RECOVERED' as const,
        createdAtMs: Date.now(),
        activatedAtMs: Date.now(),
      },
      recovered: {
        did: input.did,
        suite: input.suite,
        keyId: input.recoveredKeyId,
        publicKey: input.publicKey,
        state: 'ACTIVE' as const,
        createdAtMs: Date.now(),
        activatedAtMs: Date.now(),
      },
    };
  }

  listKeys(did: string, suite?: 'signal' | 'mls') {
    const bucket = this.keys.get(did) ?? [];
    return suite ? bucket.filter((entry) => entry.suite === suite) : bucket;
  }

  assertCanUseKey() {
    return true;
  }
}

class FakeClawNetGatewayService {
  baseUrl = 'http://127.0.0.1:9528';

  async getBalance(did?: string) {
    return {
      did: did ?? 'did:claw:zSelf',
      address: '0x' + '1'.repeat(40),
      native: '1000000000000000000',
      token: '2000000000000000000',
    };
  }

  async getNonce(_did?: string) {
    return {
      nonce: 1,
      address: '0x' + '1'.repeat(40),
    };
  }

  async resolveIdentity(did: string) {
    return {
      did,
      address: '0x' + '2'.repeat(40),
      isActive: true,
      controller: '0x' + '2'.repeat(40),
      activeKey: '0x22',
      document: {
        capabilities: ['chat'],
        keyHistory: [],
      },
    };
  }

  async getSelfIdentity() {
    return this.resolveIdentity('did:claw:zSelf');
  }
}

class FakeSessionManager {
  async unlock() {
    return {
      sessionToken: 'tses_test_token',
      expiresAt: new Date(Date.now() + 60_000),
      scope: ['transfer', 'escrow', 'market', 'contract', 'reputation', 'identity'],
    };
  }

  lock() {}

  getSessionInfo() {
    return {
      active: true,
      expiresAt: new Date(Date.now() + 60_000),
      scope: ['transfer'],
      operationsUsed: 0,
      createdAt: new Date(),
    };
  }
}

class FakeNonceManager {}

class FakeClawNetTransportService {
  async sendEnvelope() {
    return { messageId: 'fake-msg-id', delivered: true };
  }
  startListening() {}
  stopListening() {}
}

async function startTestServer() {
  const identityService = new FakeIdentityService();
  const messageService = new FakeMessageService(identityService);
  const context: RuntimeContext = {
    config: { host: '127.0.0.1', port: 0 },
    identityService: identityService as unknown as RuntimeContext['identityService'],
    groupService: new FakeGroupService() as unknown as RuntimeContext['groupService'],
    messageService: messageService as unknown as RuntimeContext['messageService'],
    attachmentService: new FakeAttachmentService() as unknown as RuntimeContext['attachmentService'],
    monitoringService: new FakeMonitoringService() as unknown as RuntimeContext['monitoringService'],
    keyLifecycleService: new FakeKeyLifecycleService() as unknown as RuntimeContext['keyLifecycleService'],
    clawnetGateway: new FakeClawNetGatewayService() as unknown as RuntimeContext['clawnetGateway'],
    clawnetTransportService: new FakeClawNetTransportService() as unknown as RuntimeContext['clawnetTransportService'],
    sessionManager: new FakeSessionManager() as unknown as RuntimeContext['sessionManager'],
    nonceManager: new FakeNonceManager() as unknown as RuntimeContext['nonceManager'],
    contactService: {} as unknown as RuntimeContext['contactService'],
    selfProfileStore: {} as unknown as RuntimeContext['selfProfileStore'],
    peerProfileRepository: {} as unknown as RuntimeContext['peerProfileRepository'],
  };

  const server = new ApiServer(context);
  await server.start();

  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP address');
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test('created response returns data envelope and Location header', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const response = await fetch(`${baseUrl}/api/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({
      senderDid: 'did:claw:zSelf',
      conversationId: 'group:0x' + 'b'.repeat(64),
      conversationType: 'group',
      targetDomain: 'alpha.tel',
      targetDid: 'did:claw:zBob',
      mailboxKeyId: 'mailbox-1',
      sealedHeader: '0x11',
      ciphertext: '0x22',
      contentType: 'text',
      ttlSec: 3600,
    }),
  });

  assert.equal(response.status, 201);
  assert.match(response.headers.get('location') ?? '', /^\/api\/v1\/messages\/pull\?/);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);

  const body = (await response.json()) as {
    data: { envelope: { envelopeId: string; seq: string }; p2pDelivered: boolean };
    links: { self: string };
  };
  assert.equal(body.data.envelope.envelopeId, 'env-1');
  assert.equal(body.data.envelope.seq, '1');
  assert.equal(body.data.p2pDelivered, true);
  assert.match(body.links.self, /^\/api\/v1\/messages\/pull\?/);
});

test('list response returns paginated envelope shape', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const groupId = `0x${'b'.repeat(64)}`;
  const response = await fetch(`${baseUrl}/api/v1/groups/${groupId}/members?view=all&page=1&per_page=1`, { headers: AUTH_HEADERS });
  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    data: Array<{ did: string }>;
    meta: { pagination: { page: number; perPage: number; total: number; totalPages: number } };
    links: { self: string; first: string; last: string; prev: string | null; next: string | null };
  };

  assert.equal(body.data.length, 1);
  assert.equal(body.meta.pagination.page, 1);
  assert.equal(body.meta.pagination.perPage, 1);
  assert.equal(body.meta.pagination.total, 2);
  assert.equal(body.meta.pagination.totalPages, 2);
  assert.match(body.links.self, /\/api\/v1\/groups\/.*\/members\?/);
});

test('validation errors use RFC7807 shape and problem+json content type', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const response = await fetch(`${baseUrl}/api/v1/groups`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json/);

  const body = (await response.json()) as {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
    code: string;
  };

  assert.equal(body.status, 400);
  assert.equal(body.title, 'Bad Request');
  assert.equal(body.instance, '/api/v1/groups');
  assert.equal(body.code, 'VALIDATION_ERROR');
  assert.match(body.type, /^https:\/\/telagent\.org\/errors\/validation-error$/);
  assert.ok(body.detail.length > 0);
});

test('node audit snapshot exports de-sensitized envelope and links.self', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const response = await fetch(`${baseUrl}/api/v1/node/audit-snapshot?sample_size=5&retraction_scan_limit=100`);
  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    data: {
      actor: { didHash: string; controllerHash: string; isActive: boolean };
      groups: {
        total: number;
        domainCount: number;
        domainSamples: Array<{ domainHash: string; groupCount: number }>;
        memberStateCounts: { PENDING: number; FINALIZED: number; REMOVED: number };
      };
      messages: {
        activeEnvelopeCount: number;
        retractedCount: number;
        sampledRetractions: Array<{ envelopeIdHash: string; conversationIdHash: string }>;
      };
    };
    links: { self: string };
  };

  assert.equal(body.data.groups.total, 2);
  assert.equal(body.data.groups.domainCount, 2);
  assert.equal(body.data.groups.memberStateCounts.PENDING, 2);
  assert.equal(body.data.groups.memberStateCounts.FINALIZED, 1);
  assert.equal(body.data.messages.retractedCount, 1);
  assert.equal(body.data.messages.sampledRetractions.length, 1);
  assert.equal(body.data.messages.sampledRetractions[0].envelopeIdHash.length, 64);
  assert.match(body.links.self, /^\/api\/v1\/node\/audit-snapshot\?/);

  const serialized = JSON.stringify(body.data);
  assert.equal(serialized.includes('alpha.tel'), false);
  assert.equal(serialized.includes('beta.tel'), false);
  assert.equal(serialized.includes('node-a.tel'), false);
  assert.equal(serialized.includes('env-retracted-1'), false);
  assert.equal(serialized.includes('group:0x' + 'b'.repeat(64)), false);
});

test('node audit snapshot rejects invalid query with RFC7807 response', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const response = await fetch(`${baseUrl}/api/v1/node/audit-snapshot?sample_size=0`);
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json/);

  const body = (await response.json()) as {
    title: string;
    status: number;
    instance: string;
    code: string;
    type: string;
  };

  assert.equal(body.title, 'Bad Request');
  assert.equal(body.status, 400);
  assert.equal(body.instance, '/api/v1/node/audit-snapshot');
  assert.equal(body.code, 'VALIDATION_ERROR');
  assert.match(body.type, /^https:\/\/telagent\.org\/errors\/validation-error$/);
});

test('TA-P12-003 revoked DID event isolates session and rejects message send with RFC7807', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const initialSend = await fetch(`${baseUrl}/api/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({
      senderDid: 'did:claw:zSelf',
      conversationId: 'direct:revoked-contract',
      conversationType: 'direct',
      targetDomain: 'alpha.tel',
      targetDid: 'did:claw:zBob',
      mailboxKeyId: 'mailbox-1',
      sealedHeader: '0x11',
      ciphertext: '0x22',
      contentType: 'text',
      ttlSec: 3600,
    }),
  });
  assert.equal(initialSend.status, 201);

  const revokeRes = await fetch(`${baseUrl}/api/v1/node/revocations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      did: 'did:claw:zSelf',
      source: 'contract-test',
    }),
  });
  assert.equal(revokeRes.status, 201);
  const revokeBody = (await revokeRes.json()) as {
    data: {
      revocation: {
        did: string;
        didHash: string;
        source: string;
      };
    };
  };
  assert.equal(revokeBody.data.revocation.did, 'did:claw:zSelf');
  assert.equal(revokeBody.data.revocation.source, 'contract-test');
  assert.equal(revokeBody.data.revocation.didHash.length, 66);

  const blockedSend = await fetch(`${baseUrl}/api/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({
      senderDid: 'did:claw:zSelf',
      conversationId: 'direct:revoked-contract',
      conversationType: 'direct',
      targetDomain: 'alpha.tel',
      targetDid: 'did:claw:zBob',
      mailboxKeyId: 'mailbox-1',
      sealedHeader: '0x11',
      ciphertext: '0x33',
      contentType: 'text',
      ttlSec: 3600,
    }),
  });

  assert.equal(blockedSend.status, 422);
  assert.match(blockedSend.headers.get('content-type') ?? '', /^application\/problem\+json/);
  const blockedBody = (await blockedSend.json()) as {
    title: string;
    status: number;
    code: string;
    type: string;
    instance: string;
  };
  assert.equal(blockedBody.title, 'Unprocessable Entity');
  assert.equal(blockedBody.status, 422);
  assert.equal(blockedBody.code, 'UNPROCESSABLE_ENTITY');
  assert.equal(blockedBody.instance, '/api/v1/messages');
  assert.match(blockedBody.type, /^https:\/\/telagent\.org\/errors\/unprocessable-entity$/);

  const auditRes = await fetch(`${baseUrl}/api/v1/node/audit-snapshot?sample_size=5&retraction_scan_limit=100`);
  assert.equal(auditRes.status, 200);
  const auditBody = (await auditRes.json()) as {
    data: {
      messages: {
        revokedDidCount: number;
        isolatedConversationCount: number;
        isolationEventCount: number;
      };
    };
  };
  assert.equal(auditBody.data.messages.revokedDidCount, 1);
  assert.equal(auditBody.data.messages.isolatedConversationCount, 1);
  assert.equal(auditBody.data.messages.isolationEventCount, 1);
});

test('not found uses RFC7807 shape', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const response = await fetch(`${baseUrl}/api/v1/not-exist`, { headers: AUTH_HEADERS });
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json/);

  const body = (await response.json()) as {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
    code: string;
  };

  assert.equal(body.title, 'Not Found');
  assert.equal(body.status, 404);
  assert.equal(body.instance, '/api/v1/not-exist');
  assert.equal(body.code, 'NOT_FOUND');
  assert.match(body.type, /^https:\/\/telagent\.org\/errors\/not-found$/);
});

test('identities and groups endpoints are accessible with expected status codes', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const groupId = `0x${'b'.repeat(64)}`;
  const inviteId = `0x${'c'.repeat(64)}`;
  const did = 'did:claw:zM2';

  const selfRes = await fetch(`${baseUrl}/api/v1/identities/self`);
  assert.equal(selfRes.status, 200);

  const nodeRes = await fetch(`${baseUrl}/api/v1/node`);
  assert.equal(nodeRes.status, 200);

  const metricsRes = await fetch(`${baseUrl}/api/v1/node/metrics`);
  assert.equal(metricsRes.status, 200);

  const permissionsRes = await fetch(`${baseUrl}/api/v1/owner/permissions`, { headers: AUTH_HEADERS });
  assert.equal(permissionsRes.status, 200);

  const conversationsRes = await fetch(`${baseUrl}/api/v1/conversations?page=1&per_page=20`, { headers: AUTH_HEADERS });
  assert.equal(conversationsRes.status, 200);

  const resolveRes = await fetch(`${baseUrl}/api/v1/identities/${encodeURIComponent(did)}`, { headers: AUTH_HEADERS });
  assert.equal(resolveRes.status, 200);

  const createGroupRes = await fetch(`${baseUrl}/api/v1/groups`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({
      creatorDid: 'did:claw:zSelf',
      groupId,
      groupDomain: 'alpha.tel',
      domainProofHash: `0x${'3'.repeat(64)}`,
      initialMlsStateHash: `0x${'4'.repeat(64)}`,
    }),
  });
  assert.equal(createGroupRes.status, 201);

  const getGroupRes = await fetch(`${baseUrl}/api/v1/groups/${groupId}`, { headers: AUTH_HEADERS });
  assert.equal(getGroupRes.status, 200);

  const membersRes = await fetch(`${baseUrl}/api/v1/groups/${groupId}/members?view=all&page=1&per_page=20`, { headers: AUTH_HEADERS });
  assert.equal(membersRes.status, 200);

  const inviteRes = await fetch(`${baseUrl}/api/v1/groups/${groupId}/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({
      inviterDid: 'did:claw:zSelf',
      inviteeDid: did,
      inviteId,
      mlsCommitHash: `0x${'5'.repeat(64)}`,
    }),
  });
  assert.equal(inviteRes.status, 201);

  const acceptRes = await fetch(`${baseUrl}/api/v1/groups/${groupId}/invites/${inviteId}/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({
      inviteeDid: did,
      mlsWelcomeHash: `0x${'6'.repeat(64)}`,
    }),
  });
  assert.equal(acceptRes.status, 201);

  const removeRes = await fetch(`${baseUrl}/api/v1/groups/${groupId}/members/${encodeURIComponent(did)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({
      operatorDid: 'did:claw:zSelf',
      mlsCommitHash: `0x${'7'.repeat(64)}`,
    }),
  });
  assert.equal(removeRes.status, 204);

  const chainStateRes = await fetch(`${baseUrl}/api/v1/groups/${groupId}/chain-state`, { headers: AUTH_HEADERS });
  assert.equal(chainStateRes.status, 200);
});

test('conversation privacy rejects unauthenticated callers and syncs private flags across APIs', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const conversationId = 'direct:did:claw:zSelf:did:claw:zPeer';
  const encodedConversationId = encodeURIComponent(conversationId);

  const noAuthDenied = await fetch(`${baseUrl}/api/v1/conversations/${encodedConversationId}/privacy`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ private: true }),
  });
  assert.equal(noAuthDenied.status, 401);
  assert.match(noAuthDenied.headers.get('content-type') ?? '', /^application\/problem\+json/);
  const noAuthBody = (await noAuthDenied.json()) as {
    title: string;
    status: number;
    code: string;
  };
  assert.equal(noAuthBody.title, 'Unauthorized');
  assert.equal(noAuthBody.status, 401);
  assert.equal(noAuthBody.code, 'UNAUTHORIZED');

  const setPrivate = await fetch(`${baseUrl}/api/v1/conversations/${encodedConversationId}/privacy`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer tses_test_token',
    },
    body: JSON.stringify({ private: true }),
  });
  assert.equal(setPrivate.status, 200);
  const setPrivateBody = (await setPrivate.json()) as {
    data: {
      conversationId: string;
      private: boolean;
      updatedAtMs: number;
    };
    links: {
      self: string;
    };
  };
  assert.equal(setPrivateBody.data.conversationId, conversationId);
  assert.equal(setPrivateBody.data.private, true);
  assert.equal(Number.isInteger(setPrivateBody.data.updatedAtMs), true);
  assert.equal(setPrivateBody.links.self, `/api/v1/conversations/${encodedConversationId}/privacy`);

  const conversationsRes = await fetch(`${baseUrl}/api/v1/conversations?page=1&per_page=20`, { headers: AUTH_HEADERS });
  assert.equal(conversationsRes.status, 200);
  const conversationsBody = (await conversationsRes.json()) as {
    data: Array<{
      conversationId: string;
      private: boolean;
      lastMessagePreview: string | null;
    }>;
  };
  const conversation = conversationsBody.data.find((item) => item.conversationId === conversationId);
  assert.ok(conversation);
  assert.equal(conversation.private, true);
  assert.equal(conversation.lastMessagePreview, null);

  const permissionsRes = await fetch(`${baseUrl}/api/v1/owner/permissions`, { headers: AUTH_HEADERS });
  assert.equal(permissionsRes.status, 200);
  const permissionsBody = (await permissionsRes.json()) as {
    data: {
      privateConversations: string[];
    };
  };
  assert.equal(permissionsBody.data.privateConversations.includes(conversationId), true);
});

test('messages, attachments and key endpoints are accessible', async (t) => {
  const { server, baseUrl } = await startTestServer();
  t.after(async () => {
    await server.stop();
  });

  const pullRes = await fetch(`${baseUrl}/api/v1/messages/pull?limit=20`, { headers: AUTH_HEADERS });
  assert.equal(pullRes.status, 200);

  const retractedRes = await fetch(`${baseUrl}/api/v1/messages/retracted?limit=20`, { headers: AUTH_HEADERS });
  assert.equal(retractedRes.status, 200);

  const initUploadRes = await fetch(`${baseUrl}/api/v1/attachments/init-upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({
      filename: 'a.png',
      contentType: 'image/png',
      sizeBytes: 1024,
      manifestHash: `0x${'8'.repeat(64)}`,
    }),
  });
  assert.equal(initUploadRes.status, 201);

  const completeUploadRes = await fetch(`${baseUrl}/api/v1/attachments/complete-upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({
      objectKey: 'attachments/o1',
      manifestHash: `0x${'8'.repeat(64)}`,
      checksum: `0x${'9'.repeat(64)}`,
    }),
  });
  assert.equal(completeUploadRes.status, 200);

  const keyRegisterRes = await fetch(`${baseUrl}/api/v1/keys/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({
      did: 'did:claw:zSelf',
      suite: 'signal',
      keyId: 'signal-key-v1',
      publicKey: `0x${'9'.repeat(64)}`,
    }),
  });
  assert.equal(keyRegisterRes.status, 201);

  const keyRotateRes = await fetch(`${baseUrl}/api/v1/keys/rotate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...AUTH_HEADERS },
    body: JSON.stringify({
      did: 'did:claw:zSelf',
      suite: 'signal',
      fromKeyId: 'signal-key-v1',
      toKeyId: 'signal-key-v2',
      publicKey: `0x${'8'.repeat(64)}`,
      gracePeriodSec: 60,
    }),
  });
  assert.equal(keyRotateRes.status, 200);

  const keyListRes = await fetch(`${baseUrl}/api/v1/keys/${encodeURIComponent('did:claw:zSelf')}?suite=signal`, { headers: AUTH_HEADERS });
  assert.equal(keyListRes.status, 200);
});
