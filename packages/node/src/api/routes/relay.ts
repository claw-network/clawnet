/**
 * Relay routes — /api/v1/relay
 *
 * GET  /stats             — Relay traffic statistics (F3)
 * GET  /health            — Relay self-diagnosis (F9)
 * GET  /access            — Current access control list (F7)
 * POST /access            — Modify access control list (F7)
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError } from '../response.js';
import type { RuntimeContext } from '../types.js';

export function relayRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // GET /stats — relay traffic statistics
  r.get('/stats', async (_req, res) => {
    if (!ctx.relayService) {
      internalError(res, 'Relay service unavailable');
      return;
    }
    try {
      const stats = ctx.relayService.getStats();
      ok(res, stats, { self: '/api/v1/relay/stats' });
    } catch {
      internalError(res, 'Failed to read relay stats');
    }
  });

  // GET /health — relay self-diagnosis
  r.get('/health', async (_req, res) => {
    if (!ctx.relayService) {
      internalError(res, 'Relay service unavailable');
      return;
    }
    try {
      const health = ctx.relayService.getHealth();
      ok(res, health, { self: '/api/v1/relay/health' });
    } catch {
      internalError(res, 'Failed to read relay health');
    }
  });

  // GET /access — current access control list
  r.get('/access', async (_req, res) => {
    if (!ctx.relayService) {
      internalError(res, 'Relay service unavailable');
      return;
    }
    try {
      const info = ctx.relayService.getAccessInfo();
      ok(res, info, { self: '/api/v1/relay/access' });
    } catch {
      internalError(res, 'Failed to read relay access info');
    }
  });

  // POST /access — modify access control list
  r.post('/access', async (_req, res, route) => {
    if (!ctx.relayService) {
      internalError(res, 'Relay service unavailable');
      return;
    }

    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const action = body.action as string | undefined;
    const did = body.did as string | undefined;
    const mode = body.mode as string | undefined;

    // Set access mode
    if (mode) {
      if (mode !== 'open' && mode !== 'whitelist' && mode !== 'blacklist') {
        badRequest(res, 'Invalid mode. Must be "open", "whitelist", or "blacklist"', route.url.pathname);
        return;
      }
      ctx.relayService.setAccessMode(mode);
      ok(res, ctx.relayService.getAccessInfo(), { self: '/api/v1/relay/access' });
      return;
    }

    // Add/remove DID
    if (!action || (action !== 'add' && action !== 'remove')) {
      badRequest(res, 'Missing or invalid "action". Must be "add" or "remove"', route.url.pathname);
      return;
    }
    if (!did || typeof did !== 'string') {
      badRequest(res, 'Missing or invalid "did"', route.url.pathname);
      return;
    }

    if (action === 'add') {
      ctx.relayService.addToAccessList(did);
    } else {
      ctx.relayService.removeFromAccessList(did);
    }

    ok(res, ctx.relayService.getAccessInfo(), { self: '/api/v1/relay/access' });
  });

  return r;
}
