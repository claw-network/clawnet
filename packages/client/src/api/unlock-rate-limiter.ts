/**
 * Brute-force protection for the session unlock endpoint.
 *
 * Tracks failed passphrase attempts per IP address with exponential backoff
 * and a hard lockout after MAX_FAILURES consecutive failures.
 */

const MAX_FAILURES = 5;
const LOCKOUT_MS = 5 * 60 * 1000;           // 5 minutes
const INACTIVITY_EVICT_MS = 15 * 60 * 1000; // 15 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000;       // 1 minute

interface AttemptRecord {
  consecutiveFailures: number;
  lockedUntil: number;          // Unix ms, 0 = not locked
  lastAttemptAt: number;        // Unix ms
}

export class UnlockRateLimiter {
  private readonly records = new Map<string, AttemptRecord>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupTimer = setInterval(() => this.evictStale(), CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * Check whether the given IP is allowed to attempt an unlock.
   * Returns `{ allowed: true }` or `{ allowed: false, retryAfterSec }`.
   */
  check(ip: string): { allowed: true } | { allowed: false; retryAfterSec: number } {
    const record = this.records.get(ip);
    if (!record) return { allowed: true };

    const now = Date.now();

    // Hard lockout active
    if (record.lockedUntil > now) {
      return { allowed: false, retryAfterSec: Math.ceil((record.lockedUntil - now) / 1000) };
    }

    // Exponential backoff: delay = 2^(failures-1) seconds, starting at 1 s after first failure
    if (record.consecutiveFailures > 0) {
      const backoffMs = Math.pow(2, record.consecutiveFailures - 1) * 1000;
      const readyAt = record.lastAttemptAt + backoffMs;
      if (now < readyAt) {
        return { allowed: false, retryAfterSec: Math.ceil((readyAt - now) / 1000) };
      }
    }

    return { allowed: true };
  }

  /**
   * Record a failed passphrase attempt for the given IP.
   */
  recordFailure(ip: string): void {
    const now = Date.now();
    const record = this.records.get(ip);

    if (!record) {
      this.records.set(ip, { consecutiveFailures: 1, lockedUntil: 0, lastAttemptAt: now });
      return;
    }

    record.consecutiveFailures++;
    record.lastAttemptAt = now;

    if (record.consecutiveFailures >= MAX_FAILURES) {
      record.lockedUntil = now + LOCKOUT_MS;
    }
  }

  /**
   * Record a successful unlock — resets the failure counter for the IP.
   */
  recordSuccess(ip: string): void {
    this.records.delete(ip);
  }

  /**
   * Remove stale records that haven't been touched in INACTIVITY_EVICT_MS.
   */
  private evictStale(): void {
    const cutoff = Date.now() - INACTIVITY_EVICT_MS;
    for (const [ip, record] of this.records) {
      if (record.lastAttemptAt < cutoff) {
        this.records.delete(ip);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.records.clear();
  }
}
