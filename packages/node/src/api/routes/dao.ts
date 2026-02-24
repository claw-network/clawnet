/**
 * DAO governance routes �?/api/v1/dao
 */

import { Router } from '../router.js';
import {
  ok,
  created,
  badRequest,
  notFound,
  internalError,
  paginated,
  parsePagination,
} from '../response.js';
import { validate } from '../schemas/common.js';
import {
  DaoProposalCreateSchema,
  DaoProposalAdvanceSchema,
  DaoVoteCastSchema,
  DaoDelegateSetSchema,
  DaoDelegateRevokeSchema,
  DaoTimelockExecuteSchema,
  DaoTimelockCancelSchema,
  DaoTreasuryDepositSchema,
} from '../schemas/dao.js';
import type { RuntimeContext } from '../types.js';
import { resolvePrivateKey } from '../types.js';
import {
  createDaoProposalCreateEnvelope,
  createDaoProposalAdvanceEnvelope,
  createDaoVoteCastEnvelope,
  createDaoDelegateSetEnvelope,
  createDaoDelegateRevokeEnvelope,
  createDaoTimelockExecuteEnvelope,
  createDaoTimelockCancelEnvelope,
  createDaoTreasuryDepositEnvelope,
  type ProposalAction,
  type DelegationScope,
} from '@claw-network/protocol';

export function daoRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ══════════════════════════════════════════════════════════════�?  //  Proposals
  // ══════════════════════════════════════════════════════════════�?
  // ── POST /proposals �?create proposal ─────────────────────────
  r.post('/proposals', async (_req, res, route) => {
    const v = validate(DaoProposalCreateSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;
    const proposalId =
      body.proposalId ?? `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (ctx.daoService) {
      try {
        const result = await ctx.daoService.propose(
          body.type,
          body.description,
          (body.actions?.[0]?.target as string) ?? '',
          (body.actions?.[0]?.callData as string) ?? '',
        );
        created(
          res,
          { proposalId, txHash: result.txHash ?? result, status: 'created' },
          { self: `/api/v1/dao/proposals/${proposalId}` },
        );
        return;
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }
    try {
      const envelope = await createDaoProposalCreateEnvelope({
        issuer: body.did,
        privateKey,
        proposalId,
        proposalType: body.type,
        title: body.title,
        description: body.description,
        discussionUrl: body.discussionUrl,
        actions: (body.actions ?? []) as unknown as ProposalAction[],
        discussionPeriod: body.discussionPeriod ?? 0,
        votingPeriod: body.votingPeriod ?? 0,
        timelockDelay: body.timelockDelay ?? 0,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      created(
        res,
        { proposalId, txHash: hash, status: 'broadcast' },
        { self: `/api/v1/dao/proposals/${proposalId}` },
      );
    } catch (err) {
      internalError(res, (err as Error).message || 'Proposal creation failed');
    }
  });

  // ── GET /proposals �?list proposals ───────────────────────────
  r.get('/proposals', async (_req, res, route) => {
    const { page, perPage, offset } = parsePagination(route.query);
    const status = route.query.get('status');

    if (ctx.daoService) {
      try {
        const statusNum = status != null ? Number(status) : undefined;
        const result = await ctx.daoService.listProposals({
          status: statusNum,
          limit: perPage,
          offset,
        });
        paginated(res, result.proposals ?? [], {
          page,
          perPage,
          total: result.total ?? 0,
          basePath: '/api/v1/dao/proposals',
        });
        return;
      } catch {
        /* fallthrough */
      }
    }

    if (ctx.daoStore) {
      try {
        const proposals = await ctx.daoStore.listProposals(status as never);
        paginated(res, proposals ?? [], {
          page,
          perPage,
          total: proposals.length,
          basePath: '/api/v1/dao/proposals',
        });
        return;
      } catch {
        /* fallthrough */
      }
    }

    paginated(res, [], { page, perPage, total: 0, basePath: '/api/v1/dao/proposals' });
  });

  // ── GET /proposals/:id �?single proposal ──────────────────────
  r.get('/proposals/:id', async (_req, res, route) => {
    const { id } = route.params;

    if (ctx.daoService) {
      try {
        const result = await ctx.daoService.getProposal(Number(id));
        if (result) {
          ok(res, result, { self: `/api/v1/dao/proposals/${id}` });
          return;
        }
      } catch {
        /* fallthrough */
      }
    }

    if (ctx.daoStore) {
      try {
        const proposal = await ctx.daoStore.getProposal(id);
        if (proposal) {
          ok(res, proposal, { self: `/api/v1/dao/proposals/${id}` });
          return;
        }
      } catch {
        /* fallthrough */
      }
    }

    notFound(res, `Proposal ${id} not found`);
  });

  // ── POST /proposals/:id/actions/advance ───────────────────────
  r.post('/proposals/:id/actions/advance', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(DaoProposalAdvanceSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    if (ctx.daoService) {
      try {
        const result = await ctx.daoService.advanceProposal(Number(id) || 0, body.newStatus);
        ok(res, result, { self: `/api/v1/dao/proposals/${id}` });
        return;
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }
    try {
      const envelope = await createDaoProposalAdvanceEnvelope({
        issuer: body.did,
        privateKey,
        proposalId: body.proposalId ?? id,
        newStatus: body.newStatus,
        resourcePrev: body.resourcePrev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { txHash: hash, proposalId: id, newStatus: body.newStatus, status: 'broadcast' },
        { self: `/api/v1/dao/proposals/${id}` },
      );
    } catch (err) {
      internalError(res, (err as Error).message || 'Proposal advance failed');
    }
  });

  // ══════════════════════════════════════════════════════════════�?  //  Votes
  // ══════════════════════════════════════════════════════════════�?
  // ── GET /proposals/:id/votes ──────────────────────────────────
  r.get('/proposals/:id/votes', async (_req, res, route) => {
    const { id } = route.params;

    if (ctx.daoService) {
      try {
        const result = await ctx.daoService.listVotes({ proposalId: Number(id) || 0 });
        ok(res, result, { self: `/api/v1/dao/proposals/${id}/votes` });
        return;
      } catch {
        /* fallthrough */
      }
    }

    if (ctx.daoStore) {
      try {
        const votes = await ctx.daoStore.getVotes(id);
        ok(res, votes ?? [], { self: `/api/v1/dao/proposals/${id}/votes` });
        return;
      } catch {
        /* fallthrough */
      }
    }

    ok(res, [], { self: `/api/v1/dao/proposals/${id}/votes` });
  });

  // ── POST /proposals/:id/votes �?cast vote ─────────────────────
  r.post('/proposals/:id/votes', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(DaoVoteCastSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    if (ctx.daoService) {
      try {
        const optionStr =
          body.option === 'for' ? 'for' : body.option === 'against' ? 'against' : 'abstain';
        const result = await ctx.daoService.vote(Number(id) || 0, optionStr);
        ok(
          res,
          {
            txHash: (result as unknown as Record<string, unknown>).txHash ?? result,
            proposalId: id,
            option: body.option,
            status: 'confirmed',
          },
          { self: `/api/v1/dao/proposals/${id}/votes` },
        );
        return;
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }
    try {
      const envelope = await createDaoVoteCastEnvelope({
        issuer: body.did,
        privateKey,
        proposalId: body.proposalId ?? id,
        option: body.option,
        power: String(body.power),
        reason: body.reason,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { txHash: hash, proposalId: id, option: body.option, status: 'broadcast' },
        { self: `/api/v1/dao/proposals/${id}/votes` },
      );
    } catch (err) {
      internalError(res, (err as Error).message || 'Vote cast failed');
    }
  });

  // ══════════════════════════════════════════════════════════════�?  //  Delegations
  // ══════════════════════════════════════════════════════════════�?
  // ── GET /delegations �?list delegations ───────────────────────
  r.get('/delegations', async (_req, res, route) => {
    const did = route.query.get('did');

    if (ctx.daoStore) {
      try {
        const delegations = did ? await ctx.daoStore.getDelegationsFrom(did) : [];
        ok(res, delegations ?? [], { self: '/api/v1/dao/delegations' });
        return;
      } catch {
        /* fallthrough */
      }
    }

    ok(res, [], { self: '/api/v1/dao/delegations' });
  });

  // ── POST /delegations �?set delegate ──────────────────────────
  r.post('/delegations', async (_req, res, route) => {
    const v = validate(DaoDelegateSetSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }
    try {
      const envelope = await createDaoDelegateSetEnvelope({
        issuer: body.did,
        privateKey,
        delegate: body.delegate,
        scope: (body.scope ?? { all: true }) as DelegationScope,
        percentage: body.percentage ?? 100,
        expiresAt: body.expiresAt,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      created(
        res,
        { txHash: hash, delegate: body.delegate, status: 'broadcast' },
        { self: '/api/v1/dao/delegations' },
      );
    } catch (err) {
      internalError(res, (err as Error).message || 'Delegate set failed');
    }
  });

  // ── DELETE /delegations/:delegate �?revoke delegation ─────────
  r.delete('/delegations/:delegate', async (_req, res, route) => {
    const { delegate } = route.params;
    const v = validate(DaoDelegateRevokeSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }
    try {
      const envelope = await createDaoDelegateRevokeEnvelope({
        issuer: body.did,
        privateKey,
        delegate: body.delegate ?? delegate,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { txHash: hash, delegate, status: 'revoked' }, { self: '/api/v1/dao/delegations' });
    } catch (err) {
      internalError(res, (err as Error).message || 'Delegate revoke failed');
    }
  });

  // ── POST /delegations/:delegate �?compatibility alias ─────────
  r.post('/delegations/:delegate', async (_req, res, route) => {
    const { delegate } = route.params;
    const v = validate(DaoDelegateRevokeSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }
    try {
      const envelope = await createDaoDelegateRevokeEnvelope({
        issuer: body.did,
        privateKey,
        delegate: body.delegate ?? delegate,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { txHash: hash, delegate, status: 'revoked' }, { self: '/api/v1/dao/delegations' });
    } catch (err) {
      internalError(res, (err as Error).message || 'Delegate revoke failed');
    }
  });

  // ══════════════════════════════════════════════════════════════�?  //  Treasury
  // ══════════════════════════════════════════════════════════════�?
  // ── GET /treasury �?treasury balance ──────────────────────────
  r.get('/treasury', async (_req, res) => {
    if (ctx.daoService) {
      try {
        const result = await ctx.daoService.getTreasuryBalance?.();
        ok(res, result ?? { balance: 0 }, { self: '/api/v1/dao/treasury' });
        return;
      } catch {
        /* fallthrough */
      }
    }

    if (ctx.daoStore) {
      try {
        const treasury = await ctx.daoStore.getTreasury?.();
        ok(res, treasury ?? { balance: 0 }, { self: '/api/v1/dao/treasury' });
        return;
      } catch {
        /* fallthrough */
      }
    }

    ok(res, { balance: 0 }, { self: '/api/v1/dao/treasury' });
  });

  // ── POST /treasury/deposits �?deposit to treasury ─────────────
  r.post('/treasury/deposits', async (_req, res, route) => {
    const v = validate(DaoTreasuryDepositSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    if (ctx.daoService) {
      try {
        const result = await ctx.daoService.treasuryDeposit(Number(body.amount));
        created(
          res,
          { txHash: result.txHash ?? result, amount: Number(body.amount), status: 'confirmed' },
          { self: '/api/v1/dao/treasury' },
        );
        return;
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }
    try {
      const envelope = await createDaoTreasuryDepositEnvelope({
        issuer: body.did,
        privateKey,
        amount: String(body.amount),
        source: body.source,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      created(
        res,
        { txHash: hash, amount: Number(body.amount), status: 'broadcast' },
        { self: '/api/v1/dao/treasury' },
      );
    } catch (err) {
      internalError(res, (err as Error).message || 'Treasury deposit failed');
    }
  });

  // ══════════════════════════════════════════════════════════════�?  //  Timelock
  // ══════════════════════════════════════════════════════════════�?
  // ── GET /timelock �?list timelock actions ──────────────────────
  r.get('/timelock', async (_req, res) => {
    if (ctx.daoStore) {
      try {
        const actions = await ctx.daoStore.listTimelockEntries();
        ok(res, actions ?? [], { self: '/api/v1/dao/timelock' });
        return;
      } catch {
        /* fallthrough */
      }
    }
    ok(res, [], { self: '/api/v1/dao/timelock' });
  });

  // ── POST /timelock/:actionId/actions/execute ──────────────────
  r.post('/timelock/:actionId/actions/execute', async (_req, res, route) => {
    const { actionId } = route.params;
    const v = validate(DaoTimelockExecuteSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    if (ctx.daoService) {
      try {
        const result = await ctx.daoService.execute(Number(actionId) || 0);
        ok(res, result, { self: `/api/v1/dao/timelock/${actionId}` });
        return;
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }
    try {
      const envelope = await createDaoTimelockExecuteEnvelope({
        issuer: body.did,
        privateKey,
        actionId: body.actionId ?? actionId,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { txHash: hash, actionId, status: 'executed' },
        { self: `/api/v1/dao/timelock/${actionId}` },
      );
    } catch (err) {
      internalError(res, (err as Error).message || 'Timelock execute failed');
    }
  });

  // ── POST /timelock/:actionId/actions/cancel ───────────────────
  r.post('/timelock/:actionId/actions/cancel', async (_req, res, route) => {
    const { actionId } = route.params;
    const v = validate(DaoTimelockCancelSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    if (ctx.daoService) {
      try {
        const result = await ctx.daoService.cancel(Number(actionId) || 0);
        ok(res, result, { self: `/api/v1/dao/timelock/${actionId}` });
        return;
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }
    try {
      const envelope = await createDaoTimelockCancelEnvelope({
        issuer: body.did,
        privateKey,
        actionId: body.actionId ?? actionId,
        reason: body.reason,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { txHash: hash, actionId, reason: body.reason, status: 'cancelled' },
        { self: `/api/v1/dao/timelock/${actionId}` },
      );
    } catch (err) {
      internalError(res, (err as Error).message || 'Timelock cancel failed');
    }
  });

  // ══════════════════════════════════════════════════════════════�?  //  Parameters
  // ══════════════════════════════════════════════════════════════�?
  // ── GET /params �?current DAO parameters ──────────────────────
  r.get('/params', async (_req, res) => {
    if (ctx.daoService) {
      try {
        const params = await ctx.daoService.getAllParams();
        if (params) {
          ok(res, params, { self: '/api/v1/dao/params' });
          return;
        }
      } catch {
        /* fallthrough */
      }
    }

    // DaoStore has no getParams �?return empty
    ok(res, {}, { self: '/api/v1/dao/params' });
  });

  return r;
}
