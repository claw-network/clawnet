/**
 * Nonce routes — /api/v1/nonce
 *
 * Returns the EVM transaction count (nonce) for the address
 * derived from a DID or for a raw 0x… address.
 */

import { Router } from '../router.js';
import { ok, badRequest, notFound, internalError } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { isValidDid } from '../types.js';
import { deriveAddressForDid } from '../../services/identity-service.js';

/**
 * Resolve the input (DID or 0x address) to an EVM address.
 *
 * - `did:claw:…` → on-chain identity lookup (controller), fallback to
 *   deterministic derivation.
 * - `0x…` → pass through.
 */
async function resolveToEvmAddress(
  ctx: RuntimeContext,
  input: string,
): Promise<string | null> {
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) return input;

  if (input.startsWith('did:claw:')) {
    // Try on-chain registry first
    if (ctx.walletService) {
      const addr = await ctx.walletService.resolveDidToAddress(input);
      if (addr) return addr;
    }
    // Fallback to deterministic derivation
    return deriveAddressForDid(input);
  }

  return null;
}

export function nonceRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── GET /:did — transaction nonce for a DID / address ─────────
  r.get('/:did', async (_req, res, route) => {
    const { did } = route.params;

    if (!isValidDid(did) && !/^0x[0-9a-fA-F]{40}$/.test(did)) {
      badRequest(res, 'Invalid DID or EVM address', route.url.pathname);
      return;
    }

    if (!ctx.walletService) {
      internalError(res, 'Wallet service unavailable');
      return;
    }

    const evmAddr = await resolveToEvmAddress(ctx, did);
    if (!evmAddr) {
      notFound(res, 'Could not resolve address for the given DID', route.url.pathname);
      return;
    }

    try {
      const result = await ctx.walletService.getNonce(evmAddr);
      ok(
        res,
        {
          did: did.startsWith('did:claw:') ? did : undefined,
          address: result.address,
          nonce: result.nonce,
        },
        { self: `/api/v1/nonce/${encodeURIComponent(did)}` },
      );
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  return r;
}
