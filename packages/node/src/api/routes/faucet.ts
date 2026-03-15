/**
 * Public faucet route — POST /api/v1/faucet
 *
 * One-time Token claim for new DIDs. Requires Ed25519 signature proof
 * of DID ownership. No API key needed.
 */

import { Router } from '../router.js';
import { ok, badRequest, unauthorized, conflict, tooManyRequests, internalError, paginated, parsePagination } from '../response.js';
import { validate } from '../schemas/common.js';
import { z } from 'zod';
import type { RuntimeContext } from '../types.js';
import { publicKeyFromDid, bytesToHex } from '../types.js';
import { verifySignature, utf8ToBytes } from '@claw-network/core';
import type { IncomingMessage } from 'node:http';

// ── Config ──────────────────────────────────────────────────────

interface FaucetConfig {
  amount: number;
  maxClaimsPerIpPerDay: number;
  dailyBudget: number;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

function readFaucetConfig(): FaucetConfig {
  return {
    amount: readPositiveIntEnv('CLAW_FAUCET_AMOUNT', 100),
    maxClaimsPerIpPerDay: readPositiveIntEnv('CLAW_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY', 10),
    dailyBudget: readPositiveIntEnv('CLAW_FAUCET_DAILY_BUDGET', 1_000),
  };
}

// ── Request schema ──────────────────────────────────────────────

const FaucetClaimSchema = z.object({
  did: z.string().min(1),
  signature: z.string().min(1),
  timestamp: z.number().int().positive(),
});

// ── IP extraction (same pattern as dev.ts) ──────────────────────

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
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

// ── Timestamp validation ────────────────────────────────────────

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

// ── Route module ────────────────────────────────────────────────

export function faucetRoutes(ctx: RuntimeContext): Router {
  const r = new Router();
  const config = readFaucetConfig();

  // ── GET /claims — paginated faucet claim history ───────────────
  r.get('/claims', async (_req, res, route) => {
    if (!ctx.indexerQuery) {
      internalError(res, 'Indexer unavailable');
      return;
    }
    const { page, perPage, offset } = parsePagination(route.query);
    const result = ctx.indexerQuery.listFaucetClaims({ limit: perPage, offset });
    paginated(res, result.items, {
      page,
      perPage,
      total: result.total,
      basePath: '/api/v1/faucet/claims',
    });
  });

  // ── GET /stats — faucet statistics ─────────────────────────────
  r.get('/stats', async (_req, res) => {
    if (!ctx.indexerQuery) {
      internalError(res, 'Indexer unavailable');
      return;
    }
    const stats = ctx.indexerQuery.getFaucetStats();
    ok(res, stats, { self: '/api/v1/faucet/stats' });
  });

  r.post('/', async (req, res, route) => {
    if (!ctx.walletService || !ctx.identityService || !ctx.indexerQuery) {
      internalError(res, 'Faucet unavailable: chain services not configured');
      return;
    }

    // Parse and validate request body
    const v = validate(FaucetClaimSchema, route.body);
    if (!v.success) {
      badRequest(res, v.error, route.url.pathname);
      return;
    }
    const { did, signature, timestamp } = v.data;

    // Validate DID format
    if (!did.startsWith('did:claw:')) {
      badRequest(res, 'Invalid DID format: must start with did:claw:', route.url.pathname);
      return;
    }

    // Validate timestamp freshness (anti-replay)
    const now = Date.now();
    if (Math.abs(now - timestamp) > MAX_TIMESTAMP_DRIFT_MS) {
      badRequest(res, 'Timestamp expired or too far in the future', route.url.pathname);
      return;
    }

    // Extract public key from DID and verify signature
    let publicKey: Uint8Array;
    try {
      publicKey = publicKeyFromDid(did);
    } catch {
      badRequest(res, 'Cannot extract public key from DID', route.url.pathname);
      return;
    }

    const message = utf8ToBytes(`faucet:claim:${did}:${timestamp}`);
    let sigBytes: Uint8Array;
    try {
      // Accept hex-encoded signature (with or without 0x prefix)
      const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
      if (!/^[0-9a-fA-F]+$/.test(sigHex) || sigHex.length !== 128) {
        badRequest(res, 'Invalid signature: expected 64-byte hex-encoded Ed25519 signature', route.url.pathname);
        return;
      }
      sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    } catch {
      badRequest(res, 'Invalid signature encoding', route.url.pathname);
      return;
    }

    const valid = await verifySignature(sigBytes, message, publicKey);
    if (!valid) {
      unauthorized(res, 'Invalid signature: DID ownership verification failed', route.url.pathname);
      return;
    }

    // Check one-time claim (per DID)
    if (ctx.indexerQuery.hasFaucetClaim(did)) {
      conflict(res, 'Faucet already claimed for this DID', route.url.pathname);
      return;
    }

    // Check IP rate limit
    const clientIp = extractClientIp(req);
    if (config.maxClaimsPerIpPerDay > 0) {
      const since = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const ipCount = ctx.indexerQuery.getIpFaucetClaimCount(clientIp, since);
      if (ipCount >= config.maxClaimsPerIpPerDay) {
        tooManyRequests(
          res,
          `IP daily claim limit reached (${config.maxClaimsPerIpPerDay}/day)`,
          route.url.pathname,
        );
        return;
      }
    }

    // Check daily budget
    if (config.dailyBudget > 0) {
      const dailyTotal = ctx.indexerQuery.getFaucetDailyTotal();
      if (dailyTotal + config.amount > config.dailyBudget) {
        tooManyRequests(res, 'Daily faucet budget exhausted', route.url.pathname);
        return;
      }
    }

    // Auto-register DID on-chain if needed
    try {
      const pubKeyHex = '0x' + bytesToHex(publicKey);
      await ctx.identityService.ensureRegistered(did, pubKeyHex);
    } catch {
      // Non-fatal — DID may already be registered
    }

    // Derive EVM address and mint tokens
    const evmAddress = await ctx.walletService.resolveDidToAddress(did);
    if (!evmAddress) {
      internalError(res, 'Failed to resolve DID to EVM address');
      return;
    }

    let txHash: string | undefined;
    try {
      const result = await ctx.walletService.mint(evmAddress, config.amount, 'public-faucet');
      txHash = result?.txHash;
    } catch (err) {
      internalError(res, `Faucet mint failed: ${(err as Error).message}`);
      return;
    }

    // Record the claim
    try {
      ctx.indexerQuery.insertFaucetClaim({
        did,
        address: evmAddress,
        amount: config.amount,
        ip: clientIp,
        txHash,
      });
    } catch {
      // Unique constraint violation — race condition, claim already recorded
      conflict(res, 'Faucet already claimed for this DID', route.url.pathname);
      return;
    }

    ok(res, {
      did,
      address: evmAddress,
      amount: config.amount,
      txHash: txHash ?? null,
    }, { self: '/api/v1/faucet' });
  });

  return r;
}
