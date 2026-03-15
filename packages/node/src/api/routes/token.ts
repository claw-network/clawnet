/**
 * Token admin routes — /api/v1/token
 *
 * Supply info, mint/burn (node signer must hold MINTER_ROLE / BURNER_ROLE),
 * and distribution overview (balances at well-known ecosystem addresses).
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError } from '../response.js';
import { validate } from '../schemas/common.js';
import { z } from 'zod';
import type { RuntimeContext } from '../types.js';

// ── Request schemas ─────────────────────────────────────────────

const MintSchema = z.object({
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address'),
  amount: z.number().int().positive(),
  memo: z.string().optional(),
});

const BurnSchema = z.object({
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address'),
  amount: z.number().int().positive(),
  memo: z.string().optional(),
});

const TransferSchema = z.object({
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address'),
  amount: z.number().int().positive(),
  memo: z.string().optional(),
});

// ── Route module ────────────────────────────────────────────────

export function tokenRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── GET /supply — token supply overview ────────────────────────
  r.get('/supply', async (_req, res) => {
    if (!ctx.walletService) {
      internalError(res, 'Token service unavailable');
      return;
    }
    try {
      const token = ctx.walletService['contracts'].token;
      const [totalSupply, name, symbol, decimals] = await Promise.all([
        token.totalSupply(),
        token.name(),
        token.symbol(),
        token.decimals(),
      ]);
      ok(res, {
        name,
        symbol,
        decimals: Number(decimals),
        totalSupply: totalSupply.toString(),
      }, { self: '/api/v1/token/supply' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── GET /distribution — ecosystem fund balances ────────────────
  r.get('/distribution', async (_req, res) => {
    if (!ctx.walletService || !ctx.daoService) {
      internalError(res, 'Token service unavailable');
      return;
    }
    try {
      const token = ctx.walletService['contracts'].token;
      const treasury = await ctx.daoService.getTreasuryBalance();

      // Signer (node operator) balance
      const signerAddress = ctx.walletService['contracts'].signerAddress;
      const signerBalance = await token.balanceOf(signerAddress);

      // Staking contract balance (if staking available)
      let stakingBalance = '0';
      let stakingAddress = '';
      if (ctx.stakingService) {
        const staking = ctx.stakingService['contracts'].staking;
        stakingAddress = await staking.getAddress();
        const bal = await token.balanceOf(stakingAddress);
        stakingBalance = bal.toString();
      }

      ok(res, {
        treasury: {
          address: treasury.daoAddress,
          balance: treasury.balance,
        },
        staking: {
          address: stakingAddress,
          balance: stakingBalance,
        },
        signer: {
          address: signerAddress,
          balance: signerBalance.toString(),
        },
      }, { self: '/api/v1/token/distribution' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /transfer — transfer tokens from node signer ──────────
  r.post('/transfer', async (_req, res, route) => {
    if (!ctx.walletService) {
      internalError(res, 'Token service unavailable');
      return;
    }
    const v = validate(TransferSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    try {
      const signerAddress = ctx.walletService['contracts'].signerAddress;
      const result = await ctx.walletService.transfer(
        signerAddress,
        v.data.to,
        v.data.amount,
        v.data.memo,
      );
      ok(res, result, { self: '/api/v1/token/transfer' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /mint — mint tokens (requires MINTER_ROLE) ────────────
  r.post('/mint', async (_req, res, route) => {
    if (!ctx.walletService) {
      internalError(res, 'Token service unavailable');
      return;
    }
    const v = validate(MintSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    try {
      const result = await ctx.walletService.mint(v.data.to, v.data.amount, v.data.memo);
      ok(res, result, { self: '/api/v1/token/mint' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /burn — burn tokens (requires BURNER_ROLE) ────────────
  r.post('/burn', async (_req, res, route) => {
    if (!ctx.walletService) {
      internalError(res, 'Token service unavailable');
      return;
    }
    const v = validate(BurnSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    try {
      const token = ctx.walletService['contracts'].token;
      const tx = await token.burn(v.data.from, v.data.amount);
      const receipt = await tx.wait();
      ok(res, {
        txHash: receipt.hash,
        from: v.data.from,
        amount: String(v.data.amount),
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        timestamp: Date.now(),
      }, { self: '/api/v1/token/burn' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  return r;
}
