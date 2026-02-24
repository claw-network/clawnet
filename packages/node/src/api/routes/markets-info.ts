/**
 * Info market routes — /api/v1/markets/info
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
  InfoPublishSchema,
  InfoPurchaseSchema,
  InfoDeliverSchema,
  InfoConfirmSchema,
  InfoReviewSchema,
  InfoSubscriptionSchema,
  InfoSubscriptionCancelSchema,
} from '../schemas/markets.js';
import type { RuntimeContext } from '../types.js';
import { resolvePrivateKey } from '../types.js';
import {
  createInfoListingPublishEnvelope,
  createInfoOrderCreateEnvelope,
  createInfoEscrowCreateEnvelope,
  createInfoEscrowFundEnvelope,
  createInfoOrderPaymentEscrowedEnvelope,
  createInfoOrderDeliveryEnvelope,
  createInfoOrderCompletionEnvelope,
  createInfoOrderReviewEnvelope,
  createInfoEscrowReleaseEnvelope,
  createMarketListingRemoveEnvelope,
  createMarketSubscriptionStartEnvelope,
  createMarketSubscriptionCancelEnvelope,
} from '@claw-network/protocol';

export function marketsInfoRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST / — publish info listing ─────────────────────────────
  r.post('/', async (_req, res, route) => {
    const v = validate(InfoPublishSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;
    const listingId =
      body.listingId ?? `info-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }

    try {
      const envelope = await createInfoListingPublishEnvelope({
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
          infoType: body.infoType,
          content: body.content,
          accessMethod: body.accessMethod,
          license: body.license,
          quality: body.quality,
          usageRestrictions: body.usageRestrictions,
        } as never,
        restrictions: body.restrictions as never,
        metadata: body.metadata as Record<string, unknown> | undefined,
        expiresAt: body.expiresAt,
        status: body.status as never,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce ?? 0,
        prev: body.prev,
      } as never);
      const hash = await ctx.publishEvent(envelope);
      created(res, { listingId, txHash: hash }, { self: `/api/v1/markets/info/${listingId}` });
    } catch {
      internalError(res, 'Info listing publish failed');
    }
  });

  // ── GET / — list info listings ────────────────────────────────
  r.get('/', async (_req, res, route) => {
    const { page, perPage } = parsePagination(route.query);

    if (ctx.marketStore) {
      try {
        const result = ctx.searchMarkets?.({
          markets: ['info'],
          page,
          pageSize: perPage,
          keyword: route.query.get('keyword') ?? undefined,
          category: route.query.get('category') ?? undefined,
        });
        if (result) {
          const r2 = result as unknown as Record<string, unknown>;
          paginated(res, (r2.listings ?? []) as unknown[], {
            page,
            perPage,
            total: (r2.total ?? 0) as number,
            basePath: '/api/v1/markets/info',
          });
          return;
        }
      } catch {
        /* fallthrough */
      }
    }

    paginated(res, [], { page, perPage, total: 0, basePath: '/api/v1/markets/info' });
  });

  // ── GET /:id — single info listing ────────────────────────────
  r.get('/:id', async (_req, res, route) => {
    const { id } = route.params;

    if (ctx.marketStore) {
      try {
        const listing = await ctx.marketStore.getListing?.(id);
        if (listing) {
          ok(res, listing, { self: `/api/v1/markets/info/${id}` });
          return;
        }
      } catch {
        /* fallthrough */
      }
    }

    notFound(res, `Info listing ${id} not found`);
  });

  // ── GET /:id/content — listing content metadata ───────────────
  r.get('/:id/content', async (_req, res, route) => {
    const { id } = route.params;
    if (!ctx.marketStore) {
      notFound(res, `Info listing ${id} not found`);
      return;
    }
    try {
      const listing = await ctx.marketStore.getListing?.(id);
      if (!listing) {
        notFound(res, `Info listing ${id} not found`);
        return;
      }
      const marketData = (listing as unknown as Record<string, unknown>).marketData as
        | Record<string, unknown>
        | undefined;
      ok(res, marketData?.content ?? {}, { self: `/api/v1/markets/info/${id}/content` });
    } catch {
      internalError(res, 'Info content lookup failed');
    }
  });

  // ── GET /orders/:orderId/delivery — delivery record ───────────
  r.get('/orders/:orderId/delivery', async (_req, res, route) => {
    const { orderId } = route.params;
    if (!ctx.infoContentStore) {
      notFound(res, `Delivery ${orderId} not found`);
      return;
    }
    try {
      const delivery = await ctx.infoContentStore.getDeliveryForOrder?.(orderId);
      if (!delivery) {
        notFound(res, `Delivery ${orderId} not found`);
        return;
      }
      ok(res, delivery, { self: `/api/v1/markets/info/orders/${orderId}/delivery` });
    } catch {
      internalError(res, 'Info delivery lookup failed');
    }
  });

  // ── DELETE /:id — remove info listing ─────────────────────────
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
        nonce: body.nonce ?? 0,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { listingId: id, txHash: hash }, { self: `/api/v1/markets/info/${id}` });
    } catch {
      internalError(res, 'Info listing remove failed');
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
        nonce: body.nonce ?? 0,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { listingId: id, txHash: hash }, { self: `/api/v1/markets/info/${id}` });
    } catch {
      internalError(res, 'Info listing remove failed');
    }
  });

  // ── POST /:id/actions/purchase ────────────────────────────────
  r.post('/:id/actions/purchase', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(InfoPurchaseSchema, route.body);
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
      const nonce = body.nonce ?? 0;
      const ts = body.ts ?? Date.now();

      // Fetch listing object for order create
      const listing = ctx.marketStore ? await ctx.marketStore.getListing?.(id) : null;

      const e1 = await createInfoOrderCreateEnvelope({
        issuer: body.did,
        privateKey,
        listing: (listing ?? { id, marketType: 'info' }) as never,
        orderId,
        quantity: body.quantity,
        unitPrice: body.unitPrice ? String(body.unitPrice) : undefined,
        ts,
        nonce,
        prev: body.prev,
      });
      const h1 = await ctx.publishEvent(e1);

      const totalAmount = body.unitPrice
        ? String(Number(body.unitPrice) * (body.quantity ?? 1))
        : '0';

      const e2 = await createInfoEscrowCreateEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        buyerDid: body.did,
        sellerDid: ((body as Record<string, unknown>).sellerDid as string) ?? '',
        amount: totalAmount,
        releaseRules: body.releaseRules ?? [{ type: 'delivery_confirmation' }],
        ts: ts + 1,
        nonce: nonce + 1,
        prev: h1,
      });
      const h2 = await ctx.publishEvent(e2);

      const e3 = await createInfoEscrowFundEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        amount: totalAmount,
        resourcePrev: h2,
        ts: ts + 2,
        nonce: nonce + 2,
        prev: h2,
      });
      const h3 = await ctx.publishEvent(e3);

      const e4 = await createInfoOrderPaymentEscrowedEnvelope({
        issuer: body.did,
        privateKey,
        orderId,
        escrowId,
        resourcePrev: h3,
        ts: ts + 3,
        nonce: nonce + 3,
        prev: h3,
      });
      const h4 = await ctx.publishEvent(e4);

      created(
        res,
        {
          orderId,
          escrowId,
          orderHash: h1,
          escrowCreateHash: h2,
          escrowFundHash: h3,
          paymentHash: h4,
        },
        { self: `/api/v1/markets/info/${id}` },
      );
    } catch {
      internalError(res, 'Info purchase failed');
    }
  });

  // ── POST /:id/actions/deliver ─────────────────────────────────
  r.post('/:id/actions/deliver', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(InfoDeliverSchema, route.body);
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
      const deliveryId = body.deliveryId ?? `delivery-${Date.now()}`;
      const envelope = await createInfoOrderDeliveryEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId ?? '',
        resourcePrev: body.prev ?? '',
        deliveryId,
        method: ((body as Record<string, unknown>).method as string) ?? 'direct',
        accessUrl: body.accessUrl,
        accessToken: body.accessToken,
        expiresAt: body.expiresAt,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce ?? 0,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { deliveryId, orderUpdateHash: hash }, { self: `/api/v1/markets/info/${id}` });
    } catch {
      internalError(res, 'Info delivery failed');
    }
  });

  // ── POST /:id/actions/confirm ─────────────────────────────────
  r.post('/:id/actions/confirm', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(InfoConfirmSchema, route.body);
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
      const nonce = body.nonce ?? 0;
      const ts = body.ts ?? Date.now();
      const escrowId = body.escrowId ?? `escrow-${body.orderId}`;

      const e1 = await createInfoEscrowReleaseEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        amount: ((body as Record<string, unknown>).amount as string) ?? '0',
        ruleId: body.ruleId ?? 'delivery_confirmation',
        resourcePrev: body.prev ?? '',
        ts,
        nonce,
        prev: body.prev,
      });
      const h1 = await ctx.publishEvent(e1);

      const e2 = await createInfoOrderCompletionEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId ?? '',
        resourcePrev: h1,
        ts: ts + 1,
        nonce: nonce + 1,
        prev: h1,
      });
      const h2 = await ctx.publishEvent(e2);
      ok(
        res,
        { escrowReleaseHash: h1, orderUpdateHash: h2 },
        { self: `/api/v1/markets/info/${id}` },
      );
    } catch {
      internalError(res, 'Info confirm failed');
    }
  });

  // ── POST /:id/actions/review ──────────────────────────────────
  r.post('/:id/actions/review', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(InfoReviewSchema, route.body);
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
        orderId: body.orderId ?? '',
        resourcePrev: body.prev ?? '',
        status: 'completed' as never,
        review: {
          rating: body.rating,
          comment: body.comment,
          ...(body.detailedRatings ? { detailedRatings: body.detailedRatings } : {}),
        } as never,
        by: body.by as 'buyer' | 'seller' | undefined,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce ?? 0,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { orderUpdateHash: hash }, { self: `/api/v1/markets/info/${id}` });
    } catch {
      internalError(res, 'Info review failed');
    }
  });

  // ── POST /:id/subscriptions — subscribe ───────────────────────
  r.post('/:id/subscriptions', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(InfoSubscriptionSchema, route.body);
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
      const subscriptionId =
        body.subscriptionId ?? `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const envelope = await createMarketSubscriptionStartEnvelope({
        issuer: body.did,
        privateKey,
        listingId: id,
        subscriptionId,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce ?? 0,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      created(
        res,
        { subscriptionId, txHash: hash },
        { self: `/api/v1/markets/info/${id}/subscriptions/${subscriptionId}` },
      );
    } catch {
      internalError(res, 'Subscription start failed');
    }
  });

  // ── DELETE /:id/subscriptions/:subId — cancel subscription ────
  r.delete('/:id/subscriptions/:subId', async (_req, res, route) => {
    const { subId } = route.params;
    const v = validate(InfoSubscriptionCancelSchema, route.body);
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
      const envelope = await createMarketSubscriptionCancelEnvelope({
        issuer: body.did,
        privateKey,
        subscriptionId: subId,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce ?? 0,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { subscriptionId: subId, txHash: hash },
        { self: `/api/v1/markets/info/${route.params.id}` },
      );
    } catch {
      internalError(res, 'Subscription cancel failed');
    }
  });

  // ── POST /subscriptions/:subId/actions/cancel — compat alias ─
  r.post('/subscriptions/:subId/actions/cancel', async (_req, res, route) => {
    const { subId } = route.params;
    const v = validate(InfoSubscriptionCancelSchema, route.body);
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
      const envelope = await createMarketSubscriptionCancelEnvelope({
        issuer: body.did,
        privateKey,
        subscriptionId: subId,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce ?? 0,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { subscriptionId: subId, txHash: hash },
        { self: `/api/v1/markets/info/subscriptions/${subId}` },
      );
    } catch {
      internalError(res, 'Subscription cancel failed');
    }
  });

  return r;
}
