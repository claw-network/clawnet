/**
 * Market dispute routes — /api/v1/markets/disputes
 */

import { Router } from '../router.js';
import {
  ok, created, badRequest, internalError,
} from '../response.js';
import { validate } from '../schemas/common.js';
import {
  DisputeOpenSchema, DisputeResponseSchema, DisputeResolveSchema,
} from '../schemas/markets.js';
import type { RuntimeContext } from '../types.js';
import { resolvePrivateKey } from '../types.js';
import {
  createMarketDisputeOpenEnvelope,
  createMarketDisputeResponseEnvelope,
  createMarketDisputeResolveEnvelope,
} from '@claw-network/protocol';

export function marketsDisputeRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST / — open dispute on an order ─────────────────────────
  r.post('/', async (_req, res, route) => {
    const v = validate(DisputeOpenSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;
    const disputeId = body.disputeId ?? `dispute-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const envelope = await createMarketDisputeOpenEnvelope({
        issuer: body.did, privateKey, disputeId,
        orderId: (body as Record<string, unknown>).orderId as string ?? '',
        type: body.type, description: body.description,
        claimAmount: body.claimAmount != null ? String(body.claimAmount) : undefined,
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      created(res, {
        disputeId, txHash: hash, type: body.type,
        status: 'open', createdAt: body.ts ?? Date.now(),
      }, { self: `/api/v1/markets/disputes/${disputeId}` });
    } catch (err) { internalError(res, (err as Error).message || 'Dispute open failed'); }
  });

  // ── POST /:id/actions/respond — respond to dispute ────────────
  r.post('/:id/actions/respond', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(DisputeResponseSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const envelope = await createMarketDisputeResponseEnvelope({
        issuer: body.did, privateKey, disputeId: id,
        resourcePrev: body.prev ?? '',
        response: body.response, evidence: body.evidence,
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { disputeId: id, txHash: hash, status: 'responded' },
        { self: `/api/v1/markets/disputes/${id}` });
    } catch (err) { internalError(res, (err as Error).message || 'Dispute response failed'); }
  });

  // ── POST /:id/actions/resolve — resolve dispute ───────────────
  r.post('/:id/actions/resolve', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(DisputeResolveSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }
    try {
      const envelope = await createMarketDisputeResolveEnvelope({
        issuer: body.did, privateKey, disputeId: id,
        resourcePrev: body.prev ?? '',
        resolution: body.resolution, notes: body.notes,
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { disputeId: id, txHash: hash, resolution: body.resolution, status: 'resolved' },
        { self: `/api/v1/markets/disputes/${id}` });
    } catch (err) { internalError(res, (err as Error).message || 'Dispute resolve failed'); }
  });

  return r;
}
