import { canonicalizeBytes } from '@clawtoken/core/crypto';
import { bytesToUtf8, concatBytes, hexToBytes } from '@clawtoken/core/utils';
import { eventHashHex, MAX_CLOCK_SKEW_MS } from '@clawtoken/core/protocol';
import {
  EventStore,
  SnapshotRecord,
  SnapshotStore,
  verifySnapshotHash,
  verifySnapshotSignatures,
} from '@clawtoken/core/storage';
import { P2PNode, PubsubMessage, TOPIC_EVENTS, TOPIC_REQUESTS, TOPIC_RESPONSES } from '@clawtoken/core/p2p';
import {
  CONTENT_TYPE,
  P2PEnvelope,
  RangeResponse,
  RequestMessage,
  RequestType,
  ResponseMessage,
  ResponseType,
  SnapshotResponse,
  decodeP2PEnvelopeBytes,
  decodeRequestMessageBytes,
  decodeResponseMessageBytes,
  encodeP2PEnvelopeBytes,
  encodeRequestMessageBytes,
  encodeResponseMessageBytes,
  powTicketHashHex,
  signP2PEnvelope,
  verifyPeerRotateNewSignature,
  verifyPeerRotateOldSignature,
  verifyPowTicketSignature,
  verifyP2PEnvelopeSignature,
  verifyStakeProofControllerSignature,
  verifyStakeProofPeerSignature,
} from '@clawtoken/protocol/p2p';

export type SybilPolicy = 'none' | 'allowlist' | 'pow' | 'stake';

export interface P2PSyncConfig {
  maxEnvelopeBytes: number;
  maxRangeLimit: number;
  maxRangeBytes: number;
  maxSnapshotBytes: number;
  maxSnapshotTotalBytes: number;
  minSnapshotSignatures: number;
  rateLimitWindowMs: number;
  maxMessagesPerWindow: number;
  maxBytesPerWindow: number;
  minPeerScore: number;
  scoreIncrease: number;
  scoreDecrease: number;
  scoreDecayMs: number;
  sybilPolicy: SybilPolicy;
  allowlist: string[];
  powTicketTtlMs: number;
  stakeProofTtlMs: number;
  minPowDifficulty: number;
  verifySignatures: boolean;
  verifyEventHash: boolean;
  verifySnapshotHash: boolean;
  verifySnapshotSignatures: boolean;
  verifySnapshotState: boolean;
  verifyPeerId: boolean;
  subscribeEvents: boolean;
}

export interface P2PSyncOptions extends Partial<P2PSyncConfig> {
  peerId: string;
  peerPrivateKey: Uint8Array;
  resolvePeerPublicKey?: (peerId: string) => Promise<Uint8Array | null>;
  resolveControllerPublicKey?: (controllerDid: string) => Promise<Uint8Array | null>;
  validateSnapshotState?: (
    snapshot: SnapshotRecord,
    events: Uint8Array[],
  ) => Promise<boolean> | boolean;
}

export const DEFAULT_P2P_SYNC_CONFIG: P2PSyncConfig = {
  maxEnvelopeBytes: 1_000_000,
  maxRangeLimit: 256,
  maxRangeBytes: 900_000,
  maxSnapshotBytes: 900_000,
  maxSnapshotTotalBytes: 8_000_000,
  minSnapshotSignatures: 2,
  rateLimitWindowMs: 60_000,
  maxMessagesPerWindow: 200,
  maxBytesPerWindow: 2_000_000,
  minPeerScore: -10,
  scoreIncrease: 1,
  scoreDecrease: 1,
  scoreDecayMs: 10 * 60 * 1000,
  sybilPolicy: 'none',
  allowlist: [],
  powTicketTtlMs: 10 * 60 * 1000,
  stakeProofTtlMs: 60 * 60 * 1000,
  minPowDifficulty: 0,
  verifySignatures: true,
  verifyEventHash: true,
  verifySnapshotHash: true,
  verifySnapshotSignatures: true,
  verifySnapshotState: true,
  verifyPeerId: true,
  subscribeEvents: true,
};

interface SnapshotChunkState {
  totalBytes: number;
  chunkCount: number;
  received: Map<number, Uint8Array>;
  receivedBytes: number;
  updatedAt: number;
}

export class P2PSync {
  private readonly config: P2PSyncConfig;
  private readonly resolvePeerPublicKey?: (peerId: string) => Promise<Uint8Array | null>;
  private readonly resolveControllerPublicKey?: (controllerDid: string) => Promise<Uint8Array | null>;
  private readonly validateSnapshotState?: (
    snapshot: SnapshotRecord,
    events: Uint8Array[],
  ) => Promise<boolean> | boolean;
  private unsubscribeRequests?: () => void;
  private unsubscribeResponses?: () => void;
  private unsubscribeEvents?: () => void;
  private readonly snapshotChunks = new Map<string, SnapshotChunkState>();
  private readonly snapshotChunkTtlMs = 5 * 60 * 1000;
  private readonly allowlist = new Set<string>();
  private readonly powTickets = new Map<string, { receivedAt: number }>();
  private readonly stakeProofs = new Map<string, { receivedAt: number }>();
  private readonly peerStats = new Map<string, { windowStart: number; count: number; bytes: number }>();
  private readonly peerScores = new Map<string, { score: number; updatedAt: number }>();
  private readonly peerRotations = new Map<string, { newPeer: string; ts: number }>();

  constructor(
    private readonly node: P2PNode,
    private readonly eventStore: EventStore,
    private readonly snapshotStore: SnapshotStore | null,
    private readonly options: P2PSyncOptions,
  ) {
    this.config = { ...DEFAULT_P2P_SYNC_CONFIG, ...options };
    this.resolvePeerPublicKey = options.resolvePeerPublicKey;
    this.resolveControllerPublicKey = options.resolveControllerPublicKey;
    this.validateSnapshotState = options.validateSnapshotState;
    for (const peer of this.config.allowlist ?? []) {
      if (peer) {
        this.allowlist.add(peer);
      }
    }
  }

  async start(): Promise<void> {
    this.unsubscribeRequests = await this.node.subscribe(TOPIC_REQUESTS, (message) =>
      this.handleRequest(message),
    );
    this.unsubscribeResponses = await this.node.subscribe(TOPIC_RESPONSES, (message) =>
      this.handleResponse(message),
    );
    if (this.config.subscribeEvents) {
      this.unsubscribeEvents = await this.node.subscribe(TOPIC_EVENTS, (message) =>
        this.handleEventEnvelope(message),
      );
    }
  }

  async stop(): Promise<void> {
    this.unsubscribeRequests?.();
    this.unsubscribeResponses?.();
    this.unsubscribeEvents?.();
    this.unsubscribeRequests = undefined;
    this.unsubscribeResponses = undefined;
    this.unsubscribeEvents = undefined;
  }

  async requestRange(from: string, limit?: number): Promise<void> {
    const request: RequestMessage = {
      type: RequestType.RangeRequest,
      rangeRequest: {
        from,
        limit: limit ?? this.config.maxRangeLimit,
      },
    };
    await this.publishRequest(request);
  }

  async requestSnapshot(from = ''): Promise<void> {
    const request: RequestMessage = {
      type: RequestType.SnapshotRequest,
      snapshotRequest: {
        from,
      },
    };
    await this.publishRequest(request);
  }

  private async publishRequest(request: RequestMessage): Promise<void> {
    const payload = encodeRequestMessageBytes(request);
    const envelope = await this.signEnvelope({
      v: 1,
      topic: TOPIC_REQUESTS,
      sender: this.options.peerId,
      ts: BigInt(Date.now()),
      contentType: CONTENT_TYPE,
      payload,
    });
    const bytes = encodeP2PEnvelopeBytes(envelope);
    await this.node.publish(TOPIC_REQUESTS, bytes);
  }

  private async publishResponse(response: ResponseMessage): Promise<void> {
    const payload = encodeResponseMessageBytes(response);
    const envelope = await this.signEnvelope({
      v: 1,
      topic: TOPIC_RESPONSES,
      sender: this.options.peerId,
      ts: BigInt(Date.now()),
      contentType: CONTENT_TYPE,
      payload,
    });
    const bytes = encodeP2PEnvelopeBytes(envelope);
    await this.node.publish(TOPIC_RESPONSES, bytes);
  }

  private async signEnvelope(envelope: Omit<P2PEnvelope, 'sig'>): Promise<P2PEnvelope> {
    return signP2PEnvelope(envelope, this.options.peerPrivateKey);
  }

  private async handleRequest(message: PubsubMessage): Promise<void> {
    const envelope = await this.decodeEnvelope(message);
    if (!envelope) {
      return;
    }
    const request = this.decodeRequest(envelope);
    if (!request) {
      return;
    }
    switch (request.type) {
      case RequestType.RangeRequest:
        await this.handleRangeRequest(request);
        break;
      case RequestType.SnapshotRequest:
        await this.handleSnapshotRequest(request);
        break;
      case RequestType.PeerRotate:
        await this.handlePeerRotate(request, envelope.sender);
        break;
      case RequestType.PowTicket:
        await this.handlePowTicket(request, envelope.sender);
        break;
      case RequestType.StakeProof:
        await this.handleStakeProof(request, envelope.sender);
        break;
      default:
        break;
    }
  }

  private async handleResponse(message: PubsubMessage): Promise<void> {
    const envelope = await this.decodeEnvelope(message);
    if (!envelope) {
      return;
    }
    const response = this.decodeResponse(envelope);
    if (!response) {
      return;
    }
    switch (response.type) {
      case ResponseType.RangeResponse:
        await this.applyRangeResponse(response.rangeResponse ?? null);
        break;
      case ResponseType.SnapshotResponse:
        await this.applySnapshotResponse(response.snapshotResponse ?? null);
        break;
      default:
        break;
    }
  }

  private async handleEventEnvelope(message: PubsubMessage): Promise<void> {
    const envelope = await this.decodeEnvelope(message);
    if (!envelope) {
      return;
    }
    if (envelope.topic !== TOPIC_EVENTS) {
      return;
    }
    await this.applyEventBytes(envelope.payload);
  }

  private async handleRangeRequest(request: RequestMessage): Promise<void> {
    if (!request.rangeRequest) {
      return;
    }
    const limit = Math.min(
      Math.max(request.rangeRequest.limit, 0),
      this.config.maxRangeLimit,
    );
    if (limit <= 0) {
      return;
    }
    const from = request.rangeRequest.from || '';
    const range = await this.eventStore.getEventLogRange(
      from,
      limit,
      this.config.maxRangeBytes,
    );
    const response: ResponseMessage = {
      type: ResponseType.RangeResponse,
      rangeResponse: range,
    };
    await this.publishResponse(response);
  }

  private async handleSnapshotRequest(request: RequestMessage): Promise<void> {
    if (!request.snapshotRequest || !this.snapshotStore) {
      return;
    }
    const latest = await this.snapshotStore.loadLatestSnapshotBytes();
    if (!latest) {
      return;
    }
    if (request.snapshotRequest.from && request.snapshotRequest.from === latest.hash) {
      return;
    }
    if (latest.bytes.length > this.config.maxSnapshotTotalBytes) {
      return;
    }
    if (latest.bytes.length <= this.config.maxSnapshotBytes) {
      const response: ResponseMessage = {
        type: ResponseType.SnapshotResponse,
        snapshotResponse: {
          hash: latest.hash,
          snapshot: latest.bytes,
          totalBytes: latest.bytes.length,
          chunkIndex: 0,
          chunkCount: 1,
        },
      };
      await this.publishResponse(response);
      return;
    }
    const chunkCount = Math.ceil(latest.bytes.length / this.config.maxSnapshotBytes);
    for (let i = 0; i < chunkCount; i++) {
      const start = i * this.config.maxSnapshotBytes;
      const end = Math.min(start + this.config.maxSnapshotBytes, latest.bytes.length);
      const chunk = latest.bytes.subarray(start, end);
      const response: ResponseMessage = {
        type: ResponseType.SnapshotResponse,
        snapshotResponse: {
          hash: latest.hash,
          snapshot: chunk,
          totalBytes: latest.bytes.length,
          chunkIndex: i,
          chunkCount,
        },
      };
      await this.publishResponse(response);
    }
  }

  private async applyRangeResponse(response: RangeResponse | null): Promise<void> {
    if (!response) {
      return;
    }
    for (const eventBytes of response.events) {
      await this.applyEventBytes(eventBytes);
    }
  }

  private async applySnapshotResponse(response: SnapshotResponse | null): Promise<void> {
    if (!response || !this.snapshotStore) {
      return;
    }
    if (!response.hash || !response.snapshot.length) {
      return;
    }
    const snapshotBytes = this.collectSnapshotBytes(response);
    if (!snapshotBytes) {
      return;
    }
    let snapshot: SnapshotRecord;
    try {
      snapshot = JSON.parse(bytesToUtf8(snapshotBytes)) as SnapshotRecord;
    } catch {
      return;
    }
    if (!snapshot?.hash || snapshot.hash !== response.hash) {
      return;
    }
    if (this.config.verifySnapshotHash && !verifySnapshotHash(snapshot)) {
      return;
    }
    if (this.config.verifySnapshotSignatures) {
      const { validPeers } = await verifySnapshotSignatures(
        snapshot,
        (peerId) => this.resolvePublicKey(peerId),
        { minSignatures: 1 },
      );
      const eligiblePeers = validPeers.filter((peer) => this.isPeerEligible(peer));
      if (eligiblePeers.length < this.config.minSnapshotSignatures) {
        return;
      }
    }
    const latest = await this.snapshotStore.loadLatestSnapshot();
    if (snapshot.prev) {
      if (!latest || latest.hash !== snapshot.prev) {
        return;
      }
    } else if (latest) {
      return;
    }
    if (this.config.verifySnapshotState) {
      if (!this.validateSnapshotState) {
        return;
      }
      const events = await this.collectEventsForSnapshot(latest?.at ?? null, snapshot.at);
      if (!events) {
        return;
      }
      const ok = await this.validateSnapshotState(snapshot, events);
      if (!ok) {
        return;
      }
    }
    await this.snapshotStore.saveSnapshot(snapshot);
  }

  private async applyEventBytes(eventBytes: Uint8Array): Promise<void> {
    const envelope = this.parseEventEnvelope(eventBytes);
    if (!envelope) {
      return;
    }
    let canonical: Uint8Array;
    try {
      canonical = canonicalizeBytes(envelope);
    } catch {
      return;
    }
    if (!bytesEqual(canonical, eventBytes)) {
      return;
    }
    const hash = envelope.hash;
    if (typeof hash !== 'string' || !hash.length) {
      return;
    }
    if (this.config.verifyEventHash) {
      const computed = eventHashHex(envelope);
      if (computed !== hash) {
        return;
      }
    }
    try {
      await this.eventStore.appendEvent(hash, eventBytes);
    } catch {
      return;
    }
  }

  private parseEventEnvelope(eventBytes: Uint8Array): Record<string, unknown> | null {
    try {
      return JSON.parse(bytesToUtf8(eventBytes)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private decodeRequest(envelope: P2PEnvelope): RequestMessage | null {
    if (envelope.topic !== TOPIC_REQUESTS) {
      return null;
    }
    try {
      return decodeRequestMessageBytes(envelope.payload);
    } catch {
      return null;
    }
  }

  private decodeResponse(envelope: P2PEnvelope): ResponseMessage | null {
    if (envelope.topic !== TOPIC_RESPONSES) {
      return null;
    }
    try {
      return decodeResponseMessageBytes(envelope.payload);
    } catch {
      return null;
    }
  }

  private async decodeEnvelope(message: PubsubMessage): Promise<P2PEnvelope | null> {
    if (message.data.length > this.config.maxEnvelopeBytes) {
      if (message.from) {
        this.updatePeerScore(message.from, -this.config.scoreDecrease);
      }
      return null;
    }
    let envelope: P2PEnvelope;
    try {
      envelope = decodeP2PEnvelopeBytes(message.data);
    } catch {
      if (message.from) {
        this.updatePeerScore(message.from, -this.config.scoreDecrease);
      }
      return null;
    }
    const sender = envelope.sender || message.from || '';
    if (!sender) {
      return null;
    }
    if (!envelope.sender && sender) {
      envelope.sender = sender;
    }
    if (message.from && envelope.sender && message.from !== envelope.sender) {
      this.updatePeerScore(sender, -this.config.scoreDecrease);
      return null;
    }
    if (this.isRateLimited(sender, message.data.length)) {
      this.updatePeerScore(sender, -this.config.scoreDecrease);
      return null;
    }
    if (!this.isPeerScoreEligible(sender)) {
      return null;
    }
    if (envelope.contentType !== CONTENT_TYPE) {
      this.updatePeerScore(sender, -this.config.scoreDecrease);
      return null;
    }
    if (sender === this.options.peerId) {
      return null;
    }
    let publicKey: Uint8Array | null = null;
    if (this.config.verifyPeerId || this.config.verifySignatures) {
      publicKey = await this.resolvePublicKey(sender);
      if (!publicKey) {
        this.updatePeerScore(sender, -this.config.scoreDecrease);
        return null;
      }
    }
    if (this.config.verifyPeerId) {
      if (!publicKey) {
        return null;
      }
      const okPeerId = await this.verifyPeerId(sender, publicKey);
      if (!okPeerId) {
        this.updatePeerScore(sender, -this.config.scoreDecrease);
        return null;
      }
    }
    if (this.config.verifySignatures) {
      if (!publicKey) {
        return null;
      }
      const ok = await verifyP2PEnvelopeSignature(envelope, publicKey);
      if (!ok) {
        this.updatePeerScore(sender, -this.config.scoreDecrease);
        return null;
      }
    }
    this.updatePeerScore(sender, this.config.scoreIncrease);
    return envelope;
  }

  private async resolvePublicKey(peerId: string): Promise<Uint8Array | null> {
    if (this.resolvePeerPublicKey) {
      return this.resolvePeerPublicKey(peerId);
    }
    return this.node.getPeerPublicKey(peerId);
  }

  private async handlePowTicket(request: RequestMessage, sender: string): Promise<void> {
    const ticket = request.powTicket;
    if (!ticket || ticket.peer !== sender) {
      return;
    }
    const now = Date.now();
    const ts = Number(ticket.ts ?? 0n);
    if (Number.isNaN(ts) || Math.abs(now - ts) > MAX_CLOCK_SKEW_MS) {
      return;
    }
    const expected = powTicketHashHex(ticket);
    if (ticket.hash !== ticket.hash.toLowerCase()) {
      return;
    }
    if (!/^[0-9a-f]{64}$/.test(ticket.hash)) {
      return;
    }
    if (expected !== ticket.hash) {
      return;
    }
    if (!hasLeadingZeroBits(expected, ticket.difficulty)) {
      return;
    }
    if (ticket.difficulty < this.config.minPowDifficulty) {
      return;
    }
    const publicKey = await this.resolvePublicKey(ticket.peer);
    if (!publicKey) {
      return;
    }
    const ok = await verifyPowTicketSignature(ticket, publicKey);
    if (!ok) {
      return;
    }
    this.powTickets.set(ticket.peer, { receivedAt: now });
  }

  private async handleStakeProof(request: RequestMessage, sender: string): Promise<void> {
    const proof = request.stakeProof;
    if (!proof || proof.peer !== sender) {
      return;
    }
    const stakeBytes = await this.eventStore.getEvent(proof.stakeEvent);
    if (!stakeBytes) {
      return;
    }
    const stakeEnvelope = this.parseEventEnvelope(stakeBytes);
    if (!stakeEnvelope) {
      return;
    }
    if (stakeEnvelope.hash !== proof.stakeEvent) {
      return;
    }
    if (stakeEnvelope.type !== 'wallet.stake') {
      return;
    }
    if (stakeEnvelope.issuer !== proof.controller) {
      return;
    }
    const payload = stakeEnvelope.payload as Record<string, unknown> | undefined;
    const amount = typeof payload?.amount === 'string' ? payload.amount : null;
    if (!amount) {
      return;
    }
    if (compareTokenAmounts(amount, proof.minStake) < 0) {
      return;
    }
    const peerPublicKey = await this.resolvePublicKey(proof.peer);
    if (!peerPublicKey) {
      return;
    }
    const okPeer = await verifyStakeProofPeerSignature(proof, peerPublicKey);
    if (!okPeer) {
      return;
    }
    if (!this.resolveControllerPublicKey) {
      return;
    }
    const controllerKey = await this.resolveControllerPublicKey(proof.controller);
    if (!controllerKey) {
      return;
    }
    const okController = await verifyStakeProofControllerSignature(proof, controllerKey);
    if (!okController) {
      return;
    }
    this.stakeProofs.set(proof.peer, { receivedAt: Date.now() });
  }

  private async handlePeerRotate(request: RequestMessage, sender: string): Promise<void> {
    const rotate = request.peerRotate;
    if (!rotate) {
      return;
    }
    if (sender !== rotate.old && sender !== rotate['new']) {
      return;
    }
    const ts = Number(rotate.ts ?? 0n);
    if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
      return;
    }
    const oldKey = await this.resolvePublicKey(rotate.old);
    const newKey = await this.resolvePublicKey(rotate['new']);
    if (!oldKey || !newKey) {
      return;
    }
    const okOld = await verifyPeerRotateOldSignature(rotate, oldKey);
    if (!okOld) {
      return;
    }
    const okNew = await verifyPeerRotateNewSignature(rotate, newKey);
    if (!okNew) {
      return;
    }
    this.peerRotations.set(rotate.old, { newPeer: rotate['new'], ts });
    if (this.allowlist.has(rotate.old)) {
      this.allowlist.add(rotate['new']);
    }
  }

  private isPeerEligible(peerId: string): boolean {
    if (this.allowlist.has(peerId)) {
      return true;
    }
    switch (this.config.sybilPolicy) {
      case 'none':
        return true;
      case 'allowlist':
        return this.allowlist.has(peerId);
      case 'pow':
        return this.isPowEligible(peerId);
      case 'stake':
        return this.isStakeEligible(peerId);
      default:
        return false;
    }
  }

  private isPowEligible(peerId: string): boolean {
    this.cleanupSybilCaches();
    return this.powTickets.has(peerId);
  }

  private isStakeEligible(peerId: string): boolean {
    this.cleanupSybilCaches();
    return this.stakeProofs.has(peerId);
  }

  private cleanupSybilCaches(): void {
    const now = Date.now();
    for (const [peer, entry] of this.powTickets.entries()) {
      if (now - entry.receivedAt > this.config.powTicketTtlMs) {
        this.powTickets.delete(peer);
      }
    }
    for (const [peer, entry] of this.stakeProofs.entries()) {
      if (now - entry.receivedAt > this.config.stakeProofTtlMs) {
        this.stakeProofs.delete(peer);
      }
    }
  }

  private collectSnapshotBytes(response: SnapshotResponse): Uint8Array | null {
    const chunkCount = response.chunkCount ?? 0;
    const chunkIndex = response.chunkIndex ?? 0;
    const totalBytes =
      response.totalBytes && response.totalBytes > 0 ? response.totalBytes : response.snapshot.length;

    if (totalBytes <= 0 || totalBytes > this.config.maxSnapshotTotalBytes) {
      return null;
    }
    if (chunkCount <= 1) {
      if (response.snapshot.length > this.config.maxSnapshotBytes) {
        return null;
      }
      if (response.snapshot.length !== totalBytes) {
        return null;
      }
      return response.snapshot;
    }
    if (chunkIndex < 0 || chunkIndex >= chunkCount) {
      return null;
    }
    if (response.snapshot.length > this.config.maxSnapshotBytes) {
      return null;
    }

    this.cleanupSnapshotChunks();
    const key = response.hash;
    let state = this.snapshotChunks.get(key);
    if (!state || state.totalBytes !== totalBytes || state.chunkCount !== chunkCount) {
      state = {
        totalBytes,
        chunkCount,
        received: new Map(),
        receivedBytes: 0,
        updatedAt: Date.now(),
      };
      this.snapshotChunks.set(key, state);
    }
    if (!state.received.has(chunkIndex)) {
      state.received.set(chunkIndex, response.snapshot);
      state.receivedBytes += response.snapshot.length;
      state.updatedAt = Date.now();
    }
    if (state.received.size !== chunkCount) {
      return null;
    }

    const parts: Uint8Array[] = [];
    let assembledBytes = 0;
    for (let i = 0; i < chunkCount; i++) {
      const part = state.received.get(i);
      if (!part) {
        return null;
      }
      parts.push(part);
      assembledBytes += part.length;
    }
    this.snapshotChunks.delete(key);
    if (assembledBytes !== totalBytes) {
      return null;
    }
    return concatBytes(...parts);
  }

  private async collectEventsForSnapshot(
    prevAt: string | null,
    targetAt: string,
  ): Promise<Uint8Array[] | null> {
    if (!targetAt) {
      return null;
    }
    const events: Uint8Array[] = [];
    let cursor = prevAt ?? '';
    let totalBytes = 0;
    const maxTotalBytes = this.config.maxSnapshotTotalBytes;
    let guard = 0;

    while (guard < 10_000) {
      guard += 1;
      const range = await this.eventStore.getEventLogRange(
        cursor,
        this.config.maxRangeLimit,
        this.config.maxRangeBytes,
      );
      if (!range.events.length) {
        return null;
      }
      for (const eventBytes of range.events) {
        events.push(eventBytes);
        totalBytes += eventBytes.length;
        if (totalBytes > maxTotalBytes) {
          return null;
        }
      }
      if (!range.cursor) {
        return null;
      }
      cursor = range.cursor;
      if (cursor === targetAt) {
        return events;
      }
    }

    return null;
  }

  private cleanupSnapshotChunks(): void {
    const now = Date.now();
    for (const [hash, state] of this.snapshotChunks.entries()) {
      if (now - state.updatedAt > this.snapshotChunkTtlMs) {
        this.snapshotChunks.delete(hash);
      }
    }
  }

  private isRateLimited(peerId: string, bytes: number): boolean {
    const now = Date.now();
    const windowMs = this.config.rateLimitWindowMs;
    const current = this.peerStats.get(peerId);
    if (!current || now - current.windowStart >= windowMs) {
      this.peerStats.set(peerId, { windowStart: now, count: 1, bytes });
      return false;
    }
    current.count += 1;
    current.bytes += bytes;
    this.peerStats.set(peerId, current);
    return (
      current.count > this.config.maxMessagesPerWindow ||
      current.bytes > this.config.maxBytesPerWindow
    );
  }

  private updatePeerScore(peerId: string, delta: number): void {
    const now = Date.now();
    const current = this.peerScores.get(peerId);
    let score = current?.score ?? 0;
    const updatedAt = current?.updatedAt ?? now;
    if (now - updatedAt > this.config.scoreDecayMs) {
      score = 0;
    }
    score += delta;
    this.peerScores.set(peerId, { score, updatedAt: now });
  }

  private isPeerScoreEligible(peerId: string): boolean {
    const score = this.peerScores.get(peerId)?.score ?? 0;
    return score >= this.config.minPeerScore;
  }

  private async verifyPeerId(peerId: string, publicKey: Uint8Array): Promise<boolean> {
    try {
      const factory: any = await import('@libp2p/peer-id-factory');
      const createFromPubKey =
        factory.createFromPubKey ?? factory.createFromPublicKey ?? factory.createFromPubKeyBytes;
      if (typeof createFromPubKey !== 'function') {
        return false;
      }
      try {
        const derived = await createFromPubKey(publicKey);
        if (derived?.toString?.() === peerId) {
          return true;
        }
      } catch {
        // try raw key conversion below
      }
      if (publicKey.length === 32) {
        try {
          const keys: any = await import('@libp2p/crypto/keys');
          if (typeof keys.publicKeyFromRaw === 'function') {
            const keyObj = keys.publicKeyFromRaw(publicKey);
            const keyBytes =
              keyObj?.bytes ??
              (typeof keyObj?.marshal === 'function' ? keyObj.marshal() : null) ??
              (typeof keyObj?.toBytes === 'function' ? keyObj.toBytes() : null);
            if (keyBytes) {
              const derived = await createFromPubKey(keyBytes);
              return derived?.toString?.() === peerId;
            }
          }
        } catch {
          return false;
        }
      }
    } catch {
      return false;
    }
    return false;
  }
}

function hasLeadingZeroBits(hashHex: string, difficulty: number): boolean {
  if (difficulty <= 0) {
    return true;
  }
  const bytes = hexToBytes(hashHex);
  let remaining = difficulty;
  for (const byte of bytes) {
    if (remaining <= 0) {
      return true;
    }
    if (byte === 0) {
      remaining -= 8;
      continue;
    }
    let mask = 0x80;
    while (mask > 0) {
      if ((byte & mask) !== 0) {
        return remaining <= 0;
      }
      remaining -= 1;
      if (remaining <= 0) {
        return true;
      }
      mask >>= 1;
    }
    return remaining <= 0;
  }
  return remaining <= 0;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function parseTokenAmount(amount: string): { value: bigint; scale: number } | null {
  if (!/^[0-9]+(\\.[0-9]+)?$/.test(amount)) {
    return null;
  }
  const [whole, fraction = ''] = amount.split('.');
  const scale = fraction.length;
  const value = BigInt(`${whole}${fraction}`);
  return { value, scale };
}

function compareTokenAmounts(a: string, b: string): number {
  const left = parseTokenAmount(a);
  const right = parseTokenAmount(b);
  if (!left || !right) {
    return -1;
  }
  const scale = Math.max(left.scale, right.scale);
  const leftValue = left.value * 10n ** BigInt(scale - left.scale);
  const rightValue = right.value * 10n ** BigInt(scale - right.scale);
  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? 1 : -1;
}
