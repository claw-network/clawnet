/**
 * Accounts routes — /api/v1/accounts
 *
 * Aggregated view of all system accounts: node signer, DID identity,
 * consensus validators (QBFT), treasury, and key contract addresses.
 * Plus: role management (grant/revoke) and validator voting (propose/discard).
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError } from '../response.js';
import { validate } from '../schemas/common.js';
import { z } from 'zod';
import { keccak256, toUtf8Bytes } from 'ethers';
import type { RuntimeContext } from '../types.js';
import { deriveAddressForDid } from '../../services/identity-service.js';

// ── Well-known roles per contract ──────────────────────────────

const ROLE_DEFS: Record<string, string[]> = {
  token: ['MINTER_ROLE', 'BURNER_ROLE', 'PAUSER_ROLE'],
  staking: ['PAUSER_ROLE', 'SLASHER_ROLE', 'DISTRIBUTOR_ROLE'],
  dao: ['PAUSER_ROLE', 'CANCELLER_ROLE'],
  paramRegistry: ['GOVERNOR_ROLE'],
  identity: ['PAUSER_ROLE', 'REGISTRAR_ROLE'],
  reputation: ['ANCHOR_ROLE', 'PAUSER_ROLE'],
  escrow: ['PAUSER_ROLE'],
  contracts: ['PAUSER_ROLE', 'ARBITER_ROLE'],
  router: ['REGISTRAR_ROLE', 'MULTICALL_ROLE'],
  relayReward: ['DAO_ROLE', 'PAUSER_ROLE'],
};

const ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

function roleHash(name: string): string {
  if (name === 'DEFAULT_ADMIN_ROLE') return ADMIN_ROLE;
  return keccak256(toUtf8Bytes(name));
}

// ── Request schemas ────────────────────────────────────────────

const RoleActionSchema = z.object({
  contract: z.string().min(1),
  role: z.string().min(1),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address'),
});

const ValidatorProposeSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address'),
  vote: z.enum(['add', 'remove']),
});

const ValidatorDiscardSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Invalid EVM address'),
});

// ── Helper: get contract instance by key ───────────────────────

function getContract(ctx: RuntimeContext, key: string) {
  const contracts = ctx.walletService?.['contracts'];
  if (!contracts) return null;
  // Map 'contracts' key to 'serviceContracts' accessor
  const accessorMap: Record<string, string> = { contracts: 'serviceContracts' };
  const accessor = accessorMap[key] ?? key;
  try {
    const c = (contracts as unknown as Record<string, unknown>)[accessor];
    if (c && typeof c === 'object' && 'hasRole' in c) return c as { hasRole: (role: string, addr: string) => Promise<boolean>; grantRole: (role: string, addr: string) => Promise<{ wait: () => Promise<{ hash: string; status: number }> }>; revokeRole: (role: string, addr: string) => Promise<{ wait: () => Promise<{ hash: string; status: number }> }>; getAddress: () => Promise<string> };
    return null;
  } catch {
    return null;
  }
}

// ── Route module ───────────────────────────────────────────────

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

        const MINTER_ROLE = roleHash('MINTER_ROLE');
        const BURNER_ROLE = roleHash('BURNER_ROLE');
        const [hasMinter, hasBurner, hasAdmin] = await Promise.all([
          token.hasRole(MINTER_ROLE, signerAddress).catch(() => false),
          token.hasRole(BURNER_ROLE, signerAddress).catch(() => false),
          token.hasRole(ADMIN_ROLE, signerAddress).catch(() => false),
        ]);

        accounts.signer = {
          address: signerAddress,
          balance: signerBalance.toString(),
          roles: { minter: hasMinter, burner: hasBurner, admin: hasAdmin },
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
        accounts.identity = { did, evmAddress: derivedAddress, balance: derivedBalance };
      }

      // 3. QBFT consensus validators (from chain RPC)
      if (ctx.walletService) {
        const provider = ctx.walletService['contracts'].provider;
        try {
          const result = await provider.send('qbft_getValidatorsByBlockNumber', ['latest']);
          accounts.validators = { addresses: result, count: Array.isArray(result) ? result.length : 0, type: 'QBFT' };
        } catch {
          try {
            const result = await provider.send('clique_getSigners', ['latest']);
            accounts.validators = { addresses: result, count: Array.isArray(result) ? result.length : 0, type: 'Clique' };
          } catch {
            accounts.validators = { addresses: [], count: 0, type: 'unknown' };
          }
        }
      }

      // 4. Treasury (DAO)
      if (ctx.daoService) {
        try {
          const treasury = await ctx.daoService.getTreasuryBalance();
          accounts.treasury = { address: treasury.daoAddress, balance: treasury.balance };
        } catch { /* DAO might not be configured */ }
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
          } catch { /* contract might not be loaded */ }
        }
        accounts.contracts = contractAddresses;
      }

      ok(res, accounts, { self: '/api/v1/accounts' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  Role management
  // ══════════════════════════════════════════════════════════════

  // ── GET /roles — list all roles across all contracts ────────────
  r.get('/roles', async (_req, res) => {
    if (!ctx.walletService) {
      internalError(res, 'Contracts unavailable');
      return;
    }
    try {
      const signerAddress = ctx.walletService['contracts'].signerAddress;
      const result: Array<{
        contract: string;
        address: string;
        roles: Array<{ name: string; hash: string; signerHasRole: boolean }>;
      }> = [];

      for (const [contractKey, roleNames] of Object.entries(ROLE_DEFS)) {
        const contract = getContract(ctx, contractKey);
        if (!contract) continue;

        let contractAddr = '';
        try { contractAddr = await contract.getAddress(); } catch { continue; }

        const rolesWithAdmin = ['DEFAULT_ADMIN_ROLE', ...roleNames];
        const roles = await Promise.all(
          rolesWithAdmin.map(async (name) => {
            const hash = roleHash(name);
            const signerHasRole = await contract.hasRole(hash, signerAddress).catch(() => false);
            return { name, hash, signerHasRole };
          }),
        );
        result.push({ contract: contractKey, address: contractAddr, roles });
      }

      ok(res, { contracts: result }, { self: '/api/v1/accounts/roles' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /roles/grant — grant a role on a contract ──────────────
  r.post('/roles/grant', async (_req, res, route) => {
    if (!ctx.walletService) {
      internalError(res, 'Contracts unavailable');
      return;
    }
    const v = validate(RoleActionSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const { contract: contractKey, role: roleName, address } = v.data;
    const contract = getContract(ctx, contractKey);
    if (!contract) {
      badRequest(res, `Contract "${contractKey}" not available`, route.url.pathname);
      return;
    }
    try {
      const hash = roleHash(roleName);
      const tx = await contract.grantRole(hash, address);
      const receipt = await tx.wait();
      ok(res, {
        txHash: receipt.hash,
        contract: contractKey,
        role: roleName,
        address,
        status: receipt.status === 1 ? 'confirmed' : 'failed',
      }, { self: '/api/v1/accounts/roles' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /roles/revoke — revoke a role on a contract ────────────
  r.post('/roles/revoke', async (_req, res, route) => {
    if (!ctx.walletService) {
      internalError(res, 'Contracts unavailable');
      return;
    }
    const v = validate(RoleActionSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const { contract: contractKey, role: roleName, address } = v.data;
    const contract = getContract(ctx, contractKey);
    if (!contract) {
      badRequest(res, `Contract "${contractKey}" not available`, route.url.pathname);
      return;
    }
    try {
      const hash = roleHash(roleName);
      const tx = await contract.revokeRole(hash, address);
      const receipt = await tx.wait();
      ok(res, {
        txHash: receipt.hash,
        contract: contractKey,
        role: roleName,
        address,
        status: receipt.status === 1 ? 'confirmed' : 'failed',
      }, { self: '/api/v1/accounts/roles' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  Validator management (consensus-level RPC)
  // ══════════════════════════════════════════════════════════════

  // ── POST /validators/propose — propose adding/removing a validator
  r.post('/validators/propose', async (_req, res, route) => {
    if (!ctx.walletService) {
      internalError(res, 'Chain RPC unavailable');
      return;
    }
    const v = validate(ValidatorProposeSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const { address, vote } = v.data;
    const provider = ctx.walletService['contracts'].provider;
    const auth = vote === 'add';

    try {
      // Try QBFT first, then Clique
      let type = 'QBFT';
      try {
        await provider.send('qbft_proposeValidatorVote', [address, auth ? 'true' : 'false']);
      } catch {
        type = 'Clique';
        await provider.send('clique_propose', [address, auth]);
      }
      ok(res, { address, vote, type, status: 'proposed' }, { self: '/api/v1/accounts/validators' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /validators/discard — discard a pending validator vote ──
  r.post('/validators/discard', async (_req, res, route) => {
    if (!ctx.walletService) {
      internalError(res, 'Chain RPC unavailable');
      return;
    }
    const v = validate(ValidatorDiscardSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const { address } = v.data;
    const provider = ctx.walletService['contracts'].provider;

    try {
      let type = 'QBFT';
      try {
        await provider.send('qbft_discardValidatorVote', [address]);
      } catch {
        type = 'Clique';
        await provider.send('clique_discard', [address]);
      }
      ok(res, { address, type, status: 'discarded' }, { self: '/api/v1/accounts/validators' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  return r;
}
