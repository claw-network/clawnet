/**
 * Task market routes — /api/v1/markets/tasks
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
import { validate, ListingRemoveSchema } from '../schemas/common.js';
import {
  TaskPublishSchema,
  TaskBidSchema,
  TaskBidActionSchema,
  TaskAcceptSchema,
  TaskDeliverSchema,
  TaskConfirmSchema,
  TaskReviewSchema,
} from '../schemas/markets.js';
import type { RuntimeContext } from '../types.js';
import { resolvePrivateKey, addressFromDid } from '../types.js';
import {
  createTaskListingPublishEnvelope,
  createMarketBidSubmitEnvelope,
  createMarketBidAcceptEnvelope,
  createMarketBidRejectEnvelope,
  createMarketBidWithdrawEnvelope,
  createMarketOrderCreateEnvelope,
  createMarketOrderUpdateEnvelope,
  createMarketSubmissionSubmitEnvelope,
  createMarketSubmissionReviewEnvelope,
  createMarketListingRemoveEnvelope,
  createWalletEscrowCreateEnvelope,
  createWalletEscrowFundEnvelope,
  createInfoEscrowReleaseEnvelope,
  createInfoOrderCompletionEnvelope,
  createInfoOrderReviewEnvelope,
} from '@claw-network/protocol';

export function marketsTaskRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST / — publish task listing ─────────────────────────────
  r.post('/', async (_req, res, route) => {
    const v = validate(TaskPublishSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;
    const listingId =
      body.listingId ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }
    try {
      const envelope = await createTaskListingPublishEnvelope({
        issuer: body.did,
        privateKey,
        listingId,
        title: body.title,
        description: body.description,
        category: body.category,
        tags: (body.tags ?? []) as string[],
        pricing: body.pricing as never,
        visibility: (body.visibility ?? 'public') as never,
        marketData: {
          taskType: body.taskType,
          task: body.task,
          timeline: body.timeline,
          workerRequirements: body.workerRequirements,
          bidding: body.bidding,
          milestones: body.milestones,
        } as never,
        restrictions: body.restrictions as never,
        metadata: body.metadata as Record<string, unknown> | undefined,
        expiresAt: body.expiresAt,
        status: body.status as never,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      } as never);
      const hash = await ctx.publishEvent(envelope);
      created(res, { listingId, txHash: hash }, { self: `/api/v1/markets/tasks/${listingId}` });
    } catch (err) {
      internalError(res, (err as Error).message || 'Task listing publish failed');
    }
  });

  // ── GET / — list task listings ────────────────────────────────
  r.get('/', async (_req, res, route) => {
    const { page, perPage } = parsePagination(route.query);

    if (ctx.searchMarkets) {
      try {
        const result = ctx.searchMarkets({
          markets: ['task'],
          page,
          pageSize: perPage,
          keyword: route.query.get('keyword') ?? undefined,
          category: route.query.get('category') ?? undefined,
        });
        const r2 = result as unknown as Record<string, unknown>;
        paginated(res, (r2.listings ?? []) as unknown[], {
          page,
          perPage,
          total: (r2.total ?? 0) as number,
          basePath: '/api/v1/markets/tasks',
        });
        return;
      } catch {
        /* fallthrough */
      }
    }

    paginated(res, [], { page, perPage, total: 0, basePath: '/api/v1/markets/tasks' });
  });

  // ── GET /:id — single task listing ────────────────────────────
  r.get('/:id', async (_req, res, route) => {
    const { id } = route.params;
    if (ctx.marketStore) {
      try {
        const listing = await ctx.marketStore.getListing?.(id);
        if (listing) {
          ok(res, listing, { self: `/api/v1/markets/tasks/${id}` });
          return;
        }
      } catch {
        /* fallthrough */
      }
    }
    notFound(res, `Task listing ${id} not found`);
  });

  // ── DELETE /:id — remove task listing ─────────────────────────
  r.delete('/:id', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(ListingRemoveSchema, route.body);
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
      const envelope = await createMarketListingRemoveEnvelope({
        issuer: body.did,
        privateKey,
        listingId: id,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { listingId: id, txHash: hash }, { self: `/api/v1/markets/tasks/${id}` });
    } catch (err) {
      internalError(res, (err as Error).message || 'Task listing remove failed');
    }
  });

  // ── POST /:id/actions/remove — compatibility alias ────────────
  r.post('/:id/actions/remove', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(ListingRemoveSchema, route.body);
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
      const envelope = await createMarketListingRemoveEnvelope({
        issuer: body.did,
        privateKey,
        listingId: id,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { listingId: id, txHash: hash }, { self: `/api/v1/markets/tasks/${id}` });
    } catch (err) {
      internalError(res, (err as Error).message || 'Task listing remove failed');
    }
  });

  // ── POST /:id/bids — submit bid ──────────────────────────────
  r.post('/:id/bids', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(TaskBidSchema, route.body);
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
      const bidId = body.bidId ?? `bid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const envelope = await createMarketBidSubmitEnvelope({
        issuer: body.did,
        privateKey,
        bidId,
        taskId: id,
        proposal: {
          price: String(body.price),
          timeline: body.timeline,
          approach: body.approach,
          milestones: body.milestones as Record<string, unknown>[] | undefined,
        } as never,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      created(res, { bidId, txHash: hash }, { self: `/api/v1/markets/tasks/${id}/bids/${bidId}` });
    } catch (err) {
      internalError(res, (err as Error).message || 'Bid submit failed');
    }
  });

  // ── GET /:id/bids — list bids for task ────────────────────────
  r.get('/:id/bids', async (_req, res, route) => {
    const { id } = route.params;
    // MarketSearchStore does not index bids — return empty list
    ok(res, [], { self: `/api/v1/markets/tasks/${id}/bids` });
  });

  // ── POST /:id/bids/:bidId/actions/accept ──────────────────────
  r.post('/:id/bids/:bidId/actions/accept', async (_req, res, route) => {
    const { id, bidId } = route.params;
    const v = validate(TaskAcceptSchema, route.body);
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
      const orderId =
        body.orderId ?? `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const escrowId = body.escrowId ?? `escrow-${orderId}`;
      const ts = body.ts ?? Date.now();
      let nonce = body.nonce;

      // accept bid
      const e1 = await createMarketBidAcceptEnvelope({
        issuer: body.did,
        privateKey,
        bidId: body.bidId ?? bidId,
        resourcePrev: body.prev ?? '',
        ts,
        nonce,
        prev: body.prev,
      });
      const h1 = await ctx.publishEvent(e1);

      // create order
      const listing = ctx.marketStore ? await ctx.marketStore.getListing?.(id) : undefined;
      const listingSellerDid =
        listing && typeof listing === 'object'
          ? ((listing as { seller?: { did?: string } }).seller?.did ?? undefined)
          : undefined;
      const e2 = await createMarketOrderCreateEnvelope({
        issuer: body.did,
        privateKey,
        listingId: id,
        orderId,
        marketType: 'task' as never,
        sellerDid: listingSellerDid,
        items: [{ listingId: id, quantity: 1, unitPrice: '1' }] as never,
        pricing: { subtotal: '1', total: '1' } as never,
        ts: ts + 1,
        nonce: ++nonce,
        prev: h1,
      });
      const h2 = await ctx.publishEvent(e2);

      // create escrow
      const e3 = await createWalletEscrowCreateEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        depositor: addressFromDid(body.did),
        beneficiary: addressFromDid(body.did),
        amount: '1',
        releaseRules: body.releaseRules ?? [{ type: 'task_completion' }],
        ts: ts + 2,
        nonce: ++nonce,
        prev: h2,
      });
      const h3 = await ctx.publishEvent(e3);

      // fund escrow
      const e4 = await createWalletEscrowFundEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        amount: '1',
        resourcePrev: h3,
        ts: ts + 3,
        nonce: ++nonce,
        prev: h3,
      });
      const h4 = await ctx.publishEvent(e4);

      // mark paid
      const e5 = await createMarketOrderUpdateEnvelope({
        issuer: body.did,
        privateKey,
        orderId,
        status: 'payment_pending',
        payment: { status: 'escrowed', escrowId },
        resourcePrev: h4,
        ts: ts + 4,
        nonce: ++nonce,
        prev: h4,
      });
      const h5 = await ctx.publishEvent(e5);

      created(
        res,
        {
          bidId: body.bidId ?? bidId,
          orderId,
          escrowId,
          bidAcceptHash: h1,
          orderHash: h2,
          escrowCreateHash: h3,
          escrowFundHash: h4,
          paymentHash: h5,
        },
        { self: `/api/v1/markets/tasks/${id}` },
      );
    } catch (err) {
      internalError(res, (err as Error).message || 'Bid accept failed');
    }
  });

  // ── POST /:id/bids/:bidId/actions/reject ──────────────────────
  r.post('/:id/bids/:bidId/actions/reject', async (_req, res, route) => {
    const { id, bidId } = route.params;
    const v = validate(TaskBidActionSchema, route.body);
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
      const envelope = await createMarketBidRejectEnvelope({
        issuer: body.did,
        privateKey,
        bidId: body.bidId ?? bidId,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { bidId: body.bidId ?? bidId, txHash: hash },
        { self: `/api/v1/markets/tasks/${id}` },
      );
    } catch (err) {
      internalError(res, (err as Error).message || 'Bid reject failed');
    }
  });

  // ── POST /:id/bids/:bidId/actions/withdraw ────────────────────
  r.post('/:id/bids/:bidId/actions/withdraw', async (_req, res, route) => {
    const { id, bidId } = route.params;
    const v = validate(TaskBidActionSchema, route.body);
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
      const envelope = await createMarketBidWithdrawEnvelope({
        issuer: body.did,
        privateKey,
        bidId: body.bidId ?? bidId,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { bidId: body.bidId ?? bidId, txHash: hash },
        { self: `/api/v1/markets/tasks/${id}` },
      );
    } catch (err) {
      internalError(res, (err as Error).message || 'Bid withdraw failed');
    }
  });

  // ── POST /:id/actions/deliver ─────────────────────────────────
  r.post('/:id/actions/deliver', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(TaskDeliverSchema, route.body);
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
      const submissionId =
        body.submissionId ?? `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ts = body.ts ?? Date.now();

      const e1 = await createMarketSubmissionSubmitEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId,
        submissionId,
        deliverables: body.deliverables,
        notes: body.notes,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
      const h1 = await ctx.publishEvent(e1);

      const e2 = await createMarketOrderUpdateEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId,
        status: 'delivered',
        resourcePrev: h1,
        ts: ts + 1,
        nonce: body.nonce + 1,
        prev: h1,
      });
      const h2 = await ctx.publishEvent(e2);

      ok(
        res,
        { submissionId, submissionHash: h1, orderUpdateHash: h2 },
        { self: `/api/v1/markets/tasks/${id}` },
      );
    } catch (err) {
      internalError(res, (err as Error).message || 'Task delivery failed');
    }
  });

  // ── POST /:id/actions/confirm ─────────────────────────────────
  r.post('/:id/actions/confirm', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(TaskConfirmSchema, route.body);
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
      const ts = body.ts ?? Date.now();
      let nonce = body.nonce;

      const e1 = await createMarketSubmissionReviewEnvelope({
        issuer: body.did,
        privateKey,
        submissionId: body.submissionId,
        resourcePrev: body.prev ?? '',
        approved: body.approved,
        feedback: body.feedback,
        rating: body.rating as number | undefined,
        revisionDeadline: body.revisionDeadline,
        ts,
        nonce,
        prev: body.prev,
      });
      const h1 = await ctx.publishEvent(e1);
      const result: Record<string, string | undefined> = { submissionReviewHash: h1 };

      if (body.approved && body.escrowId) {
        const e2 = await createInfoEscrowReleaseEnvelope({
          issuer: body.did,
          privateKey,
          escrowId: body.escrowId,
          resourcePrev: h1,
          amount: '0',
          ruleId: body.ruleId ?? 'task_completion',
          ts: ts + 1,
          nonce: ++nonce,
          prev: h1,
        });
        const h2 = await ctx.publishEvent(e2);
        result.escrowReleaseHash = h2;

        const e3 = await createInfoOrderCompletionEnvelope({
          issuer: body.did,
          privateKey,
          orderId: body.orderId,
          resourcePrev: h2,
          ts: ts + 2,
          nonce: ++nonce,
          prev: h2,
        });
        const h3 = await ctx.publishEvent(e3);
        result.orderUpdateHash = h3;
      } else if (!body.approved) {
        const e2 = await createMarketOrderUpdateEnvelope({
          issuer: body.did,
          privateKey,
          orderId: body.orderId,
          status: 'in_progress',
          resourcePrev: h1,
          ts: ts + 1,
          nonce: ++nonce,
          prev: h1,
        });
        const h2 = await ctx.publishEvent(e2);
        result.orderUpdateHash = h2;
      }

      ok(res, result, { self: `/api/v1/markets/tasks/${id}` });
    } catch (err) {
      internalError(res, (err as Error).message || 'Task confirm failed');
    }
  });

  // ── POST /:id/actions/review ──────────────────────────────────
  r.post('/:id/actions/review', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(TaskReviewSchema, route.body);
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
      const envelope = await createInfoOrderReviewEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId,
        resourcePrev: body.prev ?? '',
        status: 'completed' as never,
        review: {
          rating: body.rating,
          comment: body.comment,
          ...(body.detailedRatings ? { detailedRatings: body.detailedRatings } : {}),
        } as never,
        by: body.by,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { orderUpdateHash: hash }, { self: `/api/v1/markets/tasks/${id}` });
    } catch (err) {
      internalError(res, (err as Error).message || 'Task review failed');
    }
  });

  return r;
}
