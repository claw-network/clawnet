/**
 * MessageStore — SQLite-backed inbox/outbox for P2P direct messaging.
 *
 * Inbox: messages received from other peers, waiting to be consumed by the local app.
 * Outbox: messages pending delivery to offline peers, retried when the peer connects.
 */

import Database from 'better-sqlite3';
import crypto from 'node:crypto';

// ── Types ────────────────────────────────────────────────────────

export interface StoredMessage {
  id: string;
  sourceDid: string;
  targetDid: string;
  topic: string;
  payload: string;        // base64-encoded
  ttlSec: number;
  sentAtMs: number;
  receivedAtMs: number;
  status: 'pending' | 'delivered' | 'consumed' | 'expired';
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

export interface OutboxEntry {
  id: string;
  targetDid: string;
  topic: string;
  payload: string;
  ttlSec: number;
  sentAtMs: number;
  attempts: number;
  lastAttempt: number;
}

// ── Schema ───────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inbox (
  id            TEXT PRIMARY KEY,
  source_did    TEXT NOT NULL,
  target_did    TEXT NOT NULL,
  topic         TEXT NOT NULL,
  payload       TEXT NOT NULL,
  ttl_sec       INTEGER NOT NULL DEFAULT 86400,
  sent_at_ms    INTEGER NOT NULL,
  received_at_ms INTEGER NOT NULL,
  consumed      INTEGER NOT NULL DEFAULT 0,
  priority      INTEGER NOT NULL DEFAULT 0,
  seq           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_inbox_topic ON inbox(topic, consumed);
CREATE INDEX IF NOT EXISTS idx_inbox_received ON inbox(received_at_ms);
CREATE INDEX IF NOT EXISTS idx_inbox_source ON inbox(source_did, consumed);
CREATE INDEX IF NOT EXISTS idx_inbox_unconsumed ON inbox(consumed, received_at_ms) WHERE consumed = 0;

CREATE TABLE IF NOT EXISTS outbox (
  id            TEXT PRIMARY KEY,
  target_did    TEXT NOT NULL,
  topic         TEXT NOT NULL,
  payload       TEXT NOT NULL,
  ttl_sec       INTEGER NOT NULL DEFAULT 86400,
  sent_at_ms    INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_attempt  INTEGER,
  priority      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_outbox_target ON outbox(target_did);
CREATE INDEX IF NOT EXISTS idx_outbox_retry ON outbox(attempts, last_attempt);

-- Deduplication table: stores idempotency keys with TTL for duplicate detection
CREATE TABLE IF NOT EXISTS dedup (
  idempotency_key TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL,
  created_at_ms   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dedup_created ON dedup(created_at_ms);

-- Sequence counter for ordered inbox replay
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO meta (key, value) VALUES ('inbox_seq', '0');

-- DID → PeerId mapping persistence (survives restarts)
CREATE TABLE IF NOT EXISTS did_peers (
  did           TEXT PRIMARY KEY,
  peer_id       TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_did_peers_peer ON did_peers(peer_id);

-- Rate limiting: sliding-window event log (shared across processes via SQLite)
CREATE TABLE IF NOT EXISTS rate_limits (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  ts_ms  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_bucket_ts ON rate_limits(bucket, ts_ms);

-- Attachment metadata: tracks received attachments stored on local disk
CREATE TABLE IF NOT EXISTS attachments (
  attachment_id   TEXT PRIMARY KEY,
  source_did      TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  file_name       TEXT NOT NULL DEFAULT '',
  stored_file     TEXT NOT NULL,
  total_size      INTEGER NOT NULL,
  received_at_ms  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_received ON attachments(received_at_ms);
CREATE INDEX IF NOT EXISTS idx_attachments_source ON attachments(source_did);
`;

/** Deduplication window: 24 hours */
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

// ── Store ────────────────────────────────────────────────────────

export class MessageStore {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_SQL);
  }

  // ── Inbox ──────────────────────────────────────────────────────

  /**
   * Store an inbound message in the inbox. Returns the messageId.
   * If `idempotencyKey` is provided, deduplicates — returns existing messageId on duplicate.
   */
  addToInbox(msg: {
    sourceDid: string;
    targetDid: string;
    topic: string;
    payload: string;
    ttlSec?: number;
    sentAtMs?: number;
    priority?: number;
    idempotencyKey?: string;
  }): string {
    // Deduplication check
    if (msg.idempotencyKey) {
      const existing = this.db.prepare(
        'SELECT message_id FROM dedup WHERE idempotency_key = ?',
      ).get(msg.idempotencyKey) as { message_id: string } | undefined;
      if (existing) return existing.message_id;
    }

    const id = `msg_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    const seq = this.nextSeq();
    this.db.prepare(`
      INSERT INTO inbox (id, source_did, target_did, topic, payload, ttl_sec, sent_at_ms, received_at_ms, priority, seq)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, msg.sourceDid, msg.targetDid, msg.topic, msg.payload, msg.ttlSec ?? 86400, msg.sentAtMs ?? now, now, msg.priority ?? 0, seq);

    // Record dedup key
    if (msg.idempotencyKey) {
      this.db.prepare(
        'INSERT OR IGNORE INTO dedup (idempotency_key, message_id, created_at_ms) VALUES (?, ?, ?)',
      ).run(msg.idempotencyKey, id, now);
    }
    return id;
  }

  /** Increment and return the next inbox sequence number (monotonic). */
  private nextSeq(): number {
    this.db.prepare("UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'inbox_seq'").run();
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'inbox_seq'").get() as { value: string };
    return parseInt(row.value, 10);
  }

  /** Get the current (latest) inbox sequence number. */
  currentSeq(): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'inbox_seq'").get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  }

  /** Fetch unconsumed inbox messages, ordered by priority then time. */
  getInbox(opts: {
    topic?: string;
    sinceMs?: number;
    sinceSeq?: number;
    limit?: number;
  } = {}): InboxMessage[] {
    const limit = Math.min(opts.limit ?? 100, 500);
    let sql = 'SELECT id, source_did, topic, payload, received_at_ms, priority, seq FROM inbox WHERE consumed = 0';
    const params: unknown[] = [];

    if (opts.topic) {
      sql += ' AND topic = ?';
      params.push(opts.topic);
    }
    if (opts.sinceMs) {
      sql += ' AND received_at_ms > ?';
      params.push(opts.sinceMs);
    }
    if (opts.sinceSeq !== undefined) {
      sql += ' AND seq > ?';
      params.push(opts.sinceSeq);
    }

    // Higher priority first, then by received time
    sql += ' ORDER BY priority DESC, received_at_ms ASC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string; source_did: string; topic: string; payload: string;
      received_at_ms: number; priority: number; seq: number;
    }>;

    return rows.map((r) => ({
      messageId: r.id,
      sourceDid: r.source_did,
      topic: r.topic,
      payload: r.payload,
      receivedAtMs: r.received_at_ms,
      priority: r.priority,
      seq: r.seq,
    }));
  }

  /** Mark a message as consumed (acknowledged). */
  consumeMessage(messageId: string): boolean {
    const result = this.db.prepare(
      'UPDATE inbox SET consumed = 1 WHERE id = ? AND consumed = 0',
    ).run(messageId);
    return result.changes > 0;
  }

  /** Delete consumed and expired messages in batches to avoid locking. Also cleans dedup table. */
  cleanupInbox(): number {
    const now = Date.now();
    let total = 0;
    // Delete in batches of 500 to avoid long table locks
    const stmt = this.db.prepare(
      'DELETE FROM inbox WHERE id IN (SELECT id FROM inbox WHERE consumed = 1 OR (sent_at_ms + ttl_sec * 1000) <= ? LIMIT 500)',
    );
    let changes: number;
    do {
      changes = stmt.run(now).changes;
      total += changes;
    } while (changes > 0);

    // Clean expired dedup entries
    const dedupCutoff = now - DEDUP_TTL_MS;
    this.db.prepare('DELETE FROM dedup WHERE created_at_ms < ?').run(dedupCutoff);

    return total;
  }

  // ── Outbox ─────────────────────────────────────────────────────

  /** Queue a message for later delivery to an offline peer. */
  addToOutbox(msg: {
    targetDid: string;
    topic: string;
    payload: string;
    ttlSec?: number;
    priority?: number;
  }): string {
    const id = `msg_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO outbox (id, target_did, topic, payload, ttl_sec, sent_at_ms, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, msg.targetDid, msg.topic, msg.payload, msg.ttlSec ?? 86400, now, msg.priority ?? 0);
    return id;
  }

  /** Get pending outbox messages for a specific target DID, ordered by priority then time. */
  getOutboxForTarget(targetDid: string, limit = 100): OutboxEntry[] {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT id, target_did, topic, payload, ttl_sec, sent_at_ms, attempts, last_attempt
      FROM outbox
      WHERE target_did = ? AND (sent_at_ms + ttl_sec * 1000) > ?
      ORDER BY priority DESC, sent_at_ms ASC LIMIT ?
    `).all(targetDid, now, limit) as Array<{
      id: string; target_did: string; topic: string; payload: string;
      ttl_sec: number; sent_at_ms: number; attempts: number; last_attempt: number | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      targetDid: r.target_did,
      topic: r.topic,
      payload: r.payload,
      ttlSec: r.ttl_sec,
      sentAtMs: r.sent_at_ms,
      attempts: r.attempts,
      lastAttempt: r.last_attempt ?? 0,
    }));
  }

  /** Increment attempt count for an outbox message. */
  recordAttempt(messageId: string): void {
    this.db.prepare(
      'UPDATE outbox SET attempts = attempts + 1, last_attempt = ? WHERE id = ?',
    ).run(Date.now(), messageId);
  }

  /** Remove a message from the outbox (successfully delivered). */
  removeFromOutbox(messageId: string): boolean {
    const result = this.db.prepare('DELETE FROM outbox WHERE id = ?').run(messageId);
    return result.changes > 0;
  }

  /** Clean up expired outbox entries in batches. */
  cleanupOutbox(): number {
    const now = Date.now();
    let total = 0;
    const stmt = this.db.prepare(
      'DELETE FROM outbox WHERE id IN (SELECT id FROM outbox WHERE (sent_at_ms + ttl_sec * 1000) <= ? LIMIT 500)',
    );
    let changes: number;
    do {
      changes = stmt.run(now).changes;
      total += changes;
    } while (changes > 0);
    return total;
  }

  /** Total count of inbox messages (for rate limiting / stats). */
  inboxCount(targetDid: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM inbox WHERE target_did = ? AND consumed = 0',
    ).get(targetDid) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  close(): void {
    this.db.close();
  }

  // ── DID → PeerId Mapping ───────────────────────────────────

  /** Persist or update a DID → PeerId mapping. */
  upsertDidPeer(did: string, peerId: string): void {
    this.db.prepare(
      'INSERT INTO did_peers (did, peer_id, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(did) DO UPDATE SET peer_id = excluded.peer_id, updated_at_ms = excluded.updated_at_ms',
    ).run(did, peerId, Date.now());
  }

  /** Load all persisted DID → PeerId mappings (including update timestamps for TTL). */
  getAllDidPeers(): Array<{ did: string; peerId: string; updatedAtMs: number }> {
    const rows = this.db.prepare('SELECT did, peer_id, updated_at_ms FROM did_peers').all() as Array<{ did: string; peer_id: string; updated_at_ms: number }>;
    return rows.map((r) => ({ did: r.did, peerId: r.peer_id, updatedAtMs: r.updated_at_ms }));
  }

  /** Remove a DID mapping (e.g. when a peer is permanently gone). */
  removeDidPeer(did: string): boolean {
    return this.db.prepare('DELETE FROM did_peers WHERE did = ?').run(did).changes > 0;
  }

  // ── Rate Limiting ──────────────────────────────────────────

  /** Record a rate-limit event for the given bucket. */
  recordRateEvent(bucket: string): void {
    this.db.prepare('INSERT INTO rate_limits (bucket, ts_ms) VALUES (?, ?)').run(bucket, Date.now());
  }

  /** Count rate-limit events for a bucket within the sliding window. */
  countRateEvents(bucket: string, windowStartMs: number): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM rate_limits WHERE bucket = ? AND ts_ms > ?',
    ).get(bucket, windowStartMs) as { cnt: number };
    return row.cnt;
  }

  /** Delete rate-limit events older than the given timestamp. */
  pruneRateEvents(beforeMs: number): number {
    return this.db.prepare('DELETE FROM rate_limits WHERE ts_ms <= ?').run(beforeMs).changes;
  }

  // ── Attachment Metadata ────────────────────────────────────

  /** Store attachment metadata after receiving a file via P2P. */
  saveAttachmentMeta(info: {
    attachmentId: string;
    sourceDid: string;
    contentType: string;
    fileName: string;
    totalSize: number;
    receivedAtMs: number;
  }, storedFileName: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO attachments (attachment_id, source_did, content_type, file_name, stored_file, total_size, received_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(info.attachmentId, info.sourceDid, info.contentType, info.fileName, storedFileName, info.totalSize, info.receivedAtMs);
  }

  /** Get attachment metadata by ID. Returns null if not found. */
  getAttachmentMeta(attachmentId: string): {
    attachmentId: string;
    sourceDid: string;
    contentType: string;
    fileName: string;
    storedFileName: string;
    totalSize: number;
    receivedAtMs: number;
  } | null {
    const row = this.db.prepare(
      'SELECT attachment_id, source_did, content_type, file_name, stored_file, total_size, received_at_ms FROM attachments WHERE attachment_id = ?',
    ).get(attachmentId) as {
      attachment_id: string; source_did: string; content_type: string;
      file_name: string; stored_file: string; total_size: number; received_at_ms: number;
    } | undefined;
    if (!row) return null;
    return {
      attachmentId: row.attachment_id,
      sourceDid: row.source_did,
      contentType: row.content_type,
      fileName: row.file_name,
      storedFileName: row.stored_file,
      totalSize: row.total_size,
      receivedAtMs: row.received_at_ms,
    };
  }

  /** List attachment metadata, ordered by received time descending. */
  listAttachments(opts?: { limit?: number; since?: number }): Array<{
    attachmentId: string;
    sourceDid: string;
    contentType: string;
    fileName: string;
    totalSize: number;
    receivedAtMs: number;
  }> {
    const limit = Math.min(opts?.limit ?? 100, 500);
    let sql = 'SELECT attachment_id, source_did, content_type, file_name, total_size, received_at_ms FROM attachments';
    const params: unknown[] = [];
    if (opts?.since) {
      sql += ' WHERE received_at_ms > ?';
      params.push(opts.since);
    }
    sql += ' ORDER BY received_at_ms DESC LIMIT ?';
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as Array<{
      attachment_id: string; source_did: string; content_type: string;
      file_name: string; total_size: number; received_at_ms: number;
    }>;
    return rows.map((r) => ({
      attachmentId: r.attachment_id,
      sourceDid: r.source_did,
      contentType: r.content_type,
      fileName: r.file_name,
      totalSize: r.total_size,
      receivedAtMs: r.received_at_ms,
    }));
  }

  /** Delete attachment metadata. Returns true if a row was deleted. */
  deleteAttachment(attachmentId: string): boolean {
    return this.db.prepare('DELETE FROM attachments WHERE attachment_id = ?').run(attachmentId).changes > 0;
  }
}
