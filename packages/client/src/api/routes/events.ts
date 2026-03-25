import type { RuntimeContext } from '../types.js';
import { Router } from '../router.js';
import { ok, created } from '../response.js';
import { handleError } from '../route-utils.js';

/**
 * Event routes:
 *   GET  /                — Local SSE event stream
 *   POST /subscribe       — Target: create delegation (called by gateway via API Proxy)
 *   POST /unsubscribe     — Target: revoke delegation
 */
export function eventRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  // Local SSE endpoint — Webapp directly connected to this node
  router.get('/', ({ res }) => {
    if (!ctx.eventPushService) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Event push service unavailable' }));
      return;
    }
    // SSE connection: addLocalClient handles headers, heartbeat, and cleanup.
    // Do NOT call res.end() — SSE is a long-lived connection.
    ctx.eventPushService.addLocalClient(res);
  });

  // Target role: gateway asks us to create a delegation
  router.post('/subscribe', async ({ res, body }) => {
    if (!ctx.eventPushService) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Event push service unavailable' }));
      return;
    }

    const payload = body as Record<string, unknown> | undefined;
    const gatewayDid = payload?.gatewayDid as string;
    const topics = Array.isArray(payload?.topics) && payload!.topics.every((item) => typeof item === 'string')
      ? payload!.topics as string[]
      : undefined;
    const expiresInSec = typeof payload?.expiresInSec === 'number' && Number.isFinite(payload.expiresInSec) && payload.expiresInSec > 0
      ? payload.expiresInSec
      : undefined;
    const metadataOnly = typeof payload?.metadataOnly === 'boolean'
      ? payload.metadataOnly
      : undefined;
    if (!gatewayDid || typeof gatewayDid !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing gatewayDid' }));
      return;
    }

    try {
      const result = await ctx.eventPushService.createDelegation(gatewayDid, {
        topics,
        expiresInSec,
        metadataOnly,
      });
      created(res, result, { self: '/api/v1/events/subscribe' });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Target role: gateway asks us to revoke a delegation
  router.post('/unsubscribe', async ({ res, body }) => {
    if (!ctx.eventPushService) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Event push service unavailable' }));
      return;
    }

    const payload = body as Record<string, unknown> | undefined;
    const delegationId = payload?.delegationId as string;
    if (!delegationId || typeof delegationId !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing delegationId' }));
      return;
    }

    try {
      await ctx.eventPushService.revokeDelegation(delegationId);
      res.writeHead(204);
      res.end();
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}
