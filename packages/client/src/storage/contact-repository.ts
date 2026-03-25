import Database from 'better-sqlite3';

import type { Contact } from '../protocol/index.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS contacts (
  did TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  notes TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
`;

interface ContactRow {
  did: string;
  display_name: string;
  avatar_url: string | null;
  notes: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

function toContact(row: ContactRow): Contact {
  return {
    did: row.did,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? undefined,
    notes: row.notes ?? undefined,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

export class ContactRepository {
  private readonly db: InstanceType<typeof Database>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  save(contact: Contact): void {
    this.db
      .prepare(
        `INSERT INTO contacts (did, display_name, avatar_url, notes, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(did) DO UPDATE SET
           display_name = excluded.display_name,
           avatar_url = excluded.avatar_url,
           notes = excluded.notes,
           updated_at_ms = excluded.updated_at_ms`,
      )
      .run(
        contact.did,
        contact.displayName,
        contact.avatarUrl ?? null,
        contact.notes ?? null,
        contact.createdAtMs,
        contact.updatedAtMs,
      );
  }

  get(did: string): Contact | null {
    const row = this.db
      .prepare('SELECT did, display_name, avatar_url, notes, created_at_ms, updated_at_ms FROM contacts WHERE did = ?')
      .get(did) as ContactRow | undefined;
    return row ? toContact(row) : null;
  }

  list(): Contact[] {
    const rows = this.db
      .prepare('SELECT did, display_name, avatar_url, notes, created_at_ms, updated_at_ms FROM contacts ORDER BY updated_at_ms DESC')
      .all() as ContactRow[];
    return rows.map(toContact);
  }

  remove(did: string): boolean {
    const result = this.db
      .prepare('DELETE FROM contacts WHERE did = ?')
      .run(did);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
