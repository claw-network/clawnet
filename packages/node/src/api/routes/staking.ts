/**
 * Staking routes — /api/v1/staking
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError } from '../response.js';
import type { RuntimeContext } from '../types.js';

export function stakingRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── GET / — global staking info ────────────────────────────────
  r.get('/', async (_req, res) => {
    if (!ctx.stakingService) {
      internalError(res, 'Staking service unavailable');
      return;
    }
    try {
      const info = await ctx.stakingService.getInfo();
      ok(res, info, { self: '/api/v1/staking' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── GET /validators — active validator list ────────────────────
  r.get('/validators', async (_req, res) => {
    if (!ctx.stakingService) {
      internalError(res, 'Staking service unavailable');
      return;
    }
    try {
      const validators = await ctx.stakingService.getActiveValidators();
      ok(res, { validators, count: validators.length }, { self: '/api/v1/staking/validators' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── GET /:address — staker info ────────────────────────────────
  r.get('/:address', async (_req, res, route) => {
    if (!ctx.stakingService) {
      internalError(res, 'Staking service unavailable');
      return;
    }
    const { address } = route.params;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      badRequest(res, 'Invalid EVM address', route.url.pathname);
      return;
    }
    try {
      const staker = await ctx.stakingService.getStaker(address);
      ok(res, staker, { self: `/api/v1/staking/${address}` });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /stake — stake tokens ─────────────────────────────────
  r.post('/stake', async (_req, res, route) => {
    if (!ctx.stakingService) {
      internalError(res, 'Staking service unavailable');
      return;
    }
    const { amount, nodeType } = (route.body ?? {}) as { amount?: number; nodeType?: number };
    if (typeof amount !== 'number' || amount <= 0) {
      badRequest(res, 'amount must be a positive integer', route.url.pathname);
      return;
    }
    try {
      const result = await ctx.stakingService.stake(amount, nodeType ?? 0);
      ok(res, result, { self: '/api/v1/staking/stake' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /request-unstake — begin unstake cooldown ─────────────
  r.post('/request-unstake', async (_req, res) => {
    if (!ctx.stakingService) {
      internalError(res, 'Staking service unavailable');
      return;
    }
    try {
      const result = await ctx.stakingService.requestUnstake();
      ok(res, result, { self: '/api/v1/staking/request-unstake' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /unstake — complete unstake after cooldown ────────────
  r.post('/unstake', async (_req, res) => {
    if (!ctx.stakingService) {
      internalError(res, 'Staking service unavailable');
      return;
    }
    try {
      const result = await ctx.stakingService.unstake();
      ok(res, result, { self: '/api/v1/staking/unstake' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /claim-rewards — claim pending staking rewards ────────
  r.post('/claim-rewards', async (_req, res) => {
    if (!ctx.stakingService) {
      internalError(res, 'Staking service unavailable');
      return;
    }
    try {
      const result = await ctx.stakingService.claimRewards();
      ok(res, result, { self: '/api/v1/staking/claim-rewards' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  return r;
}
