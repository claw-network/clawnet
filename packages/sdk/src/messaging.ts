/**
 * Messaging API — send/receive P2P direct messages via the ClawNet node.
 */
import type { HttpClient, RequestOptions } from './http.js';

// ── Types ────────────────────────────────────────────────────────

export interface SendMessageParams {
  /** Target node's DID (did:claw:z...) */
  targetDid: string;
  /** Topic / channel name (e.g. "telagent/envelope") */
  topic: string;
  /** Opaque payload — typically base64-encoded */
  payload: string;
  /** Time-to-live in seconds (default: 86400 = 24h) */
  ttlSec?: number;
}

export interface SendBatchParams {
  /** Target DIDs (max 100) */
  targetDids: string[];
  /** Topic / channel name */
  topic: string;
  /** Opaque payload */
  payload: string;
  /** Time-to-live in seconds (default: 86400 = 24h) */
  ttlSec?: number;
}

export interface SendMessageResult {
  messageId: string;
  delivered: boolean;
}

export interface SendBatchResult {
  results: Array<SendMessageResult & { targetDid: string }>;
}

export interface InboxMessage {
  messageId: string;
  sourceDid: string;
  topic: string;
  payload: string;
  receivedAtMs: number;
}

export interface InboxQueryParams {
  /** Filter by topic */
  topic?: string;
  /** Only messages received after this timestamp (ms) */
  since?: number;
  /** Max messages to return (1-500, default 100) */
  limit?: number;
}

export interface InboxResponse {
  messages: InboxMessage[];
}

export interface DidPeerMapResponse {
  didPeerMap: Record<string, string>;
}

// ── API Class ────────────────────────────────────────────────────

export class MessagingApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * Send a message to a target DID via P2P.
   *
   * If the target peer is online and reachable, the message is delivered
   * directly. Otherwise it is queued for delivery when the peer reconnects.
   */
  async send(params: SendMessageParams, opts?: RequestOptions): Promise<SendMessageResult> {
    return this.http.post<SendMessageResult>('/api/v1/messaging/send', params, opts);
  }

  /**
   * Multicast: send a message to multiple target DIDs.
   *
   * Each target is attempted independently — partial success is possible.
   * Maximum 100 targets per call.
   */
  async sendBatch(params: SendBatchParams, opts?: RequestOptions): Promise<SendBatchResult> {
    return this.http.post<SendBatchResult>('/api/v1/messaging/send/batch', params, opts);
  }

  /**
   * Query the local inbox for received messages.
   *
   * Messages remain in the inbox until explicitly acknowledged via `ack()`.
   * Use `topic` to filter by application namespace (e.g. "telagent/envelope").
   */
  async inbox(params?: InboxQueryParams, opts?: RequestOptions): Promise<InboxResponse> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params?.topic) query.topic = params.topic;
    if (params?.since !== undefined) query.since = params.since;
    if (params?.limit !== undefined) query.limit = params.limit;
    return this.http.get<InboxResponse>('/api/v1/messaging/inbox', query, opts);
  }

  /**
   * Acknowledge (consume) a message from the inbox.
   *
   * Once acknowledged, the message will no longer appear in inbox queries at
   * all. Call this after your application has processed the message.
   */
  async ack(messageId: string, opts?: RequestOptions): Promise<void> {
    await this.http.delete(`/api/v1/messaging/inbox/${encodeURIComponent(messageId)}`, undefined, opts);
  }

  /**
   * Get the current DID → PeerId mapping (for debugging).
   */
  async peers(opts?: RequestOptions): Promise<DidPeerMapResponse> {
    return this.http.get<DidPeerMapResponse>('/api/v1/messaging/peers', undefined, opts);
  }
}
