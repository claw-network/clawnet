/**
 * Metrics route — GET /api/v1/metrics
 *
 * Returns Prometheus-format metrics for scraping.
 * Updates gauge values from RuntimeContext before each scrape.
 */

import { Router } from '../router.js';
import type { RuntimeContext } from '../types.js';
import {
  metricsRegistry,
  blockHeight,
  p2pPeers,
  p2pConnections,
  nodeUptime,
  relayActiveCircuits,
} from '../metrics.js';

export function metricsRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  r.get('/', async (_req, res) => {
    // Refresh gauge values from live service state
    try {
      if (ctx.getNodeStatus) {
        const status = await ctx.getNodeStatus();
        if (typeof status.blockHeight === 'number') blockHeight.set(status.blockHeight);
        if (typeof status.peers === 'number') p2pPeers.set(status.peers);
        if (typeof status.connections === 'number') p2pConnections.set(status.connections);
        if (typeof status.uptime === 'number') nodeUptime.set(status.uptime);
      }
      if (ctx.relayService) {
        const stats = ctx.relayService.getStats();
        relayActiveCircuits.set(stats.activeCircuits);
      }
    } catch {
      // Best-effort gauge update — don't fail the scrape
    }

    const metrics = await metricsRegistry.metrics();
    res.writeHead(200, { 'Content-Type': metricsRegistry.contentType });
    res.end(metrics);
  });

  return r;
}
