/**
 * Node routes — GET /api/v1/node, GET /api/v1/node/peers
 */

import { Router } from '../router.js';
import { ok, internalError } from '../response.js';
import type { RuntimeContext } from '../types.js';

export function nodeRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // GET /api/v1/node — combined status + config
  r.get('/', async (_req, res) => {
    if (!ctx.getNodeStatus) {
      internalError(res, 'Node status unavailable');
      return;
    }
    try {
      const status = await ctx.getNodeStatus();
      const config = ctx.getNodeConfig ? await ctx.getNodeConfig() : {};
      ok(res, { ...status, config }, { self: '/api/v1/node' });
    } catch {
      internalError(res, 'Failed to read node status');
    }
  });

  // GET /api/v1/node/peers
  r.get('/peers', async (_req, res) => {
    if (!ctx.getNodePeers) {
      internalError(res, 'Peer list unavailable');
      return;
    }
    try {
      const result = await ctx.getNodePeers();
      ok(res, result, { self: '/api/v1/node/peers' });
    } catch {
      internalError(res, 'Failed to read peers');
    }
  });

  // GET /api/v1/node/config
  r.get('/config', async (_req, res) => {
    if (!ctx.getNodeConfig) {
      internalError(res, 'Node config unavailable');
      return;
    }
    try {
      const config = await ctx.getNodeConfig();
      ok(res, config, { self: '/api/v1/node/config' });
    } catch {
      internalError(res, 'Failed to read node config');
    }
  });

  return r;
}
