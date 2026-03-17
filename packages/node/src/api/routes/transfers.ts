/**
 * Transfer routes — /api/v1/transfers
 */

import { Router } from '../router.js';
import { created, badRequest, internalError } from '../response.js';
import { validate } from '../schemas/common.js';
import { TransferSchema } from '../schemas/wallet.js';
import type { RuntimeContext } from '../types.js';
import { resolveAddress, resolvePrivateKey, addressFromDid } from '../types.js';
import { createWalletTransferEnvelope } from '@claw-network/protocol';
import { deriveAddressForDid } from '../../services/identity-service.js';

/**
 * Resolve a DID or 0x address to an EVM address.
 * On-chain registry first, then deterministic derivation.
 */
async function resolveEvmAddress(
  ctx: RuntimeContext,
  input: string,
): Promise<string | null> {
  if (/^0x[0-9a-fA-F]{40}$/.test(input)) return input;
  if (input.startsWith('did:claw:')) {
    if (ctx.walletService) {
      const addr = await ctx.walletService.resolveDidToAddress(input);
      if (addr) return addr;
    }
    return deriveAddressForDid(input);
  }
  return null;
}

export function transferRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST / — transfer Tokens ──────────────────────────────────
  r.post('/', async (_req, res, route) => {
    const v = validate(TransferSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    const to = resolveAddress(body.to);
    if (!to) {
      badRequest(res, 'Invalid recipient address', route.url.pathname);
      return;
    }
    const from = addressFromDid(body.did);

    // On-chain path
    if (ctx.walletService) {
      try {
        // Resolve sender & receiver DIDs → EVM addresses
        const evmFrom = await resolveEvmAddress(ctx, body.did);
        const evmTo = await resolveEvmAddress(ctx, body.to);

        if (!evmFrom) {
          badRequest(res, 'Sender DID could not be resolved to an EVM address', route.url.pathname);
          return;
        }
        if (!evmTo) {
          badRequest(res, 'Recipient address could not be resolved to an EVM address', route.url.pathname);
          return;
        }

        const result = await ctx.walletService.transfer(evmFrom, evmTo, BigInt(body.amount), body.memo);
        created(res, result, { self: `/api/v1/wallets/${from}` });
        return;
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    // Legacy: sign & publish event
    const privateKey = await resolvePrivateKey(ctx.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      badRequest(res, 'Key unavailable — check DID and passphrase', route.url.pathname);
      return;
    }

    try {
      const envelope = await createWalletTransferEnvelope({
        issuer: body.did,
        privateKey,
        from,
        to,
        amount: String(body.amount),
        fee: body.fee != null ? String(body.fee) : '0',
        memo: body.memo,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await ctx.publishEvent(envelope);
      created(
        res,
        {
          txHash: hash,
          from,
          to,
          amount: String(body.amount),
          status: 'broadcast',
          timestamp: body.ts ?? Date.now(),
        },
        { self: `/api/v1/wallets/${from}` },
      );
    } catch {
      internalError(res, 'Transfer publish failed');
    }
  });

  return r;
}
