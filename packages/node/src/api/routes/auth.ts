/**
 * Auth routes — /api/v1/auth
 *
 * Lightweight authentication helpers that work without chain/wallet services.
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { listKeyRecords, decryptKeyRecord, resolveStoragePaths } from '../types.js';

export function authRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST /verify-passphrase — verify passphrase against local identity key ──
  r.post('/verify-passphrase', async (_req, res, route) => {
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
        ok(res, { valid: false }, { self: '/api/v1/auth/verify-passphrase' });
        return;
      }

      // Try to decrypt the first (primary) identity key record
      const record = records[0];
      try {
        await decryptKeyRecord(record, passphrase);
        const did = `did:claw:${record.publicKey}`;

        // If 2FA is enabled, issue a pending token that must be upgraded via TOTP
        if (ctx.totpStore?.isEnabled()) {
          const pendingToken = ctx.consoleSessionStore?.createPending();
          ok(res, { valid: true, did, requireTotp: true, pendingToken }, { self: '/api/v1/auth/verify-passphrase' });
          return;
        }

        const sessionToken = ctx.consoleSessionStore?.create();
        ok(res, { valid: true, did, sessionToken }, { self: '/api/v1/auth/verify-passphrase' });
      } catch {
        ok(res, { valid: false }, { self: '/api/v1/auth/verify-passphrase' });
      }
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  return r;
}
