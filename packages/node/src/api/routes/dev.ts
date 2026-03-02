/**
 * Dev-only routes — /api/v1/dev
 *
 * These routes are intended for development / testnet use only.
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError, tooManyRequests, unauthorized } from '../response.js';
import { validate } from '../schemas/common.js';
import { z } from 'zod';
import type { RuntimeContext } from '../types.js';
import { resolveAddress, resolvePrivateKey } from '../types.js';
import { getApiKeyAuth } from '../auth.js';
import { createWalletMintEnvelope } from '@claw-network/protocol';
import type { IncomingMessage } from 'node:http';

const FaucetSchema = z
  .object({
    address: z.string().min(1).optional(),
    did: z.string().min(1).optional(),
    amount: z.number().int().positive().optional(),
  })
  .refine((d) => d.address || d.did, { message: 'address or did required' });

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;

interface FaucetPolicyConfig {
  apiKey: string;
  maxAmountPerClaim: number;
  cooldownMs: number;
  maxClaimsPerDidPerMonth: number;
  maxClaimsPerIpPerDay: number;
}

interface FaucetClaimMeta {
  clientIp: string;
  did?: string;
  recipientKey: string;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

function readFaucetPolicyConfig(): FaucetPolicyConfig {
  const cooldownHours = readPositiveIntEnv('CLAW_DEV_FAUCET_COOLDOWN_HOURS', 24);
  return {
    apiKey: (process.env.CLAW_DEV_FAUCET_API_KEY ?? '').trim(),
    maxAmountPerClaim: readPositiveIntEnv('CLAW_DEV_FAUCET_MAX_AMOUNT_PER_CLAIM', 50),
    cooldownMs: cooldownHours * HOUR_MS,
    maxClaimsPerDidPerMonth: readPositiveIntEnv('CLAW_DEV_FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH', 4),
    maxClaimsPerIpPerDay: readPositiveIntEnv('CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY', 3),
  };
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

function extractProvidedApiKey(req: IncomingMessage): string {
  const xApiKey = firstHeaderValue(req.headers['x-api-key']);
  if (xApiKey) return xApiKey.trim();
  const auth = firstHeaderValue(req.headers.authorization);
  if (!auth) return '';
  const normalized = auth.trim();
  if (!normalized.toLowerCase().startsWith('bearer ')) return '';
  return normalized.slice(7).trim();
}

function normalizeIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const trimmed = ip.trim();
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  return trimmed;
}

function extractClientIp(req: IncomingMessage): string {
  const forwardedFor = firstHeaderValue(req.headers['x-forwarded-for']);
  if (forwardedFor) {
    return normalizeIp(forwardedFor.split(',')[0]);
  }
  const realIp = firstHeaderValue(req.headers['x-real-ip']);
  if (realIp) return normalizeIp(realIp);
  return normalizeIp(req.socket.remoteAddress);
}

function pruneWindow(claims: number[], now: number, windowMs: number): number[] {
  const threshold = now - windowMs;
  return claims.filter((ts) => ts >= threshold);
}

function buildRecipientKey(did: string | undefined, address: string): string {
  const key = did?.trim() || address;
  return key.toLowerCase();
}

export function devRoutes(ctx: RuntimeContext): Router {
  const r = new Router();
  const policy = readFaucetPolicyConfig();
  const ipClaims = new Map<string, number[]>();
  const didClaims = new Map<string, number[]>();
  const recipientLastClaim = new Map<string, number>();

  // ── POST /faucet — dev-mode token mint ────────────────────────
  r.post('/faucet', async (req, res, route) => {
    // If the request was already authenticated by API key middleware, skip legacy check
    const middlewareAuth = getApiKeyAuth(req);
    if (!middlewareAuth) {
      // Legacy flow: require CLAW_DEV_FAUCET_API_KEY env var
      if (!policy.apiKey) {
        unauthorized(
          res,
          'Dev faucet disabled: configure CLAW_DEV_FAUCET_API_KEY to enable authenticated access',
          route.url.pathname,
        );
        return;
      }

      const providedKey = extractProvidedApiKey(req);
      if (!providedKey || providedKey !== policy.apiKey) {
        unauthorized(res, 'Invalid or missing API key', route.url.pathname);
        return;
      }
    }

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
    const amount = body.amount ?? policy.maxAmountPerClaim;

    if (amount > policy.maxAmountPerClaim) {
      badRequest(
        res,
        `amount exceeds max per claim (${policy.maxAmountPerClaim})`,
        route.url.pathname,
      );
      return;
    }

    const now = Date.now();
    const clientIp = extractClientIp(req);
    const didKey = body.did?.trim().toLowerCase();
    const recipientKey = buildRecipientKey(body.did, to);

    if (policy.maxClaimsPerIpPerDay > 0) {
      const dayClaims = pruneWindow(ipClaims.get(clientIp) ?? [], now, DAY_MS);
      ipClaims.set(clientIp, dayClaims);
      if (dayClaims.length >= policy.maxClaimsPerIpPerDay) {
        const retryAfterSeconds = Math.max(1, (dayClaims[0] + DAY_MS - now) / 1000);
        tooManyRequests(
          res,
          `IP daily claim limit reached (${policy.maxClaimsPerIpPerDay}/day)`,
          route.url.pathname,
          retryAfterSeconds,
        );
        return;
      }
    }

    if (didKey && policy.maxClaimsPerDidPerMonth > 0) {
      const monthClaims = pruneWindow(didClaims.get(didKey) ?? [], now, MONTH_MS);
      didClaims.set(didKey, monthClaims);
      if (monthClaims.length >= policy.maxClaimsPerDidPerMonth) {
        const retryAfterSeconds = Math.max(1, (monthClaims[0] + MONTH_MS - now) / 1000);
        tooManyRequests(
          res,
          `DID monthly claim limit reached (${policy.maxClaimsPerDidPerMonth}/month)`,
          route.url.pathname,
          retryAfterSeconds,
        );
        return;
      }
    }

    if (policy.cooldownMs > 0) {
      const last = recipientLastClaim.get(recipientKey);
      if (typeof last === 'number' && now - last < policy.cooldownMs) {
        const retryAfterSeconds = Math.max(1, (last + policy.cooldownMs - now) / 1000);
        tooManyRequests(
          res,
          `cooldown active; next claim after ${Math.ceil(policy.cooldownMs / HOUR_MS)}h window`,
          route.url.pathname,
          retryAfterSeconds,
        );
        return;
      }
    }

    const claimMeta: FaucetClaimMeta = {
      clientIp,
      did: didKey,
      recipientKey,
    };

    const recordClaim = (meta: FaucetClaimMeta): void => {
      const ts = Date.now();
      const ipHistory = pruneWindow(ipClaims.get(meta.clientIp) ?? [], ts, DAY_MS);
      ipHistory.push(ts);
      ipClaims.set(meta.clientIp, ipHistory);

      if (meta.did) {
        const didHistory = pruneWindow(didClaims.get(meta.did) ?? [], ts, MONTH_MS);
        didHistory.push(ts);
        didClaims.set(meta.did, didHistory);
      }

      recipientLastClaim.set(meta.recipientKey, ts);
    };

    // On-chain faucet — prefer mint (no pre-funded balance needed),
    // fall back to transfer if the node signer lacks MINTER_ROLE.
    if (ctx.walletService) {
      // Resolve DID → EVM address for on-chain calls
      let evmTo = to;
      if (body.did && body.did.startsWith('did:claw:')) {
        const resolved = await ctx.walletService.resolveDidToAddress(body.did);
        if (resolved) {
          evmTo = resolved;
        }
      }
      // If `to` is not a valid EVM hex address, fall through to legacy path
      const isEvmAddress = /^0x[0-9a-fA-F]{40}$/.test(evmTo);
      if (isEvmAddress) {
        try {
          const walletService = ctx.walletService as unknown as {
            mint?: (...args: unknown[]) => Promise<unknown>;
            transfer?: (...args: unknown[]) => Promise<unknown>;
          };

          // Try minting fresh Tokens first (requires MINTER_ROLE).
          if (walletService.mint) {
            try {
              const result = await walletService.mint(evmTo, amount, 'dev-faucet-mint');
              if (result) {
                recordClaim(claimMeta);
                ok(res, result, { self: '/api/v1/dev/faucet' });
                return;
              }
            } catch {
            // Mint failed (likely no MINTER_ROLE) — fall through to transfer.
          }
        }

        // Fallback: transfer from the node signer's own balance.
        if (walletService.transfer) {
          const result = await walletService.transfer('faucet', evmTo, amount, 'dev-faucet-transfer');
          if (result) {
            recordClaim(claimMeta);
            ok(res, result, { self: '/api/v1/dev/faucet' });
            return;
          }
        }
      } catch (err) {
        internalError(res, (err as Error).message);
        return;
      }
      } // isEvmAddress
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
      recordClaim(claimMeta);
      ok(res, { txHash: hash, to, amount, status: 'broadcast' }, { self: '/api/v1/dev/faucet' });
    } catch (err) {
      internalError(res, (err as Error).message || 'Faucet mint failed');
    }
  });

  return r;
}
