/**
 * MessagingService — orchestrates P2P direct messaging.
 *
 * Responsibilities:
 * - Send messages to target DIDs via libp2p stream protocol
 * - Receive inbound messages and store in inbox
 * - Queue messages for offline peers in outbox, deliver on reconnect
 * - Maintain DID → PeerId mapping via announce protocol
 * - Periodic TTL cleanup of expired messages
 */

import type { P2PNode, StreamDuplex } from '@claw-network/core';
import {
  generateX25519Keypair,
  x25519SharedSecret,
  hkdfSha256,
  encryptAes256Gcm,
  decryptAes256Gcm,
  bytesToHex,
  hexToBytes,
} from '@claw-network/core';
import {
  encodeDirectMessageBytes,
  decodeDirectMessageBytes,
  encodeDeliveryReceiptBytes,
  decodeDeliveryReceiptBytes,
  encodeDidAnnounceBytes,
  decodeDidAnnounceBytes,
  encodeDidResolveRequestBytes,
  decodeDidResolveRequestBytes,
  encodeDidResolveResponseBytes,
  decodeDidResolveResponseBytes,
  encodeE2EEnvelope,
  decodeE2EEnvelope,
  encodeAttachmentMessageBytes,
  decodeAttachmentMessageBytes,
  ReceiptType,
} from '@claw-network/protocol/messaging';
import { MessageStore } from './message-store.js';
import { createLogger } from '../logger.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, writeFile, readFile as fsReadFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import crypto from 'node:crypto';

// ── Constants ────────────────────────────────────────────────────

const PROTO_DM = '/clawnet/1.0.0/dm';
const PROTO_DID_ANNOUNCE = '/clawnet/1.0.0/did-announce';
const PROTO_RECEIPT = '/clawnet/1.0.0/receipt';
const PROTO_DID_RESOLVE = '/clawnet/1.0.0/did-resolve';
const PROTO_ATTACHMENT = '/clawnet/1.0.0/attachment';

/** Timeout for DID resolve queries (ms). */
const DID_RESOLVE_TIMEOUT_MS = 5_000;

/** Maximum number of peers to query in parallel for DID resolve. */
const DID_RESOLVE_MAX_PEERS = 3;

/** DID→PeerId mapping TTL: re-resolve after 30 minutes to handle stale mappings. */
const DID_PEER_TTL_MS = 30 * 60_000;

/** Maximum payload size in bytes (64 KB). */
const MAX_PAYLOAD_BYTES = 65_536;

/** Maximum attachment size in bytes (10 MB). */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Attachment stream read timeout (30s — larger than DM for big files). */
const ATTACHMENT_STREAM_TIMEOUT_MS = 30_000;

/** Cleanup interval for expired messages (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60_000;

/** Max attempts before giving up on an outbox message. */
const MAX_DELIVERY_ATTEMPTS = 50;

/** Rate limit: max messages per DID per minute. */
const RATE_LIMIT_PER_MIN = 600;

/** Rate limit window in milliseconds (1 minute). */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Inbound P2P rate limit: max inbound messages per peer per minute. */
const INBOUND_RATE_LIMIT = 300;

/** Global inbound rate limit: max total inbound messages per minute (all peers combined). */
const GLOBAL_INBOUND_RATE_LIMIT = 3000;

/** Stream read timeout in milliseconds — abort slow/stalled streams. */
const STREAM_READ_TIMEOUT_MS = 10_000;

/** Maximum concurrency for multicast delivery. */
const MULTICAST_CONCURRENCY = 20;

/** Base delay for exponential backoff in outbox retry (ms). */
const OUTBOX_RETRY_BASE_MS = 1_000;

/** Maximum backoff delay for outbox retry (ms). */
const OUTBOX_RETRY_MAX_MS = 60_000;

/** Valid DID format: did:claw:<multibase-base58btc-encoded-key>. */
const DID_PATTERN = /^did:claw:z[1-9A-HJ-NP-Za-km-z]{32,64}$/;

/** Payload size threshold for automatic gzip compression (1 KB). */
const COMPRESSION_THRESHOLD_BYTES = 1024;

/** HKDF info tag for E2E messaging encryption. */
const E2E_MSG_INFO = Buffer.from('clawnet:e2e-msg:v1', 'utf-8');

/** Topic used for delivery receipt notifications via WebSocket. */
export const RECEIPT_TOPIC = '_receipt' as const;

/** Priority levels — higher number = higher priority. */
export enum MessagePriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  URGENT = 3,
}

// ── Types ────────────────────────────────────────────────────────

export interface SendResult {
  messageId: string;
  delivered: boolean;
  compressed?: boolean;
  encrypted?: boolean;
}

export interface MulticastResult {
  results: Array<SendResult & { targetDid: string }>;
}

export interface InboxQueryOptions {
  topic?: string;
  sinceMs?: number;
  sinceSeq?: number;
  limit?: number;
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

export interface SendOptions {
  ttlSec?: number;
  priority?: MessagePriority;
  /** If true, compress payload > 1 KB with gzip before sending. */
  compress?: boolean;
  /** Recipient's X25519 public key hex for E2E encryption. */
  encryptForKeyHex?: string;
  /** Idempotency key for deduplication. */
  idempotencyKey?: string;
  /** Per-recipient X25519 public key hex map (DID → key) for multicast E2E encryption. */
  recipientKeys?: Record<string, string>;
}

/** Callback for WebSocket subscribers — called when a new message arrives in the inbox. */
export type InboxSubscriber = (message: InboxMessage) => void;

/** Callback for attachment subscribers — called when a new attachment is received via P2P. */
export type AttachmentSubscriber = (info: AttachmentInfo) => void;

/** Metadata about a received attachment. */
export interface AttachmentInfo {
  attachmentId: string;
  sourceDid: string;
  contentType: string;
  fileName: string;
  totalSize: number;
  receivedAtMs: number;
}

/** Result of relaying an attachment. */
export interface RelayAttachmentResult {
  attachmentId: string;
  delivered: boolean;
}

type Logger = ReturnType<typeof createLogger>;

// ── Helpers ──────────────────────────────────────────────────────

/** Read all data from a stream source into a single Buffer, enforcing a size limit and timeout. */
async function readStream(
  source: AsyncIterable<{ subarray: () => Uint8Array } | Uint8Array>,
  maxBytes: number = MAX_PAYLOAD_BYTES * 2,
  timeoutMs: number = STREAM_READ_TIMEOUT_MS,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    for await (const chunk of source) {
      if (ac.signal.aborted) throw new Error(`Stream read timed out after ${timeoutMs}ms`);
      const bytes = chunk instanceof Uint8Array ? chunk : chunk.subarray();
      total += bytes.length;
      if (total > maxBytes) {
        throw new Error(`Stream exceeded size limit: ${total} > ${maxBytes}`);
      }
      chunks.push(Buffer.from(bytes));
    }
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(chunks);
}

/** Write raw binary data to a stream sink. */
async function writeBinaryStream(sink: StreamDuplex['sink'], data: Uint8Array): Promise<void> {
  await sink(
    (async function* () {
      yield data;
    })(),
  );
}

// ── Service ──────────────────────────────────────────────────────

export class MessagingService {
  private readonly log: Logger;
  private readonly store: MessageStore;
  private readonly p2p: P2PNode;
  private readonly localDid: string;
  private readonly attachmentsDir: string;
  private cleanupTimer?: NodeJS.Timeout;

  /**
   * DID → PeerId mapping. Populated via the did-announce protocol when
   * peers connect. Persisted to SQLite and restored on startup.
   */
  private readonly didToPeerId = new Map<string, string>();
  private readonly peerIdToDid = new Map<string, string>();
  /** Tracks when each DID→PeerId mapping was last confirmed (for TTL-based re-resolve). */
  private readonly didPeerUpdatedAt = new Map<string, number>();

  /** WebSocket subscribers that receive real-time inbox pushes. */
  private readonly subscribers = new Set<InboxSubscriber>();

  /** Subscribers for real-time attachment receive notifications. */
  private readonly attachmentSubscribers = new Set<AttachmentSubscriber>();

  constructor(p2p: P2PNode, store: MessageStore, localDid: string, dataDir?: string) {
    this.log = createLogger({ level: 'info' });
    this.p2p = p2p;
    this.store = store;
    this.localDid = localDid;
    this.attachmentsDir = dataDir ? join(dataDir, 'attachments') : join(process.cwd(), 'data', 'attachments');
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    // Ensure attachments directory exists
    await mkdir(this.attachmentsDir, { recursive: true });

    // Restore persisted DID→PeerId mappings from SQLite
    for (const { did, peerId, updatedAtMs } of this.store.getAllDidPeers()) {
      this.didToPeerId.set(did, peerId);
      this.peerIdToDid.set(peerId, did);
      this.didPeerUpdatedAt.set(did, updatedAtMs);
    }
    this.log.info('[messaging] restored DID mappings', { count: this.didToPeerId.size });

    // Register stream protocol handlers with per-protocol inbound stream limits
    await this.p2p.handleProtocol(PROTO_DM, (incoming) => {
      void this.handleInboundMessage(incoming);
    }, { maxInboundStreams: 256 });
    await this.p2p.handleProtocol(PROTO_DID_ANNOUNCE, (incoming) => {
      void this.handleDidAnnounce(incoming);
    }, { maxInboundStreams: 64 });
    await this.p2p.handleProtocol(PROTO_RECEIPT, (incoming) => {
      void this.handleDeliveryReceipt(incoming);
    }, { maxInboundStreams: 64 });
    await this.p2p.handleProtocol(PROTO_DID_RESOLVE, (incoming) => {
      void this.handleDidResolve(incoming);
    }, { maxInboundStreams: 128 });
    await this.p2p.handleProtocol(PROTO_ATTACHMENT, (incoming) => {
      void this.handleInboundAttachment(incoming);
    }, { maxInboundStreams: 32 });

    // When a new peer connects, exchange DID announcements
    this.p2p.onPeerDisconnect(() => {
      // No-op for now; outbox delivery is handled via flush on connect.
    });

    // Announce our DID to all currently connected peers
    void this.announceToAll();

    // Periodic cleanup of expired messages and stale rate-limit entries
    this.cleanupTimer = setInterval(() => {
      try {
        this.store.cleanupInbox();
        this.store.cleanupOutbox();
        this.store.pruneRateEvents(Date.now() - RATE_LIMIT_WINDOW_MS);
      } catch {
        /* best-effort */
      }
    }, CLEANUP_INTERVAL_MS);

    this.log.info('[messaging] service started', { localDid: this.localDid });
  }

  async stop(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    try {
      await this.p2p.unhandleProtocol(PROTO_DM);
    } catch { /* ignore */ }
    try {
      await this.p2p.unhandleProtocol(PROTO_DID_ANNOUNCE);
    } catch { /* ignore */ }
    try {
      await this.p2p.unhandleProtocol(PROTO_RECEIPT);
    } catch { /* ignore */ }
    try {
      await this.p2p.unhandleProtocol(PROTO_DID_RESOLVE);
    } catch { /* ignore */ }
    try {
      await this.p2p.unhandleProtocol(PROTO_ATTACHMENT);
    } catch { /* ignore */ }
    this.subscribers.clear();
    this.attachmentSubscribers.clear();
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Send a message to a target DID.
   * If the target peer is online and reachable, delivers directly.
   * Otherwise queues in outbox for later delivery.
   */
  async send(targetDid: string, topic: string, payload: string, opts: SendOptions = {}): Promise<SendResult> {
    const ttlSec = opts.ttlSec ?? 86400;
    const priority = opts.priority ?? MessagePriority.NORMAL;

    // Rate limit check
    this.enforceRateLimit(this.localDid);

    // Apply compression + encryption to payload
    const { payloadBytes, storagePayload, compressed, encrypted } = this.encodePayload(payload, opts);

    // Validate payload size after encoding
    if (payloadBytes.length > MAX_PAYLOAD_BYTES) {
      throw new Error(`Payload too large: ${payloadBytes.length} bytes (max ${MAX_PAYLOAD_BYTES})`);
    }

    const peerId = this.didToPeerId.get(targetDid);
    if (peerId) {
      // Try direct delivery
      const delivered = await this.deliverDirect(peerId, targetDid, topic, payloadBytes, ttlSec, priority, compressed, encrypted, opts.idempotencyKey);
      if (delivered) {
        return { messageId: `msg_direct_${Date.now().toString(36)}`, delivered: true, compressed, encrypted };
      }
      // Delivery failed — if mapping is stale, try re-resolving
      if (this.isStalePeerMapping(targetDid)) {
        const resolvedPeerId = await this.resolveDidViaPeers(targetDid);
        if (resolvedPeerId && resolvedPeerId !== peerId) {
          this.registerDidPeer(targetDid, resolvedPeerId);
          try { await this.p2p.dialPeer(resolvedPeerId); } catch { /* ignore */ }
          const reDelivered = await this.deliverDirect(resolvedPeerId, targetDid, topic, payloadBytes, ttlSec, priority, compressed, encrypted, opts.idempotencyKey);
          if (reDelivered) {
            return { messageId: `msg_direct_${Date.now().toString(36)}`, delivered: true, compressed, encrypted };
          }
        }
      }
    }

    // DID unknown locally — ask connected peers (bootstrap/others) to resolve
    if (!peerId) {
      const resolvedPeerId = await this.resolveDidViaPeers(targetDid);
      if (resolvedPeerId) {
        this.registerDidPeer(targetDid, resolvedPeerId);
        try {
          await this.p2p.dialPeer(resolvedPeerId);
        } catch { /* peer may already be connected or unreachable */ }
        const delivered = await this.deliverDirect(resolvedPeerId, targetDid, topic, payloadBytes, ttlSec, priority, compressed, encrypted, opts.idempotencyKey);
        if (delivered) {
          return { messageId: `msg_direct_${Date.now().toString(36)}`, delivered: true, compressed, encrypted };
        }
      }
    }

    // Queue in outbox for later delivery (uses string storage format)
    const messageId = this.store.addToOutbox({ targetDid, topic, payload: storagePayload, ttlSec, priority });
    this.log.info('message queued in outbox', { messageId, targetDid, topic });
    return { messageId, delivered: false, compressed, encrypted };
  }

  /**
   * Send a message to multiple target DIDs (multicast).
   * Each target is attempted independently — partial success is possible.
   */
  async sendMulticast(
    targetDids: string[],
    topic: string,
    payload: string,
    opts: SendOptions = {},
  ): Promise<MulticastResult> {
    const ttlSec = opts.ttlSec ?? 86400;
    const priority = opts.priority ?? MessagePriority.NORMAL;

    // Rate limit check (counts as 1 call for rate-limit purposes)
    this.enforceRateLimit(this.localDid);

    // Pre-encode a shared payload (without per-recipient encryption)
    const { payloadBytes: sharedPayloadBytes, storagePayload: sharedStoragePayload, compressed } = this.encodePayload(payload, { ...opts, encryptForKeyHex: undefined });

    if (sharedPayloadBytes.length > MAX_PAYLOAD_BYTES) {
      throw new Error(`Payload too large: ${sharedPayloadBytes.length} bytes (max ${MAX_PAYLOAD_BYTES})`);
    }

    // Deliver to all targets concurrently with bounded concurrency
    // Per-recipient E2E encryption is applied inside deliverMulticast when recipientKeys are provided
    const results = await this.deliverMulticast(
      targetDids, topic, sharedPayloadBytes, sharedStoragePayload, ttlSec, priority, compressed,
      opts.recipientKeys, opts.idempotencyKey,
    );
    return { results };
  }

  /** Query the local inbox. */
  getInbox(opts?: InboxQueryOptions): InboxMessage[] {
    return this.store.getInbox(opts);
  }

  /** Acknowledge (consume) a message from inbox. */
  ackMessage(messageId: string): boolean {
    return this.store.consumeMessage(messageId);
  }

  /** Flush outbox: attempt to deliver all pending messages for a specific DID with bounded concurrency. */
  async flushOutboxForDid(targetDid: string): Promise<number> {
    const peerId = this.didToPeerId.get(targetDid);
    if (!peerId) return 0;

    const entries = this.store.getOutboxForTarget(targetDid);
    const now = Date.now();

    // Pre-filter: separate eligible entries from those still in backoff or over limit
    const eligible: typeof entries = [];
    for (const entry of entries) {
      if (entry.attempts > MAX_DELIVERY_ATTEMPTS) {
        this.store.removeFromOutbox(entry.id);
        continue;
      }
      const backoff = Math.min(OUTBOX_RETRY_BASE_MS * (2 ** entry.attempts), OUTBOX_RETRY_MAX_MS);
      const lastAttempt = entry.lastAttempt ?? 0;
      if (lastAttempt > 0 && now - lastAttempt < backoff) {
        continue;
      }
      eligible.push(entry);
    }

    // Deliver in batches of MULTICAST_CONCURRENCY using Promise.allSettled
    let delivered = 0;
    for (let i = 0; i < eligible.length; i += MULTICAST_CONCURRENCY) {
      const batch = eligible.slice(i, i + MULTICAST_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (entry) => {
          this.store.recordAttempt(entry.id);
          // Outbox stores storagePayload (string); convert to bytes for wire delivery
          const ok = await this.deliverDirect(peerId, targetDid, entry.topic, Buffer.from(entry.payload, 'utf-8'), entry.ttlSec);
          if (ok) {
            this.store.removeFromOutbox(entry.id);
            return true;
          }
          return false;
        }),
      );
      for (const result of settled) {
        if (result.status === 'fulfilled' && result.value) delivered++;
      }
    }
    return delivered;
  }

  /**
   * Called when a peer connects. Announces our DID and flushes any
   * pending outbox messages for that peer's DID.
   */
  async onPeerConnected(peerId: string): Promise<void> {
    // Announce our DID to the new peer
    await this.announceDidToPeer(peerId);

    // Check if we know this peer's DID and flush outbox
    const did = this.peerIdToDid.get(peerId);
    if (did) {
      const flushed = await this.flushOutboxForDid(did);
      if (flushed > 0) {
        this.log.info('flushed outbox messages on reconnect', { peerId, did, flushed });
      }
    }
  }

  /** Return the current DID→PeerId mapping (for debugging/status). */
  getDidPeerMap(): Record<string, string> {
    return Object.fromEntries(this.didToPeerId);
  }

  // ── Subscriber Management (WebSocket push) ─────────────────────

  /** Register a subscriber for real-time inbox pushes. */
  addSubscriber(cb: InboxSubscriber): void {
    this.subscribers.add(cb);
  }

  /** Remove a subscriber. */
  removeSubscriber(cb: InboxSubscriber): void {
    this.subscribers.delete(cb);
  }

  /** Number of active WS subscribers. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Notify all subscribers of a new inbox message (non-blocking). */
  private notifySubscribers(msg: InboxMessage): void {
    // Use queueMicrotask to avoid blocking the current handler when there are many subscribers
    for (const cb of this.subscribers) {
      queueMicrotask(() => {
        try { cb(msg); } catch { /* best-effort */ }
      });
    }
  }

  // ── Attachment Subscriber Management ───────────────────────────

  /** Register a subscriber for real-time attachment receive notifications. */
  addAttachmentSubscriber(cb: AttachmentSubscriber): void {
    this.attachmentSubscribers.add(cb);
  }

  /** Remove an attachment subscriber. */
  removeAttachmentSubscriber(cb: AttachmentSubscriber): void {
    this.attachmentSubscribers.delete(cb);
  }

  /** Notify all attachment subscribers (non-blocking). */
  private notifyAttachmentSubscribers(info: AttachmentInfo): void {
    for (const cb of this.attachmentSubscribers) {
      queueMicrotask(() => {
        try { cb(info); } catch { /* best-effort */ }
      });
    }
  }

  // ── Attachment Relay (P2P Binary Transfer) ─────────────────────

  /**
   * Relay a binary attachment to a target DID via P2P.
   * The attachment is transferred directly via stream protocol and
   * stored on the receiver's local filesystem.
   */
  async relayAttachment(params: {
    targetDid: string;
    data: Buffer;
    contentType: string;
    fileName?: string;
    attachmentId?: string;
  }): Promise<RelayAttachmentResult> {
    const { targetDid, data, contentType, fileName } = params;

    if (data.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment too large: ${data.length} bytes (max ${MAX_ATTACHMENT_BYTES})`);
    }

    this.enforceRateLimit(this.localDid);

    // Compute attachment ID from data hash if not provided
    const attachmentId = params.attachmentId || crypto.createHash('sha256').update(data).digest('hex');

    const peerId = this.didToPeerId.get(targetDid);
    if (peerId) {
      const delivered = await this.deliverAttachment(peerId, targetDid, attachmentId, data, contentType, fileName ?? '');
      if (delivered) {
        return { attachmentId, delivered: true };
      }
      // Try re-resolve if stale
      if (this.isStalePeerMapping(targetDid)) {
        const resolvedPeerId = await this.resolveDidViaPeers(targetDid);
        if (resolvedPeerId && resolvedPeerId !== peerId) {
          this.registerDidPeer(targetDid, resolvedPeerId);
          try { await this.p2p.dialPeer(resolvedPeerId); } catch { /* ignore */ }
          const reDelivered = await this.deliverAttachment(resolvedPeerId, targetDid, attachmentId, data, contentType, fileName ?? '');
          if (reDelivered) {
            return { attachmentId, delivered: true };
          }
        }
      }
    }

    // DID unknown — try resolve via connected peers
    if (!peerId) {
      const resolvedPeerId = await this.resolveDidViaPeers(targetDid);
      if (resolvedPeerId) {
        this.registerDidPeer(targetDid, resolvedPeerId);
        try { await this.p2p.dialPeer(resolvedPeerId); } catch { /* ignore */ }
        const delivered = await this.deliverAttachment(resolvedPeerId, targetDid, attachmentId, data, contentType, fileName ?? '');
        if (delivered) {
          return { attachmentId, delivered: true };
        }
      }
    }

    // Attachment relay requires the peer to be online — no outbox queuing for large binary data
    this.log.warn('attachment relay failed: peer offline', { targetDid, attachmentId });
    return { attachmentId, delivered: false };
  }

  /**
   * Get a locally stored attachment by ID.
   * Returns the file data and content type, or null if not found.
   */
  async getAttachment(attachmentId: string): Promise<{ data: Buffer; contentType: string; fileName: string } | null> {
    const meta = this.store.getAttachmentMeta(attachmentId);
    if (!meta) return null;
    try {
      const filePath = join(this.attachmentsDir, meta.storedFileName);
      const data = await fsReadFile(filePath);
      return { data, contentType: meta.contentType, fileName: meta.fileName };
    } catch {
      return null;
    }
  }

  /** List locally stored attachment metadata. */
  listAttachments(opts?: { limit?: number; since?: number }): AttachmentInfo[] {
    return this.store.listAttachments(opts);
  }

  /** Delete a locally stored attachment. */
  async deleteAttachment(attachmentId: string): Promise<boolean> {
    const meta = this.store.getAttachmentMeta(attachmentId);
    if (!meta) return false;
    try {
      await unlink(join(this.attachmentsDir, meta.storedFileName));
    } catch { /* file may already be gone */ }
    return this.store.deleteAttachment(attachmentId);
  }

  // ── Private: Attachment Delivery ───────────────────────────────

  private async deliverAttachment(
    peerId: string,
    targetDid: string,
    attachmentId: string,
    data: Buffer,
    contentType: string,
    fileName: string,
  ): Promise<boolean> {
    let stream: StreamDuplex | null = null;
    try {
      stream = await this.p2p.newStream(peerId, PROTO_ATTACHMENT);

      const bytes = encodeAttachmentMessageBytes({
        attachmentId,
        sourceDid: this.localDid,
        targetDid,
        contentType,
        fileName,
        data: new Uint8Array(data),
        totalSize: data.length,
        sentAtMs: BigInt(Date.now()),
      });

      await writeBinaryStream(stream.sink, bytes);
      await stream.close();
      this.log.info('attachment delivered', { peerId, targetDid, attachmentId, size: data.length });
      return true;
    } catch (err) {
      this.log.warn('attachment delivery failed', {
        peerId,
        targetDid,
        attachmentId,
        error: (err as Error).message,
      });
      if (stream) {
        try { await stream.close(); } catch { /* ignore */ }
      }
      return false;
    }
  }

  // ── Private: Inbound Attachment Handler ────────────────────────

  private async handleInboundAttachment(incoming: {
    stream: StreamDuplex;
    connection: { remotePeer?: { toString: () => string } };
  }): Promise<void> {
    const { stream, connection } = incoming;
    try {
      const remotePeer = connection.remotePeer?.toString();
      if (remotePeer) {
        try {
          this.enforceInboundRateLimit(remotePeer);
          this.enforceGlobalInboundRateLimit();
        } catch {
          this.log.warn('inbound attachment rate limit exceeded', { peerId: remotePeer });
          try { await stream.close(); } catch { /* ignore */ }
          return;
        }
      }

      const raw = await readStream(stream.source, MAX_ATTACHMENT_BYTES + 1024, ATTACHMENT_STREAM_TIMEOUT_MS);
      await stream.close();

      const msg = decodeAttachmentMessageBytes(new Uint8Array(raw));

      if (!msg.attachmentId || !msg.sourceDid || msg.data.length === 0) {
        this.log.warn('inbound attachment missing required fields');
        return;
      }

      if (msg.data.length > MAX_ATTACHMENT_BYTES) {
        this.log.warn('inbound attachment too large', { size: msg.data.length });
        return;
      }

      // Determine stored file name: use attachmentId + extension from contentType
      const ext = mimeToExtension(msg.contentType);
      const storedFileName = `${msg.attachmentId}${ext}`;

      // Store to disk
      await mkdir(this.attachmentsDir, { recursive: true });
      await writeFile(join(this.attachmentsDir, storedFileName), msg.data);

      // Store metadata in SQLite
      const info: AttachmentInfo = {
        attachmentId: msg.attachmentId,
        sourceDid: msg.sourceDid,
        contentType: msg.contentType,
        fileName: msg.fileName,
        totalSize: msg.data.length,
        receivedAtMs: Date.now(),
      };
      this.store.saveAttachmentMeta(info, storedFileName);

      // Record DID → PeerId mapping
      const remotePeerId = connection.remotePeer?.toString();
      if (remotePeerId && msg.sourceDid) {
        this.registerDidPeer(msg.sourceDid, remotePeerId);
      }

      this.log.info('attachment received', {
        attachmentId: msg.attachmentId,
        sourceDid: msg.sourceDid,
        size: msg.data.length,
        contentType: msg.contentType,
      });

      // Notify attachment subscribers
      this.notifyAttachmentSubscribers(info);

      // Also push to inbox subscribers with attachment metadata (so apps get notified)
      const currentSeq = this.store.currentSeq();
      this.notifySubscribers({
        messageId: `att_${msg.attachmentId}`,
        sourceDid: msg.sourceDid,
        topic: '_attachment',
        payload: JSON.stringify({
          attachmentId: msg.attachmentId,
          contentType: msg.contentType,
          fileName: msg.fileName,
          totalSize: msg.data.length,
        }),
        receivedAtMs: Date.now(),
        priority: MessagePriority.NORMAL,
        seq: currentSeq,
      });
    } catch (err) {
      this.log.warn('failed to handle inbound attachment', { error: (err as Error).message });
      try { await stream.close(); } catch { /* ignore */ }
    }
  }

  // ── Rate Limiting (SQLite-backed for multi-instance support) ───

  /**
   * Check rate limit for a DID. Throws if limit exceeded.
   * Uses SQLite-backed sliding window for cross-process correctness.
   */
  enforceRateLimit(did: string): void {
    this.checkRateBucket(`out:${did}`, RATE_LIMIT_PER_MIN);
  }

  /** Check if a DID is currently rate-limited (without consuming a slot). */
  isRateLimited(did: string): boolean {
    const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;
    return this.store.countRateEvents(`out:${did}`, windowStart) >= RATE_LIMIT_PER_MIN;
  }

  /**
   * Enforce inbound rate limit for a peerId. Throws if limit exceeded.
   * Prevents P2P peers from spamming without limit.
   */
  private enforceInboundRateLimit(peerId: string): void {
    this.checkRateBucket(`in:${peerId}`, INBOUND_RATE_LIMIT);
  }

  /**
   * Enforce global aggregate inbound rate limit (all peers combined).
   * Prevents total flooding even when spread across many peers.
   */
  private enforceGlobalInboundRateLimit(): void {
    this.checkRateBucket('in:_global', GLOBAL_INBOUND_RATE_LIMIT);
  }

  /**
   * Core rate-limit check: count events in the sliding window via SQLite,
   * record a new event, throw if over limit.
   */
  private checkRateBucket(bucket: string, limit: number): void {
    const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;
    const count = this.store.countRateEvents(bucket, windowStart);
    if (count >= limit) {
      throw new RateLimitError(bucket, limit);
    }
    this.store.recordRateEvent(bucket);
  }

  // ── Private: Payload Encoding (compression + encryption) ────────

  /**
   * Encode a payload: optionally compress (gzip) then optionally encrypt (X25519+AES-256-GCM).
   *
   * Returns:
   * - `payloadBytes`: raw binary payload for FlatBuffers wire format (Uint8Array)
   * - `storagePayload`: string representation for SQLite TEXT storage (backward compat)
   * - `compressed` / `encrypted` flags
   */
  private encodePayload(
    payload: string,
    opts: Pick<SendOptions, 'compress' | 'encryptForKeyHex'>,
  ): { payloadBytes: Uint8Array; storagePayload: string; compressed: boolean; encrypted: boolean } {
    let data = Buffer.from(payload, 'utf-8');
    let storagePayload = payload;
    let compressed = false;
    let encrypted = false;

    // Compression: gzip if enabled and payload > threshold
    if (opts.compress !== false && data.length > COMPRESSION_THRESHOLD_BYTES) {
      data = gzipSync(data);
      // Storage format: base64-encoded gzip wrapped in JSON object (backward compat with REST API)
      storagePayload = JSON.stringify({ _compressed: 1, data: data.toString('base64') });
      compressed = true;
    }

    // E2E Encryption: X25519 ECDH + HKDF + AES-256-GCM
    if (opts.encryptForKeyHex) {
      const recipientPubKey = hexToBytes(opts.encryptForKeyHex);
      const ephemeral = generateX25519Keypair();
      const shared = x25519SharedSecret(ephemeral.privateKey, recipientPubKey);
      const derived = hkdfSha256(shared, undefined, new Uint8Array(E2E_MSG_INFO), 32);
      const enc = encryptAes256Gcm(derived, new Uint8Array(data));

      // Wire format: binary E2E envelope (60 bytes header + ciphertext)
      data = Buffer.from(encodeE2EEnvelope({
        ephemeralPk: ephemeral.publicKey,
        nonce: hexToBytes(enc.nonceHex),
        tag: hexToBytes(enc.tagHex),
        ciphertext: hexToBytes(enc.ciphertextHex),
      }));

      // Storage format: JSON E2E envelope (backward compat with static decryptPayload)
      storagePayload = JSON.stringify({
        _e2e: 1,
        pk: bytesToHex(ephemeral.publicKey),
        n: enc.nonceHex,
        c: enc.ciphertextHex,
        t: enc.tagHex,
      });
      encrypted = true;
    }

    return { payloadBytes: new Uint8Array(data), storagePayload, compressed, encrypted };
  }

  /**
   * Decrypt an E2E-encrypted payload using the local node's X25519 private key.
   * Returns the decrypted payload string or null if not encrypted / decryption fails.
   */
  static decryptPayload(payload: string, recipientPrivateKey: Uint8Array): string | null {
    try {
      const envelope = JSON.parse(payload) as { _e2e?: number; pk?: string; n?: string; c?: string; t?: string };
      if (envelope._e2e !== 1 || !envelope.pk || !envelope.n || !envelope.c || !envelope.t) return null;

      const senderPub = hexToBytes(envelope.pk);
      const shared = x25519SharedSecret(recipientPrivateKey, senderPub);
      const derived = hkdfSha256(shared, undefined, new Uint8Array(E2E_MSG_INFO), 32);
      const decrypted = decryptAes256Gcm(derived, {
        nonceHex: envelope.n,
        ciphertextHex: envelope.c,
        tagHex: envelope.t,
      });
      return Buffer.from(decrypted).toString('utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Decompress a gzip-compressed payload (base64-encoded gzip → utf-8 string).
   * Returns the decompressed string, or null if decompression fails.
   */
  static decompressPayload(payload: string): string | null {
    try {
      const buf = Buffer.from(payload, 'base64');
      const decompressed = gunzipSync(buf);
      return decompressed.toString('utf-8');
    } catch {
      return null;
    }
  }

  /** Get the current inbox sequence number (for WS replay). */
  getCurrentSeq(): number {
    return this.store.currentSeq();
  }

  // ── Private: Direct Delivery ───────────────────────────────────

  private async deliverDirect(
    peerId: string,
    targetDid: string,
    topic: string,
    payload: Uint8Array,
    ttlSec: number,
    priority: number = MessagePriority.NORMAL,
    compressed = false,
    encrypted = false,
    idempotencyKey?: string,
  ): Promise<boolean> {
    let stream: StreamDuplex | null = null;
    try {
      stream = await this.p2p.newStream(peerId, PROTO_DM);

      const bytes = encodeDirectMessageBytes({
        sourceDid: this.localDid,
        targetDid,
        topic,
        payload,
        ttlSec,
        sentAtMs: BigInt(Date.now()),
        priority,
        compressed,
        encrypted,
        idempotencyKey: idempotencyKey ?? '',
      });

      await writeBinaryStream(stream.sink, bytes);
      await stream.close();
      this.log.info('message delivered', { peerId, targetDid, topic });
      return true;
    } catch (err) {
      this.log.warn('direct delivery failed', {
        peerId,
        targetDid,
        error: (err as Error).message,
      });
      if (stream) {
        try { await stream.close(); } catch { /* ignore */ }
      }
      return false;
    }
  }

  // ── Private: Inbound Message Handler ───────────────────────────

  private async handleInboundMessage(incoming: {
    stream: StreamDuplex;
    connection: { remotePeer?: { toString: () => string } };
  }): Promise<void> {
    const { stream, connection } = incoming;
    try {
      // Inbound rate limit check — prevent P2P spam
      const remotePeer = connection.remotePeer?.toString();
      if (remotePeer) {
        try {
          this.enforceInboundRateLimit(remotePeer);
          this.enforceGlobalInboundRateLimit();
        } catch {
          this.log.warn('inbound rate limit exceeded, dropping stream', { peerId: remotePeer });
          try { await stream.close(); } catch { /* ignore */ }
          return;
        }
      }

      // readStream enforces size limit before reading all into memory
      const raw = await readStream(stream.source);
      await stream.close();

      const msg = decodeDirectMessageBytes(new Uint8Array(raw));

      if (!msg.sourceDid || !msg.topic || msg.payload.length === 0) {
        this.log.warn('inbound message missing required fields');
        return;
      }

      // Reconstruct string payload for SQLite TEXT storage (backward compat with REST API / SDK)
      let storagePayload: string;
      if (msg.encrypted) {
        // Binary E2E → JSON E2E envelope (for static decryptPayload backward compat)
        const e2e = decodeE2EEnvelope(msg.payload);
        storagePayload = JSON.stringify({
          _e2e: 1,
          pk: bytesToHex(e2e.ephemeralPk),
          n: bytesToHex(e2e.nonce),
          c: bytesToHex(e2e.ciphertext),
          t: bytesToHex(e2e.tag),
        });
      } else if (msg.compressed) {
        // Raw gzip bytes → base64-encoded gzip wrapped in JSON (for static decompressPayload)
        storagePayload = JSON.stringify({ _compressed: 1, data: Buffer.from(msg.payload).toString('base64') });
      } else {
        // Plain UTF-8 text
        storagePayload = Buffer.from(msg.payload).toString('utf-8');
      }

      // Store in inbox (deduplication handled by store if idempotencyKey is present)
      const messageId = this.store.addToInbox({
        sourceDid: msg.sourceDid,
        targetDid: msg.targetDid || this.localDid,
        topic: msg.topic,
        payload: storagePayload,
        ttlSec: msg.ttlSec || undefined,
        sentAtMs: msg.sentAtMs ? Number(msg.sentAtMs) : undefined,
        priority: msg.priority ?? MessagePriority.NORMAL,
        idempotencyKey: msg.idempotencyKey || undefined,
      });

      // Record DID → PeerId mapping from the sender (persisted to SQLite)
      const remotePeerId = connection.remotePeer?.toString();
      if (remotePeerId && msg.sourceDid) {
        this.registerDidPeer(msg.sourceDid, remotePeerId);
      }

      this.log.info('message received', { messageId, sourceDid: msg.sourceDid, topic: msg.topic });

      // Push to WebSocket subscribers
      const currentSeq = this.store.currentSeq();
      this.notifySubscribers({
        messageId,
        sourceDid: msg.sourceDid,
        topic: msg.topic,
        payload: storagePayload,
        receivedAtMs: Date.now(),
        priority: msg.priority ?? MessagePriority.NORMAL,
        seq: currentSeq,
      });

      // Send delivery receipt back to sender
      if (remotePeerId) {
        void this.sendDeliveryReceipt(remotePeerId, messageId, msg.sourceDid);
      }
    } catch (err) {
      this.log.warn('failed to handle inbound message', { error: (err as Error).message });
      try { await stream.close(); } catch { /* ignore */ }
    }
  }

  // ── Private: DID Announce Protocol ────────────────────────────

  private async handleDidAnnounce(incoming: {
    stream: StreamDuplex;
    connection: { remotePeer?: { toString: () => string } };
  }): Promise<void> {
    const { stream, connection } = incoming;
    try {
      // Rate limit DID announcements to prevent mapping table poisoning
      const remotePeerId = connection.remotePeer?.toString();
      if (remotePeerId) {
        try {
          this.enforceInboundRateLimit(remotePeerId);
          this.enforceGlobalInboundRateLimit();
        } catch {
          this.log.warn('announce rate limit exceeded, dropping', { peerId: remotePeerId });
          try { await stream.close(); } catch { /* ignore */ }
          return;
        }
      }

      const raw = await readStream(stream.source, 1024); // DID announces are tiny
      await stream.close();

      const msg = decodeDidAnnounceBytes(new Uint8Array(raw));

      // Validate DID format to prevent spoofing / garbage entries
      if (msg.did && !DID_PATTERN.test(msg.did)) {
        this.log.warn('invalid DID in announce, ignoring', { did: msg.did, peerId: remotePeerId });
        return;
      }

      if (msg.did && remotePeerId) {
        this.registerDidPeer(msg.did, remotePeerId);
        this.log.info('peer DID registered', { did: msg.did, peerId: remotePeerId });

        // Flush any pending outbox messages for this DID
        const flushed = await this.flushOutboxForDid(msg.did);
        if (flushed > 0) {
          this.log.info('flushed outbox on DID announce', { did: msg.did, flushed });
        }
      }
    } catch (err) {
      this.log.warn('failed to handle DID announce', { error: (err as Error).message });
      try { await stream.close(); } catch { /* ignore */ }
    }
  }

  // ── Private: DID Resolve Protocol ────────────────────────────

  private async handleDidResolve(incoming: {
    stream: StreamDuplex;
    connection: { remotePeer?: { toString: () => string } };
  }): Promise<void> {
    const { stream, connection } = incoming;
    try {
      const remotePeerId = connection.remotePeer?.toString();
      if (remotePeerId) {
        try {
          this.enforceInboundRateLimit(remotePeerId);
          this.enforceGlobalInboundRateLimit();
        } catch {
          this.log.warn('resolve rate limit exceeded, dropping', { peerId: remotePeerId });
          try { await stream.close(); } catch { /* ignore */ }
          return;
        }
      }

      const raw = await readStream(stream.source, 1024);
      const msg = decodeDidResolveRequestBytes(new Uint8Array(raw));

      if (!msg.did || !DID_PATTERN.test(msg.did)) {
        const respBytes = encodeDidResolveResponseBytes({ did: msg.did ?? '', peerId: '', found: false });
        await writeBinaryStream(stream.sink, respBytes);
        await stream.close();
        return;
      }

      const peerId = this.didToPeerId.get(msg.did);
      const respBytes = encodeDidResolveResponseBytes(
        peerId
          ? { did: msg.did, peerId, found: true }
          : { did: msg.did, peerId: '', found: false },
      );

      await writeBinaryStream(stream.sink, respBytes);
      await stream.close();
      this.log.info('DID resolve handled', { did: msg.did, found: !!peerId });
    } catch (err) {
      this.log.warn('failed to handle DID resolve', { error: (err as Error).message });
      try { await stream.close(); } catch { /* ignore */ }
    }
  }

  /**
   * Query connected peers to resolve an unknown DID → PeerId.
   * Sends DID resolve requests to up to DID_RESOLVE_MAX_PEERS peers concurrently.
   * Returns the first PeerId found, or null if none of the queried peers know the DID.
   */
  private async resolveDidViaPeers(targetDid: string): Promise<string | null> {
    const connectedPeers = this.p2p.getConnections().slice(0, DID_RESOLVE_MAX_PEERS);
    if (connectedPeers.length === 0) return null;

    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('resolve timeout')), DID_RESOLVE_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([
        Promise.any(
          connectedPeers.map(async (peerId) => {
            let stream: StreamDuplex | null = null;
            try {
              stream = await this.p2p.newStream(peerId, PROTO_DID_RESOLVE);
              const reqBytes = encodeDidResolveRequestBytes({ did: targetDid });
              await writeBinaryStream(stream.sink, reqBytes);
              const raw = await readStream(stream.source, 1024, DID_RESOLVE_TIMEOUT_MS);
              await stream.close();
              const resp = decodeDidResolveResponseBytes(new Uint8Array(raw));
              if (resp.found && resp.peerId) return resp.peerId;
              throw new Error('not found');
            } catch (err) {
              if (stream) { try { await stream.close(); } catch { /* ignore */ } }
              throw err;
            }
          }),
        ),
        timeout,
      ]);
      return result;
    } catch {
      return null;
    } finally {
      clearTimeout(timer!);
    }
  }

  /** Announce our DID to a specific peer. */
  private async announceDidToPeer(peerId: string): Promise<void> {
    let stream: StreamDuplex | null = null;
    try {
      stream = await this.p2p.newStream(peerId, PROTO_DID_ANNOUNCE);
      const bytes = encodeDidAnnounceBytes({ did: this.localDid });
      await writeBinaryStream(stream.sink, bytes);
      await stream.close();
    } catch {
      // Best-effort; the peer may not support this protocol yet
      if (stream) {
        try { await stream.close(); } catch { /* ignore */ }
      }
    }
  }

  /** Announce our DID to all currently connected peers. */
  private async announceToAll(): Promise<void> {
    const peers = this.p2p.getConnections();
    for (const peerId of peers) {
      await this.announceDidToPeer(peerId);
    }
  }

  /**
   * Deliver to multiple targets concurrently with bounded concurrency.
   * Uses Promise.allSettled so one failure doesn't block others.
   * Supports per-recipient E2E encryption when recipientKeys are provided.
   */
  private async deliverMulticast(
    targetDids: string[],
    topic: string,
    sharedPayloadBytes: Uint8Array,
    sharedStoragePayload: string,
    ttlSec: number,
    priority: number = MessagePriority.NORMAL,
    compressed = false,
    recipientKeys?: Record<string, string>,
    idempotencyKey?: string,
  ): Promise<Array<SendResult & { targetDid: string }>> {
    const results: Array<SendResult & { targetDid: string }> = [];
    // Process in batches of MULTICAST_CONCURRENCY
    for (let i = 0; i < targetDids.length; i += MULTICAST_CONCURRENCY) {
      const batch = targetDids.slice(i, i + MULTICAST_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (targetDid) => {
          // Per-recipient E2E encryption if a key is provided for this target
          let payloadBytes = sharedPayloadBytes;
          let storagePayload = sharedStoragePayload;
          let encrypted = false;
          const recipientKeyHex = recipientKeys?.[targetDid];
          if (recipientKeyHex) {
            const perRecipient = this.encodePayload(
              Buffer.from(sharedPayloadBytes).toString('utf-8'),
              { encryptForKeyHex: recipientKeyHex, compress: false },
            );
            payloadBytes = perRecipient.payloadBytes;
            storagePayload = perRecipient.storagePayload;
            encrypted = perRecipient.encrypted;
          }

          const peerId = this.didToPeerId.get(targetDid);
          if (peerId) {
            const delivered = await this.deliverDirect(peerId, targetDid, topic, payloadBytes, ttlSec, priority, compressed, encrypted, idempotencyKey);
            if (delivered) {
              return { targetDid, messageId: `msg_direct_${Date.now().toString(36)}`, delivered: true, compressed, encrypted };
            }
            // Delivery failed — if mapping is stale, try re-resolving
            if (this.isStalePeerMapping(targetDid)) {
              const resolvedPeerId = await this.resolveDidViaPeers(targetDid);
              if (resolvedPeerId && resolvedPeerId !== peerId) {
                this.registerDidPeer(targetDid, resolvedPeerId);
                try { await this.p2p.dialPeer(resolvedPeerId); } catch { /* ignore */ }
                const reDelivered = await this.deliverDirect(resolvedPeerId, targetDid, topic, payloadBytes, ttlSec, priority, compressed, encrypted, idempotencyKey);
                if (reDelivered) {
                  return { targetDid, messageId: `msg_direct_${Date.now().toString(36)}`, delivered: true, compressed, encrypted };
                }
              }
            }
          }

          // DID unknown — try resolve via connected peers
          if (!peerId) {
            const resolvedPeerId = await this.resolveDidViaPeers(targetDid);
            if (resolvedPeerId) {
              this.registerDidPeer(targetDid, resolvedPeerId);
              try { await this.p2p.dialPeer(resolvedPeerId); } catch { /* ignore */ }
              const delivered = await this.deliverDirect(resolvedPeerId, targetDid, topic, payloadBytes, ttlSec, priority, compressed, encrypted, idempotencyKey);
              if (delivered) {
                return { targetDid, messageId: `msg_direct_${Date.now().toString(36)}`, delivered: true, compressed, encrypted };
              }
            }
          }

          const messageId = this.store.addToOutbox({ targetDid, topic, payload: storagePayload, ttlSec, priority });
          return { targetDid, messageId, delivered: false, compressed, encrypted };
        }),
      );
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          this.log.warn('multicast delivery error', { error: String(result.reason) });
        }
      }
    }
    return results;
  }

  // ── Private: DID → PeerId Persistence ──────────────────────────

  /** Update in-memory maps AND persist the DID→PeerId mapping to SQLite. */
  private registerDidPeer(did: string, peerId: string): void {
    this.didToPeerId.set(did, peerId);
    this.peerIdToDid.set(peerId, did);
    this.didPeerUpdatedAt.set(did, Date.now());
    try {
      this.store.upsertDidPeer(did, peerId);
    } catch {
      // Best-effort persistence — in-memory map is authoritative
    }
  }

  /** Check if a DID→PeerId mapping is older than the TTL threshold. */
  private isStalePeerMapping(did: string): boolean {
    const updatedAt = this.didPeerUpdatedAt.get(did) ?? 0;
    return (Date.now() - updatedAt) > DID_PEER_TTL_MS;
  }

  // ── Private: Delivery Receipt Protocol ─────────────────────────

  /** Send a delivery receipt to the sender after receiving a message. */
  private async sendDeliveryReceipt(
    peerId: string,
    messageId: string,
    recipientDid: string,
  ): Promise<void> {
    let stream: StreamDuplex | null = null;
    try {
      stream = await this.p2p.newStream(peerId, PROTO_RECEIPT);
      const bytes = encodeDeliveryReceiptBytes({
        type: ReceiptType.Delivered,
        messageId,
        recipientDid: this.localDid,
        senderDid: recipientDid,
        deliveredAtMs: BigInt(Date.now()),
      });
      await writeBinaryStream(stream.sink, bytes);
      await stream.close();
      this.log.info('delivery receipt sent', { peerId, messageId });
    } catch {
      // Best-effort — receipts are not critical
      if (stream) {
        try { await stream.close(); } catch { /* ignore */ }
      }
    }
  }

  /** Handle an incoming delivery receipt from a remote peer. */
  private async handleDeliveryReceipt(incoming: {
    stream: StreamDuplex;
    connection: { remotePeer?: { toString: () => string } };
  }): Promise<void> {
    const { stream, connection } = incoming;
    try {
      // Rate limit receipts to prevent receipt flooding
      const remotePeerId = connection.remotePeer?.toString();
      if (remotePeerId) {
        try {
          this.enforceInboundRateLimit(remotePeerId);
          this.enforceGlobalInboundRateLimit();
        } catch {
          this.log.warn('receipt rate limit exceeded, dropping', { peerId: remotePeerId });
          try { await stream.close(); } catch { /* ignore */ }
          return;
        }
      }

      const raw = await readStream(stream.source);
      await stream.close();

      const receipt = decodeDeliveryReceiptBytes(new Uint8Array(raw));

      if (receipt.type === ReceiptType.Delivered && receipt.messageId) {
        // Remove from outbox if it was queued
        this.store.removeFromOutbox(receipt.messageId);
        this.log.info('delivery receipt received', {
          messageId: receipt.messageId,
          recipientDid: receipt.recipientDid,
        });

        // Notify subscribers about the receipt (convert to JSON string for backward compat)
        const receiptPayload = JSON.stringify({
          type: 'delivered',
          messageId: receipt.messageId,
          recipientDid: receipt.recipientDid,
          senderDid: receipt.senderDid,
          deliveredAtMs: Number(receipt.deliveredAtMs),
        });

        this.notifySubscribers({
          messageId: receipt.messageId,
          sourceDid: receipt.recipientDid ?? '',
          topic: RECEIPT_TOPIC,
          payload: receiptPayload,
          receivedAtMs: Number(receipt.deliveredAtMs) || Date.now(),
          priority: MessagePriority.NORMAL,
          seq: 0, // Receipts don't have inbox seq
        });
      }
    } catch {
      try { await stream.close(); } catch { /* ignore */ }
    }
  }
}

// ── MIME → Extension Helper ──────────────────────────────────────

const MIME_EXT_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'application/json': '.json',
  'text/plain': '.txt',
  'text/html': '.html',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'application/octet-stream': '.bin',
};

function mimeToExtension(contentType: string): string {
  const base = contentType.split(';')[0].trim().toLowerCase();
  return MIME_EXT_MAP[base] ?? '.bin';
}

// ── Rate Limit Error ─────────────────────────────────────────────

export class RateLimitError extends Error {
  readonly did: string;
  readonly limit: number;

  constructor(did: string, limit: number) {
    super(`Rate limit exceeded for ${did}: max ${limit} messages/minute`);
    this.name = 'RateLimitError';
    this.did = did;
    this.limit = limit;
  }
}
