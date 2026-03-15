/**
 * TOTP secret store — SQLite-backed, single-user.
 *
 * Stores the TOTP base32 secret used for Google Authenticator 2FA.
 * Uses the same `better-sqlite3` database as ApiKeyStore (api-keys.sqlite).
 * Only one TOTP secret exists at a time (id=1, single-user console model).
 */

import Database from 'better-sqlite3';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS console_totp (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  secret      TEXT    NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL
);
`;

export interface TotpRecord {
  secret: string;
  enabled: boolean;
  createdAt: string;
}

export class TotpStore {
  private readonly db: Database.Database;
  private stmtGet!: Database.Statement;
  private stmtUpsert!: Database.Statement;
  private stmtDelete!: Database.Statement;
  private stmtSetEnabled!: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_SQL);
    this.prepareStatements();
  }

  private prepareStatements(): void {
    this.stmtGet = this.db.prepare(
      `SELECT secret, enabled, created_at AS createdAt FROM console_totp WHERE id = 1`,
    );
    this.stmtUpsert = this.db.prepare(
      `INSERT INTO console_totp (id, secret, enabled, created_at) VALUES (1, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET secret = excluded.secret, enabled = 1, created_at = excluded.created_at`,
    );
    this.stmtDelete = this.db.prepare(`DELETE FROM console_totp WHERE id = 1`);
    this.stmtSetEnabled = this.db.prepare(
      `UPDATE console_totp SET enabled = ? WHERE id = 1`,
    );
  }

  /** Whether a TOTP secret has been configured. */
  isConfigured(): boolean {
    return !!this.stmtGet.get();
  }

  /** Whether TOTP is configured AND enabled. */
  isEnabled(): boolean {
    const row = this.stmtGet.get() as TotpRecord | undefined;
    return !!row && !!row.enabled;
  }

  /** Get the stored TOTP record (null if not configured). */
  get(): TotpRecord | null {
    const row = this.stmtGet.get() as TotpRecord | undefined;
    if (!row) return null;
    return { ...row, enabled: !!row.enabled };
  }

  /** Save (or replace) the TOTP secret. */
  save(secret: string): void {
    this.stmtUpsert.run(secret, new Date().toISOString());
  }

  /** Remove the TOTP secret entirely. */
  remove(): void {
    this.stmtDelete.run();
  }

  /** Enable or disable TOTP without removing the secret. */
  setEnabled(enabled: boolean): void {
    this.stmtSetEnabled.run(enabled ? 1 : 0);
  }
}
