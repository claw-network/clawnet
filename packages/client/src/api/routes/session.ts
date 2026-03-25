import { timingSafeEqual } from 'node:crypto';

import { ErrorCodes, TelagentError } from '../../protocol/index.js';

import { Router } from '../router.js';
import { noContent, ok } from '../response.js';
import { handleError } from '../route-utils.js';
import { UnlockRateLimiter } from '../unlock-rate-limiter.js';
import type { RuntimeContext } from '../types.js';

const rateLimiter = new UnlockRateLimiter();

function getClientIp(req: import('node:http').IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '0.0.0.0';
}

export function sessionRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  router.post('/unlock', async ({ req, res, body, url }) => {
    const ip = getClientIp(req);

    // Rate limit check
    const check = rateLimiter.check(ip);
    if (!check.allowed) {
      res.setHeader('Retry-After', String(check.retryAfterSec));
      handleError(
        res,
        new TelagentError(ErrorCodes.TOO_MANY_REQUESTS, `Too many failed attempts. Retry after ${check.retryAfterSec}s.`),
        url.pathname,
      );
      return;
    }

    try {
      const payload = (body ?? {}) as {
        passphrase?: unknown;
        ttlSeconds?: unknown;
        scope?: unknown;
        maxOperations?: unknown;
      };

      if (typeof payload.passphrase !== 'string' || !payload.passphrase.trim()) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'passphrase is required');
      }

      const selfDid = ctx.identityService.getSelfDid();
      const result = await ctx.sessionManager.unlock({
        passphrase: payload.passphrase,
        did: selfDid,
        ttlSeconds: typeof payload.ttlSeconds === 'number' ? payload.ttlSeconds : undefined,
        scope: Array.isArray(payload.scope)
          ? payload.scope.filter((item): item is 'transfer' | 'escrow' | 'market' | 'contract' | 'reputation' | 'identity' =>
            item === 'transfer'
            || item === 'escrow'
            || item === 'market'
            || item === 'contract'
            || item === 'reputation'
            || item === 'identity')
          : undefined,
        maxOperations: typeof payload.maxOperations === 'number' ? payload.maxOperations : undefined,
        validatePassphrase: async (_did, passphrase) => {
          const expected = ctx.configuredPassphrase;
          if (!expected) return false;
          if (expected.length !== passphrase.length) return false;
          const a = Buffer.from(expected, 'utf8');
          const b = Buffer.from(passphrase, 'utf8');
          return timingSafeEqual(a, b);
        },
      });

      rateLimiter.recordSuccess(ip);

      const permissions = ctx.ownerPermissionService?.getPermissions() ?? {
        mode: 'observer' as const,
        interventionScopes: [],
        privateConversations: [],
      };

      ok(
        res,
        {
          sessionToken: result.sessionToken,
          expiresAt: result.expiresAt.toISOString(),
          scope: result.scope,
          did: selfDid,
          permissions: {
            mode: permissions.mode,
            interventionScopes: permissions.interventionScopes,
          },
        },
        { self: '/api/v1/session' },
      );
    } catch (error) {
      // Record failure for brute-force protection (only for auth errors, not validation)
      if (error instanceof Error && error.message === 'Invalid passphrase') {
        rateLimiter.recordFailure(ip);
      }
      handleError(res, error, url.pathname);
    }
  });

  router.post('/lock', ({ req, res, url }) => {
    try {
      const token = extractBearerToken(req.headers);
      if (!token) {
        throw new TelagentError(ErrorCodes.UNAUTHORIZED, 'Missing Authorization header');
      }
      ctx.sessionManager.lock(token);
      noContent(res);
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/', ({ req, res, url }) => {
    try {
      const token = extractBearerToken(req.headers);
      if (!token) {
        throw new TelagentError(ErrorCodes.UNAUTHORIZED, 'Missing Authorization header');
      }

      const info = ctx.sessionManager.getSessionInfo(token);
      if (!info) {
        throw new TelagentError(ErrorCodes.NOT_FOUND, 'Session not found or expired');
      }

      ok(
        res,
        {
          active: info.active,
          expiresAt: info.expiresAt.toISOString(),
          scope: info.scope,
          operationsUsed: info.operationsUsed,
          createdAt: info.createdAt.toISOString(),
        },
        { self: '/api/v1/session' },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}

function extractBearerToken(headers: Record<string, string | string[] | undefined>): string | null {
  const authHeader = headers.authorization;
  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!auth?.startsWith('Bearer ')) {
    return null;
  }
  return auth.slice(7);
}
