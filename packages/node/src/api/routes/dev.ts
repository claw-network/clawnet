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
import { resolveAddress } from '../types.js';
import { createWalletMintEnvelope } from '@claw-network/protocol';

const FaucetSchema = z.object({
  address: z.string().min(1).optional(),
  did: z.string().min(1).optional(),
  amount: z.number().int().positive().optional(),
}).refine((d) => d.address || d.did, { message: 'address or did required' });

export function devRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST /faucet — dev-mode token mint ────────────────────────
  r.post('/faucet', async (_req, res, route) => {
    const v = validate(FaucetSchema, route.body);
    if (!v.success) { badRequest(res, v.error, route.url.pathname); return; }
    const body = v.data;

    const to = resolveAddress(body.address ?? body.did ?? '');
    if (!to) { badRequest(res, 'Invalid address', route.url.pathname); return; }
    const amount = body.amount ?? 1000;

    // On-chain faucet
    if (ctx.walletService) {
      try {
        const result = await (ctx.walletService as unknown as Record<string, Function>).transfer?.(to, amount);
        if (result) { ok(res, result, { self: '/api/v1/dev/faucet' }); return; }
      } catch (err) { internalError(res, (err as Error).message); return; }
    }

    // Legacy: create mint envelope
    try {
      const envelope = await createWalletMintEnvelope({
        issuer: 'system', privateKey: new Uint8Array(64),
        to, amount: String(amount), ts: Date.now(), nonce: 0,
      });
      const hash = await ctx.publishEvent(envelope);
      ok(res, { txHash: hash, to, amount, status: 'broadcast' },
        { self: '/api/v1/dev/faucet' });
    } catch { internalError(res, 'Faucet mint failed'); }
  });

  return r;
}
