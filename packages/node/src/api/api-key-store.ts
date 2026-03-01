/**
 * API Key Store — SQLite-backed multi-key management.
 *
 * Each key has:
 *  - id: auto-increment primary key
 *  - key: 64-char hex token (crypto-random)
 *  - label: human-readable tag (e.g. "alice-agent", "bot-prod")
 *  - status: 'active' | 'revoked'
 *  - createdAt: ISO-8601 timestamp
 *  - revokedAt: ISO-8601 timestamp (nullable)
 *  - lastUsedAt: ISO-8601 timestamp (nullable)
 *
 * Uses the same `better-sqlite3` that IndexerStore already depends on.
 */

import Database from 'better-sqlite3';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Key hashing — SHA-256 is sufficient because API keys are 256-bit random.
// ---------------------------------------------------------------------------

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiKeyRecord {
  id: number;
  key: string;
  label: string;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** Public-facing record (omits the full key, shows only prefix). */
export interface ApiKeySummary {
  id: number;
  keyPrefix: string;
  label: string;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS api_keys (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL UNIQUE,
  key_prefix  TEXT    NOT NULL DEFAULT '',
  label       TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'active',
  created_at  TEXT    NOT NULL,
  revoked_at  TEXT,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_key    ON api_keys(key);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);
`;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class ApiKeyStore {
  private readonly db: Database.Database;

  // Prepared statements (lazy-init)
  private stmtInsert!: Database.Statement;
  private stmtLookup!: Database.Statement;
  private stmtListAll!: Database.Statement;
  private stmtListActive!: Database.Statement;
  private stmtRevoke!: Database.Statement;
  private stmtTouch!: Database.Statement;
  private stmtGetById!: Database.Statement;
  private stmtDelete!: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_SQL);
    this.migrateHashKeys();
    this.prepareStatements();
  }

  /**
   * One-time migration: if the `key_prefix` column was just added to an
   * existing database, hash any plaintext keys that are still stored.
   * Plaintext keys are 64-char hex; hashed keys are also 64-char hex but
   * we detect the old schema by checking whether `key_prefix` is empty.
   */
  private migrateHashKeys(): void {
    const rows = this.db
      .prepare("SELECT id, key FROM api_keys WHERE key_prefix = ''")
      .all() as Array<{ id: number; key: string }>;
    if (rows.length === 0) return;

    const update = this.db.prepare(
      'UPDATE api_keys SET key = ?, key_prefix = ? WHERE id = ?',
    );
    const migrate = this.db.transaction(() => {
      for (const row of rows) {
        update.run(hashKey(row.key), row.key.slice(0, 8) + '…', row.id);
      }
    });
    migrate();
  }

  private prepareStatements(): void {
    this.stmtInsert = this.db.prepare(
      `INSERT INTO api_keys (key, key_prefix, label, status, created_at) VALUES (?, ?, ?, 'active', ?)`,
    );
    this.stmtLookup = this.db.prepare(
      `SELECT id, key, key_prefix AS keyPrefix, label, status, created_at AS createdAt, revoked_at AS revokedAt, last_used_at AS lastUsedAt
       FROM api_keys WHERE key = ?`,
    );
    this.stmtListAll = this.db.prepare(
      `SELECT id, key, key_prefix AS keyPrefix, label, status, created_at AS createdAt, revoked_at AS revokedAt, last_used_at AS lastUsedAt
       FROM api_keys ORDER BY id`,
    );
    this.stmtListActive = this.db.prepare(
      `SELECT id, key, key_prefix AS keyPrefix, label, status, created_at AS createdAt, revoked_at AS revokedAt, last_used_at AS lastUsedAt
       FROM api_keys WHERE status = 'active' ORDER BY id`,
    );
    this.stmtRevoke = this.db.prepare(
      `UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE id = ? AND status = 'active'`,
    );
    this.stmtTouch = this.db.prepare(
      `UPDATE api_keys SET last_used_at = ? WHERE id = ?`,
    );
    this.stmtGetById = this.db.prepare(
      `SELECT id, key, key_prefix AS keyPrefix, label, status, created_at AS createdAt, revoked_at AS revokedAt, last_used_at AS lastUsedAt
       FROM api_keys WHERE id = ?`,
    );
    this.stmtDelete = this.db.prepare(`DELETE FROM api_keys WHERE id = ?`);
  }

  /** Generate a new API key. Returns the full plaintext key (only shown once). */
  create(label: string): ApiKeyRecord {
    const rawKey = crypto.randomBytes(32).toString('hex'); // 64-char hex
    const keyHash = hashKey(rawKey);
    const prefix = rawKey.slice(0, 8) + '…';
    const now = new Date().toISOString();
    this.stmtInsert.run(keyHash, prefix, label, now);
    // Return the record with the PLAINTEXT key — this is the only time it's visible
    const row = this.stmtLookup.get(keyHash) as ApiKeyRecord;
    return { ...row, key: rawKey };
  }

  /** Validate an API key. Returns the record if active, null otherwise. */
  validate(key: string): ApiKeyRecord | null {
    const keyHash = hashKey(key);
    const record = this.stmtLookup.get(keyHash) as ApiKeyRecord | undefined;
    if (!record || record.status !== 'active') return null;
    // Touch last_used_at asynchronously (non-blocking for perf)
    this.stmtTouch.run(new Date().toISOString(), record.id);
    return record;
  }

  /** List all keys (with truncated key values for safety). */
  list(includeRevoked = false): ApiKeySummary[] {
    const rows = includeRevoked
      ? (this.stmtListAll.all() as DbKeyRow[])
      : (this.stmtListActive.all() as DbKeyRow[]);
    return rows.map(toSummary);
  }

  /** Get a key by ID (returns null if not found). */
  getById(id: number): ApiKeyRecord | null {
    return (this.stmtGetById.get(id) as ApiKeyRecord) ?? null;
  }

  /** Revoke a key. Returns true if revoked, false if already revoked or not found. */
  revoke(id: number): boolean {
    const now = new Date().toISOString();
    const result = this.stmtRevoke.run(now, id);
    return result.changes > 0;
  }

  /** Permanently delete a key. */
  delete(id: number): boolean {
    const result = this.stmtDelete.run(id);
    return result.changes > 0;
  }

  /** Total active key count. */
  activeCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS cnt FROM api_keys WHERE status = ?').get('active') as { cnt: number };
    return row.cnt;
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** DB rows include a `keyPrefix` alias from the `key_prefix` column. */
interface DbKeyRow extends ApiKeyRecord {
  keyPrefix: string;
}

function toSummary(record: DbKeyRow): ApiKeySummary {
  return {
    id: record.id,
    keyPrefix: record.keyPrefix || record.key.slice(0, 8) + '…',
    label: record.label,
    status: record.status,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
    lastUsedAt: record.lastUsedAt,
  };
}
