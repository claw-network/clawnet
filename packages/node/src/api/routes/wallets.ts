/**
 * Wallet routes — /api/v1/wallets
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError, paginated, parsePagination } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { resolveAddress } from '../types.js';
import { buildWalletState } from '../legacy.js';
import { getWalletBalance } from '@claw-network/protocol';

/**
 * For the on-chain path, resolve the user-supplied address/DID to an
 * EVM address that contract calls understand.
 * - DID → look up on-chain identity registry → controller (0x…)
 * - 0x… → pass through
 * - claw1… → not valid for on-chain path (needs DID or 0x)
 */
async function resolveEvmAddress(
  ctx: RuntimeContext,
  input: string,
): Promise<string | null> {
  // Already an EVM hex address
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) return input;

  // DID → resolve via on-chain identity registry
  if (input.startsWith('did:claw:') && ctx.walletService) {
    return ctx.walletService.resolveDidToAddress(input);
  }

  return null;
}

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
      const evmAddr = await resolveEvmAddress(ctx, address);
      if (evmAddr) {
        try {
          const balance = await ctx.walletService.getBalance(evmAddr);
          ok(res, balance, { self: `/api/v1/wallets/${address}` });
          return;
        } catch (err) {
          internalError(res, (err as Error).message);
          return;
        }
      }
      // DID not registered on-chain — fall through to legacy path
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
      const evmAddr = await resolveEvmAddress(ctx, address);
      if (evmAddr) {
        try {
          const result = await ctx.walletService.getHistory(evmAddr, {
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
      // DID not registered on-chain — fall through to legacy path
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
