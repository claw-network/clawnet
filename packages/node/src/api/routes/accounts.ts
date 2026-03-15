/**
 * Accounts routes — /api/v1/accounts
 *
 * Aggregated view of all system accounts: node signer, DID identity,
 * consensus validators (QBFT), treasury, and key contract addresses.
 */

import { Router } from '../router.js';
import { ok, internalError } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { deriveAddressForDid } from '../../services/identity-service.js';

export function accountsRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── GET / — all system accounts overview ────────────────────────
  r.get('/', async (_req, res) => {
    try {
      const accounts: Record<string, unknown> = {};

      // 1. Node signer (deployer)
      if (ctx.walletService) {
        const contracts = ctx.walletService['contracts'];
        const signerAddress = contracts.signerAddress;
        const token = contracts.token;
        const signerBalance = await token.balanceOf(signerAddress).catch(() => 0n);

        // Check roles
        const MINTER_ROLE = '0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6';
        const BURNER_ROLE = '0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848';
        const ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';
        const [hasMinter, hasBurner, hasAdmin] = await Promise.all([
          token.hasRole(MINTER_ROLE, signerAddress).catch(() => false),
          token.hasRole(BURNER_ROLE, signerAddress).catch(() => false),
          token.hasRole(ADMIN_ROLE, signerAddress).catch(() => false),
        ]);

        accounts.signer = {
          address: signerAddress,
          balance: signerBalance.toString(),
          roles: {
            minter: hasMinter,
            burner: hasBurner,
            admin: hasAdmin,
          },
        };
      }

      // 2. Node identity (DID + derived EVM address)
      const did = ctx.getNodeStatus
        ? ((await ctx.getNodeStatus()).did as string | undefined)
        : undefined;
      if (did && did.startsWith('did:claw:')) {
        const derivedAddress = deriveAddressForDid(did);
        let derivedBalance = '0';
        if (ctx.walletService) {
          const token = ctx.walletService['contracts'].token;
          derivedBalance = (await token.balanceOf(derivedAddress).catch(() => 0n)).toString();
        }
        accounts.identity = {
          did,
          evmAddress: derivedAddress,
          balance: derivedBalance,
        };
      }

      // 3. QBFT consensus validators (from chain RPC)
      if (ctx.walletService) {
        const provider = ctx.walletService['contracts'].provider;
        try {
          const result = await provider.send('qbft_getValidatorsByBlockNumber', ['latest']);
          accounts.validators = {
            addresses: result,
            count: Array.isArray(result) ? result.length : 0,
            type: 'QBFT',
          };
        } catch {
          // Might be Clique instead of QBFT, try clique_getSigners
          try {
            const result = await provider.send('clique_getSigners', ['latest']);
            accounts.validators = {
              addresses: result,
              count: Array.isArray(result) ? result.length : 0,
              type: 'Clique',
            };
          } catch {
            accounts.validators = { addresses: [], count: 0, type: 'unknown' };
          }
        }
      }

      // 4. Treasury (DAO)
      if (ctx.daoService) {
        try {
          const treasury = await ctx.daoService.getTreasuryBalance();
          accounts.treasury = {
            address: treasury.daoAddress,
            balance: treasury.balance,
          };
        } catch {
          // DAO might not be configured
        }
      }

      // 5. Contract addresses
      if (ctx.walletService) {
        const contracts = ctx.walletService['contracts'];
        const contractAddresses: Record<string, string> = {};
        const names = ['token', 'identity', 'escrow', 'staking', 'reputation', 'dao', 'contracts', 'router', 'relayReward'] as const;
        for (const name of names) {
          try {
            const c = (contracts as unknown as Record<string, unknown>)[name];
            if (c && typeof c === 'object' && 'getAddress' in c) {
              contractAddresses[name] = await (c as { getAddress: () => Promise<string> }).getAddress();
            }
          } catch {
            // contract might not be loaded
          }
        }
        accounts.contracts = contractAddresses;
      }

      ok(res, accounts, { self: '/api/v1/accounts' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  return r;
}
