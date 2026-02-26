/**
 * Admin routes — /api/v1/admin
 *
 * API key management endpoints. These routes are only accessible
 * from localhost (127.0.0.1 / ::1) for security — they never pass
 * through the Caddy reverse proxy.
 */

import { Router } from '../router.js';
import { ok, badRequest, notFound, forbidden } from '../response.js';
import { validate } from '../schemas/common.js';
import { z } from 'zod';
import type { RuntimeContext } from '../types.js';
import type { IncomingMessage } from 'node:http';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateKeySchema = z.object({
  label: z.string().min(1).max(128),
});

const RevokeKeySchema = z.object({
  id: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLocalhost(req: IncomingMessage): boolean {
  const remoteAddress = req.socket.remoteAddress ?? '';
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function adminRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST /api-keys — create new API key ───────────────────────
  r.post('/api-keys', async (req, res, route) => {
    if (!isLocalhost(req)) {
      forbidden(res, 'Admin API is only accessible from localhost', route.url.pathname);
      return;
    }

    const store = ctx.apiKeyStore;
    if (!store) {
      badRequest(res, 'API key management not enabled', route.url.pathname);
      return;
    }

    const v = validate(CreateKeySchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }

    const record = store.create(v.data.label);
    // Return full key only on creation (not visible again)
    ok(res, {
      id: record.id,
      key: record.key,
      label: record.label,
      status: record.status,
      createdAt: record.createdAt,
    }, { self: '/api/v1/admin/api-keys' });
  });

  // ── GET /api-keys — list all keys (truncated) ────────────────
  r.get('/api-keys', async (req, res, route) => {
    if (!isLocalhost(req)) {
      forbidden(res, 'Admin API is only accessible from localhost', route.url.pathname);
      return;
    }

    const store = ctx.apiKeyStore;
    if (!store) {
      badRequest(res, 'API key management not enabled', route.url.pathname);
      return;
    }

    const includeRevoked = route.query.get('includeRevoked') === 'true';
    const keys = store.list(includeRevoked);
    ok(res, keys, { self: '/api/v1/admin/api-keys' });
  });

  // ── POST /api-keys/:id/revoke — revoke a key ─────────────────
  r.post('/api-keys/:id/revoke', async (req, res, route) => {
    if (!isLocalhost(req)) {
      forbidden(res, 'Admin API is only accessible from localhost', route.url.pathname);
      return;
    }

    const store = ctx.apiKeyStore;
    if (!store) {
      badRequest(res, 'API key management not enabled', route.url.pathname);
      return;
    }

    const id = Number(route.params.id);
    if (Number.isNaN(id) || id <= 0) {
      badRequest(res, 'Invalid key ID', route.url.pathname);
      return;
    }

    const revoked = store.revoke(id);
    if (!revoked) {
      notFound(res, `Key #${id} not found or already revoked`);
      return;
    }

    ok(res, { id, status: 'revoked' }, { self: `/api/v1/admin/api-keys/${id}` });
  });

  // ── DELETE /api-keys/:id — permanently delete a key ───────────
  r.delete('/api-keys/:id', async (req, res, route) => {
    if (!isLocalhost(req)) {
      forbidden(res, 'Admin API is only accessible from localhost', route.url.pathname);
      return;
    }

    const store = ctx.apiKeyStore;
    if (!store) {
      badRequest(res, 'API key management not enabled', route.url.pathname);
      return;
    }

    const id = Number(route.params.id);
    if (Number.isNaN(id) || id <= 0) {
      badRequest(res, 'Invalid key ID', route.url.pathname);
      return;
    }

    const deleted = store.delete(id);
    if (!deleted) {
      notFound(res, `Key #${id} not found`);
      return;
    }

    ok(res, { id, status: 'deleted' }, { self: `/api/v1/admin/api-keys/${id}` });
  });

  return r;
}
