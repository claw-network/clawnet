/**
 * Deliverable routes — /api/v1/deliverables
 *
 * POST /verify            — Layer 1: verify contentHash + Ed25519 signature
 * POST /verify/schema     — Layer 2: JSON Schema structural validation (Phase 2B)
 * POST /fetch             — Fetch external deliverable content (Phase 2C)
 * POST /fetch/p2p         — Fetch deliverable content via P2P from provider node (Phase 2C)
 * POST /store             — Store deliverable content for serving via P2P (Phase 2C)
 * GET  /stream/:id        — Proxy stream transport to SSE/WS client (Phase 2D)
 */

import { Router } from '../router.js';
import { ok, badRequest, internalError, created } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { DeliverableVerifier } from '../../services/deliverable-verifier.js';
import type { DeliverableEnvelope } from '@claw-network/protocol';
import { base64ToBytes, blake3Hex, createBlake3Hasher } from '@claw-network/core';

/** Shared verifier instance (stateless — safe to reuse). */
const verifier = new DeliverableVerifier();

export function deliverableRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST /verify — Layer 1: hash + signature ─────────────────
  r.post('/verify', async (_req, res, route) => {
    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const envelope = body.envelope as DeliverableEnvelope | undefined;
    const contentBase64 = body.content as string | undefined;
    const skipSignature = body.skipSignature === true;

    if (!envelope || typeof envelope !== 'object') {
      badRequest(res, 'Missing or invalid "envelope"', route.url.pathname);
      return;
    }
    if (typeof contentBase64 !== 'string') {
      badRequest(res, 'Missing or invalid "content" (base64-encoded bytes expected)', route.url.pathname);
      return;
    }

    let plaintext: Uint8Array;
    try {
      plaintext = base64ToBytes(contentBase64);
    } catch {
      badRequest(res, '"content" is not valid base64', route.url.pathname);
      return;
    }

    try {
      const result = await verifier.verifyLayer1(envelope, plaintext, { skipSignature });
      ok(res, result, { self: '/api/v1/deliverables/verify' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /verify/schema — Layer 2 (Phase 2B) ─────────────────
  r.post('/verify/schema', async (_req, res, route) => {
    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const envelope = body.envelope as DeliverableEnvelope | undefined;
    const content = body.content as unknown;

    if (!envelope || typeof envelope !== 'object') {
      badRequest(res, 'Missing or invalid "envelope"', route.url.pathname);
      return;
    }
    try {
      const result = await verifier.verifyLayer2(envelope, content);
      ok(res, result, { self: '/api/v1/deliverables/verify/schema' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /fetch — fetch external deliverable content ─────────
  r.post('/fetch', async (_req, res, route) => {
    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const envelope = body.envelope as DeliverableEnvelope | undefined;
    if (!envelope || typeof envelope !== 'object') {
      badRequest(res, 'Missing or invalid "envelope"', route.url.pathname);
      return;
    }

    const transport = envelope.transport;
    if (!transport || (transport as { method: string }).method !== 'external') {
      badRequest(res, 'Envelope transport.method must be "external"', route.url.pathname);
      return;
    }

    const uri = (transport as { method: string; uri: string }).uri;
    if (typeof uri !== 'string' || !uri) {
      badRequest(res, 'transport.uri is required', route.url.pathname);
      return;
    }

    // Phase 2C: HTTP(S) fetch with SSRF protection (RFC1918 blocking).
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      try {
        const bytes = await fetchExternalWithSsrfGuard(uri, envelope.contentHash);
        created(res, {
          deliverableId: envelope.id,
          bytes: Buffer.from(bytes).toString('base64'),
          size: bytes.length,
        }, { self: '/api/v1/deliverables/fetch' });
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes('SSRF') || message.includes('private')) {
          badRequest(res, message, route.url.pathname);
        } else {
          internalError(res, message);
        }
      }
      return;
    }

    badRequest(res, `Unsupported transport URI scheme: ${uri.split(':')[0]}`, route.url.pathname);
  });

  // ── POST /fetch/p2p — pull deliverable from provider via P2P ─
  r.post('/fetch/p2p', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }
    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const providerDid = body.providerDid as string | undefined;
    const deliverableId = body.deliverableId as string | undefined;
    const expectedHash = body.expectedHash as string | undefined;

    if (!providerDid || typeof providerDid !== 'string') {
      badRequest(res, 'Missing or invalid "providerDid"', route.url.pathname);
      return;
    }
    if (!deliverableId || typeof deliverableId !== 'string') {
      badRequest(res, 'Missing or invalid "deliverableId"', route.url.pathname);
      return;
    }

    try {
      const result = await ctx.messagingService.requestDeliverableFromPeer(providerDid, deliverableId);
      if (!result) {
        internalError(res, 'Provider did not return content (peer offline or not found)');
        return;
      }

      if (expectedHash && result.contentHash !== expectedHash) {
        internalError(res, `Content hash mismatch: expected ${expectedHash} got ${result.contentHash}`);
        return;
      }

      // Verify our own hash
      const actualHash = blake3Hex(result.bytes);
      if (result.contentHash && actualHash !== result.contentHash) {
        internalError(res, `BLAKE3 integrity check failed for deliverable ${deliverableId}`);
        return;
      }

      created(res, {
        deliverableId,
        bytes: Buffer.from(result.bytes).toString('base64'),
        size: result.bytes.length,
        contentHash: result.contentHash,
      }, { self: '/api/v1/deliverables/fetch/p2p' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /store — store content blob for P2P serving ─────────
  r.post('/store', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }
    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const deliverableId = body.deliverableId as string | undefined;
    const contentBase64 = body.content as string | undefined;

    if (!deliverableId || typeof deliverableId !== 'string') {
      badRequest(res, 'Missing or invalid "deliverableId"', route.url.pathname);
      return;
    }
    if (typeof contentBase64 !== 'string') {
      badRequest(res, 'Missing or invalid "content" (base64-encoded bytes expected)', route.url.pathname);
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(contentBase64);
    } catch {
      badRequest(res, '"content" is not valid base64', route.url.pathname);
      return;
    }

    const contentHash = blake3Hex(bytes);
    try {
      await ctx.messagingService.storeDeliverableContent(deliverableId, bytes, contentHash);
      created(res, { deliverableId, size: bytes.length, contentHash }, { self: '/api/v1/deliverables/store' });
    } catch (err) {
      internalError(res, (err as Error).message);
    }
  });

  // ── POST /hash/incremental — compute BLAKE3 hash in chunks ────
  // Accepts multiple base64-encoded chunks; returns the running hash.
  // Useful for clients that build the hash client-side before uploading.
  r.post('/hash/incremental', async (_req, res, route) => {
    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const chunks = body.chunks as unknown[] | undefined;
    if (!Array.isArray(chunks) || chunks.length === 0) {
      badRequest(res, '"chunks" must be a non-empty array of base64-encoded strings', route.url.pathname);
      return;
    }

    const hasher = createBlake3Hasher();
    let totalBytes = 0;
    for (const chunk of chunks) {
      if (typeof chunk !== 'string') {
        badRequest(res, 'Each chunk must be a base64-encoded string', route.url.pathname);
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes(chunk);
      } catch {
        badRequest(res, 'A chunk is not valid base64', route.url.pathname);
        return;
      }
      hasher.update(bytes);
      totalBytes += bytes.length;
    }

    ok(res, { contentHash: hasher.hexDigest(), totalBytes }, { self: '/api/v1/deliverables/hash/incremental' });
  });

  // ── POST /hash/composite — compute composite hash over parts ──
  // {parts: [{hash: string}]} → contentHash = BLAKE3(hash1 + hash2 + ...)
  r.post('/hash/composite', async (_req, res, route) => {
    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const parts = body.parts as unknown[] | undefined;
    if (!Array.isArray(parts) || parts.length === 0) {
      badRequest(res, '"parts" must be a non-empty array of { hash: string } objects', route.url.pathname);
      return;
    }

    const hashes: string[] = [];
    for (const part of parts) {
      if (typeof part !== 'object' || part === null || typeof (part as Record<string, unknown>).hash !== 'string') {
        badRequest(res, 'Each part must have a "hash" string field', route.url.pathname);
        return;
      }
      hashes.push((part as Record<string, string>).hash);
    }

    const { computeCompositeHash } = await import('@claw-network/protocol');
    const { utf8ToBytes } = await import('@claw-network/core');
    const contentHash = computeCompositeHash(hashes, blake3Hex, utf8ToBytes);
    ok(res, { contentHash, partCount: hashes.length }, { self: '/api/v1/deliverables/hash/composite' });
  });

  return r;
}

// ── SSRF-safe fetch helper (delegates to shared guard) ─────────────

import { ssrfSafeFetchBytes } from '../../services/ssrf-guard.js';

async function fetchExternalWithSsrfGuard(
  uri: string,
  expectedHash?: string,
): Promise<Uint8Array> {
  return ssrfSafeFetchBytes(uri, { expectedHash });
}
