/**
 * Reputation routes — /api/v1/reputations
 */

import { Router } from '../router.js';
import { ok, created, badRequest, notFound, internalError, paginated, parsePagination } from '../response.js';
import { validate } from '../schemas/common.js';
import { ReputationRecordSchema } from '../schemas/markets.js';
import type { RuntimeContext } from '../types.js';
import { isValidDid, resolvePrivateKey } from '../types.js';
import {
  createReputationRecordEnvelope,
  createReputationState,
  applyReputationEvent,
  buildReputationProfile,
  getReputationRecords,
} from '@claw-network/protocol';
import { parseEvent } from '../legacy.js';

export function reputationRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── GET /:did — reputation profile ────────────────────────────
  r.get('/:did', async (_req, res, route) => {
    const { did } = route.params;
    if (!isValidDid(did)) { badRequest(res, 'Invalid DID', route.url.pathname); return; }

    // On-chain
    if (ctx.reputationService) {
      try {
        const profile = await ctx.reputationService.getProfile(did);
        if (profile) {
          const p = profile as unknown as Record<string, unknown>;
          const deliveryStats = ctx.reputationService.getDeliveryStats(did);
          ok(res, {
            did,
            score: p.score ?? p.overallScore ?? 0,
            level: 'anchored',
            dimensions: (profile as unknown as Record<string, unknown>).dimensions ?? {},
            epoch: (profile as unknown as Record<string, unknown>).epoch ?? 0,
            merkleRoot: (profile as unknown as Record<string, unknown>).merkleRoot ?? '',
            timestamp: (profile as unknown as Record<string, unknown>).timestamp ?? Date.now(),
            deliveryStats,
          }, { self: `/api/v1/reputations/${did}` });
          return;
        }
      } catch { /* fallthrough */ }
    }

    // Legacy: reputationStore or eventStore
    if (ctx.reputationStore) {
      try {
        const profile = await ctx.reputationStore.getProfile(did);
        if (profile) {
          ok(res, profile, { self: `/api/v1/reputations/${did}` });
          return;
        }
      } catch { /* fallthrough */ }
    }

    if (!ctx.eventStore) { notFound(res, `No reputation data for ${did}`); return; }
    let state = createReputationState();
    let cursor: string | null = null;
    for (;;) {
      const { events, cursor: next } = await ctx.eventStore.getEventLogRange(cursor, 200);
      if (!events.length) break;
      for (const bytes of events) {
        const envelope = parseEvent(bytes);
        if (envelope) state = applyReputationEvent(state, envelope);
      }
      if (!next) break;
      cursor = next;
    }
    const profile = buildReputationProfile(state, did);
    const p = profile as unknown as Record<string, unknown>;
    ok(res, {
      did,
      score: p.overallScore ?? p.score ?? 0,
      level: p.level ?? 'none',
      dimensions: p.dimensions ?? {},
      updatedAt: p.updatedAt ?? Date.now(),
    }, { self: `/api/v1/reputations/${did}` });
  });

  // ── GET /:did/reviews — reviews for a DID ────────────────────
  r.get('/:did/reviews', async (_req, res, route) => {
    const { did } = route.params;
    if (!isValidDid(did)) { badRequest(res, 'Invalid DID', route.url.pathname); return; }
    const { page, perPage, offset } = parsePagination(route.query);

    // On-chain
    if (ctx.reputationService) {
      try {
        const result = await ctx.reputationService.getReviews(did, { limit: perPage, offset });
        if (result) {
          const r2 = result as unknown as Record<string, unknown>;
          paginated(res, (r2.reviews ?? []) as unknown[], {
            page, perPage, total: (r2.total ?? 0) as number,
            basePath: `/api/v1/reputations/${did}/reviews`,
          });
          return;
        }
      } catch { /* fallthrough */ }
    }

    // Legacy
    if (ctx.reputationStore) {
      try {
        const records = await ctx.reputationStore.getRecords(did);
        const allRecords = (records ?? []) as unknown as Record<string, unknown>[];
        const reviews = allRecords
          .filter((rec) => (rec as Record<string, unknown>).dimension === 'quality')
          .map((rec) => ({
            id: rec.id, contractId: rec.ref, reviewer: rec.issuer, reviewee: did,
            rating: rec.score, comment: rec.comment, aspects: rec.aspects,
            createdAt: rec.createdAt ?? rec.ts,
          }));
        const slice = reviews.slice(offset, offset + perPage);
        paginated(res, slice, {
          page, perPage, total: reviews.length,
          basePath: `/api/v1/reputations/${did}/reviews`,
        });
        return;
      } catch { /* fallthrough */ }
    }

    // Bare eventStore fallback
    if (!ctx.eventStore) {
      paginated(res, [], { page, perPage, total: 0, basePath: `/api/v1/reputations/${did}/reviews` });
      return;
    }
    let state = createReputationState();
    let cursor: string | null = null;
    for (;;) {
      const { events, cursor: next } = await ctx.eventStore.getEventLogRange(cursor, 200);
      if (!events.length) break;
      for (const bytes of events) {
        const envelope = parseEvent(bytes);
        if (envelope) state = applyReputationEvent(state, envelope);
      }
      if (!next) break;
      cursor = next;
    }
    const records = getReputationRecords(state, did);
    const qualityRecords = records.filter((rec) => rec.dimension === 'quality');
    const slice = qualityRecords.slice(offset, offset + perPage);
    paginated(res, slice, {
      page, perPage, total: qualityRecords.length,
      basePath: `/api/v1/reputations/${did}/reviews`,
    });
  });

  // ── POST /:did/reviews — record a reputation review ───────────
  r.post('/:did/reviews', async (_req, res, route) => {
    const { did } = route.params;
    const v = validate(ReputationRecordSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    // On-chain
    if (ctx.reputationService) {
      try {
        const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const result = await ctx.reputationService.recordReview(
          reviewId, body.did, body.target, body.ref,
        );
        const r2 = result as unknown as Record<string, unknown>;
        created(res, { txHash: r2.txHash ?? result, status: 'confirmed', timestamp: Date.now() },
          { self: `/api/v1/reputations/${did}/reviews` });
        return;
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    // Legacy
    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) { badRequest(res, 'Key unavailable', route.url.pathname); return; }

    try {
      const envelope = await createReputationRecordEnvelope({
        issuer: body.did, privateKey, target: body.target,
        dimension: body.dimension as never,
        score: Number(body.score), ref: body.ref,
        comment: body.comment,
        aspects: body.aspects as Record<string, number> | undefined,
        ts: body.ts ?? Date.now(), nonce: body.nonce, prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      created(res, { txHash: hash, status: 'broadcast', timestamp: body.ts ?? Date.now() },
        { self: `/api/v1/reputations/${did}/reviews` });
    } catch { internalError(res, 'Reputation record failed'); }
  });

  // ── POST /:did/anchor — anchor reputation on-chain ────────────
  r.post('/:did/anchor', async (_req, res, route) => {
    const { did } = route.params;
    if (!isValidDid(did)) { badRequest(res, 'Invalid DID', route.url.pathname); return; }

    if (ctx.reputationService) {
      try {
        // Build reputation profile to get required params
        let overallScore = 0;
        let dimensionScores: [number, number, number, number, number] = [0, 0, 0, 0, 0];
        let merkleRoot = '';

        const profile = await ctx.reputationService.getProfile(did);
        if (profile) {
          const p = profile as unknown as Record<string, unknown>;
          overallScore = (p.score ?? p.overallScore ?? 0) as number;
          const dims = p.dimensions as Record<string, unknown> | undefined;
          if (dims) {
            dimensionScores = [
              (dims.transaction ?? 0) as number,
              (dims.fulfillment ?? 0) as number,
              (dims.quality ?? 0) as number,
              (dims.social ?? 0) as number,
              (dims.behavior ?? 0) as number,
            ];
          }
          merkleRoot = (p.merkleRoot ?? '') as string;
        }

        const result = await ctx.reputationService.anchorReputation(
          did, overallScore, dimensionScores, merkleRoot,
        );
        if (result) {
          const r2 = result as unknown as Record<string, unknown>;
          ok(res, { did, txHash: r2.txHash, status: 'anchored', timestamp: Date.now() },
            { self: `/api/v1/reputations/${did}` });
          return;
        }
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    // Legacy: no on-chain anchor available
    badRequest(res, 'Reputation anchoring requires on-chain service', route.url.pathname);
  });

  return r;
}
