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
import { MessageStore } from './message-store.js';
import { createLogger } from '../logger.js';
import { gzipSync, gunzipSync } from 'node:zlib';

// ── Constants ────────────────────────────────────────────────────

const PROTO_DM = '/clawnet/1.0.0/dm';
const PROTO_DID_ANNOUNCE = '/clawnet/1.0.0/did-announce';
const PROTO_RECEIPT = '/clawnet/1.0.0/receipt';

/** Maximum payload size in bytes (64 KB). */
const MAX_PAYLOAD_BYTES = 65_536;

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

type Logger = ReturnType<typeof createLogger>;

// ── Helpers ──────────────────────────────────────────────────────

/** Read all data from a stream source into a single Buffer, enforcing a size limit. */
async function readStream(
  source: AsyncIterable<{ subarray: () => Uint8Array } | Uint8Array>,
  maxBytes: number = MAX_PAYLOAD_BYTES * 2,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    const bytes = chunk instanceof Uint8Array ? chunk : chunk.subarray();
    total += bytes.length;
    if (total > maxBytes) {
      throw new Error(`Stream exceeded size limit: ${total} > ${maxBytes}`);
    }
    chunks.push(Buffer.from(bytes));
  }
  return Buffer.concat(chunks);
}

/** Write a UTF-8 JSON string to a stream sink. */
async function writeStream(sink: StreamDuplex['sink'], data: string): Promise<void> {
  const encoded = Buffer.from(data, 'utf-8');
  await sink(
    (async function* () {
      yield encoded;
    })(),
  );
}

// ── Service ──────────────────────────────────────────────────────

export class MessagingService {
  private readonly log: Logger;
  private readonly store: MessageStore;
  private readonly p2p: P2PNode;
  private readonly localDid: string;
  private cleanupTimer?: NodeJS.Timeout;

  /**
   * DID → PeerId mapping. Populated via the did-announce protocol when
   * peers connect. Persisted to SQLite and restored on startup.
   */
  private readonly didToPeerId = new Map<string, string>();
  private readonly peerIdToDid = new Map<string, string>();

  /** WebSocket subscribers that receive real-time inbox pushes. */
  private readonly subscribers = new Set<InboxSubscriber>();

  constructor(p2p: P2PNode, store: MessageStore, localDid: string) {
    this.log = createLogger({ level: 'info' });
    this.p2p = p2p;
    this.store = store;
    this.localDid = localDid;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    // Restore persisted DID→PeerId mappings from SQLite
    for (const { did, peerId } of this.store.getAllDidPeers()) {
      this.didToPeerId.set(did, peerId);
      this.peerIdToDid.set(peerId, did);
    }
    this.log.info('[messaging] restored DID mappings', { count: this.didToPeerId.size });

    // Register stream protocol handlers
    await this.p2p.handleProtocol(PROTO_DM, (incoming) => {
      void this.handleInboundMessage(incoming);
    });
    await this.p2p.handleProtocol(PROTO_DID_ANNOUNCE, (incoming) => {
      void this.handleDidAnnounce(incoming);
    });
    await this.p2p.handleProtocol(PROTO_RECEIPT, (incoming) => {
      void this.handleDeliveryReceipt(incoming);
    });

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
    this.subscribers.clear();
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
    const { encoded, compressed, encrypted } = this.encodePayload(payload, opts);

    // Validate payload size after encoding
    const payloadBytes = Buffer.byteLength(encoded, 'utf-8');
    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      throw new Error(`Payload too large: ${payloadBytes} bytes (max ${MAX_PAYLOAD_BYTES})`);
    }

    const peerId = this.didToPeerId.get(targetDid);
    if (peerId) {
      // Try direct delivery
      const delivered = await this.deliverDirect(peerId, targetDid, topic, encoded, ttlSec, priority, compressed, encrypted, opts.idempotencyKey);
      if (delivered) {
        return { messageId: `msg_direct_${Date.now().toString(36)}`, delivered: true, compressed, encrypted };
      }
    }

    // Queue in outbox for later delivery
    const messageId = this.store.addToOutbox({ targetDid, topic, payload: encoded, ttlSec, priority });
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
    const { encoded: sharedEncoded, compressed } = this.encodePayload(payload, { ...opts, encryptForKeyHex: undefined });

    const payloadBytes = Buffer.byteLength(sharedEncoded, 'utf-8');
    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      throw new Error(`Payload too large: ${payloadBytes} bytes (max ${MAX_PAYLOAD_BYTES})`);
    }

    // Deliver to all targets concurrently with bounded concurrency
    // Per-recipient E2E encryption is applied inside deliverMulticast when recipientKeys are provided
    const results = await this.deliverMulticast(
      targetDids, topic, sharedEncoded, ttlSec, priority, compressed,
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
          const ok = await this.deliverDirect(peerId, targetDid, entry.topic, entry.payload, entry.ttlSec);
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
   * Returns the encoded string and flags indicating what was applied.
   */
  private encodePayload(
    payload: string,
    opts: Pick<SendOptions, 'compress' | 'encryptForKeyHex'>,
  ): { encoded: string; compressed: boolean; encrypted: boolean } {
    let data = payload;
    let compressed = false;
    let encrypted = false;

    // Compression: gzip if enabled and payload > threshold
    if (opts.compress !== false && Buffer.byteLength(data, 'utf-8') > COMPRESSION_THRESHOLD_BYTES) {
      const gzipped = gzipSync(Buffer.from(data, 'utf-8'));
      data = gzipped.toString('base64');
      compressed = true;
    }

    // E2E Encryption: X25519 ECDH + HKDF + AES-256-GCM
    if (opts.encryptForKeyHex) {
      const recipientPubKey = hexToBytes(opts.encryptForKeyHex);
      const ephemeral = generateX25519Keypair();
      const shared = x25519SharedSecret(ephemeral.privateKey, recipientPubKey);
      const derived = hkdfSha256(shared, undefined, new Uint8Array(E2E_MSG_INFO), 32);
      const plainBytes = Buffer.from(data, 'utf-8');
      const enc = encryptAes256Gcm(derived, new Uint8Array(plainBytes));
      data = JSON.stringify({
        _e2e: 1,
        pk: bytesToHex(ephemeral.publicKey),
        n: enc.nonceHex,
        c: enc.ciphertextHex,
        t: enc.tagHex,
      });
      encrypted = true;
    }

    return { encoded: data, compressed, encrypted };
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
    payload: string,
    ttlSec: number,
    priority: number = MessagePriority.NORMAL,
    compressed = false,
    encrypted = false,
    idempotencyKey?: string,
  ): Promise<boolean> {
    let stream: StreamDuplex | null = null;
    try {
      stream = await this.p2p.newStream(peerId, PROTO_DM);

      const message = JSON.stringify({
        sourceDid: this.localDid,
        targetDid,
        topic,
        payload,
        ttlSec,
        sentAtMs: Date.now(),
        priority,
        compressed,
        encrypted,
        idempotencyKey,
      });

      await writeStream(stream.sink, message);
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
        } catch {
          this.log.warn('inbound rate limit exceeded, dropping stream', { peerId: remotePeer });
          try { await stream.close(); } catch { /* ignore */ }
          return;
        }
      }

      // readStream enforces size limit before reading all into memory
      const raw = await readStream(stream.source);
      await stream.close();

      const msg = JSON.parse(raw.toString('utf-8')) as {
        sourceDid?: string;
        targetDid?: string;
        topic?: string;
        payload?: string;
        ttlSec?: number;
        sentAtMs?: number;
        priority?: number;
        compressed?: boolean;
        encrypted?: boolean;
        idempotencyKey?: string;
      };

      if (!msg.sourceDid || !msg.topic || !msg.payload) {
        this.log.warn('inbound message missing required fields');
        return;
      }

      // Store in inbox (deduplication handled by store if idempotencyKey is present)
      const messageId = this.store.addToInbox({
        sourceDid: msg.sourceDid,
        targetDid: msg.targetDid ?? this.localDid,
        topic: msg.topic,
        payload: msg.payload,
        ttlSec: msg.ttlSec,
        sentAtMs: msg.sentAtMs,
        priority: msg.priority ?? MessagePriority.NORMAL,
        idempotencyKey: msg.idempotencyKey,
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
        payload: msg.payload,
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
      const raw = await readStream(stream.source, 1024); // DID announces are tiny
      await stream.close();

      const msg = JSON.parse(raw.toString('utf-8')) as { did?: string };
      const remotePeerId = connection.remotePeer?.toString();

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

  /** Announce our DID to a specific peer. */
  private async announceDidToPeer(peerId: string): Promise<void> {
    let stream: StreamDuplex | null = null;
    try {
      stream = await this.p2p.newStream(peerId, PROTO_DID_ANNOUNCE);
      await writeStream(stream.sink, JSON.stringify({ did: this.localDid }));
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
    sharedPayload: string,
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
          let payload = sharedPayload;
          let encrypted = false;
          const recipientKeyHex = recipientKeys?.[targetDid];
          if (recipientKeyHex) {
            const perRecipient = this.encodePayload(sharedPayload, { encryptForKeyHex: recipientKeyHex, compress: false });
            payload = perRecipient.encoded;
            encrypted = perRecipient.encrypted;
          }

          const peerId = this.didToPeerId.get(targetDid);
          if (peerId) {
            const delivered = await this.deliverDirect(peerId, targetDid, topic, payload, ttlSec, priority, compressed, encrypted, idempotencyKey);
            if (delivered) {
              return { targetDid, messageId: `msg_direct_${Date.now().toString(36)}`, delivered: true, compressed, encrypted };
            }
          }
          const messageId = this.store.addToOutbox({ targetDid, topic, payload, ttlSec, priority });
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
    try {
      this.store.upsertDidPeer(did, peerId);
    } catch {
      // Best-effort persistence — in-memory map is authoritative
    }
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
      await writeStream(
        stream.sink,
        JSON.stringify({
          type: 'delivered',
          messageId,
          recipientDid: this.localDid,
          senderDid: recipientDid,
          deliveredAtMs: Date.now(),
        }),
      );
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
    const { stream } = incoming;
    try {
      const raw = await readStream(stream.source);
      await stream.close();

      const receipt = JSON.parse(raw.toString('utf-8')) as {
        type?: string;
        messageId?: string;
        recipientDid?: string;
        deliveredAtMs?: number;
      };

      if (receipt.type === 'delivered' && receipt.messageId) {
        // Remove from outbox if it was queued
        this.store.removeFromOutbox(receipt.messageId);
        this.log.info('delivery receipt received', {
          messageId: receipt.messageId,
          recipientDid: receipt.recipientDid,
        });

        // Notify subscribers about the receipt
        this.notifySubscribers({
          messageId: receipt.messageId,
          sourceDid: receipt.recipientDid ?? '',
          topic: RECEIPT_TOPIC,
          payload: JSON.stringify(receipt),
          receivedAtMs: receipt.deliveredAtMs ?? Date.now(),
          priority: MessagePriority.NORMAL,
          seq: 0, // Receipts don't have inbox seq
        });
      }
    } catch {
      try { await stream.close(); } catch { /* ignore */ }
    }
  }
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
