/**
 * Prometheus metrics for ClawNet node.
 *
 * Exposes request latency, throughput, P2P stats, chain height, relay stats,
 * and process-level metrics via prom-client.
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import type { Middleware } from './router.js';

// ─── Registry ───────────────────────────────────────────────────

export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ app: 'clawnet' });
collectDefaultMetrics({ register: metricsRegistry });

// ─── HTTP Metrics ───────────────────────────────────────────────

export const httpRequestDuration = new Histogram({
  name: 'clawnet_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

export const httpRequestsTotal = new Counter({
  name: 'clawnet_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

// ─── Node / Chain Gauges ────────────────────────────────────────

export const blockHeight = new Gauge({
  name: 'clawnet_block_height',
  help: 'Latest indexed block height',
  registers: [metricsRegistry],
});

export const p2pPeers = new Gauge({
  name: 'clawnet_p2p_peers',
  help: 'Number of pubsub peers',
  registers: [metricsRegistry],
});

export const p2pConnections = new Gauge({
  name: 'clawnet_p2p_connections',
  help: 'Number of active P2P connections',
  registers: [metricsRegistry],
});

export const nodeUptime = new Gauge({
  name: 'clawnet_node_uptime_seconds',
  help: 'Node uptime in seconds',
  registers: [metricsRegistry],
});

// ─── Relay Gauges ───────────────────────────────────────────────

export const relayActiveCircuits = new Gauge({
  name: 'clawnet_relay_active_circuits',
  help: 'Number of active relay circuits',
  registers: [metricsRegistry],
});

export const relayBytesTotal = new Counter({
  name: 'clawnet_relay_bytes_total',
  help: 'Total bytes relayed',
  registers: [metricsRegistry],
});

export const relayMessagesTotal = new Counter({
  name: 'clawnet_relay_messages_total',
  help: 'Total messages relayed',
  registers: [metricsRegistry],
});

// ─── Request Duration Middleware ────────────────────────────────

/**
 * Normalise URL path for metric labels to avoid cardinality explosion.
 * Replaces UUIDs, hex hashes, and numeric IDs with `:id`.
 */
function normaliseRoute(url: string): string {
  const path = url.split('?')[0];
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/z[1-9A-HJ-NP-Za-km-z]{32,}/g, '/:id')   // multibase base58btc
    .replace(/\/0x[0-9a-fA-F]{40,}/g, '/:id')              // EVM addresses / hashes
    .replace(/\/did:claw:[^\s/]+/g, '/:did')                // DID paths
    .replace(/\/\d+/g, '/:id');                             // numeric IDs
}

/**
 * Middleware that records HTTP request duration and count.
 */
export function metricsMiddleware(): Middleware {
  return async (req, res, next) => {
    const start = process.hrtime.bigint();
    await next();
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;

    const method = req.method ?? 'GET';
    const route = normaliseRoute(req.url ?? '/');
    const statusCode = String(res.statusCode);

    httpRequestDuration.observe({ method, route, status_code: statusCode }, durationSec);
    httpRequestsTotal.inc({ method, route, status_code: statusCode });
  };
}
