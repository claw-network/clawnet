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
