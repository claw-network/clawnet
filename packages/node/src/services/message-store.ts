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
  consumed      INTEGER NOT NULL DEFAULT 0
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
  last_attempt  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_outbox_target ON outbox(target_did);
CREATE INDEX IF NOT EXISTS idx_outbox_retry ON outbox(attempts, last_attempt);
`;

// ── Store ────────────────────────────────────────────────────────

export class MessageStore {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_SQL);
  }

  // ── Inbox ──────────────────────────────────────────────────────

  /** Store an inbound message in the inbox. Returns the messageId. */
  addToInbox(msg: {
    sourceDid: string;
    targetDid: string;
    topic: string;
    payload: string;
    ttlSec?: number;
    sentAtMs?: number;
  }): string {
    const id = `msg_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO inbox (id, source_did, target_did, topic, payload, ttl_sec, sent_at_ms, received_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, msg.sourceDid, msg.targetDid, msg.topic, msg.payload, msg.ttlSec ?? 86400, msg.sentAtMs ?? now, now);
    return id;
  }

  /** Fetch unconsumed inbox messages for a given topic. */
  getInbox(opts: {
    topic?: string;
    sinceMs?: number;
    limit?: number;
  } = {}): InboxMessage[] {
    const limit = Math.min(opts.limit ?? 100, 500);
    let sql = 'SELECT id, source_did, topic, payload, received_at_ms FROM inbox WHERE consumed = 0';
    const params: unknown[] = [];

    if (opts.topic) {
      sql += ' AND topic = ?';
      params.push(opts.topic);
    }
    if (opts.sinceMs) {
      sql += ' AND received_at_ms > ?';
      params.push(opts.sinceMs);
    }

    sql += ' ORDER BY received_at_ms ASC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string; source_did: string; topic: string; payload: string; received_at_ms: number;
    }>;

    return rows.map((r) => ({
      messageId: r.id,
      sourceDid: r.source_did,
      topic: r.topic,
      payload: r.payload,
      receivedAtMs: r.received_at_ms,
    }));
  }

  /** Mark a message as consumed (acknowledged). */
  consumeMessage(messageId: string): boolean {
    const result = this.db.prepare(
      'UPDATE inbox SET consumed = 1 WHERE id = ? AND consumed = 0',
    ).run(messageId);
    return result.changes > 0;
  }

  /** Delete consumed and expired messages in batches to avoid locking. */
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
    return total;
  }

  // ── Outbox ─────────────────────────────────────────────────────

  /** Queue a message for later delivery to an offline peer. */
  addToOutbox(msg: {
    targetDid: string;
    topic: string;
    payload: string;
    ttlSec?: number;
  }): string {
    const id = `msg_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO outbox (id, target_did, topic, payload, ttl_sec, sent_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, msg.targetDid, msg.topic, msg.payload, msg.ttlSec ?? 86400, now);
    return id;
  }

  /** Get pending outbox messages for a specific target DID. */
  getOutboxForTarget(targetDid: string, limit = 100): OutboxEntry[] {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT id, target_did, topic, payload, ttl_sec, sent_at_ms, attempts, last_attempt
      FROM outbox
      WHERE target_did = ? AND (sent_at_ms + ttl_sec * 1000) > ?
      ORDER BY sent_at_ms ASC LIMIT ?
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
}
