import { Router } from '../router.js';
import { handleError } from '../route-utils.js';
import { ok } from '../response.js';
import type { RuntimeContext } from '../types.js';

export function ownerRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  router.get('/permissions', async ({ res, url }) => {
    try {
      const permissions = ctx.ownerPermissionService?.getPermissions() ?? {
        mode: 'observer' as const,
        interventionScopes: [],
        privateConversations: [],
      };
      const persistedPrivate = await ctx.messageService.listPrivateConversationIds();
      const privateConversations = new Set([
        ...permissions.privateConversations,
        ...persistedPrivate,
      ]);
      ok(
        res,
        {
          ...permissions,
          privateConversations: [...privateConversations].sort((left, right) => left.localeCompare(right)),
        },
        { self: '/api/v1/owner/permissions' },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}
