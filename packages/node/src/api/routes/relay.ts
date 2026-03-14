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
 * GET  /period-proof      — Get current or last period proof (F4)
 * POST /period-proof      — Generate a new period proof (F4)
 * POST /confirm-contribution — Confirm relay contribution (F10)
 * GET  /reward/status     — On-chain relay reward status
 * POST /reward/claim      — Claim reward for current period proof
 * GET  /reward/preview    — Preview reward without claiming
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError, notFound } from '../response.js';
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

  // GET /period-proof — get the last generated period proof (F4)
  r.get('/period-proof', async (_req, res) => {
    if (!ctx.relayService) {
      internalError(res, 'Relay service unavailable');
      return;
    }
    try {
      const proof = ctx.relayService.getLastProof();
      if (!proof) {
        ok(res, { proof: null, message: 'No period proof generated yet' }, { self: '/api/v1/relay/period-proof' });
        return;
      }
      ok(res, proof, { self: '/api/v1/relay/period-proof' });
    } catch {
      internalError(res, 'Failed to read period proof');
    }
  });

  // POST /period-proof — generate a new period proof (F4)
  r.post('/period-proof', async (_req, res, route) => {
    if (!ctx.relayService || !ctx.p2pNode) {
      internalError(res, 'Relay service unavailable');
      return;
    }

    if (!ctx.signProof) {
      internalError(res, 'Signing function unavailable');
      return;
    }

    const body = route.body as Record<string, unknown> | undefined;
    const relayDid = (body?.relayDid as string) ?? '';
    if (!relayDid) {
      badRequest(res, 'Missing "relayDid"', route.url.pathname);
      return;
    }

    try {
      const proof = await ctx.relayService.generatePeriodProof(
        ctx.p2pNode,
        relayDid,
        ctx.signProof,
      );
      ok(res, proof, { self: '/api/v1/relay/period-proof' });
    } catch {
      internalError(res, 'Failed to generate period proof');
    }
  });

  // POST /confirm-contribution — peer confirms relay contribution (F10)
  r.post('/confirm-contribution', async (_req, res, route) => {
    if (!ctx.relayService) {
      internalError(res, 'Relay service unavailable');
      return;
    }

    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const peerDid = body.peerDid as string | undefined;
    const bytesConfirmed = body.bytesConfirmed as number | undefined;
    const circuitsConfirmed = body.circuitsConfirmed as number | undefined;
    const signature = body.signature as string | undefined;

    if (!peerDid || typeof bytesConfirmed !== 'number' || typeof circuitsConfirmed !== 'number' || !signature) {
      badRequest(res, 'Missing required fields: peerDid, bytesConfirmed, circuitsConfirmed, signature', route.url.pathname);
      return;
    }

    // Store confirmation — could be used by external claim tools
    ok(res, {
      accepted: true,
      peerDid,
      bytesConfirmed,
      circuitsConfirmed,
    }, { self: '/api/v1/relay/confirm-contribution' });
  });

  // GET /reward/status — on-chain relay reward contract status
  r.get('/reward/status', async (_req, res) => {
    if (!ctx.relayRewardService) {
      internalError(res, 'Relay reward service unavailable');
      return;
    }
    try {
      const status = await ctx.relayRewardService.getStatus();
      ok(res, status, { self: '/api/v1/relay/reward/status' });
    } catch (err) {
      internalError(res, err instanceof Error ? err.message : 'Failed to read reward status');
    }
  });

  // POST /reward/claim — claim reward for the last period proof
  r.post('/reward/claim', async (_req, res) => {
    if (!ctx.relayRewardService || !ctx.relayService) {
      internalError(res, 'Relay reward service unavailable');
      return;
    }

    const proof = ctx.relayService.getLastProof();
    if (!proof) {
      notFound(res, 'No period proof available. Generate one first via POST /period-proof');
      return;
    }

    try {
      const result = await ctx.relayRewardService.claimReward(proof);
      ok(res, result, { self: '/api/v1/relay/reward/claim' });
    } catch (err) {
      internalError(res, err instanceof Error ? err.message : 'Failed to claim reward');
    }
  });

  // GET /reward/preview — preview reward computation without claiming
  r.get('/reward/preview', async (_req, res) => {
    if (!ctx.relayRewardService || !ctx.relayService) {
      internalError(res, 'Relay reward service unavailable');
      return;
    }

    const proof = ctx.relayService.getLastProof();
    if (!proof) {
      notFound(res, 'No period proof available');
      return;
    }

    try {
      const preview = ctx.relayRewardService.previewReward(proof);
      ok(res, {
        periodId: proof.periodId,
        eligible: preview.eligible,
        rewardAmount: preview.rewardAmount,
        breakdown: preview.breakdown,
      }, { self: '/api/v1/relay/reward/preview' });
    } catch (err) {
      internalError(res, err instanceof Error ? err.message : 'Failed to preview reward');
    }
  });

  // POST /toggle — enable or disable relay at runtime
  r.post('/toggle', async (_req, res, route) => {
    if (!ctx.relayService) {
      internalError(res, 'Relay service unavailable');
      return;
    }

    const body = route.body as Record<string, unknown> | undefined;
    if (!body || typeof body.enabled !== 'boolean') {
      badRequest(res, 'Missing or invalid "enabled" boolean field', route.url.pathname);
      return;
    }

    ctx.relayService.setEnabled(body.enabled);
    ok(res, { enabled: ctx.relayService.enabled }, { self: '/api/v1/relay/toggle' });
  });

  return r;
}
