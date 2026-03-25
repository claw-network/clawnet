import { ErrorCodes, TelagentError } from '../../protocol/index.js';

import { Router } from '../router.js';
import { created, ok } from '../response.js';
import { handleError } from '../route-utils.js';
import type { RuntimeContext } from '../types.js';

export function keyRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  router.post('/register', ({ body, res, url }) => {
    try {
      const payload = assertRecord(body, 'register payload');
      const did = assertString(payload.did, 'did');
      const suite = parseSuite(payload.suite);
      const keyId = assertString(payload.keyId, 'keyId');
      const publicKey = assertString(payload.publicKey, 'publicKey');
      const expiresAtMs = parseOptionalPositiveNumber(payload.expiresAtMs, 'expiresAtMs');

      const record = ctx.keyLifecycleService.registerKey({
        did,
        suite,
        keyId,
        publicKey,
        expiresAtMs,
      });

      created(
        res,
        record,
        { self: `/api/v1/keys/${encodeURIComponent(did)}?suite=${suite}` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/rotate', ({ body, res, url }) => {
    try {
      const payload = assertRecord(body, 'rotate payload');
      const did = assertString(payload.did, 'did');
      const suite = parseSuite(payload.suite);
      const fromKeyId = assertString(payload.fromKeyId, 'fromKeyId');
      const toKeyId = assertString(payload.toKeyId, 'toKeyId');
      const publicKey = assertString(payload.publicKey, 'publicKey');
      const gracePeriodSec = parseOptionalPositiveInteger(payload.gracePeriodSec, 'gracePeriodSec');

      const result = ctx.keyLifecycleService.rotateKey({
        did,
        suite,
        fromKeyId,
        toKeyId,
        publicKey,
        gracePeriodSec,
      });

      ok(
        res,
        result,
        { self: `/api/v1/keys/${encodeURIComponent(did)}?suite=${suite}` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/revoke', ({ body, res, url }) => {
    try {
      const payload = assertRecord(body, 'revoke payload');
      const did = assertString(payload.did, 'did');
      const suite = parseSuite(payload.suite);
      const keyId = assertString(payload.keyId, 'keyId');
      const reason = assertString(payload.reason, 'reason');

      const result = ctx.keyLifecycleService.revokeKey({
        did,
        suite,
        keyId,
        reason,
      });

      ok(
        res,
        result,
        { self: `/api/v1/keys/${encodeURIComponent(did)}?suite=${suite}` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/recover', ({ body, res, url }) => {
    try {
      const payload = assertRecord(body, 'recover payload');
      const did = assertString(payload.did, 'did');
      const suite = parseSuite(payload.suite);
      const revokedKeyId = assertString(payload.revokedKeyId, 'revokedKeyId');
      const recoveredKeyId = assertString(payload.recoveredKeyId, 'recoveredKeyId');
      const publicKey = assertString(payload.publicKey, 'publicKey');

      const result = ctx.keyLifecycleService.recoverKey({
        did,
        suite,
        revokedKeyId,
        recoveredKeyId,
        publicKey,
      });

      ok(
        res,
        result,
        { self: `/api/v1/keys/${encodeURIComponent(did)}?suite=${suite}` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/:did', ({ params, query, res, url }) => {
    try {
      const did = decodeURIComponent(params.did);
      const suite = parseOptionalSuite(query.get('suite'));
      const records = ctx.keyLifecycleService.listKeys(did, suite);
      ok(res, records, { self: `/api/v1/keys/${encodeURIComponent(did)}${suite ? `?suite=${suite}` : ''}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}

function assertRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TelagentError(ErrorCodes.VALIDATION, `${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TelagentError(ErrorCodes.VALIDATION, `${name} is required`);
  }
  return value.trim();
}

function parseSuite(value: unknown): 'signal' | 'mls' {
  if (value === 'signal' || value === 'mls') {
    return value;
  }
  throw new TelagentError(ErrorCodes.VALIDATION, 'suite must be signal or mls');
}

function parseOptionalSuite(value: string | null): 'signal' | 'mls' | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }
  return parseSuite(value.trim());
}

function parseOptionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TelagentError(ErrorCodes.VALIDATION, `${name} must be a positive integer`);
  }
  return value;
}

function parseOptionalPositiveNumber(value: unknown, name: string): number | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TelagentError(ErrorCodes.VALIDATION, `${name} must be a positive number`);
  }
  return value;
}
