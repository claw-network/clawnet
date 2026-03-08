/**
 * Messaging API — send/receive P2P direct messages via the ClawNet node.
 */
import type { HttpClient, RequestOptions } from './http.js';

/** Topic used for delivery receipt notifications via WebSocket. */
export const RECEIPT_TOPIC = '_receipt' as const;

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
  /** Priority level: 0=low, 1=normal, 2=high, 3=urgent */
  priority?: number;
  /** Enable gzip compression for payloads > 1KB */
  compress?: boolean;
  /** Recipient's X25519 public key hex for E2E encryption */
  encryptForKeyHex?: string;
  /** Idempotency key for deduplication (unique per message) */
  idempotencyKey?: string;
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
  /** Priority level: 0=low, 1=normal, 2=high, 3=urgent */
  priority?: number;
  /** Enable gzip compression for payloads > 1KB */
  compress?: boolean;
  /** Idempotency key for deduplication */
  idempotencyKey?: string;
  /** Per-recipient X25519 public key hex for E2E encryption (DID → key hex) */
  recipientKeys?: Record<string, string>;
}

export interface SendMessageResult {
  messageId: string;
  delivered: boolean;
  compressed?: boolean;
  encrypted?: boolean;
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
  priority: number;
  seq: number;
}

export interface InboxQueryParams {
  /** Filter by topic */
  topic?: string;
  /** Only messages received after this timestamp (ms) */
  since?: number;
  /** Only messages with sequence number > sinceSeq (for replay) */
  sinceSeq?: number;
  /** Max messages to return (1-500, default 100) */
  limit?: number;
}

export interface InboxResponse {
  messages: InboxMessage[];
}

export interface DidPeerMapResponse {
  didPeerMap: Record<string, string>;
}

// ── Attachment Types ─────────────────────────────────────────────

export interface RelayAttachmentParams {
  /** Target node's DID (did:claw:z...) */
  targetDid: string;
  /** Base64-encoded binary attachment data */
  data: string;
  /** MIME type (e.g. "image/png") */
  contentType: string;
  /** Original filename (optional) */
  fileName?: string;
  /** Deterministic attachment ID (optional — defaults to sha256 of data) */
  attachmentId?: string;
}

export interface RelayAttachmentResult {
  attachmentId: string;
  delivered: boolean;
}

export interface AttachmentInfo {
  attachmentId: string;
  sourceDid: string;
  contentType: string;
  fileName: string;
  totalSize: number;
  receivedAtMs: number;
}

export interface AttachmentListResponse {
  attachments: AttachmentInfo[];
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
    if (params?.sinceSeq !== undefined) query.sinceSeq = params.sinceSeq;
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

  // ── Attachment Relay ─────────────────────────────────────────

  /**
   * Relay a binary attachment to a target DID via P2P.
   *
   * The attachment is transferred directly through the P2P network and
   * stored on the receiver's local filesystem. The receiver can then
   * access it via `getAttachment()` without needing cross-node HTTP.
   *
   * @param params.data — Base64-encoded binary data (max 10 MB)
   */
  async relayAttachment(params: RelayAttachmentParams, opts?: RequestOptions): Promise<RelayAttachmentResult> {
    return this.http.post<RelayAttachmentResult>('/api/v1/messaging/relay-attachment', params, opts);
  }

  /**
   * List attachments received via P2P relay.
   */
  async listAttachments(params?: { limit?: number; since?: number }, opts?: RequestOptions): Promise<AttachmentListResponse> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params?.limit !== undefined) query.limit = params.limit;
    if (params?.since !== undefined) query.since = params.since;
    return this.http.get<AttachmentListResponse>('/api/v1/messaging/attachments', query, opts);
  }

  /**
   * Download a received attachment by ID.
   * Returns the raw binary data as an ArrayBuffer.
   */
  async getAttachment(attachmentId: string, opts?: RequestOptions): Promise<ArrayBuffer> {
    return this.http.getRaw(`/api/v1/messaging/attachments/${encodeURIComponent(attachmentId)}`, opts);
  }

  /**
   * Delete a received attachment by ID.
   */
  async deleteAttachment(attachmentId: string, opts?: RequestOptions): Promise<void> {
    await this.http.delete(`/api/v1/messaging/attachments/${encodeURIComponent(attachmentId)}`, undefined, opts);
  }
}
