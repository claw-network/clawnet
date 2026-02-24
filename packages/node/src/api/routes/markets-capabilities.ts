/**
 * Capability market routes — /api/v1/markets/capabilities
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
  CapabilityPublishSchema,
  CapabilityLeaseSchema,
  CapabilityLeaseActionSchema,
  CapabilityInvokeSchema,
} from '../schemas/markets.js';
import type { RuntimeContext } from '../types.js';
import { resolvePrivateKey } from '../types.js';
import {
  createCapabilityListingPublishEnvelope,
  createMarketCapabilityLeaseStartEnvelope,
  createMarketCapabilityInvokeEnvelope,
  createMarketCapabilityLeasePauseEnvelope,
  createMarketCapabilityLeaseResumeEnvelope,
  createMarketCapabilityLeaseTerminateEnvelope,
  createMarketListingRemoveEnvelope,
} from '@claw-network/protocol';

export function marketsCapabilityRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST / — publish capability listing ───────────────────────
  r.post('/', async (_req, res, route) => {
    const v = validate(CapabilityPublishSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;
    const listingId =
      body.listingId ?? `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }
    try {
      const envelope = await createCapabilityListingPublishEnvelope({
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
          capabilityType: body.capabilityType,
          capability: body.capability,
          performance: body.performance,
          quota: body.quota,
          access: body.access,
          sla: body.sla,
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
      created(
        res,
        { listingId, txHash: hash },
        { self: `/api/v1/markets/capabilities/${listingId}` },
      );
    } catch {
      internalError(res, 'Capability listing publish failed');
    }
  });

  // ── GET / — list capability listings ──────────────────────────
  r.get('/', async (_req, res, route) => {
    const { page, perPage } = parsePagination(route.query);

    if (ctx.searchMarkets) {
      try {
        const result = ctx.searchMarkets({
          markets: ['capability'],
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
          basePath: '/api/v1/markets/capabilities',
        });
        return;
      } catch {
        /* fallthrough */
      }
    }

    paginated(res, [], { page, perPage, total: 0, basePath: '/api/v1/markets/capabilities' });
  });

  // ── GET /:id — single capability listing ──────────────────────
  r.get('/:id', async (_req, res, route) => {
    const { id } = route.params;
    if (ctx.marketStore) {
      try {
        const listing = await ctx.marketStore.getListing?.(id);
        if (listing) {
          ok(res, listing, { self: `/api/v1/markets/capabilities/${id}` });
          return;
        }
      } catch {
        /* fallthrough */
      }
    }
    notFound(res, `Capability listing ${id} not found`);
  });

  // ── DELETE /:id — remove capability listing ───────────────────
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
      ok(res, { listingId: id, txHash: hash }, { self: `/api/v1/markets/capabilities/${id}` });
    } catch {
      internalError(res, 'Capability listing remove failed');
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
      ok(res, { listingId: id, txHash: hash }, { self: `/api/v1/markets/capabilities/${id}` });
    } catch {
      internalError(res, 'Capability listing remove failed');
    }
  });

  // ── POST /:id/leases — start lease ────────────────────────────
  r.post('/:id/leases', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(CapabilityLeaseSchema, route.body);
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
      const leaseId =
        body.leaseId ?? `lease-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const envelope = await createMarketCapabilityLeaseStartEnvelope({
        issuer: body.did,
        privateKey,
        listingId: id,
        leaseId,
        plan: body.plan,
        credentials: body.credentials,
        metadata: body.metadata,
        expiresAt: body.expiresAt,
        resourcePrev: body.resourcePrev as never,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      created(
        res,
        { leaseId, txHash: hash, credentials: body.credentials },
        { self: `/api/v1/markets/capabilities/${id}/leases/${leaseId}` },
      );
    } catch {
      internalError(res, 'Lease start failed');
    }
  });

  // ── GET /:id/leases — list leases for capability ──────────────
  r.get('/:id/leases', async (_req, res, route) => {
    const { id } = route.params;
    // MarketSearchStore does not index leases — return empty list
    ok(res, [], { self: `/api/v1/markets/capabilities/${id}/leases` });
  });

  // ── POST /:id/leases/:leaseId/actions/invoke ──────────────────
  r.post('/:id/leases/:leaseId/actions/invoke', async (_req, res, route) => {
    const { id, leaseId } = route.params;
    const v = validate(CapabilityInvokeSchema, route.body);
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
      const envelope = await createMarketCapabilityInvokeEnvelope({
        issuer: body.did,
        privateKey,
        leaseId,
        resource: body.resource,
        units: body.units as never,
        latency: body.latency,
        success: body.success,
        cost: body.cost != null ? String(body.cost) : undefined,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        {
          leaseId,
          txHash: hash,
          usage: {
            resource: body.resource,
            units: body.units,
            latency: body.latency,
            success: body.success,
          },
        },
        { self: `/api/v1/markets/capabilities/${id}/leases/${leaseId}` },
      );
    } catch {
      internalError(res, 'Capability invoke failed');
    }
  });

  // ── POST /:id/leases/:leaseId/actions/pause ───────────────────
  r.post('/:id/leases/:leaseId/actions/pause', async (_req, res, route) => {
    const { id, leaseId } = route.params;
    const v = validate(CapabilityLeaseActionSchema, route.body);
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
      const envelope = await createMarketCapabilityLeasePauseEnvelope({
        issuer: body.did,
        privateKey,
        leaseId,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { leaseId, txHash: hash, action: 'pause' },
        { self: `/api/v1/markets/capabilities/${id}/leases/${leaseId}` },
      );
    } catch {
      internalError(res, 'Lease pause failed');
    }
  });

  // ── POST /:id/leases/:leaseId/actions/resume ──────────────────
  r.post('/:id/leases/:leaseId/actions/resume', async (_req, res, route) => {
    const { id, leaseId } = route.params;
    const v = validate(CapabilityLeaseActionSchema, route.body);
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
      const envelope = await createMarketCapabilityLeaseResumeEnvelope({
        issuer: body.did,
        privateKey,
        leaseId,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { leaseId, txHash: hash, action: 'resume' },
        { self: `/api/v1/markets/capabilities/${id}/leases/${leaseId}` },
      );
    } catch {
      internalError(res, 'Lease resume failed');
    }
  });

  // ── POST /:id/leases/:leaseId/actions/terminate ───────────────
  r.post('/:id/leases/:leaseId/actions/terminate', async (_req, res, route) => {
    const { id, leaseId } = route.params;
    const v = validate(CapabilityLeaseActionSchema, route.body);
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
      const envelope = await createMarketCapabilityLeaseTerminateEnvelope({
        issuer: body.did,
        privateKey,
        leaseId,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { leaseId, txHash: hash, action: 'terminate' },
        { self: `/api/v1/markets/capabilities/${id}/leases/${leaseId}` },
      );
    } catch {
      internalError(res, 'Lease terminate failed');
    }
  });

  // ── Lease endpoints without listingId in path ──────────────────
  r.get('/leases/:leaseId', async (_req, res, route) => {
    const { leaseId } = route.params;
    ok(res, { leaseId }, { self: `/api/v1/markets/capabilities/leases/${leaseId}` });
  });

  r.post('/leases/:leaseId/actions/invoke', async (_req, res, route) => {
    const { leaseId } = route.params;
    const v = validate(CapabilityInvokeSchema, route.body);
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
      const envelope = await createMarketCapabilityInvokeEnvelope({
        issuer: body.did,
        privateKey,
        leaseId,
        resource: body.resource,
        units: body.units as never,
        latency: body.latency,
        success: body.success,
        cost: body.cost != null ? String(body.cost) : undefined,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { leaseId, txHash: hash },
        { self: `/api/v1/markets/capabilities/leases/${leaseId}` },
      );
    } catch {
      internalError(res, 'Capability invoke failed');
    }
  });

  r.post('/leases/:leaseId/actions/pause', async (_req, res, route) => {
    const { leaseId } = route.params;
    const v = validate(CapabilityLeaseActionSchema, route.body);
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
      const envelope = await createMarketCapabilityLeasePauseEnvelope({
        issuer: body.did,
        privateKey,
        leaseId,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { leaseId, txHash: hash, action: 'pause' },
        { self: `/api/v1/markets/capabilities/leases/${leaseId}` },
      );
    } catch {
      internalError(res, 'Lease pause failed');
    }
  });

  r.post('/leases/:leaseId/actions/resume', async (_req, res, route) => {
    const { leaseId } = route.params;
    const v = validate(CapabilityLeaseActionSchema, route.body);
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
      const envelope = await createMarketCapabilityLeaseResumeEnvelope({
        issuer: body.did,
        privateKey,
        leaseId,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { leaseId, txHash: hash, action: 'resume' },
        { self: `/api/v1/markets/capabilities/leases/${leaseId}` },
      );
    } catch {
      internalError(res, 'Lease resume failed');
    }
  });

  r.post('/leases/:leaseId/actions/terminate', async (_req, res, route) => {
    const { leaseId } = route.params;
    const v = validate(CapabilityLeaseActionSchema, route.body);
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
      const envelope = await createMarketCapabilityLeaseTerminateEnvelope({
        issuer: body.did,
        privateKey,
        leaseId,
        resourcePrev: body.prev ?? '',
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        { leaseId, txHash: hash, action: 'terminate' },
        { self: `/api/v1/markets/capabilities/leases/${leaseId}` },
      );
    } catch {
      internalError(res, 'Lease terminate failed');
    }
  });

  return r;
}
