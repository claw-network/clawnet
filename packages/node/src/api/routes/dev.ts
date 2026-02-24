/**
 * Dev-only routes — /api/v1/dev
 *
 * These routes are intended for development / testnet use only.
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError } from '../response.js';
import { validate } from '../schemas/common.js';
import { z } from 'zod';
import type { RuntimeContext } from '../types.js';
import { resolveAddress, resolvePrivateKey } from '../types.js';
import { createWalletMintEnvelope } from '@claw-network/protocol';

const FaucetSchema = z
  .object({
    address: z.string().min(1).optional(),
    did: z.string().min(1).optional(),
    amount: z.number().int().positive().optional(),
  })
  .refine((d) => d.address || d.did, { message: 'address or did required' });

export function devRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST /faucet — dev-mode token mint ────────────────────────
  r.post('/faucet', async (_req, res, route) => {
    const v = validate(FaucetSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const body = v.data;

    const to = resolveAddress(body.address ?? body.did ?? '');
    if (!to) {
      badRequest(res, 'Invalid address', route.url.pathname);
      return;
    }
    const amount = body.amount ?? 1000;

    // On-chain faucet
    if (ctx.walletService) {
      try {
        const walletService = ctx.walletService as unknown as {
          transfer?: (...args: unknown[]) => Promise<unknown>;
        };
        const result = await walletService.transfer?.('faucet', to, amount, 'dev-faucet-mint');
        if (result) {
          ok(res, result, { self: '/api/v1/dev/faucet' });
          return;
        }
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
    }

    // Legacy: create mint envelope using node's own identity
    try {
      const nodeStatus = await ctx.getNodeStatus?.();
      const nodeDid = typeof nodeStatus?.did === 'string' ? nodeStatus.did : '';
      const passphrase = process.env.CLAW_PASSPHRASE ?? '';
      if (!nodeDid || !passphrase) {
        internalError(res, 'Faucet requires node identity and CLAW_PASSPHRASE');
        return;
      }
      const privateKey = await resolvePrivateKey(ctx.config.dataDir, nodeDid, passphrase);
      if (!privateKey) {
        internalError(res, 'Could not resolve node private key for faucet signing');
        return;
      }
      const envelope = await createWalletMintEnvelope({
        issuer: nodeDid,
        privateKey,
        to,
        amount: String(amount),
        ts: Date.now(),
        nonce: 0,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { txHash: hash, to, amount, status: 'broadcast' }, { self: '/api/v1/dev/faucet' });
    } catch (err) {
      internalError(res, (err as Error).message || 'Faucet mint failed');
    }
  });

  return r;
}
