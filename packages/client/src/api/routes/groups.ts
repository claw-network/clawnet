import {
  AcceptInviteSchema,
  CreateGroupSchema,
  ErrorCodes,
  InviteMemberSchema,
  RemoveMemberSchema,
  TelagentError,
  type MembershipState,
} from '../../protocol/index.js';

import { requireScope } from '../auth.js';
import { Router } from '../router.js';
import { created, noContent, ok, paginated, parsePagination } from '../response.js';
import { handleError } from '../route-utils.js';
import type { RuntimeContext } from '../types.js';
import { validate } from '../validate.js';

export function groupRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  router.post('/', async ({ req, res, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'manage_groups');
    } catch (error) {
      handleError(res, error, url.pathname);
      return;
    }

    const parsed = validate(CreateGroupSchema, body);
    if (!parsed.success) {
      handleError(res, new TelagentError(ErrorCodes.VALIDATION, parsed.error), url.pathname);
      return;
    }

    try {
      const result = await ctx.groupService.createGroup(parsed.data);
      created(
        res,
        {
          txHash: result.txHash,
          group: result.group,
        },
        { self: `/api/v1/groups/${result.group.groupId}` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/:groupId', async ({ res, params, url }) => {
    try {
      const group = ctx.groupService.getGroup(params.groupId);
      ok(res, group, { self: `/api/v1/groups/${params.groupId}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/:groupId/members', async ({ res, params, query, url }) => {
    try {
      const view = (query.get('view') ?? 'all').toLowerCase();
      const { page, perPage, offset } = parsePagination(query);

      let state: MembershipState | undefined;
      if (view === 'pending') state = 'PENDING';
      if (view === 'finalized') state = 'FINALIZED';

      const allMembers = ctx.groupService.listMembers(params.groupId, state);
      const members = allMembers.slice(offset, offset + perPage);

      paginated(res, members, {
        page,
        perPage,
        total: allMembers.length,
        basePath: `/api/v1/groups/${params.groupId}/members`,
        query: { view },
      });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/:groupId/invites', async ({ req, res, body, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'manage_groups');
    } catch (error) {
      handleError(res, error, url.pathname);
      return;
    }

    const parsed = validate(InviteMemberSchema, body);
    if (!parsed.success) {
      handleError(res, new TelagentError(ErrorCodes.VALIDATION, parsed.error), url.pathname);
      return;
    }

    try {
      const result = await ctx.groupService.inviteMember({
        ...parsed.data,
        groupId: params.groupId,
      });
      created(
        res,
        {
          txHash: result.txHash,
          inviteId: parsed.data.inviteId,
          groupId: params.groupId,
        },
        { self: `/api/v1/groups/${params.groupId}/invites/${parsed.data.inviteId}` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/:groupId/invites/:inviteId/accept', async ({ req, res, body, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'manage_groups');
    } catch (error) {
      handleError(res, error, url.pathname);
      return;
    }

    const parsed = validate(AcceptInviteSchema, body);
    if (!parsed.success) {
      handleError(res, new TelagentError(ErrorCodes.VALIDATION, parsed.error), url.pathname);
      return;
    }

    try {
      const result = await ctx.groupService.acceptInvite({
        ...parsed.data,
        groupId: params.groupId,
        inviteId: params.inviteId,
      });
      created(
        res,
        {
          txHash: result.txHash,
          groupId: params.groupId,
          inviteId: params.inviteId,
        },
        { self: `/api/v1/groups/${params.groupId}/members` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.delete('/:groupId/members/:memberDid', async ({ req, res, body, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'manage_groups');
    } catch (error) {
      handleError(res, error, url.pathname);
      return;
    }

    const parsed = validate(RemoveMemberSchema, {
      ...(typeof body === 'object' && body ? body : {}),
      memberDid: params.memberDid,
    });
    if (!parsed.success) {
      handleError(res, new TelagentError(ErrorCodes.VALIDATION, parsed.error), url.pathname);
      return;
    }

    try {
      await ctx.groupService.removeMember({
        groupId: params.groupId,
        operatorDid: parsed.data.operatorDid,
        memberDid: params.memberDid,
        mlsCommitHash: parsed.data.mlsCommitHash,
      });
      noContent(res);
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/:groupId/chain-state', async ({ res, params, url }) => {
    try {
      const state = ctx.groupService.getChainState(params.groupId);
      ok(res, state, { self: `/api/v1/groups/${params.groupId}/chain-state` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}
