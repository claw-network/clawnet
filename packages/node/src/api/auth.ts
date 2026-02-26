/**
 * API Key authentication middleware.
 *
 * Strategy:
 *  1. If no ApiKeyStore is configured → skip auth (backwards-compatible).
 *  2. If the store has 0 active keys → skip auth (fresh node, not yet configured).
 *  3. Otherwise, require a valid `X-Api-Key` header (or `Authorization: Bearer <key>`).
 *  4. GET requests to /api/v1/node (status endpoint) are always open.
 *
 * When auth is enforced, the middleware rejects with 401 Unauthorized.
 * The validated key metadata is attached to the request for downstream use.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Middleware } from './router.js';
import type { ApiKeyStore, ApiKeyRecord } from './api-key-store.js';
import type { NetworkType } from './types.js';
import { unauthorized } from './response.js';

// ---------------------------------------------------------------------------
// Augment request to carry auth context
// ---------------------------------------------------------------------------

const AUTH_SYMBOL = Symbol('apiKeyAuth');

export interface ApiKeyAuth {
  keyId: number;
  label: string;
}

/** Retrieve the authenticated key from a request (or undefined). */
export function getApiKeyAuth(req: IncomingMessage): ApiKeyAuth | undefined {
  return (req as unknown as Record<symbol, ApiKeyAuth>)[AUTH_SYMBOL];
}

// ---------------------------------------------------------------------------
// Public route patterns (no auth required)
// ---------------------------------------------------------------------------

/** Routes that are always accessible without an API key. */
const PUBLIC_ROUTES: Array<(url: string, method: string) => boolean> = [
  // Node status — needed by health checks and SDK connection probing
  (url) => url === '/api/v1/node' || url === '/api/v1/node/',
  // OPTIONS (CORS preflight)
  (_url, method) => method === 'OPTIONS',
];

function isPublicRoute(url: string, method: string): boolean {
  return PUBLIC_ROUTES.some((check) => check(url, method));
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create the API key auth middleware.
 *
 * @param store - optional ApiKeyStore. If undefined or has 0 keys, auth is skipped.
 * @param network - network type. On mainnet, 0-key still enforces 401.
 */
export function apiKeyAuth(store: ApiKeyStore | undefined, network?: NetworkType): Middleware {
  return async (req: IncomingMessage, res: ServerResponse, next: () => Promise<void>) => {
    // No store configured → open access (backward-compatible)
    if (!store) {
      await next();
      return;
    }

    // Parse the URL pathname
    const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    // Public routes are always accessible
    if (isPublicRoute(pathname, method)) {
      await next();
      return;
    }

    // If no keys have been created yet:
    //  - mainnet: still enforce 401 (must create keys before API is usable)
    //  - testnet/devnet: open access (fresh node, backwards-compatible)
    if (store.activeCount() === 0) {
      if (network === 'mainnet') {
        unauthorized(res, 'No API keys configured. Create a key with `clawnet api-key create <label>` before using mainnet API.', pathname);
        return;
      }
      await next();
      return;
    }

    // Extract key from header
    const key = extractApiKey(req);
    if (!key) {
      unauthorized(res, 'API key required. Provide via X-Api-Key header or Authorization: Bearer <key>', pathname);
      return;
    }

    // Validate against store
    const record: ApiKeyRecord | null = store.validate(key);
    if (!record) {
      unauthorized(res, 'Invalid or revoked API key', pathname);
      return;
    }

    // Attach auth context to request
    (req as unknown as Record<symbol, ApiKeyAuth>)[AUTH_SYMBOL] = {
      keyId: record.id,
      label: record.label,
    };

    await next();
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractApiKey(req: IncomingMessage): string | undefined {
  // Try X-Api-Key header first
  const xApiKey = firstHeaderValue(req.headers['x-api-key']);
  if (xApiKey) return xApiKey.trim();

  // Fall back to Authorization: Bearer <key>
  const auth = firstHeaderValue(req.headers.authorization);
  if (!auth) return undefined;

  const normalized = auth.trim();
  if (!normalized.toLowerCase().startsWith('bearer ')) return undefined;
  const token = normalized.slice(7).trim();
  return token || undefined;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}
