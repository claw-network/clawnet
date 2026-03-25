import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

import type { AgentDID, PeerProfile } from '../protocol/index.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS peer_profiles (
  did TEXT PRIMARY KEY,
  nickname TEXT,
  avatar_url TEXT,
  node_url TEXT,
  received_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
`;

/** Deterministic filename for a DID's cached avatar. */
function avatarFileName(did: string): string {
  return createHash('sha256').update(did).digest('hex').slice(0, 32) + '.bin';
}

interface PeerProfileRow {
  did: string;
  nickname: string | null;
  avatar_url: string | null;
  avatar_mime_type: string | null;
  node_url: string | null;
  received_at_ms: number;
  updated_at_ms: number;
}

function toProfile(row: PeerProfileRow): PeerProfile {
  return {
    did: row.did,
    nickname: row.nickname ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    nodeUrl: row.node_url ?? undefined,
    receivedAtMs: row.received_at_ms,
  };
}

export class PeerProfileRepository {
  private readonly db: InstanceType<typeof Database>;
  private readonly peerAvatarsDir: string | undefined;

  constructor(dbPath: string, peerAvatarsDir?: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.peerAvatarsDir = peerAvatarsDir;

    // Add avatar_mime_type column if missing (existing databases).
    try {
      this.db.exec('ALTER TABLE peer_profiles ADD COLUMN avatar_mime_type TEXT');
    } catch {
      // Column already exists — ignore.
    }
  }

  upsert(profile: PeerProfile): void {
    const nowMs = Date.now();
    this.db
      .prepare(
        `INSERT INTO peer_profiles (did, nickname, avatar_url, node_url, received_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(did) DO UPDATE SET
           nickname = excluded.nickname,
           avatar_url = excluded.avatar_url,
           node_url = excluded.node_url,
           updated_at_ms = excluded.updated_at_ms`,
      )
      .run(
        profile.did,
        profile.nickname ?? null,
        profile.avatarUrl ?? null,
        profile.nodeUrl ?? null,
        profile.receivedAtMs,
        nowMs,
      );
  }

  get(did: AgentDID): PeerProfile | null {
    const row = this.db
      .prepare(
        'SELECT did, nickname, avatar_url, avatar_mime_type, node_url, received_at_ms, updated_at_ms FROM peer_profiles WHERE did = ?',
      )
      .get(did) as PeerProfileRow | undefined;
    return row ? toProfile(row) : null;
  }

  /** Save peer avatar binary to disk and record its MIME type. */
  saveAvatar(did: string, data: Buffer, mimeType: string): void {
    if (!this.peerAvatarsDir) return;
    const filePath = resolve(this.peerAvatarsDir, avatarFileName(did));
    writeFileSync(filePath, data);
    this.db
      .prepare('UPDATE peer_profiles SET avatar_mime_type = ? WHERE did = ?')
      .run(mimeType, did);
  }

  /** Load a cached peer avatar from disk. Returns null if not cached. */
  loadAvatar(did: string): { data: Buffer; mimeType: string } | null {
    if (!this.peerAvatarsDir) return null;
    const filePath = resolve(this.peerAvatarsDir, avatarFileName(did));
    if (!existsSync(filePath)) return null;

    const row = this.db
      .prepare('SELECT avatar_mime_type FROM peer_profiles WHERE did = ?')
      .get(did) as { avatar_mime_type: string | null } | undefined;

    const mimeType = row?.avatar_mime_type || 'image/jpeg';
    try {
      const data = readFileSync(filePath);
      return { data, mimeType };
    } catch {
      return null;
    }
  }

  close(): void {
    this.db.close();
  }
}
