/**
 * Auth routes — /api/v1/auth
 *
 * Lightweight authentication helpers that work without chain/wallet services.
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError, tooManyRequests } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { listKeyRecords, decryptKeyRecord, resolveStoragePaths } from '../types.js';

// ---------------------------------------------------------------------------
// Passphrase brute-force protection
// ---------------------------------------------------------------------------

/** Per-IP tracking for passphrase attempts. */
interface AttemptRecord {
  /** Timestamps of failed attempts within the current window. */
  failures: number[];
  /** Lockout expires at (epoch ms). 0 = not locked. */
  lockedUntil: number;
}

const PASSPHRASE_WINDOW_MS = 60_000;      // 1 minute sliding window
const PASSPHRASE_MAX_ATTEMPTS = 5;        // max failures per window
const LOCKOUT_THRESHOLDS = [60_000, 300_000, 900_000]; // 1min, 5min, 15min
const LOCKOUT_TRIGGER = 10;               // consecutive failures before lockout

const passphraseAttempts = new Map<string, AttemptRecord>();

// Cleanup every 5 minutes
const _cleanup = setInterval(() => {
  const now = Date.now();
  const cutoff = now - PASSPHRASE_WINDOW_MS;
  for (const [ip, record] of passphraseAttempts) {
    record.failures = record.failures.filter(t => t > cutoff);
    if (record.failures.length === 0 && record.lockedUntil <= now) {
      passphraseAttempts.delete(ip);
    }
  }
}, 300_000);
_cleanup.unref();

function getPassphraseRecord(ip: string): AttemptRecord {
  let record = passphraseAttempts.get(ip);
  if (!record) {
    record = { failures: [], lockedUntil: 0 };
    passphraseAttempts.set(ip, record);
  }
  return record;
}

/**
 * Check if an IP is allowed to attempt passphrase verification.
 * Returns `retryAfterSec > 0` if the request should be rejected.
 */
function checkPassphraseLimit(ip: string, now: number): { allowed: boolean; retryAfterSec: number } {
  const record = getPassphraseRecord(ip);

  // Check lockout first
  if (record.lockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((record.lockedUntil - now) / 1000) };
  }

  // Prune expired failures
  const cutoff = now - PASSPHRASE_WINDOW_MS;
  record.failures = record.failures.filter(t => t > cutoff);

  if (record.failures.length >= PASSPHRASE_MAX_ATTEMPTS) {
    const oldest = record.failures[0];
    const retryAfterSec = Math.ceil((oldest + PASSPHRASE_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSec: Math.max(retryAfterSec, 1) };
  }

  return { allowed: true, retryAfterSec: 0 };
}

function recordPassphraseFailure(ip: string, now: number): void {
  const record = getPassphraseRecord(ip);
  record.failures.push(now);

  // Escalating lockout after LOCKOUT_TRIGGER consecutive failures
  if (record.failures.length >= LOCKOUT_TRIGGER) {
    const lockoutIndex = Math.min(
      Math.floor((record.failures.length - LOCKOUT_TRIGGER) / LOCKOUT_TRIGGER),
      LOCKOUT_THRESHOLDS.length - 1,
    );
    record.lockedUntil = now + LOCKOUT_THRESHOLDS[lockoutIndex];
  }
}

function clearPassphraseFailures(ip: string): void {
  passphraseAttempts.delete(ip);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function authRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST /verify-passphrase — verify passphrase against local identity key ──
  r.post('/verify-passphrase', async (req, res, route) => {
    // Per-IP brute-force rate limit (keyed on socket address, not X-Forwarded-For)
    const clientIp = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const { allowed, retryAfterSec } = checkPassphraseLimit(clientIp, now);
    if (!allowed) {
      tooManyRequests(
        res,
        `Too many passphrase attempts. Retry after ${retryAfterSec}s.`,
        route.url.pathname,
        retryAfterSec,
      );
      return;
    }

    const body = route.body as { passphrase?: string } | undefined;
    const passphrase = body?.passphrase;

    if (!passphrase || typeof passphrase !== 'string') {
      badRequest(res, 'Missing or invalid "passphrase" field', route.url.pathname);
      return;
    }

    const dataDir = ctx.config.dataDir;
    if (!dataDir) {
      internalError(res, 'Node dataDir not configured');
      return;
    }

    try {
      const paths = resolveStoragePaths(dataDir);
      const records = await listKeyRecords(paths);

      if (records.length === 0) {
        recordPassphraseFailure(clientIp, now);
        ok(res, { valid: false }, { self: '/api/v1/auth/verify-passphrase' });
        return;
      }

      // Try to decrypt the first (primary) identity key record
      const record = records[0];
      try {
        await decryptKeyRecord(record, passphrase);
        const did = `did:claw:${record.publicKey}`;

        // Success — clear failure counter
        clearPassphraseFailures(clientIp);

        // If 2FA is enabled, issue a pending token that must be upgraded via TOTP
        if (ctx.totpStore?.isEnabled()) {
          const pendingToken = ctx.consoleSessionStore?.createPending();
          ok(res, { valid: true, did, requireTotp: true, pendingToken }, { self: '/api/v1/auth/verify-passphrase' });
          return;
        }

        const sessionToken = ctx.consoleSessionStore?.create();
        ok(res, { valid: true, did, sessionToken }, { self: '/api/v1/auth/verify-passphrase' });
      } catch {
        recordPassphraseFailure(clientIp, now);
        ok(res, { valid: false }, { self: '/api/v1/auth/verify-passphrase' });
      }
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  return r;
}
