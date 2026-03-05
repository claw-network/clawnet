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
import { MessageStore } from './message-store.js';
import { createLogger } from '../logger.js';

// ── Constants ────────────────────────────────────────────────────

const PROTO_DM = '/clawnet/1.0.0/dm';
const PROTO_DID_ANNOUNCE = '/clawnet/1.0.0/did-announce';

/** Maximum payload size in bytes (64 KB). */
const MAX_PAYLOAD_BYTES = 65_536;

/** Cleanup interval for expired messages (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60_000;

/** Max attempts before giving up on an outbox message. */
const MAX_DELIVERY_ATTEMPTS = 50;

// ── Types ────────────────────────────────────────────────────────

export interface SendResult {
  messageId: string;
  delivered: boolean;
}

export interface InboxQueryOptions {
  topic?: string;
  sinceMs?: number;
  limit?: number;
}

export interface InboxMessage {
  messageId: string;
  sourceDid: string;
  topic: string;
  payload: string;
  receivedAtMs: number;
}

type Logger = ReturnType<typeof createLogger>;

// ── Helpers ──────────────────────────────────────────────────────

/** Read all data from a stream source into a single Buffer. */
async function readStream(source: AsyncIterable<{ subarray: () => Uint8Array } | Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) {
    const bytes = chunk instanceof Uint8Array ? chunk : chunk.subarray();
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
   * peers connect. This is a best-effort cache; entries are never evicted
   * but may become stale when peers go offline.
   */
  private readonly didToPeerId = new Map<string, string>();
  private readonly peerIdToDid = new Map<string, string>();

  constructor(p2p: P2PNode, store: MessageStore, localDid: string) {
    this.log = createLogger({ level: 'info' });
    this.p2p = p2p;
    this.store = store;
    this.localDid = localDid;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    // Register stream protocol handlers
    await this.p2p.handleProtocol(PROTO_DM, (incoming) => {
      void this.handleInboundMessage(incoming);
    });
    await this.p2p.handleProtocol(PROTO_DID_ANNOUNCE, (incoming) => {
      void this.handleDidAnnounce(incoming);
    });

    // When a new peer connects, exchange DID announcements
    this.p2p.onPeerDisconnect(() => {
      // No-op for now; outbox delivery is handled via flush on connect.
    });

    // Announce our DID to all currently connected peers
    void this.announceToAll();

    // Periodic cleanup of expired messages
    this.cleanupTimer = setInterval(() => {
      try {
        this.store.cleanupInbox();
        this.store.cleanupOutbox();
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
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Send a message to a target DID.
   * If the target peer is online and reachable, delivers directly.
   * Otherwise queues in outbox for later delivery.
   */
  async send(targetDid: string, topic: string, payload: string, ttlSec = 86400): Promise<SendResult> {
    // Validate payload size
    const payloadBytes = Buffer.byteLength(payload, 'utf-8');
    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      throw new Error(`Payload too large: ${payloadBytes} bytes (max ${MAX_PAYLOAD_BYTES})`);
    }

    const peerId = this.didToPeerId.get(targetDid);
    if (peerId) {
      // Try direct delivery
      const delivered = await this.deliverDirect(peerId, targetDid, topic, payload, ttlSec);
      if (delivered) {
        return { messageId: `msg_direct_${Date.now().toString(36)}`, delivered: true };
      }
    }

    // Queue in outbox for later delivery
    const messageId = this.store.addToOutbox({ targetDid, topic, payload, ttlSec });
    this.log.info('message queued in outbox', { messageId, targetDid, topic });
    return { messageId, delivered: false };
  }

  /** Query the local inbox. */
  getInbox(opts?: InboxQueryOptions): InboxMessage[] {
    return this.store.getInbox(opts);
  }

  /** Acknowledge (consume) a message from inbox. */
  ackMessage(messageId: string): boolean {
    return this.store.consumeMessage(messageId);
  }

  /** Flush outbox: attempt to deliver all pending messages for a specific DID. */
  async flushOutboxForDid(targetDid: string): Promise<number> {
    const peerId = this.didToPeerId.get(targetDid);
    if (!peerId) return 0;

    const entries = this.store.getOutboxForTarget(targetDid);
    let delivered = 0;
    for (const entry of entries) {
      if (entry.attempts > MAX_DELIVERY_ATTEMPTS) {
        this.store.removeFromOutbox(entry.id);
        continue;
      }
      this.store.recordAttempt(entry.id);
      const ok = await this.deliverDirect(peerId, targetDid, entry.topic, entry.payload, entry.ttlSec);
      if (ok) {
        this.store.removeFromOutbox(entry.id);
        delivered++;
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

  // ── Private: Direct Delivery ───────────────────────────────────

  private async deliverDirect(
    peerId: string,
    targetDid: string,
    topic: string,
    payload: string,
    ttlSec: number,
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
      const raw = await readStream(stream.source);
      await stream.close();

      if (raw.length > MAX_PAYLOAD_BYTES * 2) {
        this.log.warn('inbound message too large, discarding');
        return;
      }

      const msg = JSON.parse(raw.toString('utf-8')) as {
        sourceDid?: string;
        targetDid?: string;
        topic?: string;
        payload?: string;
        ttlSec?: number;
        sentAtMs?: number;
      };

      if (!msg.sourceDid || !msg.topic || !msg.payload) {
        this.log.warn('inbound message missing required fields');
        return;
      }

      // Store in inbox
      const messageId = this.store.addToInbox({
        sourceDid: msg.sourceDid,
        targetDid: msg.targetDid ?? this.localDid,
        topic: msg.topic,
        payload: msg.payload,
        ttlSec: msg.ttlSec,
        sentAtMs: msg.sentAtMs,
      });

      // Record DID → PeerId mapping from the sender
      const remotePeerId = connection.remotePeer?.toString();
      if (remotePeerId && msg.sourceDid) {
        this.didToPeerId.set(msg.sourceDid, remotePeerId);
        this.peerIdToDid.set(remotePeerId, msg.sourceDid);
      }

      this.log.info('message received', { messageId, sourceDid: msg.sourceDid, topic: msg.topic });
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
      const raw = await readStream(stream.source);
      await stream.close();

      const msg = JSON.parse(raw.toString('utf-8')) as { did?: string };
      const remotePeerId = connection.remotePeer?.toString();

      if (msg.did && remotePeerId) {
        this.didToPeerId.set(msg.did, remotePeerId);
        this.peerIdToDid.set(remotePeerId, msg.did);
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
}
