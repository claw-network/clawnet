import { ErrorCodes, TelagentError } from '../../protocol/index.js';

import { Router } from '../router.js';
import { handleError } from '../route-utils.js';
import { ok, created, noContent, paginated, parsePagination } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { pushOwnProfileCard } from '../../utils/push-profile-card.js';

export function conversationRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  router.get('/', async ({ res, query, url }) => {
    try {
      const { page, perPage, offset } = parsePagination(query);
      const sort = (query.get('sort') ?? 'last_message').trim() || 'last_message';
      const all = await ctx.messageService.listConversations();
      const normalized = all.map((item) => ({ ...item }));

      normalized.sort((left, right) => (right.lastMessageAtMs ?? 0) - (left.lastMessageAtMs ?? 0));

      const data = normalized.slice(offset, offset + perPage);
      const queryHints = sort !== 'last_message'
        ? { sort }
        : undefined;

      paginated(res, data, {
        page,
        perPage,
        total: normalized.length,
        basePath: '/api/v1/conversations',
        query: queryHints,
      });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.put('/:conversationId/privacy', async ({ req, res, params, body, url }) => {
    try {
      // Auth handled by global middleware; any valid session may adjust privacy.
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'body must be an object');
      }

      const privateValue = (body as Record<string, unknown>).private;
      if (typeof privateValue !== 'boolean') {
        throw new TelagentError(ErrorCodes.VALIDATION, 'private must be a boolean');
      }

      const result = await ctx.messageService.setConversationPrivacy(
        params.conversationId,
        privateValue,
      );
      ok(
        res,
        result,
        {
          self: `/api/v1/conversations/${encodeURIComponent(params.conversationId)}/privacy`,
        },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/', async ({ res, body, url }) => {
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'body must be an object');
      }
      const payload = body as Record<string, unknown>;

      const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId.trim() : '';
      if (!conversationId) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'conversationId is required');
      }

      const conversationType = payload.conversationType === 'group' ? 'group' as const : 'direct' as const;
      const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
      if (!displayName) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'displayName is required');
      }

      const result = await ctx.messageService.createConversation({
        conversationId,
        conversationType,
        peerDid: typeof payload.peerDid === 'string' ? payload.peerDid : undefined,
        groupId: typeof payload.groupId === 'string' ? payload.groupId : undefined,
        displayName,
      });

      // Fire-and-forget: push our profile card to the peer for direct conversations
      if (conversationType === 'direct' && typeof payload.peerDid === 'string') {
        void pushOwnProfileCard(ctx, payload.peerDid).catch(() => {});
      }

      created(res, result, {
        self: `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
      });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.delete('/:conversationId', async ({ res, params, url }) => {
    try {
      await ctx.messageService.deleteConversation(params.conversationId);
      noContent(res);
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}
