import { ErrorCodes, TelagentError } from '../../protocol/index.js';

import { requireScope } from '../auth.js';
import { Router } from '../router.js';
import { ok } from '../response.js';
import { handleError } from '../route-utils.js';
import type { RuntimeContext } from '../types.js';

export function clawnetRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  router.get('/wallet/balance/:did', async ({ res, params, url }) => {
    try {
      const balance = await ctx.clawnetGateway.getBalance(params.did);
      ok(res, balance, { self: `/api/v1/clawnet/wallet/balance/${encodeURIComponent(params.did)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/wallet/balance', async ({ res, url }) => {
    try {
      const balance = await ctx.clawnetGateway.getBalance();
      ok(res, balance, { self: '/api/v1/clawnet/wallet/balance' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/wallet/nonce/:did', async ({ res, params, url }) => {
    try {
      const result = await ctx.clawnetGateway.getNonce(params.did);
      ok(res, result, { self: `/api/v1/clawnet/wallet/nonce/${encodeURIComponent(params.did)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/wallet/nonce', async ({ res, url }) => {
    try {
      const result = await ctx.clawnetGateway.getNonce();
      ok(res, result, { self: '/api/v1/clawnet/wallet/nonce' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/wallet/history/:did', async ({ res, params, query, url }) => {
    try {
      const limit = parseOptionalInt(query.get('limit'));
      const offset = parseOptionalInt(query.get('offset'));
      const history = await ctx.clawnetGateway.getWalletHistory(params.did, { limit, offset });
      ok(res, history, { self: `/api/v1/clawnet/wallet/history/${encodeURIComponent(params.did)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/wallet/history', async ({ res, query, url }) => {
    try {
      const limit = parseOptionalInt(query.get('limit'));
      const offset = parseOptionalInt(query.get('offset'));
      const history = await ctx.clawnetGateway.getWalletHistory(undefined, { limit, offset });
      ok(res, history, { self: '/api/v1/clawnet/wallet/history' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/identity/self', async ({ res, url }) => {
    try {
      const identity = await ctx.clawnetGateway.getSelfIdentity();
      ok(res, identity, { self: '/api/v1/clawnet/identity/self' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/identity/:did', async ({ res, params, url }) => {
    try {
      const identity = await ctx.clawnetGateway.resolveIdentity(params.did);
      ok(res, identity, { self: `/api/v1/clawnet/identity/${encodeURIComponent(params.did)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/escrow/:id', async ({ res, params, url }) => {
    try {
      const escrow = await ctx.clawnetGateway.getEscrow(params.id);
      ok(res, escrow, { self: `/api/v1/clawnet/escrow/${encodeURIComponent(params.id)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/profile/:did', async ({ res, params, url }) => {
    try {
      const profile = await ctx.clawnetGateway.getAgentProfile(params.did);
      ok(res, profile, { self: `/api/v1/clawnet/profile/${encodeURIComponent(params.did)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/markets/search', async ({ res, query, url }) => {
    try {
      const results = await ctx.clawnetGateway.searchMarkets({
        q: query.get('q') ?? undefined,
        type: query.get('type') ?? undefined,
      });
      ok(res, results, { self: '/api/v1/clawnet/markets/search' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/market/tasks', async ({ res, query, url }) => {
    try {
      const filters: Record<string, unknown> = {};
      for (const [key, value] of query.entries()) {
        filters[key] = value;
      }
      const tasks = await ctx.clawnetGateway.listTasks(filters);
      ok(res, tasks, { self: '/api/v1/clawnet/market/tasks' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/market/tasks/:taskId/bids', async ({ res, params, url }) => {
    try {
      const bids = await ctx.clawnetGateway.listBids(params.taskId);
      ok(res, bids, { self: `/api/v1/clawnet/market/tasks/${encodeURIComponent(params.taskId)}/bids` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/reputation/:did', async ({ res, params, url }) => {
    try {
      const reputation = await ctx.clawnetGateway.getReputation(params.did);
      ok(res, reputation, { self: `/api/v1/clawnet/reputation/${encodeURIComponent(params.did)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/health', async ({ res, url }) => {
    try {
      const health = await ctx.clawnetGateway.healthCheck();
      ok(res, health, { self: '/api/v1/clawnet/health' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/wallet/transfer', async ({ req, res, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_transfer');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { to?: string; amount?: number; memo?: string };
      if (!payload.to || typeof payload.amount !== 'number') {
        throw new TelagentError(ErrorCodes.VALIDATION, 'to and amount are required');
      }
      const result = await ctx.clawnetGateway.transfer(token, {
        to: payload.to,
        amount: payload.amount,
        memo: payload.memo,
      });
      ok(res, result, { self: '/api/v1/clawnet/wallet/transfer' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/wallet/escrow', async ({ req, res, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_escrow');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { beneficiary?: string; amount?: number; releaseRules?: unknown[] };
      if (!payload.beneficiary || typeof payload.amount !== 'number') {
        throw new TelagentError(ErrorCodes.VALIDATION, 'beneficiary and amount are required');
      }
      const result = await ctx.clawnetGateway.createEscrow(token, {
        beneficiary: payload.beneficiary,
        amount: payload.amount,
        releaseRules: payload.releaseRules,
      });
      ok(res, result, { self: '/api/v1/clawnet/wallet/escrow' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/wallet/escrow/:id/release', async ({ req, res, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_escrow');
      const token = requireSessionToken(req.headers);
      const result = await ctx.clawnetGateway.releaseEscrow(token, { escrowId: params.id });
      ok(res, result, { self: `/api/v1/clawnet/wallet/escrow/${encodeURIComponent(params.id)}/release` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/tasks', async ({ req, res, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { title?: string; description?: string; budget?: number; tags?: string[] };
      if (!payload.title || !payload.description || typeof payload.budget !== 'number') {
        throw new TelagentError(ErrorCodes.VALIDATION, 'title, description, budget are required');
      }
      const result = await ctx.clawnetGateway.publishTask(token, {
        title: payload.title,
        description: payload.description,
        budget: payload.budget,
        tags: payload.tags,
      });
      ok(res, result, { self: '/api/v1/clawnet/market/tasks' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/tasks/:taskId/bid', async ({ req, res, params, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { amount?: number; proposal?: string };
      if (typeof payload.amount !== 'number') {
        throw new TelagentError(ErrorCodes.VALIDATION, 'amount is required');
      }
      const result = await ctx.clawnetGateway.bid(token, {
        taskId: params.taskId,
        amount: payload.amount,
        proposal: payload.proposal,
      });
      ok(res, result, { self: `/api/v1/clawnet/market/tasks/${encodeURIComponent(params.taskId)}/bid` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/tasks/:taskId/accept-bid', async ({ req, res, params, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { bidId?: string };
      if (!payload.bidId) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'bidId is required');
      }
      const result = await ctx.clawnetGateway.acceptBid(token, {
        taskId: params.taskId,
        bidId: payload.bidId,
      });
      ok(res, result, { self: `/api/v1/clawnet/market/tasks/${encodeURIComponent(params.taskId)}/accept-bid` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/reputation/review', async ({ req, res, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_reputation');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { targetDid?: string; score?: number; comment?: string; orderId?: string };
      if (!payload.targetDid || typeof payload.score !== 'number') {
        throw new TelagentError(ErrorCodes.VALIDATION, 'targetDid and score are required');
      }
      const result = await ctx.clawnetGateway.submitReview(token, {
        targetDid: payload.targetDid,
        score: payload.score,
        comment: payload.comment,
        orderId: payload.orderId,
      });
      ok(res, result, { self: '/api/v1/clawnet/reputation/review' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/contracts', async ({ req, res, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_transfer');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as Record<string, unknown>;
      const result = await ctx.clawnetGateway.createServiceContract(token, payload);
      ok(res, result, { self: '/api/v1/clawnet/contracts' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // ── Info Market ───────────────────────────────────────────────────────────

  router.get('/market/info', async ({ res, query, url }) => {
    try {
      const filters: Record<string, unknown> = {};
      for (const [key, value] of query.entries()) {
        filters[key] = value;
      }
      const listings = await ctx.clawnetGateway.listInfoListings(filters);
      ok(res, listings, { self: '/api/v1/clawnet/market/info' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/market/info/:id', async ({ res, params, url }) => {
    try {
      const listing = await ctx.clawnetGateway.getInfoListing(params.id);
      ok(res, listing, { self: `/api/v1/clawnet/market/info/${encodeURIComponent(params.id)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/info', async ({ req, res, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { title?: string; description?: string; price?: number; tags?: string[] };
      if (!payload.title || !payload.description || typeof payload.price !== 'number') {
        throw new TelagentError(ErrorCodes.VALIDATION, 'title, description, price are required');
      }
      const result = await ctx.clawnetGateway.publishInfo(token, {
        title: payload.title,
        description: payload.description,
        price: payload.price,
        tags: payload.tags,
      });
      ok(res, result, { self: '/api/v1/clawnet/market/info' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/info/:id/purchase', async ({ req, res, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const result = await ctx.clawnetGateway.purchaseInfo(token, params.id);
      ok(res, result, { self: `/api/v1/clawnet/market/info/${encodeURIComponent(params.id)}/purchase` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/info/:id/deliver', async ({ req, res, params, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as Record<string, unknown>;
      const result = await ctx.clawnetGateway.deliverInfo(token, params.id, payload);
      ok(res, result, { self: `/api/v1/clawnet/market/info/${encodeURIComponent(params.id)}/deliver` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/info/:id/confirm', async ({ req, res, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const result = await ctx.clawnetGateway.confirmInfo(token, params.id);
      ok(res, result, { self: `/api/v1/clawnet/market/info/${encodeURIComponent(params.id)}/confirm` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/info/:id/subscribe', async ({ req, res, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const result = await ctx.clawnetGateway.subscribeInfo(token, params.id);
      ok(res, result, { self: `/api/v1/clawnet/market/info/${encodeURIComponent(params.id)}/subscribe` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/info/:id/unsubscribe', async ({ req, res, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const result = await ctx.clawnetGateway.unsubscribeInfo(token, params.id);
      ok(res, result, { self: `/api/v1/clawnet/market/info/${encodeURIComponent(params.id)}/unsubscribe` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // ── Capability Market ─────────────────────────────────────────────────────

  router.get('/market/capabilities', async ({ res, query, url }) => {
    try {
      const filters: Record<string, unknown> = {};
      for (const [key, value] of query.entries()) {
        filters[key] = value;
      }
      const capabilities = await ctx.clawnetGateway.listCapabilities(filters);
      ok(res, capabilities, { self: '/api/v1/clawnet/market/capabilities' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/market/capabilities/:id', async ({ res, params, url }) => {
    try {
      const capability = await ctx.clawnetGateway.getCapability(params.id);
      ok(res, capability, { self: `/api/v1/clawnet/market/capabilities/${encodeURIComponent(params.id)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/capabilities', async ({ req, res, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { title?: string; description?: string; pricePerInvocation?: number; maxConcurrentLeases?: number; tags?: string[] };
      if (!payload.title || !payload.description || typeof payload.pricePerInvocation !== 'number') {
        throw new TelagentError(ErrorCodes.VALIDATION, 'title, description, pricePerInvocation are required');
      }
      const result = await ctx.clawnetGateway.publishCapability(token, {
        title: payload.title,
        description: payload.description,
        pricePerInvocation: payload.pricePerInvocation,
        maxConcurrentLeases: payload.maxConcurrentLeases,
        tags: payload.tags,
      });
      ok(res, result, { self: '/api/v1/clawnet/market/capabilities' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/capabilities/:id/lease', async ({ req, res, params, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { maxInvocations?: number; durationSeconds?: number };
      const result = await ctx.clawnetGateway.leaseCapability(token, params.id, payload);
      ok(res, result, { self: `/api/v1/clawnet/market/capabilities/${encodeURIComponent(params.id)}/lease` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/capabilities/:id/invoke', async ({ req, res, params, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { payload?: Record<string, unknown> };
      if (!payload.payload) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'payload is required');
      }
      const result = await ctx.clawnetGateway.invokeCapability(token, params.id, { payload: payload.payload });
      ok(res, result, { self: `/api/v1/clawnet/market/capabilities/${encodeURIComponent(params.id)}/invoke` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/capabilities/:id/pause', async ({ req, res, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const result = await ctx.clawnetGateway.pauseLease(token, params.id);
      ok(res, result, { self: `/api/v1/clawnet/market/capabilities/${encodeURIComponent(params.id)}/pause` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/capabilities/:id/resume', async ({ req, res, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const result = await ctx.clawnetGateway.resumeLease(token, params.id);
      ok(res, result, { self: `/api/v1/clawnet/market/capabilities/${encodeURIComponent(params.id)}/resume` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/capabilities/:id/terminate', async ({ req, res, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const result = await ctx.clawnetGateway.terminateLease(token, params.id);
      ok(res, result, { self: `/api/v1/clawnet/market/capabilities/${encodeURIComponent(params.id)}/terminate` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // ── Task Market (missing ops) ─────────────────────────────────────────────

  router.post('/market/tasks/:taskId/reject-bid', async ({ req, res, params, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { bidId?: string };
      if (!payload.bidId) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'bidId is required');
      }
      const result = await ctx.clawnetGateway.rejectBid(token, {
        taskId: params.taskId,
        bidId: payload.bidId,
      });
      ok(res, result, { self: `/api/v1/clawnet/market/tasks/${encodeURIComponent(params.taskId)}/reject-bid` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/tasks/:taskId/withdraw-bid', async ({ req, res, params, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { bidId?: string };
      if (!payload.bidId) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'bidId is required');
      }
      const result = await ctx.clawnetGateway.withdrawBid(token, {
        taskId: params.taskId,
        bidId: payload.bidId,
      });
      ok(res, result, { self: `/api/v1/clawnet/market/tasks/${encodeURIComponent(params.taskId)}/withdraw-bid` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/tasks/:taskId/deliver', async ({ req, res, params, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as Record<string, unknown>;
      const result = await ctx.clawnetGateway.deliverTask(token, params.taskId, payload);
      ok(res, result, { self: `/api/v1/clawnet/market/tasks/${encodeURIComponent(params.taskId)}/deliver` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/tasks/:taskId/confirm', async ({ req, res, params, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const result = await ctx.clawnetGateway.confirmTask(token, params.taskId);
      ok(res, result, { self: `/api/v1/clawnet/market/tasks/${encodeURIComponent(params.taskId)}/confirm` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // ── Disputes ──────────────────────────────────────────────────────────────

  router.get('/market/disputes', async ({ res, query, url }) => {
    try {
      const filters: Record<string, unknown> = {};
      for (const [key, value] of query.entries()) {
        filters[key] = value;
      }
      const disputes = await ctx.clawnetGateway.listDisputes(filters);
      ok(res, disputes, { self: '/api/v1/clawnet/market/disputes' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.get('/market/disputes/:id', async ({ res, params, url }) => {
    try {
      const dispute = await ctx.clawnetGateway.getDispute(params.id);
      ok(res, dispute, { self: `/api/v1/clawnet/market/disputes/${encodeURIComponent(params.id)}` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/disputes', async ({ req, res, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { orderId?: string; reason?: string; evidence?: string };
      if (!payload.orderId || !payload.reason) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'orderId and reason are required');
      }
      const result = await ctx.clawnetGateway.openDispute(token, {
        orderId: payload.orderId,
        reason: payload.reason,
        evidence: payload.evidence,
      });
      ok(res, result, { self: '/api/v1/clawnet/market/disputes' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/disputes/:id/respond', async ({ req, res, params, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { response?: string; evidence?: string };
      if (!payload.response) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'response is required');
      }
      const result = await ctx.clawnetGateway.respondDispute(token, params.id, {
        response: payload.response,
        evidence: payload.evidence,
      });
      ok(res, result, { self: `/api/v1/clawnet/market/disputes/${encodeURIComponent(params.id)}/respond` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  router.post('/market/disputes/:id/resolve', async ({ req, res, params, body, url }) => {
    try {
      requireScope(req.headers, ctx, 'clawnet_market');
      const token = requireSessionToken(req.headers);
      const payload = (body ?? {}) as { outcome?: string; splitRatio?: number; reason?: string };
      if (!payload.outcome || !['refund', 'release', 'split'].includes(payload.outcome)) {
        throw new TelagentError(ErrorCodes.VALIDATION, 'outcome must be one of: refund, release, split');
      }
      const result = await ctx.clawnetGateway.resolveDispute(token, params.id, {
        outcome: payload.outcome as 'refund' | 'release' | 'split',
        splitRatio: payload.splitRatio,
        reason: payload.reason,
      });
      ok(res, result, { self: `/api/v1/clawnet/market/disputes/${encodeURIComponent(params.id)}/resolve` });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  // ── Faucet ──────────────────────────────────────────────────────────

  router.post('/faucet/claim', async ({ req, res, url }) => {
    try {
      requireScope(req.headers as Record<string, string | string[] | undefined>, ctx, 'clawnet_transfer');
      const result = await ctx.clawnetGateway.claimFaucet();
      ok(res, result, { self: '/api/v1/clawnet/faucet/claim' });
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}

function requireSessionToken(headers: Record<string, string | string[] | undefined>): string {
  const authHeader = headers.authorization;
  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!auth?.startsWith('Bearer ')) {
    throw new TelagentError(ErrorCodes.UNAUTHORIZED, 'Missing or invalid Authorization header. Use: Bearer tses_xxx');
  }
  const token = auth.slice(7);
  if (!token.startsWith('tses_')) {
    throw new TelagentError(ErrorCodes.UNAUTHORIZED, 'Invalid session token format');
  }
  return token;
}

function parseOptionalInt(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}
