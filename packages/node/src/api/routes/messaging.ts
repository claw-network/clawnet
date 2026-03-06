/**
 * Messaging routes — /api/v1/messaging
 *
 * POST /send              — Send a message to a target DID
 * POST /send/batch        — Multicast: send a message to multiple DIDs
 * GET  /inbox             — List inbox messages (polling)
 * DELETE /inbox/:messageId — Acknowledge (consume) a message
 * GET  /peers             — Show DID → PeerId mapping (debug)
 */

import { Router } from '../router.js';
import { ok, created, noContent, badRequest, internalError, tooManyRequests } from '../response.js';
import type { RuntimeContext } from '../types.js';
import { RateLimitError } from '../../services/messaging-service.js';

/** Type guard: checks if a value is a Record<string, string>. */
function isStringRecord(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  for (const val of Object.values(v)) {
    if (typeof val !== 'string') return false;
  }
  return true;
}

export function messagingRoutes(ctx: RuntimeContext): Router {
  const r = new Router();

  // ── POST /send — send a message to a target DID ──────────────
  r.post('/send', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const targetDid = body.targetDid as string | undefined;
    const topic = body.topic as string | undefined;
    const payload = body.payload as string | undefined;
    const ttlSec = typeof body.ttlSec === 'number' ? body.ttlSec : undefined;
    const priority = typeof body.priority === 'number' ? body.priority : undefined;
    const compress = typeof body.compress === 'boolean' ? body.compress : undefined;
    const encryptForKeyHex = typeof body.encryptForKeyHex === 'string' ? body.encryptForKeyHex : undefined;
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;

    if (!targetDid || typeof targetDid !== 'string') {
      badRequest(res, 'Missing or invalid "targetDid"', route.url.pathname);
      return;
    }
    if (!targetDid.startsWith('did:claw:')) {
      badRequest(res, 'targetDid must be a valid DID (did:claw:...)', route.url.pathname);
      return;
    }
    if (!topic || typeof topic !== 'string') {
      badRequest(res, 'Missing or invalid "topic"', route.url.pathname);
      return;
    }
    if (topic.length > 256) {
      badRequest(res, 'Topic too long (max 256 characters)', route.url.pathname);
      return;
    }
    if (!payload || typeof payload !== 'string') {
      badRequest(res, 'Missing or invalid "payload"', route.url.pathname);
      return;
    }

    try {
      const result = await ctx.messagingService.send(targetDid, topic, payload, {
        ttlSec, priority, compress, encryptForKeyHex, idempotencyKey,
      });
      created(res, result, { self: '/api/v1/messaging/inbox' });
    } catch (err) {
      const message = (err as Error).message;
      if (err instanceof RateLimitError) {
        tooManyRequests(res, message, route.url.pathname, 60);
        return;
      }
      if (message.includes('too large')) {
        badRequest(res, message, route.url.pathname);
        return;
      }
      internalError(res, message);
    }
  });

  // ── POST /send/batch — multicast to multiple DIDs ─────────────
  r.post('/send/batch', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const targetDids = body.targetDids as string[] | undefined;
    const topic = body.topic as string | undefined;
    const payload = body.payload as string | undefined;
    const ttlSec = typeof body.ttlSec === 'number' ? body.ttlSec : undefined;
    const priority = typeof body.priority === 'number' ? body.priority : undefined;
    const compress = typeof body.compress === 'boolean' ? body.compress : undefined;
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;
    const recipientKeys = isStringRecord(body.recipientKeys) ? body.recipientKeys : undefined;

    if (!Array.isArray(targetDids) || targetDids.length === 0) {
      badRequest(res, 'Missing or empty "targetDids" array', route.url.pathname);
      return;
    }
    if (targetDids.length > 100) {
      badRequest(res, 'Too many targets (max 100)', route.url.pathname);
      return;
    }
    for (const did of targetDids) {
      if (typeof did !== 'string' || !did.startsWith('did:claw:')) {
        badRequest(res, `Invalid DID in targetDids: ${String(did)}`, route.url.pathname);
        return;
      }
    }
    if (!topic || typeof topic !== 'string') {
      badRequest(res, 'Missing or invalid "topic"', route.url.pathname);
      return;
    }
    if (topic.length > 256) {
      badRequest(res, 'Topic too long (max 256 characters)', route.url.pathname);
      return;
    }
    if (!payload || typeof payload !== 'string') {
      badRequest(res, 'Missing or invalid "payload"', route.url.pathname);
      return;
    }

    try {
      const result = await ctx.messagingService.sendMulticast(targetDids, topic, payload, {
        ttlSec, priority, compress, idempotencyKey, recipientKeys,
      });
      created(res, result, { self: '/api/v1/messaging/inbox' });
    } catch (err) {
      const message = (err as Error).message;
      if (err instanceof RateLimitError) {
        tooManyRequests(res, message, route.url.pathname, 60);
        return;
      }
      if (message.includes('too large')) {
        badRequest(res, message, route.url.pathname);
        return;
      }
      internalError(res, message);
    }
  });

  // ── GET /inbox — list inbox messages ──────────────────────────
  r.get('/inbox', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const topic = route.query.get('topic') ?? undefined;
    const sinceStr = route.query.get('since');
    const sinceSeqStr = route.query.get('sinceSeq');
    const limitStr = route.query.get('limit');

    const sinceMs = sinceStr ? Number(sinceStr) : undefined;
    const sinceSeq = sinceSeqStr ? Number(sinceSeqStr) : undefined;
    const limit = limitStr ? Math.min(Math.max(Number(limitStr), 1), 500) : undefined;

    if (sinceStr && (isNaN(sinceMs!) || sinceMs! < 0)) {
      badRequest(res, 'Invalid "since" parameter', route.url.pathname);
      return;
    }

    const messages = ctx.messagingService.getInbox({ topic, sinceMs, sinceSeq, limit });
    ok(res, { messages }, { self: '/api/v1/messaging/inbox' });
  });

  // ── DELETE /inbox/:messageId — acknowledge a message ──────────
  r.delete('/inbox/:messageId', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const { messageId } = route.params;
    const consumed = ctx.messagingService.ackMessage(messageId);
    if (!consumed) {
      badRequest(res, 'Message not found or already consumed');
      return;
    }
    noContent(res);
  });

  // ── GET /peers — debug: show DID → PeerId mapping ────────────
  r.get('/peers', async (_req, res) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const map = ctx.messagingService.getDidPeerMap();
    ok(res, { didPeerMap: map });
  });

  return r;
}
