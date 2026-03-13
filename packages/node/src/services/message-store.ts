/**
 * MessageStore — SQLite-backed inbox/outbox for P2P direct messaging.
 *
 * Inbox: messages received from other peers, waiting to be consumed by the local app.
 * Outbox: messages pending delivery to offline peers, retried when the peer connects.
 */

import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type { DelegationRecord } from '@claw-network/protocol/messaging';

// ── Types ────────────────────────────────────────────────────────

export interface StoredMessage {
  id: string;
  sourceDid: string;
  targetDid: string;
  topic: string;
  payload: Buffer;
  ttlSec: number;
  sentAtMs: number;
  receivedAtMs: number;
  status: 'pending' | 'delivered' | 'consumed' | 'expired';
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

export interface OutboxEntry {
  id: string;
  targetDid: string;
  topic: string;
  payload: Buffer;
  ttlSec: number;
  sentAtMs: number;
  attempts: number;
  lastAttempt: number;
  compressed: boolean;
  encrypted: boolean;
}

// ── Schema ───────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inbox (
  id            TEXT PRIMARY KEY,
  source_did    TEXT NOT NULL,
  target_did    TEXT NOT NULL,
  topic         TEXT NOT NULL,
  payload       BLOB NOT NULL,
  ttl_sec       INTEGER NOT NULL DEFAULT 86400,
  sent_at_ms    INTEGER NOT NULL,
  received_at_ms INTEGER NOT NULL,
  consumed      INTEGER NOT NULL DEFAULT 0,
  priority      INTEGER NOT NULL DEFAULT 0,
  seq           INTEGER NOT NULL DEFAULT 0,
  compressed    INTEGER NOT NULL DEFAULT 0,
  encrypted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_inbox_topic ON inbox(topic, consumed);
CREATE INDEX IF NOT EXISTS idx_inbox_received ON inbox(received_at_ms);
CREATE INDEX IF NOT EXISTS idx_inbox_source ON inbox(source_did, consumed);
CREATE INDEX IF NOT EXISTS idx_inbox_unconsumed ON inbox(consumed, received_at_ms) WHERE consumed = 0;

CREATE TABLE IF NOT EXISTS outbox (
  id            TEXT PRIMARY KEY,
  target_did    TEXT NOT NULL,
  topic         TEXT NOT NULL,
  payload       BLOB NOT NULL,
  ttl_sec       INTEGER NOT NULL DEFAULT 86400,
  sent_at_ms    INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_attempt  INTEGER,
  priority      INTEGER NOT NULL DEFAULT 0,
  compressed    INTEGER NOT NULL DEFAULT 0,
  encrypted     INTEGER NOT NULL DEFAULT 0
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

-- ── Subscription Delegations (Target side) ───────────────────────
CREATE TABLE IF NOT EXISTS delegations (
  delegation_id  TEXT PRIMARY KEY,
  delegate_did   TEXT NOT NULL,
  topics         TEXT NOT NULL,
  metadata_only  INTEGER NOT NULL DEFAULT 1,
  expires_at_ms  INTEGER NOT NULL,
  created_at_ms  INTEGER NOT NULL,
  revoked        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_delegations_delegate ON delegations(delegate_did, revoked);
CREATE INDEX IF NOT EXISTS idx_delegations_expires ON delegations(expires_at_ms);

-- ── Delegated Inbox (Gateway side) ──────────────────────────────
CREATE TABLE IF NOT EXISTS delegated_inbox (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id       TEXT NOT NULL,
  source_did          TEXT NOT NULL,
  original_target_did TEXT NOT NULL,
  topic               TEXT NOT NULL,
  message_id          TEXT,
  payload_size        INTEGER,
  received_at_ms      INTEGER NOT NULL,
  seq                 INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delegated_inbox_dedup ON delegated_inbox(delegation_id, message_id);
CREATE INDEX IF NOT EXISTS idx_delegated_inbox_seq ON delegated_inbox(delegation_id, seq);

INSERT OR IGNORE INTO meta (key, value) VALUES ('delegated_inbox_seq', '0');
`;

/** Deduplication window: 24 hours */
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

// ── Delegation Row Helpers ───────────────────────────────────────

interface DelegationRow {
  delegation_id: string;
  delegate_did: string;
  topics: string;
  metadata_only: number;
  expires_at_ms: number;
  created_at_ms: number;
  revoked: number;
}

function toDelegationRecord(row: DelegationRow): DelegationRecord {
  return {
    delegationId: row.delegation_id,
    delegateDid: row.delegate_did,
    topics: JSON.parse(row.topics) as string[],
    metadataOnly: row.metadata_only === 1,
    expiresAtMs: row.expires_at_ms,
    createdAtMs: row.created_at_ms,
    revoked: row.revoked === 1,
  };
}

// ── Store ────────────────────────────────────────────────────────

export class MessageStore {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_SQL);
    this.migrateSchema();
  }

  /** Add columns that may be missing from older database files. */
  private migrateSchema(): void {
    const addColumnIfMissing = (table: string, column: string, colDef: string) => {
      const cols = this.db.pragma(`table_info(${table})`) as { name: string }[];
      if (!cols.some((c) => c.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${colDef}`);
      }
    };
    addColumnIfMissing('inbox', 'compressed', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('inbox', 'encrypted', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('outbox', 'compressed', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing('outbox', 'encrypted', 'INTEGER NOT NULL DEFAULT 0');
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
    payload: Buffer;
    ttlSec?: number;
    sentAtMs?: number;
    priority?: number;
    idempotencyKey?: string;
    compressed?: boolean;
    encrypted?: boolean;
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
      INSERT INTO inbox (id, source_did, target_did, topic, payload, ttl_sec, sent_at_ms, received_at_ms, priority, seq, compressed, encrypted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, msg.sourceDid, msg.targetDid, msg.topic, msg.payload, msg.ttlSec ?? 86400, msg.sentAtMs ?? now, now, msg.priority ?? 0, seq, msg.compressed ? 1 : 0, msg.encrypted ? 1 : 0);

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
    let sql = 'SELECT id, source_did, topic, payload, received_at_ms, priority, seq, compressed, encrypted FROM inbox WHERE consumed = 0';
    const params: unknown[] = [];

    if (opts.topic) {
      const topicClauses = this.buildTopicFilter(opts.topic, params);
      if (topicClauses) {
        sql += ` AND (${topicClauses})`;
      }
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
      id: string; source_did: string; topic: string; payload: Buffer;
      received_at_ms: number; priority: number; seq: number;
      compressed: number; encrypted: number;
    }>;

    return rows.map((r) => ({
      messageId: r.id,
      sourceDid: r.source_did,
      topic: r.topic,
      payload: Buffer.isBuffer(r.payload) ? r.payload : Buffer.from(r.payload),
      receivedAtMs: r.received_at_ms,
      priority: r.priority,
      seq: r.seq,
      compressed: r.compressed === 1,
      encrypted: r.encrypted === 1,
    }));
  }

  /**
   * Build a SQL WHERE clause for topic filtering.
   * Supports wildcards (`telagent/*`) and comma-separated lists (`a,b,c`).
   */
  private buildTopicFilter(filter: string, params: unknown[]): string | null {
    const parts = filter.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    const clauses: string[] = [];
    for (const part of parts) {
      if (part.endsWith('*')) {
        // Prefix match: telagent/* → topic LIKE 'telagent/%'
        const prefix = part.slice(0, -1);
        clauses.push("topic LIKE ? ESCAPE '\\'");
        // Escape SQL LIKE wildcards in the prefix, then append %
        params.push(prefix.replace(/[%_\\]/g, '\\$&') + '%');
      } else {
        clauses.push('topic = ?');
        params.push(part);
      }
    }
    return clauses.join(' OR ');
  }

  /** Fetch a single inbox message by ID (for payload download). */
  getInboxMessage(messageId: string): InboxMessage | null {
    const r = this.db.prepare(
      'SELECT id, source_did, topic, payload, received_at_ms, priority, seq, compressed, encrypted FROM inbox WHERE id = ? AND consumed = 0',
    ).get(messageId) as {
      id: string; source_did: string; topic: string; payload: Buffer;
      received_at_ms: number; priority: number; seq: number;
      compressed: number; encrypted: number;
    } | undefined;
    if (!r) return null;
    return {
      messageId: r.id,
      sourceDid: r.source_did,
      topic: r.topic,
      payload: Buffer.isBuffer(r.payload) ? r.payload : Buffer.from(r.payload),
      receivedAtMs: r.received_at_ms,
      priority: r.priority,
      seq: r.seq,
      compressed: r.compressed === 1,
      encrypted: r.encrypted === 1,
    };
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
    payload: Buffer;
    ttlSec?: number;
    priority?: number;
    compressed?: boolean;
    encrypted?: boolean;
  }): string {
    const id = `msg_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO outbox (id, target_did, topic, payload, ttl_sec, sent_at_ms, priority, compressed, encrypted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, msg.targetDid, msg.topic, msg.payload, msg.ttlSec ?? 86400, now, msg.priority ?? 0, msg.compressed ? 1 : 0, msg.encrypted ? 1 : 0);
    return id;
  }

  /** Get pending outbox messages for a specific target DID, ordered by priority then time. */
  getOutboxForTarget(targetDid: string, limit = 100): OutboxEntry[] {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT id, target_did, topic, payload, ttl_sec, sent_at_ms, attempts, last_attempt, compressed, encrypted
      FROM outbox
      WHERE target_did = ? AND (sent_at_ms + ttl_sec * 1000) > ?
      ORDER BY priority DESC, sent_at_ms ASC LIMIT ?
    `).all(targetDid, now, limit) as Array<{
      id: string; target_did: string; topic: string; payload: Buffer;
      ttl_sec: number; sent_at_ms: number; attempts: number; last_attempt: number | null;
      compressed: number; encrypted: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      targetDid: r.target_did,
      topic: r.topic,
      payload: Buffer.isBuffer(r.payload) ? r.payload : Buffer.from(r.payload),
      ttlSec: r.ttl_sec,
      sentAtMs: r.sent_at_ms,
      attempts: r.attempts,
      lastAttempt: r.last_attempt ?? 0,
      compressed: r.compressed === 1,
      encrypted: r.encrypted === 1,
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

  // ── Delegated Inbox Seq ────────────────────────────────────────

  private nextDelegatedSeq(): number {
    this.db
      .prepare(
        "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'delegated_inbox_seq'",
      )
      .run();
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'delegated_inbox_seq'")
      .get() as { value: string };
    return parseInt(row.value, 10);
  }

  currentDelegatedSeq(): number {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'delegated_inbox_seq'")
      .get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  }

  // ── Delegation Management (Target side) ────────────────────────

  createDelegation(opts: {
    delegateDid: string;
    topics: string[];
    metadataOnly: boolean;
    expiresAtMs: number;
  }): DelegationRecord {
    const delegationId = `dlg_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO delegations (delegation_id, delegate_did, topics, metadata_only, expires_at_ms, created_at_ms, revoked)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        delegationId,
        opts.delegateDid,
        JSON.stringify(opts.topics),
        opts.metadataOnly ? 1 : 0,
        opts.expiresAtMs,
        now,
      );
    return {
      delegationId,
      delegateDid: opts.delegateDid,
      topics: opts.topics,
      metadataOnly: opts.metadataOnly,
      expiresAtMs: opts.expiresAtMs,
      createdAtMs: now,
      revoked: false,
    };
  }

  revokeDelegation(delegationId: string): boolean {
    const result = this.db
      .prepare('UPDATE delegations SET revoked = 1 WHERE delegation_id = ? AND revoked = 0')
      .run(delegationId);
    return result.changes > 0;
  }

  getDelegation(delegationId: string): DelegationRecord | null {
    const row = this.db
      .prepare('SELECT * FROM delegations WHERE delegation_id = ?')
      .get(delegationId) as DelegationRow | undefined;
    return row ? toDelegationRecord(row) : null;
  }

  listDelegations(opts?: { activeOnly?: boolean }): DelegationRecord[] {
    let sql = 'SELECT * FROM delegations';
    const params: unknown[] = [];
    if (opts?.activeOnly) {
      sql += ' WHERE revoked = 0 AND expires_at_ms > ?';
      params.push(Date.now());
    }
    sql += ' ORDER BY created_at_ms DESC';
    const rows = this.db.prepare(sql).all(...params) as DelegationRow[];
    return rows.map(toDelegationRecord);
  }

  getActiveDelegationsForTopic(topic: string): DelegationRecord[] {
    const now = Date.now();
    const rows = this.db
      .prepare(
        'SELECT * FROM delegations WHERE revoked = 0 AND expires_at_ms > ?',
      )
      .all(now) as DelegationRow[];

    return rows
      .map(toDelegationRecord)
      .filter((d) => d.topics.includes(topic));
  }

  activeDelegationCount(): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) as cnt FROM delegations WHERE revoked = 0 AND expires_at_ms > ?',
      )
      .get(Date.now()) as { cnt: number };
    return row.cnt;
  }

  cleanupExpiredDelegations(): number {
    const result = this.db
      .prepare('DELETE FROM delegations WHERE expires_at_ms <= ?')
      .run(Date.now());
    return result.changes;
  }

  // ── Delegated Inbox (Gateway side) ─────────────────────────────

  addToDelegatedInbox(msg: {
    delegationId: string;
    sourceDid: string;
    originalTargetDid: string;
    topic: string;
    messageId?: string;
    payloadSize?: number;
  }): number | null {
    const seq = this.nextDelegatedSeq();
    try {
      this.db
        .prepare(
          `INSERT INTO delegated_inbox
             (delegation_id, source_did, original_target_did, topic, message_id, payload_size, received_at_ms, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          msg.delegationId,
          msg.sourceDid,
          msg.originalTargetDid,
          msg.topic,
          msg.messageId ?? null,
          msg.payloadSize ?? null,
          Date.now(),
          seq,
        );
      return seq;
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return null;
      }
      throw err;
    }
  }

  getDelegatedInbox(opts: {
    delegationId: string;
    sinceSeq?: number;
    limit?: number;
  }): Array<{
    delegationId: string;
    sourceDid: string;
    originalTargetDid: string;
    topic: string;
    messageId: string | null;
    payloadSize: number | null;
    receivedAtMs: number;
    seq: number;
  }> {
    let sql = 'SELECT * FROM delegated_inbox WHERE delegation_id = ?';
    const params: unknown[] = [opts.delegationId];
    if (opts.sinceSeq !== undefined) {
      sql += ' AND seq > ?';
      params.push(opts.sinceSeq);
    }
    sql += ' ORDER BY seq ASC LIMIT ?';
    params.push(opts.limit ?? 500);
    const rows = this.db.prepare(sql).all(...params) as Array<{
      delegation_id: string;
      source_did: string;
      original_target_did: string;
      topic: string;
      message_id: string | null;
      payload_size: number | null;
      received_at_ms: number;
      seq: number;
    }>;
    return rows.map((r) => ({
      delegationId: r.delegation_id,
      sourceDid: r.source_did,
      originalTargetDid: r.original_target_did,
      topic: r.topic,
      messageId: r.message_id,
      payloadSize: r.payload_size,
      receivedAtMs: r.received_at_ms,
      seq: r.seq,
    }));
  }

  cleanupDelegatedInbox(maxAgeMs: number = 86_400_000): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db
      .prepare('DELETE FROM delegated_inbox WHERE received_at_ms < ?')
      .run(cutoff);
    return result.changes;
  }
}
