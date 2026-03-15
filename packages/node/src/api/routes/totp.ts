/**
 * TOTP 2FA routes — /api/v1/auth/totp
 *
 * Manages TOTP-based two-factor authentication for the console.
 * All routes except POST /verify require a valid console session.
 * POST /verify accepts a pending token (issued after passphrase but before 2FA).
 */

import * as OTPAuth from 'otpauth';
import { Router } from '../router.js';
import { ok, badRequest, unauthorized, internalError } from '../response.js';
import type { RuntimeContext } from '../types.js';

export function totpRoutes(ctx: RuntimeContext): Router {
  const r = new Router();
  const ISSUER = 'ClawNet';
  const LABEL = 'Console';

  // ── GET /status — check if TOTP is configured and enabled ──
  r.get('/status', async (_req, res, route) => {
    if (!ctx.totpStore) {
      ok(res, { configured: false, enabled: false }, { self: route.url.pathname });
      return;
    }
    ok(
      res,
      { configured: ctx.totpStore.isConfigured(), enabled: ctx.totpStore.isEnabled() },
      { self: route.url.pathname },
    );
  });

  // ── POST /setup — generate a new TOTP secret (does NOT save yet) ──
  r.post('/setup', async (_req, res, route) => {
    if (!ctx.totpStore) {
      internalError(res, 'TOTP store not available');
      return;
    }

    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      label: LABEL,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    ok(
      res,
      { secret: secret.base32, otpauthUri: totp.toString() },
      { self: route.url.pathname },
    );
  });

  // ── POST /verify-setup — validate code against provided secret, then save ──
  r.post('/verify-setup', async (_req, res, route) => {
    if (!ctx.totpStore) {
      internalError(res, 'TOTP store not available');
      return;
    }

    const body = route.body as { secret?: string; code?: string } | undefined;
    if (!body?.secret || !body?.code) {
      badRequest(res, 'Missing "secret" and/or "code" fields', route.url.pathname);
      return;
    }

    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      label: LABEL,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(body.secret),
    });

    const delta = totp.validate({ token: body.code, window: 1 });
    if (delta === null) {
      ok(res, { success: false }, { self: route.url.pathname });
      return;
    }

    ctx.totpStore.save(body.secret);
    ok(res, { success: true }, { self: route.url.pathname });
  });

  // ── POST /verify — validate TOTP code against stored secret, upgrade pending token ──
  r.post('/verify', async (req, res, route) => {
    if (!ctx.totpStore) {
      internalError(res, 'TOTP store not available');
      return;
    }

    const body = route.body as { code?: string; pendingToken?: string } | undefined;
    if (!body?.code || !body?.pendingToken) {
      badRequest(res, 'Missing "code" and/or "pendingToken" fields', route.url.pathname);
      return;
    }

    // Validate the pending token
    if (!ctx.consoleSessionStore?.validatePending(body.pendingToken)) {
      unauthorized(res, 'Invalid or expired pending token', route.url.pathname);
      return;
    }

    const record = ctx.totpStore.get();
    if (!record) {
      badRequest(res, '2FA is not configured', route.url.pathname);
      return;
    }

    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      label: LABEL,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(record.secret),
    });

    const delta = totp.validate({ token: body.code, window: 1 });
    if (delta === null) {
      ok(res, { valid: false }, { self: route.url.pathname });
      return;
    }

    // Upgrade pending → full session
    const upgraded = ctx.consoleSessionStore.upgrade(body.pendingToken);
    if (!upgraded) {
      internalError(res, 'Failed to upgrade session');
      return;
    }

    ok(res, { valid: true, sessionToken: body.pendingToken }, { self: route.url.pathname });
  });

  // ── POST /disable — remove 2FA (requires current TOTP code for confirmation) ──
  r.post('/disable', async (_req, res, route) => {
    if (!ctx.totpStore) {
      internalError(res, 'TOTP store not available');
      return;
    }

    const body = route.body as { code?: string } | undefined;
    if (!body?.code) {
      badRequest(res, 'Missing "code" field for confirmation', route.url.pathname);
      return;
    }

    const record = ctx.totpStore.get();
    if (!record) {
      badRequest(res, '2FA is not configured', route.url.pathname);
      return;
    }

    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      label: LABEL,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(record.secret),
    });

    const delta = totp.validate({ token: body.code, window: 1 });
    if (delta === null) {
      ok(res, { success: false, reason: 'Invalid TOTP code' }, { self: route.url.pathname });
      return;
    }

    ctx.totpStore.remove();
    ok(res, { success: true }, { self: route.url.pathname });
  });

  return r;
}
