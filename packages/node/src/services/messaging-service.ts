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
  x25519PublicKeyFromPrivateKey,
  x25519SharedSecret,
  hkdfSha256,
  encryptAes256Gcm,
  decryptAes256Gcm,
  bytesToHex,
  hexToBytes,
  DELIVERY_EXTERNAL_PROTOCOL,
  encodeHeader as encodeDeliveryHeader,
  decodeHeader as decodeDeliveryHeader,
  isDeliveryExternalRequest,
  type DeliveryExternalRequest,
  type DeliveryExternalResponseHeader,
  type DeliveryExternalNotFound,
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
import type { DelegationRecord, DelegatedMessage } from '@claw-network/protocol/messaging';
import {
  DELIVERY_AUTH_PROTOCOL,
  isDeliveryAuthRequest,
  isDeliveryAuthPayload,
} from '@claw-network/protocol';
import type {
  DeliveryAuthRequest,
  DeliveryAuthPayload,
  DeliveryAuthResponse,
} from '@claw-network/protocol';
import { MessageStore } from './message-store.js';
import { createLogger } from '../logger.js';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { mkdir, writeFile, readFile as fsReadFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import crypto from 'node:crypto';

// ── Constants ────────────────────────────────────────────────────

const PROTO_DM = '/clawnet/1.0.0/dm';
const PROTO_DID_ANNOUNCE = '/clawnet/1.0.0/did-announce';
const PROTO_RECEIPT = '/clawnet/1.0.0/receipt';
const PROTO_DID_RESOLVE = '/clawnet/1.0.0/did-resolve';
const PROTO_ATTACHMENT = '/clawnet/1.0.0/attachment';
const PROTO_DELEGATED_MSG = '/clawnet/1.0.0/delegated-msg';
const PROTO_DELIVERY_AUTH = DELIVERY_AUTH_PROTOCOL;
const PROTO_DELIVERY_EXTERNAL = DELIVERY_EXTERNAL_PROTOCOL;

/** Max content bytes for delivery-external (50 MB). */
const MAX_DELIVERABLE_BYTES = 50 * 1024 * 1024;

const MAX_ACTIVE_DELEGATIONS = 10;
const MIN_DELEGATION_TTL_SEC = 60;
const MAX_DELEGATION_TTL_SEC = 86_400;
const DELEGATION_CLEANUP_INTERVAL_MS = 5 * 60_000;
const DELEGATION_FORWARD_CONCURRENCY = 5;
const DELEGATION_FORWARD_QUEUE_DEPTH = 200;

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

/** Payload size threshold for automatic Brotli compression (1 KB). */
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
  payload: Buffer;
  receivedAtMs: number;
  priority: number;
  seq: number;
  compressed: boolean;
  encrypted: boolean;
}

export interface SendOptions {
  ttlSec?: number;
  priority?: MessagePriority;
  /** If true, compress payload > 1 KB with Brotli before sending. */
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

/** Callback for delegated message subscribers — called when a delegated message arrives. */
export type DelegatedMsgSubscriber = (msg: DelegatedMessage) => void;

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

// ── Delegation Forwarder ─────────────────────────────────────────

class DelegationForwarder {
  private queue: Array<{ delegateDid: string; peerId: string; data: Uint8Array }> = [];
  private active = 0;

  constructor(
    private readonly maxConcurrency: number,
    private readonly maxQueueDepth: number,
    private readonly sendFn: (peerId: string, data: Uint8Array) => Promise<boolean>,
    private readonly log: Logger,
  ) {}

  enqueue(delegateDid: string, peerId: string, data: Uint8Array): void {
    if (this.queue.length >= this.maxQueueDepth) {
      this.log.warn('delegation forward queue full, dropping oldest', {
        delegateDid,
        queueLen: this.queue.length,
      });
      this.queue.shift();
    }
    this.queue.push({ delegateDid, peerId, data });
    this.drain();
  }

  private drain(): void {
    while (this.active < this.maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active++;
      this.sendFn(item.peerId, item.data)
        .catch((err) => {
          this.log.warn('delegation forward failed', {
            delegateDid: item.delegateDid,
            error: (err as Error).message,
          });
        })
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
}

// ── Service ──────────────────────────────────────────────────────

export class MessagingService {
  private readonly log: Logger;
  private readonly store: MessageStore;
  private readonly p2p: P2PNode;
  private readonly localDid: string;
  private readonly attachmentsDir: string;
  /** Directory for deliverable content blobs (delivery-external protocol). */
  private readonly deliverableDataDir: string;
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

  /** Delegation forwarding infrastructure. */
  private delegationForwarder!: DelegationForwarder;
  private delegationCleanupTimer?: ReturnType<typeof setInterval>;
  private readonly delegatedMsgSubscribers = new Set<DelegatedMsgSubscriber>();

  /** Persistent X25519 keypair for E2E decryption (delivery-auth, encrypted messages). */
  private x25519PrivateKey!: Uint8Array;
  private x25519PublicKey!: Uint8Array;
  private readonly keysDir: string;

  constructor(p2p: P2PNode, store: MessageStore, localDid: string, dataDir?: string) {
    this.log = createLogger({ level: 'info' });
    this.p2p = p2p;
    this.store = store;
    this.localDid = localDid;
    this.attachmentsDir = dataDir ? join(dataDir, 'attachments') : join(process.cwd(), 'data', 'attachments');
    this.deliverableDataDir = dataDir ? join(dataDir, 'deliverables') : join(process.cwd(), 'data', 'deliverables');
    this.keysDir = dataDir ? join(dataDir, 'keys') : join(process.cwd(), 'data', 'keys');
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    // Ensure attachments, deliverables, and keys directories exist
    await mkdir(this.attachmentsDir, { recursive: true });
    await mkdir(this.deliverableDataDir, { recursive: true });
    await mkdir(this.keysDir, { recursive: true });

    // Load or create persistent X25519 keypair for E2E decryption
    await this.loadOrCreateX25519Key();

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
    await this.p2p.handleProtocol(PROTO_DELIVERY_AUTH, (incoming) => {
      void this.handleInboundDeliveryAuth(incoming);
    }, { maxInboundStreams: 64 });
    await this.p2p.handleProtocol(PROTO_DELIVERY_EXTERNAL, (incoming) => {
      void this.handleInboundDeliveryExternal(incoming);
    }, { maxInboundStreams: 16 });

    // ── Delegation forwarding infrastructure ─────────────────────
    this.delegationForwarder = new DelegationForwarder(
      DELEGATION_FORWARD_CONCURRENCY,
      DELEGATION_FORWARD_QUEUE_DEPTH,
      async (peerId, data) => this.sendDelegatedMsg(peerId, data),
      this.log,
    );

    await this.p2p.handleProtocol(PROTO_DELEGATED_MSG, (incoming) => {
      void this.handleInboundDelegatedMsg(incoming);
    }, { maxInboundStreams: 64 });

    this.delegationCleanupTimer = setInterval(() => {
      try {
        const cleaned = this.store.cleanupExpiredDelegations();
        const inboxCleaned = this.store.cleanupDelegatedInbox();
        if (cleaned > 0 || inboxCleaned > 0) {
          this.log.info('delegation cleanup', { delegations: cleaned, inbox: inboxCleaned });
        }
      } catch (err) {
        this.log.warn('delegation cleanup failed', { error: (err as Error).message });
      }
    }, DELEGATION_CLEANUP_INTERVAL_MS);

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
    try {
      await this.p2p.unhandleProtocol(PROTO_DELIVERY_AUTH);
    } catch { /* ignore */ }
    try {
      await this.p2p.unhandleProtocol(PROTO_DELIVERY_EXTERNAL);
    } catch { /* ignore */ }
    try {
      await this.p2p.unhandleProtocol(PROTO_DELEGATED_MSG);
    } catch { /* ignore */ }
    if (this.delegationCleanupTimer) {
      clearInterval(this.delegationCleanupTimer);
    }
    this.subscribers.clear();
    this.attachmentSubscribers.clear();
    this.delegatedMsgSubscribers.clear();
  }

  /** Returns the node's persistent X25519 public key as hex string. */
  getX25519PublicKeyHex(): string {
    return bytesToHex(this.x25519PublicKey);
  }

  /**
   * Load or create a persistent X25519 keypair for E2E decryption.
   * Stored as raw 32-byte private key at `<keysDir>/x25519.key`.
   */
  private async loadOrCreateX25519Key(): Promise<void> {
    const keyPath = join(this.keysDir, 'x25519.key');
    try {
      const data = await fsReadFile(keyPath);
      this.x25519PrivateKey = new Uint8Array(data);
      this.x25519PublicKey = x25519PublicKeyFromPrivateKey(this.x25519PrivateKey);
      this.log.info('[messaging] loaded persistent X25519 key', {
        publicKeyHex: bytesToHex(this.x25519PublicKey).slice(0, 16) + '...',
      });
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') {
        throw err;
      }
      // Generate new keypair and persist
      const keypair = generateX25519Keypair();
      this.x25519PrivateKey = keypair.privateKey;
      this.x25519PublicKey = keypair.publicKey;
      await writeFile(keyPath, Buffer.from(this.x25519PrivateKey), { mode: 0o600 });
      this.log.info('[messaging] created persistent X25519 key', {
        publicKeyHex: bytesToHex(this.x25519PublicKey).slice(0, 16) + '...',
      });
    }
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Send a message to a target DID.
   * If the target peer is online and reachable, delivers directly.
   * Otherwise queues in outbox for later delivery.
   */
  async send(targetDid: string, topic: string, payload: Uint8Array, opts: SendOptions = {}): Promise<SendResult> {
    const ttlSec = opts.ttlSec ?? 86400;
    const priority = opts.priority ?? MessagePriority.NORMAL;

    // Rate limit check
    this.enforceRateLimit(this.localDid);

    // Apply compression + encryption to payload
    const { payloadBytes, compressed, encrypted } = this.encodePayload(payload, opts);

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

    // Queue in outbox for later delivery (raw bytes stored as BLOB)
    const messageId = this.store.addToOutbox({ targetDid, topic, payload: Buffer.from(payloadBytes), ttlSec, priority, compressed, encrypted });
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
    payload: Uint8Array,
    opts: SendOptions = {},
  ): Promise<MulticastResult> {
    const ttlSec = opts.ttlSec ?? 86400;
    const priority = opts.priority ?? MessagePriority.NORMAL;

    // Rate limit check (counts as 1 call for rate-limit purposes)
    this.enforceRateLimit(this.localDid);

    // Pre-encode a shared payload (without per-recipient encryption)
    const { payloadBytes: sharedPayloadBytes, compressed } = this.encodePayload(payload, { ...opts, encryptForKeyHex: undefined });

    if (sharedPayloadBytes.length > MAX_PAYLOAD_BYTES) {
      throw new Error(`Payload too large: ${sharedPayloadBytes.length} bytes (max ${MAX_PAYLOAD_BYTES})`);
    }

    // Deliver to all targets concurrently with bounded concurrency
    // Per-recipient E2E encryption is applied inside deliverMulticast when recipientKeys are provided
    const results = await this.deliverMulticast(
      targetDids, topic, sharedPayloadBytes, ttlSec, priority, compressed,
      opts.recipientKeys, opts.idempotencyKey,
    );
    return { results };
  }

  /** Query the local inbox. */
  getInbox(opts?: InboxQueryOptions): InboxMessage[] {
    return this.store.getInbox(opts);
  }

  /** Fetch a single inbox message by ID (for payload download). */
  getInboxMessage(messageId: string): InboxMessage | null {
    return this.store.getInboxMessage(messageId);
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
          // Outbox payload is raw BLOB bytes; flags come from columns
          const ok = await this.deliverDirect(peerId, targetDid, entry.topic, new Uint8Array(entry.payload), entry.ttlSec, undefined, entry.compressed, entry.encrypted);
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

  // ── Subscription Delegation Management ─────────────────────────

  createSubscriptionDelegation(params: {
    delegateDid: string;
    topics: string[];
    expiresInSec: number;
    metadataOnly?: boolean;
  }): DelegationRecord {
    if (!params.delegateDid || !params.delegateDid.startsWith('did:claw:z')) {
      throw new Error('Invalid delegateDid: must be a valid did:claw: identifier');
    }

    if (!Array.isArray(params.topics) || params.topics.length === 0) {
      throw new Error('topics must be a non-empty array');
    }
    for (const t of params.topics) {
      if (typeof t !== 'string' || t.length === 0 || t.length > 256) {
        throw new Error(`Invalid topic: must be 1-256 characters, got "${t}"`);
      }
      if (t.includes('*')) {
        throw new Error(`Wildcard topics not allowed in delegation: "${t}"`);
      }
    }

    if (
      params.expiresInSec < MIN_DELEGATION_TTL_SEC ||
      params.expiresInSec > MAX_DELEGATION_TTL_SEC
    ) {
      throw new Error(
        `expiresInSec must be between ${MIN_DELEGATION_TTL_SEC} and ${MAX_DELEGATION_TTL_SEC}`,
      );
    }

    const activeCount = this.store.activeDelegationCount();
    if (activeCount >= MAX_ACTIVE_DELEGATIONS) {
      throw new Error(
        `Maximum active delegations (${MAX_ACTIVE_DELEGATIONS}) reached`,
      );
    }

    const expiresAtMs = Date.now() + params.expiresInSec * 1000;
    return this.store.createDelegation({
      delegateDid: params.delegateDid,
      topics: params.topics,
      metadataOnly: params.metadataOnly ?? true,
      expiresAtMs,
    });
  }

  revokeSubscriptionDelegation(delegationId: string): boolean {
    return this.store.revokeDelegation(delegationId);
  }

  listSubscriptionDelegations(opts?: { activeOnly?: boolean }): DelegationRecord[] {
    return this.store.listDelegations(opts);
  }

  getSubscriptionDelegation(delegationId: string): DelegationRecord | null {
    return this.store.getDelegation(delegationId);
  }

  // ── Delegated Message Subscriber Management ────────────────────

  addDelegatedMsgSubscriber(cb: DelegatedMsgSubscriber): void {
    this.delegatedMsgSubscribers.add(cb);
  }

  removeDelegatedMsgSubscriber(cb: DelegatedMsgSubscriber): void {
    this.delegatedMsgSubscribers.delete(cb);
  }

  private notifyDelegatedMsgSubscribers(msg: DelegatedMessage): void {
    for (const cb of this.delegatedMsgSubscribers) {
      queueMicrotask(() => {
        try { cb(msg); } catch { /* ignore */ }
      });
    }
  }

  /** Get the current delegated inbox sequence number (for WS replay). */
  getCurrentDelegatedSeq(): number {
    return this.store.currentDelegatedSeq();
  }

  /** Get delegated inbox entries for replay. */
  getDelegatedInbox(opts: { delegationId: string; sinceSeq?: number; limit?: number }) {
    return this.store.getDelegatedInbox(opts);
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
        payload: Buffer.from(JSON.stringify({
          attachmentId: msg.attachmentId,
          contentType: msg.contentType,
          fileName: msg.fileName,
          totalSize: msg.data.length,
        }), 'utf-8'),
        receivedAtMs: Date.now(),
        priority: MessagePriority.NORMAL,
        seq: currentSeq,
        compressed: false,
        encrypted: false,
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
   * Encode a payload: optionally compress (Brotli) then optionally encrypt (X25519+AES-256-GCM).
   *
   * Returns raw binary bytes — stored directly as BLOB in SQLite.
   * No JSON wrappers, no base64. Flags indicate compression/encryption state.
   */
  private encodePayload(
    payload: Uint8Array,
    opts: Pick<SendOptions, 'compress' | 'encryptForKeyHex'>,
  ): { payloadBytes: Uint8Array; compressed: boolean; encrypted: boolean } {
    let data = Buffer.from(payload);
    let compressed = false;
    let encrypted = false;

    // Compression: Brotli if enabled and payload > threshold
    if (opts.compress !== false && data.length > COMPRESSION_THRESHOLD_BYTES) {
      data = Buffer.from(brotliCompressSync(data));
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
      encrypted = true;
    }

    return { payloadBytes: new Uint8Array(data), compressed, encrypted };
  }

  /**
   * Decrypt an E2E-encrypted payload using the local node's X25519 private key.
   * Accepts raw binary E2E envelope bytes. Returns decrypted bytes or null.
   */
  static decryptPayload(payload: Uint8Array, recipientPrivateKey: Uint8Array): Uint8Array | null {
    try {
      const envelope = decodeE2EEnvelope(payload);
      const shared = x25519SharedSecret(recipientPrivateKey, envelope.ephemeralPk);
      const derived = hkdfSha256(shared, undefined, new Uint8Array(E2E_MSG_INFO), 32);
      const decrypted = decryptAes256Gcm(derived, {
        nonceHex: bytesToHex(envelope.nonce),
        ciphertextHex: bytesToHex(envelope.ciphertext),
        tagHex: bytesToHex(envelope.tag),
      });
      return new Uint8Array(decrypted);
    } catch {
      return null;
    }
  }

  /**
   * Decompress a Brotli-compressed payload (raw Brotli bytes → decompressed bytes).
   */
  static decompressPayload(payload: Uint8Array): Uint8Array | null {
    try {
      return new Uint8Array(brotliDecompressSync(Buffer.from(payload)));
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

  // ── Private: Inbound Delivery-Auth Handler ──────────────────────

  private async handleInboundDeliveryAuth(incoming: {
    stream: StreamDuplex;
    connection: { remotePeer?: { toString: () => string } };
  }): Promise<void> {
    const { stream, connection } = incoming;
    try {
      const remotePeer = connection.remotePeer?.toString();
      if (remotePeer) {
        try {
          this.enforceInboundRateLimit(remotePeer);
        } catch {
          this.log.warn('delivery-auth inbound rate limit exceeded', { peerId: remotePeer });
          try { await stream.close(); } catch { /* ignore */ }
          return;
        }
      }

      const raw = await readStream(stream.source, MAX_PAYLOAD_BYTES, STREAM_READ_TIMEOUT_MS);

      // Parse and validate the request
      let request: unknown;
      try {
        request = JSON.parse(raw.toString('utf-8'));
      } catch {
        const errResp: DeliveryAuthResponse = { accepted: false, reason: 'Invalid JSON' };
        await writeBinaryStream(stream.sink, Buffer.from(JSON.stringify(errResp)));
        await stream.close();
        return;
      }

      if (!isDeliveryAuthRequest(request)) {
        const errResp: DeliveryAuthResponse = { accepted: false, reason: 'Invalid request format' };
        await writeBinaryStream(stream.sink, Buffer.from(JSON.stringify(errResp)));
        await stream.close();
        return;
      }

      // Decrypt the payload using persistent X25519 key
      let payload: DeliveryAuthPayload;
      try {
        const senderPub = hexToBytes(request.senderPublicKeyHex);
        const shared = x25519SharedSecret(this.x25519PrivateKey, senderPub);
        const derived = hkdfSha256(
          shared,
          undefined,
          new TextEncoder().encode('clawnet:delivery-auth:v1'),
          32,
        );
        const decrypted = decryptAes256Gcm(derived, {
          nonceHex: request.nonceHex,
          ciphertextHex: request.ciphertextHex,
          tagHex: request.tagHex,
        });
        const parsed = JSON.parse(Buffer.from(decrypted).toString('utf-8'));
        if (!isDeliveryAuthPayload(parsed)) {
          throw new Error('Invalid delivery-auth payload');
        }
        payload = parsed;
      } catch (err) {
        const errResp: DeliveryAuthResponse = { accepted: false, reason: 'Decryption failed' };
        await writeBinaryStream(stream.sink, Buffer.from(JSON.stringify(errResp)));
        await stream.close();
        this.log.warn('delivery-auth decryption failed', { error: (err as Error).message });
        return;
      }

      // Store as a special inbox message with topic _delivery-auth
      const deliveryPayload = Buffer.from(JSON.stringify({
        deliverableId: payload.deliverableId,
        orderId: payload.orderId,
        providerDid: payload.providerDid,
        token: payload.token,
        expiresAt: payload.expiresAt,
        receivedAt: Date.now(),
      }), 'utf-8');

      const messageId = this.store.addToInbox({
        sourceDid: payload.providerDid,
        targetDid: this.localDid,
        topic: '_delivery-auth',
        payload: deliveryPayload,
        ttlSec: payload.expiresAt
          ? Math.max(60, Math.floor((payload.expiresAt - Date.now()) / 1000))
          : 86400,
        sentAtMs: Date.now(),
        priority: MessagePriority.HIGH,
      });

      // Record DID → PeerId mapping from the sender
      const senderPeerId = connection.remotePeer?.toString();
      if (senderPeerId && payload.providerDid) {
        this.registerDidPeer(payload.providerDid, senderPeerId);
      }

      this.log.info('delivery-auth received', {
        messageId,
        deliverableId: payload.deliverableId,
        orderId: payload.orderId,
        providerDid: payload.providerDid,
      });

      // Notify subscribers
      const currentSeq = this.store.currentSeq();
      this.notifySubscribers({
        messageId,
        sourceDid: payload.providerDid,
        topic: '_delivery-auth',
        payload: deliveryPayload,
        receivedAtMs: Date.now(),
        priority: MessagePriority.HIGH,
        seq: currentSeq,
        compressed: false,
        encrypted: false,
      });

      // Send acceptance response
      const okResp: DeliveryAuthResponse = { accepted: true };
      await writeBinaryStream(stream.sink, Buffer.from(JSON.stringify(okResp)));
      await stream.close();
    } catch (err) {
      this.log.warn('failed to handle delivery-auth', { error: (err as Error).message });
      try { await stream.close(); } catch { /* ignore */ }
    }
  }

  // ── Private: Delivery-External Protocol ───────────────────────

  /**
   * Handle an inbound delivery-external request from a remote peer.
   * Looks up the deliverable content in `deliverableDataDir`, streams it back.
   */
  private async handleInboundDeliveryExternal(incoming: {
    stream: StreamDuplex;
    connection: { remotePeer?: { toString: () => string } };
  }): Promise<void> {
    const { stream, connection } = incoming;
    try {
      const remotePeer = connection.remotePeer?.toString();
      if (remotePeer) {
        try {
          this.enforceInboundRateLimit(remotePeer);
        } catch {
          this.log.warn('delivery-external inbound rate limit exceeded', { peerId: remotePeer });
          try { await stream.close(); } catch { /* ignore */ }
          return;
        }
      }

      // Read the JSON request (small — just an ID)
      const raw = await readStream(stream.source, 4096, STREAM_READ_TIMEOUT_MS);
      await stream.close();

      let request: unknown;
      try {
        request = JSON.parse(raw.toString('utf-8'));
      } catch {
        this.log.warn('delivery-external: invalid JSON request');
        return;
      }

      if (!isDeliveryExternalRequest(request)) {
        this.log.warn('delivery-external: invalid request format', { deliverableId: (request as Record<string, unknown>)?.deliverableId });
        return;
      }

      const req = request as DeliveryExternalRequest;
      const filePath = join(this.deliverableDataDir, `${req.deliverableId}`);

      let content: Buffer;
      try {
        content = await fsReadFile(filePath);
      } catch {
        // Not found — send not-found header
        const notFound: DeliveryExternalNotFound = {
          version: 1,
          deliverableId: req.deliverableId,
          error: 'not_found',
        };
        const outStream = await this.p2p.newStream(remotePeer ?? '', PROTO_DELIVERY_EXTERNAL).catch(() => null);
        if (outStream) {
          await writeBinaryStream(outStream.sink, encodeDeliveryHeader(notFound as unknown as Record<string, unknown>));
          await outStream.close();
        }
        this.log.info('delivery-external: not found', { deliverableId: req.deliverableId });
        return;
      }

      // Load content hash from sidecar (.hash file)
      let contentHash = '';
      try {
        const hashFile = await fsReadFile(`${filePath}.hash`, 'utf-8');
        contentHash = hashFile.trim();
      } catch { /* hash sidecar optional */ }

      const responseHdr: DeliveryExternalResponseHeader = {
        version: 1,
        deliverableId: req.deliverableId,
        size: content.length,
        contentHash,
      };

      // Open outbound stream back to requester and send header + body
      const outPeerId = remotePeer ?? this.didToPeerId.get(req.requesterDid);
      if (!outPeerId) {
        this.log.warn('delivery-external: cannot send response — requester peer unknown');
        return;
      }

      let outStream: StreamDuplex | null = null;
      try {
        outStream = await this.p2p.newStream(outPeerId, PROTO_DELIVERY_EXTERNAL);
        const hdrBytes = encodeDeliveryHeader(responseHdr as unknown as Record<string, unknown>);
        // Concatenate header + body
        const msg = new Uint8Array(hdrBytes.length + content.length);
        msg.set(hdrBytes, 0);
        msg.set(content, hdrBytes.length);
        await writeBinaryStream(outStream.sink, msg);
        await outStream.close();
        this.log.info('delivery-external: content sent', {
          deliverableId: req.deliverableId,
          size: content.length,
          requesterDid: req.requesterDid,
        });
      } catch (err) {
        this.log.warn('delivery-external: failed to send response', { error: (err as Error).message });
        if (outStream) { try { await outStream.close(); } catch { /* ignore */ } }
      }
    } catch (err) {
      this.log.warn('failed to handle delivery-external', { error: (err as Error).message });
      try { await stream.close(); } catch { /* ignore */ }
    }
  }

  /**
   * Request deliverable content from a remote provider node via P2P.
   * Returns the raw content bytes and the hash declared by the provider.
   * The caller should verify `blake3Hex(bytes) === contentHash`.
   */
  async requestDeliverableFromPeer(
    providerDid: string,
    deliverableId: string,
  ): Promise<{ bytes: Uint8Array; contentHash: string } | null> {
    const peerId = this.didToPeerId.get(providerDid);
    if (!peerId) {
      this.log.warn('delivery-external: unknown peer for provider DID', { providerDid });
      return null;
    }

    let stream: StreamDuplex | null = null;
    try {
      stream = await this.p2p.newStream(peerId, PROTO_DELIVERY_EXTERNAL);
      const req: DeliveryExternalRequest = {
        version: 1,
        deliverableId,
        requesterDid: this.localDid,
      };
      await writeBinaryStream(stream.sink, Buffer.from(JSON.stringify(req)));

      // Read response (header + body together)
      const raw = await readStream(stream.source, MAX_DELIVERABLE_BYTES + 4096, ATTACHMENT_STREAM_TIMEOUT_MS);
      await stream.close();

      const data = new Uint8Array(raw);
      const { header, bodyOffset } = decodeDeliveryHeader<DeliveryExternalResponseHeader | DeliveryExternalNotFound>(data);

      if ('error' in header && header.error === 'not_found') {
        this.log.info('delivery-external: provider returned not_found', { deliverableId });
        return null;
      }

      const hdr = header as DeliveryExternalResponseHeader;
      const body = data.subarray(bodyOffset);

      if (body.length !== hdr.size) {
        throw new Error(`Delivery-external size mismatch: expected ${hdr.size} got ${body.length}`);
      }

      return { bytes: body, contentHash: hdr.contentHash };
    } catch (err) {
      this.log.warn('delivery-external: request failed', {
        providerDid,
        deliverableId,
        error: (err as Error).message,
      });
      if (stream) { try { await stream.close(); } catch { /* ignore */ } }
      return null;
    }
  }

  /**
   * Store deliverable content blob so it can be served via delivery-external.
   * Creates `deliverableDataDir/<deliverableId>` + `.hash` sidecar.
   */
  async storeDeliverableContent(deliverableId: string, bytes: Uint8Array, contentHash: string): Promise<void> {
    await mkdir(this.deliverableDataDir, { recursive: true });
    const filePath = join(this.deliverableDataDir, deliverableId);
    await writeFile(filePath, bytes);
    await writeFile(`${filePath}.hash`, contentHash, 'utf-8');
    this.log.info('deliverable content stored', { deliverableId, size: bytes.length });
  }

  /**
   * Send a delivery-auth credential to a target DID.
   * Encrypts the token via X25519-AES-256-GCM and delivers over a P2P stream.
   * Returns the `DeliveryAuthResponse` from the recipient, or null if delivery failed.
   */
  async sendDeliveryAuth(
    targetDid: string,
    payload: DeliveryAuthPayload,
    recipientX25519PubHex?: string,
  ): Promise<DeliveryAuthResponse | null> {
    const peerId = this.didToPeerId.get(targetDid);
    if (!peerId) {
      this.log.warn('delivery-auth: unknown peer for target DID', { targetDid });
      return null;
    }

    let stream: StreamDuplex | null = null;
    try {
      // Encrypt using X25519 ECDH
      const ephemeral = generateX25519Keypair();
      let recipientPub: Uint8Array;
      if (recipientX25519PubHex) {
        recipientPub = hexToBytes(recipientX25519PubHex);
      } else {
        // Fallback: use a fresh keypair (recipient must have corresponding private key from key exchange)
        this.log.warn('delivery-auth: no recipient X25519 pub key, delivery may fail');
        return null;
      }

      const shared = x25519SharedSecret(ephemeral.privateKey, recipientPub);
      const derived = hkdfSha256(
        shared,
        undefined,
        new TextEncoder().encode('clawnet:delivery-auth:v1'),
        32,
      );
      const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
      const enc = encryptAes256Gcm(derived, new Uint8Array(plaintext));

      const request: DeliveryAuthRequest = {
        version: 1,
        senderPublicKeyHex: bytesToHex(ephemeral.publicKey),
        nonceHex: enc.nonceHex,
        ciphertextHex: enc.ciphertextHex,
        tagHex: enc.tagHex,
      };

      stream = await this.p2p.newStream(peerId, PROTO_DELIVERY_AUTH);
      await writeBinaryStream(stream.sink, Buffer.from(JSON.stringify(request)));

      // Read response
      const respRaw = await readStream(stream.source, MAX_PAYLOAD_BYTES, DID_RESOLVE_TIMEOUT_MS);
      await stream.close();

      const resp = JSON.parse(respRaw.toString('utf-8')) as DeliveryAuthResponse;
      this.log.info('delivery-auth sent', {
        targetDid,
        deliverableId: payload.deliverableId,
        accepted: resp.accepted,
      });
      return resp;
    } catch (err) {
      this.log.warn('delivery-auth send failed', {
        targetDid,
        error: (err as Error).message,
      });
      if (stream) {
        try { await stream.close(); } catch { /* ignore */ }
      }
      return null;
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

      // Store raw payload bytes directly as BLOB — no JSON wrappers, no base64
      const payloadBuffer = Buffer.from(msg.payload);
      const compressed = !!msg.compressed;
      const encrypted = !!msg.encrypted;

      // Store in inbox (deduplication handled by store if idempotencyKey is present)
      const messageId = this.store.addToInbox({
        sourceDid: msg.sourceDid,
        targetDid: msg.targetDid || this.localDid,
        topic: msg.topic,
        payload: payloadBuffer,
        ttlSec: msg.ttlSec || undefined,
        sentAtMs: msg.sentAtMs ? Number(msg.sentAtMs) : undefined,
        priority: msg.priority ?? MessagePriority.NORMAL,
        idempotencyKey: msg.idempotencyKey || undefined,
        compressed,
        encrypted,
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
        payload: payloadBuffer,
        receivedAtMs: Date.now(),
        priority: msg.priority ?? MessagePriority.NORMAL,
        seq: currentSeq,
        compressed,
        encrypted,
      });

      // Delegation forwarding
      this.forwardToDelegates(msg.topic, {
        messageId,
        sourceDid: msg.sourceDid,
        payloadBytes: payloadBuffer,
        payloadSize: msg.payload.length,
        seq: currentSeq,
        receivedAtMs: Date.now(),
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

  // ── Private: Delegation Forwarding ─────────────────────────────

  private forwardToDelegates(
    topic: string,
    msg: {
      messageId: string;
      sourceDid: string;
      payloadBytes: Buffer;
      payloadSize: number;
      seq: number;
      receivedAtMs: number;
    },
  ): void {
    let delegations: DelegationRecord[];
    try {
      delegations = this.store.getActiveDelegationsForTopic(topic);
    } catch {
      return;
    }

    if (delegations.length === 0) return;

    for (const dlg of delegations) {
      const delegatedMsg: DelegatedMessage = {
        type: 'delegated-message',
        delegationId: dlg.delegationId,
        originalTargetDid: this.localDid,
        sourceDid: msg.sourceDid,
        topic,
        seq: msg.seq,
        receivedAtMs: msg.receivedAtMs,
      };

      if (dlg.metadataOnly) {
        delegatedMsg.metadata = {
          messageId: msg.messageId,
          payloadSizeBytes: msg.payloadSize,
        };
      } else {
        // Delegation forwarding uses JSON — decode raw bytes as UTF-8 for the wire
        delegatedMsg.payload = msg.payloadBytes.toString('utf-8');
      }

      const peerId = this.didToPeerId.get(dlg.delegateDid);
      if (!peerId) {
        this.log.debug('delegation forward skipped: unknown peerId', {
          delegationId: dlg.delegationId,
          delegateDid: dlg.delegateDid,
        });
        continue;
      }

      const data = Buffer.from(JSON.stringify(delegatedMsg), 'utf-8');
      this.delegationForwarder.enqueue(dlg.delegateDid, peerId, data);
    }
  }

  private async sendDelegatedMsg(peerId: string, data: Uint8Array): Promise<boolean> {
    let stream: StreamDuplex | null = null;
    try {
      stream = await this.p2p.newStream(peerId, PROTO_DELEGATED_MSG);
      await writeBinaryStream(stream.sink, data);
      await stream.close();
      return true;
    } catch (err) {
      this.log.warn('delegated-msg send failed', { peerId, error: (err as Error).message });
      if (stream) {
        try { await stream.close(); } catch { /* ignore */ }
      }
      return false;
    }
  }

  private async handleInboundDelegatedMsg(incoming: {
    stream: StreamDuplex;
    connection: { remotePeer?: { toString: () => string } };
  }): Promise<void> {
    const { stream } = incoming;
    try {
      const raw = await readStream(stream.source, 64 * 1024, 10_000);
      await stream.close();

      const msg = JSON.parse(raw.toString('utf-8')) as DelegatedMessage;

      if (msg.type !== 'delegated-message' || !msg.delegationId || !msg.topic) {
        this.log.warn('invalid delegated message received');
        return;
      }

      const messageId = msg.metadata?.messageId ?? msg.delegationId + ':' + msg.seq;
      const seq = this.store.addToDelegatedInbox({
        delegationId: msg.delegationId,
        sourceDid: msg.sourceDid,
        originalTargetDid: msg.originalTargetDid,
        topic: msg.topic,
        messageId,
        payloadSize: msg.metadata?.payloadSizeBytes ?? (msg.payload ? Buffer.byteLength(msg.payload) : 0),
      });

      if (seq === null) {
        return;
      }

      this.log.info('delegated message received', {
        delegationId: msg.delegationId,
        topic: msg.topic,
        seq,
      });

      this.notifyDelegatedMsgSubscribers({ ...msg, seq });
    } catch (err) {
      this.log.warn('failed to handle delegated message', { error: (err as Error).message });
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
          let encrypted = false;
          const recipientKeyHex = recipientKeys?.[targetDid];
          if (recipientKeyHex) {
            const perRecipient = this.encodePayload(
              new Uint8Array(sharedPayloadBytes),
              { encryptForKeyHex: recipientKeyHex, compress: false },
            );
            payloadBytes = perRecipient.payloadBytes;
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

          const messageId = this.store.addToOutbox({ targetDid, topic, payload: Buffer.from(payloadBytes), ttlSec, priority, compressed, encrypted });
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

        // Notify subscribers about the receipt
        const receiptPayload = Buffer.from(JSON.stringify({
          type: 'delivered',
          messageId: receipt.messageId,
          recipientDid: receipt.recipientDid,
          senderDid: receipt.senderDid,
          deliveredAtMs: Number(receipt.deliveredAtMs),
        }), 'utf-8');

        this.notifySubscribers({
          messageId: receipt.messageId,
          sourceDid: receipt.recipientDid ?? '',
          topic: RECEIPT_TOPIC,
          payload: receiptPayload,
          receivedAtMs: Number(receipt.deliveredAtMs) || Date.now(),
          priority: MessagePriority.NORMAL,
          seq: 0, // Receipts don't have inbox seq
          compressed: false,
          encrypted: false,
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
