import { bytesToUtf8 } from '@clawtoken/core/utils';
import { eventHashHex } from '@clawtoken/core/protocol';
import { EventStore, SnapshotStore } from '@clawtoken/core/storage';
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
  signP2PEnvelope,
  verifyP2PEnvelopeSignature,
} from '@clawtoken/protocol/p2p';

export interface P2PSyncConfig {
  maxEnvelopeBytes: number;
  maxRangeLimit: number;
  maxRangeBytes: number;
  maxSnapshotBytes: number;
  verifySignatures: boolean;
  verifyEventHash: boolean;
  subscribeEvents: boolean;
}

export interface P2PSyncOptions extends Partial<P2PSyncConfig> {
  peerId: string;
  peerPrivateKey: Uint8Array;
  resolvePeerPublicKey?: (peerId: string) => Promise<Uint8Array | null>;
}

const DEFAULT_SYNC_CONFIG: P2PSyncConfig = {
  maxEnvelopeBytes: 1_000_000,
  maxRangeLimit: 256,
  maxRangeBytes: 900_000,
  maxSnapshotBytes: 900_000,
  verifySignatures: true,
  verifyEventHash: true,
  subscribeEvents: true,
};

export class P2PSync {
  private readonly config: P2PSyncConfig;
  private readonly resolvePeerPublicKey?: (peerId: string) => Promise<Uint8Array | null>;
  private unsubscribeRequests?: () => void;
  private unsubscribeResponses?: () => void;
  private unsubscribeEvents?: () => void;

  constructor(
    private readonly node: P2PNode,
    private readonly eventStore: EventStore,
    private readonly snapshotStore: SnapshotStore | null,
    private readonly options: P2PSyncOptions,
  ) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...options };
    this.resolvePeerPublicKey = options.resolvePeerPublicKey;
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
    if (latest.bytes.length > this.config.maxSnapshotBytes) {
      return;
    }
    const response: ResponseMessage = {
      type: ResponseType.SnapshotResponse,
      snapshotResponse: {
        hash: latest.hash,
        snapshot: latest.bytes,
      },
    };
    await this.publishResponse(response);
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
    if (response.snapshot.length > this.config.maxSnapshotBytes) {
      return;
    }
    let snapshot: { hash?: string };
    try {
      snapshot = JSON.parse(bytesToUtf8(response.snapshot)) as { hash?: string };
    } catch {
      return;
    }
    if (typeof snapshot?.hash !== 'string' || !snapshot.hash) {
      return;
    }
    if (snapshot.hash !== response.hash) {
      return;
    }
    await this.snapshotStore.saveSnapshot(snapshot as any);
  }

  private async applyEventBytes(eventBytes: Uint8Array): Promise<void> {
    const envelope = this.parseEventEnvelope(eventBytes);
    if (!envelope) {
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
    await this.eventStore.appendEvent(hash, eventBytes);
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
      return null;
    }
    let envelope: P2PEnvelope;
    try {
      envelope = decodeP2PEnvelopeBytes(message.data);
    } catch {
      return null;
    }
    if (envelope.contentType !== CONTENT_TYPE) {
      return null;
    }
    if (envelope.sender === this.options.peerId) {
      return null;
    }
    if (this.config.verifySignatures) {
      const publicKey = await this.resolvePublicKey(envelope.sender);
      if (!publicKey) {
        return null;
      }
      const ok = await verifyP2PEnvelopeSignature(envelope, publicKey);
      if (!ok) {
        return null;
      }
    }
    return envelope;
  }

  private async resolvePublicKey(peerId: string): Promise<Uint8Array | null> {
    if (this.resolvePeerPublicKey) {
      return this.resolvePeerPublicKey(peerId);
    }
    return this.node.getPeerPublicKey(peerId);
  }
}
