import type { ServerResponse } from 'node:http';

import { ErrorCodes, TelagentError } from '../../protocol/index.js';

import { requireSession } from '../auth.js';
import { Router } from '../router.js';
import { handleError } from '../route-utils.js';
import { ok } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { resolvePeerAvatarUrl, localPeerAvatarUrl, isSelfOrigin } from '../../utils/avatar-url.js';
import { pushOwnProfileCard } from '../../utils/push-profile-card.js';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB binary

function sendBinary(res: ServerResponse, status: number, data: Buffer, mimeType: string): void {
  res.writeHead(status, {
    'Content-Type': mimeType,
    'Content-Length': String(data.length),
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(data);
}

export function profileRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  // ── GET /  (public — no auth) ─────────────────────────────────────────────
  router.get('/', async ({ res, url }) => {
    try {
      const profile = await ctx.selfProfileStore.loadPublic();
      ok(res, profile, { self: '/api/v1/profile' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // ── PUT /  (requires session) ─────────────────────────────────────────────
  router.put('/', async ({ req, res, body, url }) => {
    try {
      requireSession(req.headers as Record<string, string | string[] | undefined>, ctx);

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'body must be an object');
      }
      const payload = body as Record<string, unknown>;

      const update: Record<string, string | null | undefined> = {};

      if ('nickname' in payload) {
        const nickname = payload.nickname;
        if (nickname !== null && nickname !== undefined && typeof nickname !== 'string') {
          throw new TelagentError(ErrorCodes.VALIDATION, 'nickname must be a string or null');
        }
        const trimmed = typeof nickname === 'string' ? nickname.trim() : undefined;
        if (trimmed !== undefined && trimmed.length > 64) {
          throw new TelagentError(ErrorCodes.VALIDATION, 'nickname must not exceed 64 characters');
        }
        update.nickname = trimmed || undefined;
      }

      if ('avatarUrl' in payload) {
        const avatarUrl = payload.avatarUrl;
        if (avatarUrl !== null && avatarUrl !== undefined && typeof avatarUrl !== 'string') {
          throw new TelagentError(ErrorCodes.VALIDATION, 'avatarUrl must be a string or null');
        }
        if (typeof avatarUrl === 'string' && avatarUrl.length > 2048) {
          throw new TelagentError(ErrorCodes.VALIDATION, 'avatarUrl must not exceed 2048 characters');
        }
        update.avatarUrl = typeof avatarUrl === 'string' ? avatarUrl.trim() || undefined : undefined;
      }

      const current = await ctx.selfProfileStore.save(update);
      // Strip internal fields before responding
      const { avatarMimeType: _stripped, ...publicProfile } = current as typeof current & { avatarMimeType?: unknown };
      ok(res, publicProfile, { self: '/api/v1/profile' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // ── POST /avatar  (requires session) ─────────────────────────────────────
  router.post('/avatar', async ({ req, res, body, url }) => {
    try {
      requireSession(req.headers as Record<string, string | string[] | undefined>, ctx);

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'body must be an object');
      }
      const payload = body as Record<string, unknown>;

      const rawData = payload.data;
      if (typeof rawData !== 'string' || !rawData) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'data (base64 string) is required');
      }

      const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType.trim().toLowerCase() : 'image/jpeg';
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        throw new TelagentError(
          ErrorCodes.VALIDATION,
          `mimeType must be one of: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
        );
      }

      let binary: Buffer;
      try {
        binary = Buffer.from(rawData, 'base64');
      } catch {
        throw new TelagentError(ErrorCodes.VALIDATION, 'data is not valid base64');
      }

      if (binary.length > MAX_AVATAR_BYTES) {
        throw new TelagentError(
          ErrorCodes.VALIDATION,
          `Avatar must not exceed ${MAX_AVATAR_BYTES / 1024 / 1024} MB`,
        );
      }
      if (binary.length === 0) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'Avatar data must not be empty');
      }

      await ctx.selfProfileStore.saveAvatar(binary, mimeType);
      ok(res, { avatarUrl: '/api/v1/profile/avatar' }, { self: '/api/v1/profile/avatar' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // ── GET /avatar  (public — no auth) ──────────────────────────────────────
  router.get('/avatar', async ({ res, url }) => {
    try {
      const avatar = await ctx.selfProfileStore.loadAvatar();
      if (!avatar) {
        throw new TelagentError(ErrorCodes.NOT_FOUND, 'No avatar uploaded');
      }
      sendBinary(res, 200, avatar.data, avatar.mimeType);
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // ── GET /:did/avatar  (public — proxies peer avatar via local node) ────────
  // 1. Local cache → 2. Direct HTTP → 3. P2P relay → 404
  router.get('/:did/avatar', async ({ res, params, url }) => {
    try {
      const { did } = params;
      if (!did) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'did is required');
      }
      const profile = ctx.peerProfileRepository.get(did);
      if (!profile?.avatarUrl) {
        throw new TelagentError(ErrorCodes.NOT_FOUND, `No avatar for did: ${did}`);
      }

      // 1. Try local cache.
      const cached = ctx.peerProfileRepository.loadAvatar(did);
      if (cached) {
        sendBinary(res, 200, cached.data, cached.mimeType);
        return;
      }

      // 2. Try direct HTTP to the peer's node.
      //    Skip when the stored URL points to our own API (common when the peer
      //    advertised 127.0.0.1 because TELAGENT_PUBLIC_URL was not configured).
      const remoteUrl = resolvePeerAvatarUrl(profile.avatarUrl, profile.nodeUrl);
      if (remoteUrl && !remoteUrl.startsWith('/') && !isSelfOrigin(remoteUrl, ctx.config)) {
        try {
          const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(5000) });
          if (response.ok) {
            const contentType = response.headers.get('content-type') ?? 'image/jpeg';
            const data = Buffer.from(await response.arrayBuffer());
            try { ctx.peerProfileRepository.saveAvatar(did, data, contentType); } catch { /* best-effort */ }
            sendBinary(res, 200, data, contentType);
            return;
          }
        } catch {
          // Direct HTTP failed — fall through to P2P relay.
        }
      }

      // 3. P2P relay: request avatar binary through ClawNet.
      if (ctx.apiProxyService) {
        try {
          const proxyRes = await ctx.apiProxyService.proxyRequest(
            did, 'GET', '/api/v1/profile/avatar',
            { accept: 'image/*' },
          );
          if (proxyRes.status === 200 && proxyRes.bodyBytes) {
            const mimeType = proxyRes.headers['content-type'] ?? 'image/jpeg';
            const data = Buffer.from(proxyRes.bodyBytes);
            try { ctx.peerProfileRepository.saveAvatar(did, data, mimeType); } catch { /* best-effort */ }
            sendBinary(res, 200, data, mimeType);
            return;
          }
        } catch {
          // P2P relay also failed — fall through to 404.
        }
      }

      throw new TelagentError(ErrorCodes.NOT_FOUND, `Avatar unavailable for did: ${did}`);
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // ── GET /:did  (public — no auth, returns cached peer profile) ────────────
  // On cache miss, fires a profile-card request via P2P so the next query will
  // hit the cache once the peer replies.
  router.get('/:did', async ({ res, params, url }) => {
    try {
      const { did } = params;
      if (!did) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'did is required');
      }
      const profile = ctx.peerProfileRepository.get(did);
      if (!profile) {
        // Fire-and-forget: send our own profile card so the peer replies with
        // theirs (reciprocal exchange).  Return 200 with null data instead of
        // 404 so the browser console stays clean — the SDK treats null as
        // "not yet available".
        void pushOwnProfileCard(ctx, did).catch((err: Error) =>
          console.warn('[profile-card] Failed to push profile card to %s: %s', did, err.message),
        );
        ok(res, null, { self: `/api/v1/profile/${encodeURIComponent(did)}` });
        return;
      }
      const normalizedProfile = {
        ...profile,
        avatarUrl: localPeerAvatarUrl(did, profile.avatarUrl),
      };
      ok(res, normalizedProfile, { self: `/api/v1/profile/${encodeURIComponent(did)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}
