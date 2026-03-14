/**
 * In-memory console session store.
 *
 * Passphrase-verified console logins receive a random token
 * that is accepted by the API auth middleware for the session duration.
 */

import { randomBytes } from 'node:crypto';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class ConsoleSessionStore {
  private sessions = new Map<string, number>(); // token → expiresAt (epoch ms)
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Create a new session token. */
  create(): string {
    this.gc();
    const token = `cs_${randomBytes(32).toString('hex')}`;
    this.sessions.set(token, Date.now() + this.ttlMs);
    return token;
  }

  /** Validate a session token. Returns true if valid and not expired. */
  validate(token: string): boolean {
    const expiresAt = this.sessions.get(token);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  /** Remove a session token. */
  revoke(token: string): void {
    this.sessions.delete(token);
  }

  /** Garbage-collect expired sessions. */
  private gc(): void {
    const now = Date.now();
    for (const [token, expiresAt] of this.sessions) {
      if (now > expiresAt) this.sessions.delete(token);
    }
  }
}
