/**
 * Messaging API — send/receive P2P direct messages via the ClawNet node.
 *
 * Text messages: use send() with JSON body (string payload).
 * Binary messages: use sendBinary() with raw octet-stream body.
 * No base64 encoding anywhere in the pipeline.
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
  /** Text payload (UTF-8 string). For binary payloads, use sendBinary(). */
  payload: string;
  /** Time-to-live in seconds (default: 86400 = 24h) */
  ttlSec?: number;
  /** Priority level: 0=low, 1=normal, 2=high, 3=urgent */
  priority?: number;
  /** Enable Brotli compression for payloads > 1KB */
  compress?: boolean;
  /** Recipient's X25519 public key hex for E2E encryption */
  encryptForKeyHex?: string;
  /** Idempotency key for deduplication (unique per message) */
  idempotencyKey?: string;
}

export interface SendBinaryParams {
  /** Target node's DID (did:claw:z...) */
  targetDid: string;
  /** Topic / channel name (e.g. "telagent/envelope") */
  topic: string;
  /** Binary payload (raw bytes). Sent as application/octet-stream. */
  payload: Uint8Array;
  /** Time-to-live in seconds (default: 86400 = 24h) */
  ttlSec?: number;
  /** Priority level: 0=low, 1=normal, 2=high, 3=urgent */
  priority?: number;
  /** Enable Brotli compression for payloads > 1KB */
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
  /** Text payload (UTF-8 string). For binary payloads, use sendBinaryBatch(). */
  payload: string;
  /** Time-to-live in seconds (default: 86400 = 24h) */
  ttlSec?: number;
  /** Priority level: 0=low, 1=normal, 2=high, 3=urgent */
  priority?: number;
  /** Enable Brotli compression for payloads > 1KB */
  compress?: boolean;
  /** Idempotency key for deduplication */
  idempotencyKey?: string;
  /** Per-recipient X25519 public key hex for E2E encryption (DID → key hex) */
  recipientKeys?: Record<string, string>;
}

export interface SendBinaryBatchParams {
  /** Target DIDs (max 100, comma-separated in header) */
  targetDids: string[];
  /** Topic / channel name */
  topic: string;
  /** Binary payload (raw bytes). Sent as application/octet-stream. */
  payload: Uint8Array;
  /** Time-to-live in seconds (default: 86400 = 24h) */
  ttlSec?: number;
  /** Priority level: 0=low, 1=normal, 2=high, 3=urgent */
  priority?: number;
  /** Enable Brotli compression for payloads > 1KB */
  compress?: boolean;
  /** Idempotency key for deduplication */
  idempotencyKey?: string;
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
  /** Text payload (only present for uncompressed+unencrypted messages). */
  payload?: string;
  /** Payload size in bytes (always present). */
  payloadSize: number;
  /** Whether the payload is compressed (Brotli). */
  compressed: boolean;
  /** Whether the payload is E2E encrypted. */
  encrypted: boolean;
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

// ── Subscription Delegation ──────────────────────────────────────

export interface CreateDelegationParams {
  delegateDid: string;
  topics: string[];
  expiresInSec: number;
  metadataOnly?: boolean;
}

export interface DelegationRecord {
  delegationId: string;
  delegateDid: string;
  topics: string[];
  metadataOnly: boolean;
  expiresAtMs: number;
  createdAtMs: number;
  revoked: boolean;
}

// ── API Class ────────────────────────────────────────────────────

export class MessagingApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * Send a text message to a target DID via P2P.
   *
   * If the target peer is online and reachable, the message is delivered
   * directly. Otherwise it is queued for delivery when the peer reconnects.
   * For binary payloads, use `sendBinary()`.
   */
  async send(params: SendMessageParams, opts?: RequestOptions): Promise<SendMessageResult> {
    return this.http.post<SendMessageResult>('/api/v1/messaging/send', params, opts);
  }

  /**
   * Send a binary message to a target DID via P2P.
   *
   * The payload is sent as raw bytes (application/octet-stream).
   * Metadata (targetDid, topic, etc.) is passed in HTTP headers.
   */
  async sendBinary(params: SendBinaryParams, opts?: RequestOptions): Promise<SendMessageResult> {
    const headers: Record<string, string> = {
      'x-target-did': params.targetDid,
      'x-topic': params.topic,
    };
    if (params.ttlSec !== undefined) headers['x-ttl-sec'] = String(params.ttlSec);
    if (params.priority !== undefined) headers['x-priority'] = String(params.priority);
    if (params.compress !== undefined) headers['x-compress'] = String(params.compress);
    if (params.encryptForKeyHex) headers['x-encrypt-for-key'] = params.encryptForKeyHex;
    if (params.idempotencyKey) headers['x-idempotency-key'] = params.idempotencyKey;

    return this.http.postBinary<SendMessageResult>(
      '/api/v1/messaging/send-binary', params.payload, headers, opts,
    );
  }

  /**
   * Multicast: send a text message to multiple target DIDs.
   *
   * Each target is attempted independently — partial success is possible.
   * Maximum 100 targets per call. For binary payloads, use `sendBinaryBatch()`.
   */
  async sendBatch(params: SendBatchParams, opts?: RequestOptions): Promise<SendBatchResult> {
    return this.http.post<SendBatchResult>('/api/v1/messaging/send/batch', params, opts);
  }

  /**
   * Multicast: send a binary message to multiple target DIDs.
   *
   * The payload is sent as raw bytes (application/octet-stream).
   * Target DIDs are comma-separated in the X-Target-Dids header.
   */
  async sendBinaryBatch(params: SendBinaryBatchParams, opts?: RequestOptions): Promise<SendBatchResult> {
    const headers: Record<string, string> = {
      'x-target-dids': params.targetDids.join(','),
      'x-topic': params.topic,
    };
    if (params.ttlSec !== undefined) headers['x-ttl-sec'] = String(params.ttlSec);
    if (params.priority !== undefined) headers['x-priority'] = String(params.priority);
    if (params.compress !== undefined) headers['x-compress'] = String(params.compress);
    if (params.idempotencyKey) headers['x-idempotency-key'] = params.idempotencyKey;

    return this.http.postBinary<SendBatchResult>(
      '/api/v1/messaging/send-binary/batch', params.payload, headers, opts,
    );
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
   * Download the raw payload of an inbox message as binary.
   *
   * Use this for compressed, encrypted, or binary payloads that aren't
   * included inline in the inbox listing. Response includes headers:
   * - X-Compressed: "1" if the payload is gzip-compressed
   * - X-Encrypted: "1" if the payload is E2E-encrypted
   */
  async downloadPayload(messageId: string, opts?: RequestOptions): Promise<ArrayBuffer> {
    return this.http.getRaw(`/api/v1/messaging/inbox/${encodeURIComponent(messageId)}/payload`, opts);
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

  // ── Subscription Delegations ─────────────────────────────────

  async createSubscriptionDelegation(
    params: CreateDelegationParams,
    opts?: RequestOptions,
  ): Promise<DelegationRecord> {
    return this.http.post<DelegationRecord>(
      '/api/v1/messaging/subscription-delegations',
      params,
      opts,
    );
  }

  async revokeSubscriptionDelegation(
    delegationId: string,
    opts?: RequestOptions,
  ): Promise<void> {
    await this.http.delete(`/api/v1/messaging/subscription-delegations/${encodeURIComponent(delegationId)}`, undefined, opts);
  }

  async listSubscriptionDelegations(
    opts?: RequestOptions,
  ): Promise<DelegationRecord[]> {
    return this.http.get<DelegationRecord[]>(
      '/api/v1/messaging/subscription-delegations',
      undefined,
      opts,
    );
  }
}
