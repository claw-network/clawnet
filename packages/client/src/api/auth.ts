import { ErrorCodes, TelagentError, type InterventionScope } from '../protocol/index.js';

import type { RuntimeContext } from './types.js';

/**
 * Extract the raw bearer token from request headers.
 * Returns null if no valid Bearer token is present.
 */
export function extractBearerToken(headers: Record<string, string | string[] | undefined>): string | null {
  const authHeader = headers.authorization;
  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!auth || typeof auth !== 'string') {
    return null;
  }
  const normalized = auth.trim();
  if (!normalized.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = normalized.slice(7).trim();
  return token || null;
}

/**
 * Require a valid session token (tses_*) on the request.
 * Throws 401 if missing or invalid/expired.
 */
export function requireSession(
  headers: Record<string, string | string[] | undefined>,
  ctx: RuntimeContext,
): string {
  const token = extractBearerToken(headers);
  if (!token) {
    throw new TelagentError(ErrorCodes.UNAUTHORIZED, 'Missing Authorization header');
  }
  if (!token.startsWith('tses_')) {
    throw new TelagentError(ErrorCodes.UNAUTHORIZED, 'Invalid token format. Expected session token (tses_*).');
  }
  const info = ctx.sessionManager.getSessionInfo(token);
  if (!info || !info.active) {
    throw new TelagentError(ErrorCodes.UNAUTHORIZED, 'Session expired or invalid. Please unlock again.');
  }
  return token;
}

/**
 * Guard for write operations that require a specific intervention scope.
 *
 * Validates the session token AND checks OwnerPermissionService to enforce
 * observer/intervener mode and scope restrictions.
 */
export function requireScope(
  headers: Record<string, string | string[] | undefined>,
  ctx: RuntimeContext,
  requiredScope: InterventionScope,
): void {
  requireSession(headers, ctx);

  const permissions = ctx.ownerPermissionService;
  if (!permissions) {
    return; // no permission service = no scope restriction
  }

  if (!permissions.canIntervene(requiredScope)) {
    throw new TelagentError(
      ErrorCodes.FORBIDDEN,
      `Operation '${requiredScope}' not allowed. Current mode: ${permissions.getPermissions().mode}`,
    );
  }
}
