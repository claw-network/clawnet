/**
 * HTTP middleware: CORS, error boundary, request logging.
 */

import type { Middleware } from './router.js';
import { internalError } from './response.js';

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

export interface CorsOptions {
  /** Allowed origins. `['*']` (default) permits all origins. */
  origins?: string[];
}

/**
 * Create a CORS middleware.
 *
 * By default, allows all origins (`*`). Pass specific origins for
 * production deployments to restrict cross-origin access.
 */
export function createCors(options?: CorsOptions): Middleware {
  const allowed = options?.origins ?? ['*'];
  const allowAll = allowed.includes('*');

  return async (req, res, next) => {
    const origin = req.headers.origin ?? '';

    if (allowAll) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else if (origin) {
      // Origin not in allow-list — still send headers but without Allow-Origin
      // so the browser blocks the response.
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    await next();
  };
}

/** Backward-compatible constant — permissive CORS for development. */
export const cors: Middleware = createCors();

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------

export interface ErrorBoundaryOptions {
  /**
   * When true, error details are hidden from clients (returns generic
   * "Internal Server Error"). Recommended for mainnet / production.
   */
  hideDetails?: boolean;
}

/**
 * Create an error-boundary middleware.
 *
 * @param options.hideDetails — suppress `err.message` in the response.
 */
export function createErrorBoundary(options?: ErrorBoundaryOptions): Middleware {
  const hide = options?.hideDetails ?? false;
  return async (_req, res, next) => {
    try {
      await next();
    } catch (err) {
      const message = hide
        ? 'An unexpected error occurred'
        : err instanceof Error
          ? err.message
          : 'Unknown error';
      if (!res.headersSent) {
        internalError(res, message);
      }
    }
  };
}

/** Backward-compatible constant — exposes error details (dev only). */
export const errorBoundary: Middleware = createErrorBoundary();

/** Optional request logging middleware. */
export function requestLogger(log: (msg: string) => void): Middleware {
  return async (req, res, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    log(`${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
  };
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  /** Max requests per window for read operations (GET/HEAD). Default: 300. */
  readLimit?: number;
  /** Max requests per window for write operations (POST/PUT/PATCH/DELETE). Default: 60. */
  writeLimit?: number;
  /** Sliding window duration in milliseconds. Default: 60_000 (1 minute). */
  windowMs?: number;
  /** Max number of tracked clients before oldest entries are evicted. Default: 10_000. */
  maxClients?: number;
}

interface ClientBucket {
  /** Timestamps of requests within the current window. */
  timestamps: number[];
}

/**
 * Create a per-IP sliding-window rate limiter middleware.
 *
 * - GET/HEAD → readLimit per window (default 300/min)
 * - POST/PUT/PATCH/DELETE → writeLimit per window (default 60/min)
 * - OPTIONS and GET /api/v1/node are exempt
 * - Returns 429 with Retry-After header when exceeded
 */
export function createRateLimiter(options?: RateLimitOptions): Middleware {
  const readLimit = options?.readLimit ?? 300;
  const writeLimit = options?.writeLimit ?? 60;
  const windowMs = options?.windowMs ?? 60_000;
  const maxClients = options?.maxClients ?? 10_000;

  // Separate buckets for read vs write per client IP
  const readBuckets = new Map<string, ClientBucket>();
  const writeBuckets = new Map<string, ClientBucket>();

  // Periodic cleanup of expired entries (every 2 minutes)
  const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, bucket] of readBuckets) {
      bucket.timestamps = bucket.timestamps.filter(t => t > cutoff);
      if (bucket.timestamps.length === 0) readBuckets.delete(key);
    }
    for (const [key, bucket] of writeBuckets) {
      bucket.timestamps = bucket.timestamps.filter(t => t > cutoff);
      if (bucket.timestamps.length === 0) writeBuckets.delete(key);
    }
  }, 120_000);
  cleanupInterval.unref();

  function getClientIp(req: import('node:http').IncomingMessage): string {
    // Trust X-Forwarded-For from reverse proxy (Caddy)
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  function isExempt(req: import('node:http').IncomingMessage): boolean {
    const method = req.method ?? 'GET';
    if (method === 'OPTIONS') return true;
    const url = req.url ?? '/';
    // Node status and metrics endpoints are always public
    if (url === '/api/v1/node' || url === '/api/v1/node/') return true;
    if (url === '/api/v1/metrics' || url === '/api/v1/metrics/') return true;
    return false;
  }

  function checkLimit(buckets: Map<string, ClientBucket>, clientIp: string, limit: number, now: number): { allowed: boolean; retryAfterSec: number } {
    const cutoff = now - windowMs;
    let bucket = buckets.get(clientIp);
    if (!bucket) {
      // Evict oldest client if at capacity
      if (buckets.size >= maxClients) {
        const firstKey = buckets.keys().next().value;
        if (firstKey !== undefined) buckets.delete(firstKey);
      }
      bucket = { timestamps: [] };
      buckets.set(clientIp, bucket);
    }

    // Prune expired entries
    bucket.timestamps = bucket.timestamps.filter(t => t > cutoff);

    if (bucket.timestamps.length >= limit) {
      // Calculate retry-after from oldest request in window
      const oldestInWindow = bucket.timestamps[0];
      const retryAfterSec = Math.ceil((oldestInWindow + windowMs - now) / 1000);
      return { allowed: false, retryAfterSec: Math.max(retryAfterSec, 1) };
    }

    bucket.timestamps.push(now);
    return { allowed: true, retryAfterSec: 0 };
  }

  return async (req, res, next) => {
    if (isExempt(req)) {
      await next();
      return;
    }

    const clientIp = getClientIp(req);
    const method = req.method ?? 'GET';
    const isWrite = method !== 'GET' && method !== 'HEAD';
    const now = Date.now();

    const { allowed, retryAfterSec } = isWrite
      ? checkLimit(writeBuckets, clientIp, writeLimit, now)
      : checkLimit(readBuckets, clientIp, readLimit, now);

    if (!allowed) {
      const { tooManyRequests } = await import('./response.js');
      tooManyRequests(res, `Rate limit exceeded: max ${isWrite ? writeLimit : readLimit} ${isWrite ? 'write' : 'read'} requests per ${windowMs / 1000}s`, req.url ?? undefined, retryAfterSec);
      return;
    }

    // Set informational rate-limit headers
    const limit = isWrite ? writeLimit : readLimit;
    const buckets = isWrite ? writeBuckets : readBuckets;
    const bucket = buckets.get(clientIp);
    const remaining = limit - (bucket?.timestamps.length ?? 0);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(remaining, 0)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));

    await next();
  };
}
