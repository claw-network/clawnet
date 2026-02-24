/**
 * Escrow routes — /api/v1/escrows
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
import { EscrowCreateSchema, EscrowActionSchema, EscrowExpireSchema } from '../schemas/wallet.js';
import type { RuntimeContext } from '../types.js';
import {
  resolveAddress,
  resolvePrivateKey,
  addressFromDid,
  buildEscrowView,
  parseBigInt,
} from '../types.js';
import { buildWalletState } from '../legacy.js';
import {
  createWalletEscrowCreateEnvelope,
  createWalletEscrowFundEnvelope,
  createWalletEscrowReleaseEnvelope,
  createWalletEscrowRefundEnvelope,
} from '@claw-network/protocol';

export function escrowRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST / — create escrow ────────────────────────────────────
  r.post('/', async (_req, res, route) => {
    const v = validate(EscrowCreateSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    const beneficiary = resolveAddress(body.beneficiary);
    if (!beneficiary) {
      badRequest(res, 'Invalid beneficiary', route.url.pathname);
      return;
    }
    const escrowId =
      body.escrowId ?? `escrow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // On-chain
    if (ctx.walletService) {
      try {
        const result = await ctx.walletService.createEscrow({
          escrowId,
          beneficiary,
          arbiter: body.arbiter ? (resolveAddress(body.arbiter) ?? undefined) : undefined,
          amount: Number(body.amount),
          expiresAt: body.expiresAt,
        });
        created(res, result, { self: `/api/v1/escrows/${escrowId}` });
        return;
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    // Legacy
    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable', route.url.pathname);
      return;
    }

    try {
      const envelope = await createWalletEscrowCreateEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        depositor: addressFromDid(body.did),
        beneficiary,
        amount: String(body.amount),
        releaseRules: body.releaseRules,
        arbiter: body.arbiter,
        refundRules: body.refundRules,
        expiresAt: body.expiresAt,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce ?? 0,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);

      // Auto-fund
      if (body.autoFund !== false) {
        const fundEnvelope = await createWalletEscrowFundEnvelope({
          issuer: body.did,
          privateKey,
          escrowId,
          amount: String(body.amount),
          ts: (body.ts ?? Date.now()) + 1,
          nonce: (body.nonce ?? 0) + 1,
          prev: hash,
          resourcePrev: hash,
        });
        await ctx.publishEvent(fundEnvelope);
      }

      created(
        res,
        {
          id: escrowId,
          amount: Number(body.amount),
          released: 0,
          remaining: Number(body.amount),
          status: 'active',
          releaseConditions: body.releaseRules,
          createdAt: body.ts ?? Date.now(),
          expiresAt: body.expiresAt,
          expired: false,
          txHash: hash,
        },
        { self: `/api/v1/escrows/${escrowId}` },
      );
    } catch {
      internalError(res, 'Escrow creation failed');
    }
  });

  // ── GET / — list escrows ──────────────────────────────────────
  r.get('/', async (_req, res, route) => {
    const { page, perPage, offset } = parsePagination(route.query);
    const addressParam = route.query.get('address') ?? route.query.get('did');

    if (ctx.walletService) {
      try {
        const result = ctx.walletService.getEscrows?.(
          addressParam ? { address: resolveAddress(addressParam) ?? undefined } : undefined,
        );
        if (result) {
          const escrows = (result as unknown as Record<string, unknown>).items ?? result;
          paginated(res, escrows as unknown[], {
            page,
            perPage,
            total: result.total ?? 0,
            basePath: '/api/v1/escrows',
          });
          return;
        }
      } catch {
        /* fallthrough */
      }
    }

    // Legacy
    if (!ctx.eventStore) {
      ok(res, [], { self: '/api/v1/escrows' });
      return;
    }
    const state = await buildWalletState(ctx.eventStore);
    const all = Object.entries(state.escrows).map(([id, escrow]) => ({
      id,
      ...buildEscrowView(state, escrow),
    }));
    const slice = all.slice(offset, offset + perPage);
    paginated(res, slice, { page, perPage, total: all.length, basePath: '/api/v1/escrows' });
  });

  // ── GET /:id — single escrow ──────────────────────────────────
  r.get('/:id', async (_req, res, route) => {
    const { id } = route.params;

    if (ctx.walletService) {
      try {
        const result = await ctx.walletService.getEscrow(id);
        ok(res, result, { self: `/api/v1/escrows/${id}` });
        return;
      } catch {
        /* fallthrough */
      }
    }

    if (!ctx.eventStore) {
      notFound(res, `Escrow ${id} not found`);
      return;
    }
    const state = await buildWalletState(ctx.eventStore);
    const escrow = state.escrows[id];
    if (!escrow) {
      notFound(res, `Escrow ${id} not found`);
      return;
    }
    ok(res, { id, ...buildEscrowView(state, escrow) }, { self: `/api/v1/escrows/${id}` });
  });

  // ── POST /:id/actions/fund ────────────────────────────────────
  r.post('/:id/actions/fund', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(EscrowActionSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;
    if (ctx.walletService) {
      try {
        const result = await ctx.walletService.fundEscrow(id, Number(body.amount));
        ok(res, result, { self: `/api/v1/escrows/${id}` });
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
      const envelope = await createWalletEscrowFundEnvelope({
        issuer: body.did,
        privateKey,
        escrowId: id,
        amount: String(body.amount),
        resourcePrev: body.resourcePrev,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        {
          txHash: hash,
          amount: Number(body.amount),
          status: 'broadcast',
          timestamp: body.ts ?? Date.now(),
        },
        { self: `/api/v1/escrows/${id}` },
      );
    } catch {
      internalError(res, 'Escrow fund failed');
    }
  });

  // ── POST /:id/actions/release ─────────────────────────────────
  r.post('/:id/actions/release', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(EscrowActionSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;
    if (ctx.walletService) {
      try {
        const result = await ctx.walletService.releaseEscrow(id);
        ok(res, result, { self: `/api/v1/escrows/${id}` });
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
      const envelope = await createWalletEscrowReleaseEnvelope({
        issuer: body.did,
        privateKey,
        escrowId: id,
        amount: String(body.amount),
        ruleId: body.ruleId ?? 'manual',
        resourcePrev: body.resourcePrev,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        {
          txHash: hash,
          amount: Number(body.amount),
          status: 'broadcast',
          timestamp: body.ts ?? Date.now(),
        },
        { self: `/api/v1/escrows/${id}` },
      );
    } catch {
      internalError(res, 'Escrow release failed');
    }
  });

  // ── POST /:id/actions/refund ──────────────────────────────────
  r.post('/:id/actions/refund', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(EscrowActionSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;
    if (ctx.walletService) {
      try {
        const result = await ctx.walletService.refundEscrow(id);
        ok(res, result, { self: `/api/v1/escrows/${id}` });
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
      const envelope = await createWalletEscrowRefundEnvelope({
        issuer: body.did,
        privateKey,
        escrowId: id,
        amount: String(body.amount),
        reason: body.reason ?? 'manual',
        resourcePrev: body.resourcePrev,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        {
          txHash: hash,
          amount: Number(body.amount),
          status: 'broadcast',
          timestamp: body.ts ?? Date.now(),
        },
        { self: `/api/v1/escrows/${id}` },
      );
    } catch {
      internalError(res, 'Escrow refund failed');
    }
  });

  // ── POST /:id/actions/expire ──────────────────────────────────
  r.post('/:id/actions/expire', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(EscrowExpireSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;
    if (ctx.walletService) {
      try {
        const result = await ctx.walletService.expireEscrow(id);
        ok(res, result, { self: `/api/v1/escrows/${id}` });
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

    // Legacy: check expiration and choose release or refund
    if (!ctx.eventStore) {
      internalError(res, 'Event store unavailable');
      return;
    }
    const state = await buildWalletState(ctx.eventStore);
    const escrow = state.escrows[id];
    if (!escrow) {
      notFound(res, `Escrow ${id} not found`);
      return;
    }
    const expiresAt = typeof escrow.expiresAt === 'number' ? escrow.expiresAt : undefined;
    if (expiresAt && Date.now() <= expiresAt) {
      badRequest(res, 'Escrow has not expired yet', route.url.pathname);
      return;
    }
    const remaining = parseBigInt(escrow.balance);
    if (remaining <= 0n) {
      badRequest(res, 'Escrow already empty', route.url.pathname);
      return;
    }

    // Resolve resourcePrev from the last event related to this escrow
    let resPrev = '';
    for (let i = state.history.length - 1; i >= 0; i--) {
      const entry = state.history[i];
      if ((entry.payload as Record<string, unknown>).escrowId === id) {
        resPrev = entry.hash;
        break;
      }
    }

    try {
      const action = body.action ?? 'refund';
      let envelope: Record<string, unknown>;
      if (action === 'release') {
        envelope = await createWalletEscrowReleaseEnvelope({
          issuer: body.did,
          privateKey,
          escrowId: id,
          amount: String(remaining),
          ruleId: 'expired',
          resourcePrev: resPrev,
          ts: body.ts ?? Date.now(),
          nonce: body.nonce,
          prev: body.prev,
        });
      } else {
        envelope = await createWalletEscrowRefundEnvelope({
          issuer: body.did,
          privateKey,
          escrowId: id,
          amount: String(remaining),
          reason: 'expired',
          resourcePrev: resPrev,
          ts: body.ts ?? Date.now(),
          nonce: body.nonce,
          prev: body.prev,
        });
      }
      const hash = await ctx.publishEvent(envelope);
      ok(
        res,
        {
          txHash: hash,
          amount: Number(remaining),
          action,
          status: 'broadcast',
          timestamp: body.ts ?? Date.now(),
          expiresAt,
        },
        { self: `/api/v1/escrows/${id}` },
      );
    } catch {
      internalError(res, 'Escrow expire failed');
    }
  });

  // ── POST /:id/actions/dispute ─────────────────────────────────
  r.post('/:id/actions/dispute', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(EscrowActionSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }

    if (ctx.walletService) {
      try {
        const result = await ctx.walletService.disputeEscrow?.(id);
        if (result) {
          ok(res, result, { self: `/api/v1/escrows/${id}` });
          return;
        }
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    // No dedicated legacy envelope for escrow dispute — treat as generic action
    ok(
      res,
      { escrowId: id, status: 'disputed', timestamp: Date.now() },
      { self: `/api/v1/escrows/${id}` },
    );
  });

  // ── POST /:id/actions/resolve ─────────────────────────────────
  r.post('/:id/actions/resolve', async (_req, res, route) => {
    const { id } = route.params;
    const v = validate(EscrowActionSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    if (ctx.walletService) {
      try {
        const releaseToBeneficiary = body.resolution !== 'refund';
        const result = await ctx.walletService.resolveEscrow?.(id, releaseToBeneficiary);
        if (result) {
          ok(res, result, { self: `/api/v1/escrows/${id}` });
          return;
        }
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    ok(
      res,
      { escrowId: id, status: 'resolved', timestamp: Date.now() },
      { self: `/api/v1/escrows/${id}` },
    );
  });

  return r;
}
