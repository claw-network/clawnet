/**
 * Wallet routes — /api/v1/wallets
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError, paginated, parsePagination } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { resolveAddress } from '../types.js';
import { buildWalletState } from '../legacy.js';
import { getWalletBalance } from '@claw-network/protocol';

export function walletRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── GET /:address — wallet info + balance ─────────────────────
  r.get('/:address', async (_req, res, route) => {
    const { address } = route.params;
    const resolved = resolveAddress(address);
    if (!resolved) {
      badRequest(res, 'Invalid address or DID', route.url.pathname);
      return;
    }

    // On-chain path
    if (ctx.walletService) {
      try {
        const balance = await ctx.walletService.getBalance(resolved);
        ok(res, balance, { self: `/api/v1/wallets/${address}` });
        return;
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    // Legacy fallback
    if (!ctx.eventStore) {
      internalError(res, 'Wallet service unavailable');
      return;
    }
    const state = await buildWalletState(ctx.eventStore);
    const balance = getWalletBalance(state, resolved);
    const total =
      BigInt(balance.available) +
      BigInt(balance.pending) +
      BigInt(balance.locked.escrow) +
      BigInt(balance.locked.governance);
    ok(
      res,
      {
        address: resolved,
        balance: Number(total),
        available: Number(balance.available),
        pending: Number(balance.pending),
        locked: Number(balance.locked.escrow),
      },
      { self: `/api/v1/wallets/${address}` },
    );
  });

  // ── GET /:address/transactions — transaction history ──────────
  r.get('/:address/transactions', async (_req, res, route) => {
    const { address } = route.params;
    const resolved = resolveAddress(address);
    if (!resolved) {
      badRequest(res, 'Invalid address or DID', route.url.pathname);
      return;
    }

    const { page, perPage, offset } = parsePagination(route.query);
    const typeFilter = route.query.get('type') ?? undefined;

    // On-chain path
    if (ctx.walletService) {
      try {
        const result = await ctx.walletService.getHistory(resolved, {
          limit: perPage,
          offset,
          type: typeFilter,
        });
        const items = Array.isArray(result.transactions) ? result.transactions : [];
        paginated(res, items, {
          page,
          perPage,
          total: result.total ?? items.length,
          basePath: `/api/v1/wallets/${address}/transactions`,
          query: typeFilter ? { type: typeFilter } : {},
        });
        return;
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    // Legacy fallback
    if (!ctx.eventStore) {
      internalError(res, 'Wallet service unavailable');
      return;
    }
    const state = await buildWalletState(ctx.eventStore);
    const all = state.history.filter((tx) => {
      const p = tx.payload as Record<string, unknown>;
      const from = p.from as string | undefined;
      const to = p.to as string | undefined;
      return from === resolved || to === resolved;
    });
    const filtered = typeFilter ? all.filter((tx) => tx.type === typeFilter) : all;
    const slice = filtered.slice(offset, offset + perPage);
    paginated(res, slice, {
      page,
      perPage,
      total: filtered.length,
      basePath: `/api/v1/wallets/${address}/transactions`,
      query: typeFilter ? { type: typeFilter } : {},
    });
  });

  return r;
}
