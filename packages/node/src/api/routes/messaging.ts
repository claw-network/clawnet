/**
 * Messaging routes — /api/v1/messaging
 *
 * POST /send              — Send a message to a target DID
 * GET  /inbox             — List inbox messages (polling)
 * DELETE /inbox/:messageId — Acknowledge (consume) a message
 * GET  /peers             — Show DID → PeerId mapping (debug)
 */

import { Router } from '../router.js';
import { ok, created, noContent, badRequest, internalError } from '../response.js';
import type { RuntimeContext } from '../types.js';

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
      const result = await ctx.messagingService.send(targetDid, topic, payload, ttlSec);
      created(res, result, { self: '/api/v1/messaging/inbox' });
    } catch (err) {
      const message = (err as Error).message;
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
    const limitStr = route.query.get('limit');

    const sinceMs = sinceStr ? Number(sinceStr) : undefined;
    const limit = limitStr ? Math.min(Math.max(Number(limitStr), 1), 500) : undefined;

    if (sinceStr && (isNaN(sinceMs!) || sinceMs! < 0)) {
      badRequest(res, 'Invalid "since" parameter', route.url.pathname);
      return;
    }

    const messages = ctx.messagingService.getInbox({ topic, sinceMs, limit });
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
