import { ErrorCodes, SendMessageSchema, TelagentError, type Envelope, type RedactedEnvelope } from '../../protocol/index.js';

import { getGlobalLogger } from '../../logger.js';
import { requireScope } from '../auth.js';
import { Router } from '../router.js';
import { created, ok } from '../response.js';
import { handleError } from '../route-utils.js';
import type { RuntimeContext } from '../types.js';
import { validate } from '../validate.js';

export function messageRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  router.post('/', async ({ req, res, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'send_message');
    } catch (error) {
      handleError(res, error, url.pathname);
      return;
    }

    const parsed = validate(SendMessageSchema, body);
    if (!parsed.success) {
      handleError(res, new TelagentError(ErrorCodes.VALIDATION, parsed.error), url.pathname);
      return;
    }

    try {
      const envelope = await ctx.messageService.send(parsed.data);

      let p2pDelivered: boolean;
      try {
        const result = await ctx.clawnetTransportService.sendEnvelope(parsed.data.targetDid, envelope);
        p2pDelivered = result.delivered;
      } catch (p2pError) {
        getGlobalLogger().warn('[messages] P2P delivery failed for %s: %s', envelope.envelopeId, (p2pError as Error).message);
        p2pDelivered = false;
      }

      created(
        res,
        { envelope, p2pDelivered },
        { self: `/api/v1/messages/pull?conversation_id=${encodeURIComponent(envelope.conversationId)}` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/pull', async ({ res, query, url }) => {
    try {
      const unreadRaw = query.get('unread');
      const unread = unreadRaw === '1' ? true : unreadRaw === '0' ? false : undefined;

      const result = await ctx.messageService.pull({
        cursor: query.get('cursor') ?? undefined,
        limit: query.get('limit') ? Number.parseInt(query.get('limit') ?? '', 10) : undefined,
        conversationId: query.get('conversation_id') ?? undefined,
        unread,
      });

      ok(
        res,
        {
          items: result.items,
          cursor: result.nextCursor,
        },
        { self: '/api/v1/messages/pull' },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/retracted', async ({ res, query, url }) => {
    try {
      const limit = parsePositiveInt(query.get('limit'), 'limit') ?? 50;
      const conversationId = query.get('conversation_id') ?? undefined;
      const all = await ctx.messageService.listRetracted(limit);
      const items = conversationId
        ? all.filter((entry) => entry.conversationId === conversationId)
        : all;

      const selfQuery = new URLSearchParams();
      selfQuery.set('limit', String(limit));
      if (conversationId) {
        selfQuery.set('conversation_id', conversationId);
      }

      ok(
        res,
        {
          items,
        },
        { self: `/api/v1/messages/retracted?${selfQuery.toString()}` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  /** Owner-facing message view — returns envelope metadata with ciphertext redacted. */
  router.get('/view', async ({ req, res, query, url }) => {
    try {
      const result = await ctx.messageService.pull({
        cursor: query.get('cursor') ?? undefined,
        limit: query.get('limit') ? Number.parseInt(query.get('limit') ?? '', 10) : undefined,
        conversationId: query.get('conversation_id') ?? undefined,
      });

      // All session-authenticated callers see redacted envelopes
      const items: RedactedEnvelope[] = result.items.map(redactEnvelope);

      ok(
        res,
        { items, cursor: result.nextCursor },
        { self: '/api/v1/messages/view' },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/read', async ({ req, res, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'send_message');
    } catch (error) {
      handleError(res, error, url.pathname);
      return;
    }

    const envelopeIds = (body as Record<string, unknown>)?.envelopeIds;
    if (!Array.isArray(envelopeIds) || envelopeIds.length === 0 || !envelopeIds.every((id: unknown) => typeof id === 'string')) {
      handleError(res, new TelagentError(ErrorCodes.VALIDATION, 'envelopeIds must be a non-empty array of strings'), url.pathname);
      return;
    }

    try {
      const updated = await ctx.messageService.markAsRead(envelopeIds);
      ok(res, { updated }, { self: '/api/v1/messages/read' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}

function redactEnvelope(env: Envelope): RedactedEnvelope {
  return { ...env, ciphertext: '[redacted]', sealedHeader: '[redacted]' };
}

function parsePositiveInt(raw: string | null, field: string): number | undefined {
  if (!raw || !raw.trim()) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new TelagentError(ErrorCodes.VALIDATION, `${field} must be a positive integer`);
  }
  return value;
}
