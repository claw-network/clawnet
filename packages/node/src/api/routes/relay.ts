/**
 * Relay routes — /api/v1/relay
 *
 * GET  /stats             — Relay traffic statistics (F3)
 * GET  /health            — Relay self-diagnosis (F9)
 * GET  /access            — Current access control list (F7)
 * POST /access            — Modify access control list (F7)
 * GET  /discover          — Discover relay nodes via DHT (F2)
 * GET  /scores            — Score discovered relay candidates (F5)
 * GET  /peers             — List peers using this relay (F12)
 * POST /drain             — Start/stop graceful relay drain (F12)
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

  // GET /discover — discover relay nodes via DHT (F2)
  r.get('/discover', async (_req, res) => {
    if (!ctx.p2pNode) {
      internalError(res, 'P2P node unavailable');
      return;
    }
    try {
      const peerIds = await ctx.p2pNode.discoverRelayNodes();
      ok(res, { relays: peerIds, count: peerIds.length }, { self: '/api/v1/relay/discover' });
    } catch {
      internalError(res, 'Failed to discover relay nodes');
    }
  });

  // GET /scores — score discovered relay candidates (F5)
  r.get('/scores', async (_req, res) => {
    if (!ctx.p2pNode || !ctx.relayScorer) {
      internalError(res, 'Relay scorer unavailable');
      return;
    }
    try {
      const candidates = await ctx.p2pNode.discoverRelayNodes();
      const scores = await ctx.relayScorer.scoreRelays(candidates);
      ok(res, { scores, count: scores.length }, { self: '/api/v1/relay/scores' });
    } catch {
      internalError(res, 'Failed to score relay nodes');
    }
  });

  // GET /peers — list peers currently using this relay (F12)
  r.get('/peers', async (_req, res) => {
    if (!ctx.relayService) {
      internalError(res, 'Relay service unavailable');
      return;
    }
    try {
      const peers = ctx.relayService.getActivePeers();
      ok(res, { peers, count: peers.length, draining: ctx.relayService.draining }, { self: '/api/v1/relay/peers' });
    } catch {
      internalError(res, 'Failed to list relay peers');
    }
  });

  // POST /drain — start or stop graceful relay drain (F12)
  r.post('/drain', async (_req, res, route) => {
    if (!ctx.relayService || !ctx.p2pNode) {
      internalError(res, 'Relay service unavailable');
      return;
    }

    const body = route.body as Record<string, unknown> | undefined;
    const enable = body?.enable !== false; // default true

    if (enable && !ctx.relayService.draining) {
      ctx.relayService.setDraining(true);
      // Notify connected peers in the background
      const activePeers = ctx.relayService.getActivePeers();
      void ctx.p2pNode.drainRelay(activePeers);
    } else if (!enable) {
      ctx.relayService.setDraining(false);
    }

    ok(res, { draining: ctx.relayService.draining }, { self: '/api/v1/relay/drain' });
  });

  return r;
}
