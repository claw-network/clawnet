/**
 * HTTP middleware: CORS, error boundary, request logging.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Middleware } from './router.js';
import { internalError } from './response.js';

/** CORS middleware — permissive for development. */
export const cors: Middleware = async (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

/** Error boundary — catches unhandled errors in handlers. */
export const errorBoundary: Middleware = async (_req, res, next) => {
  try {
    await next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (!res.headersSent) {
      internalError(res, message);
    }
  }
};

/** Optional request logging middleware. */
export function requestLogger(
  log: (msg: string) => void,
): Middleware {
  return async (req, res, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    log(`${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
  };
}
