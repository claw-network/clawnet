import { Router } from '../router.js';
import { ok } from '../response.js';
import { handleError } from '../route-utils.js';
import type { RuntimeContext } from '../types.js';

export function walletRoutes(ctx: RuntimeContext): Router {
  const router = new Router();

  router.get('/:did/gas-balance', async ({ res, params, url }) => {
    try {
      const balance = await ctx.clawnetGateway.getBalance(params.did);

      ok(
        res,
        {
          did: balance.did,
          address: balance.address,
          nativeBalance: balance.native,
          tokenBalance: balance.token,
        },
        { self: `/api/v1/wallets/${encodeURIComponent(params.did)}/gas-balance` },
      );
    } catch (error) {
      handleError(res, error, url.pathname);
    }
  });

  return router;
}
