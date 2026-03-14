/**
 * In-memory console session store.
 *
 * Passphrase-verified console logins receive a random token
 * that is accepted by the API auth middleware for the session duration.
 *
 * When 2FA is enabled, a short-lived "pending" token is issued first.
 * It can only be used to complete the TOTP verification step, after which
 * it is upgraded to a full session token.
 */

import { randomBytes } from 'node:crypto';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes for 2FA completion

interface SessionEntry {
  expiresAt: number;
  pending: boolean; // true = awaiting 2FA, not a full session
}

export class ConsoleSessionStore {
  private sessions = new Map<string, SessionEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Create a new full session token. */
  create(): string {
    this.gc();
    const token = `cs_${randomBytes(32).toString('hex')}`;
    this.sessions.set(token, { expiresAt: Date.now() + this.ttlMs, pending: false });
    return token;
  }

  /** Create a pending session token (awaiting 2FA). Short-lived. */
  createPending(): string {
    this.gc();
    const token = `cs_${randomBytes(32).toString('hex')}`;
    this.sessions.set(token, { expiresAt: Date.now() + PENDING_TTL_MS, pending: true });
    return token;
  }

  /** Validate a full (non-pending) session token. */
  validate(token: string): boolean {
    const entry = this.sessions.get(token);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    // Pending tokens are NOT valid as full sessions
    return !entry.pending;
  }

  /** Validate a pending (2FA-awaiting) token. */
  validatePending(token: string): boolean {
    const entry = this.sessions.get(token);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    return entry.pending;
  }

  /** Upgrade a pending token to a full session. */
  upgrade(token: string): boolean {
    const entry = this.sessions.get(token);
    if (!entry || !entry.pending) return false;
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(token);
      return false;
    }
    entry.pending = false;
    entry.expiresAt = Date.now() + this.ttlMs;
    return true;
  }

  /** Remove a session token. */
  revoke(token: string): void {
    this.sessions.delete(token);
  }

  /** Garbage-collect expired sessions. */
  private gc(): void {
    const now = Date.now();
    for (const [token, entry] of this.sessions) {
      if (now > entry.expiresAt) this.sessions.delete(token);
    }
  }
}
