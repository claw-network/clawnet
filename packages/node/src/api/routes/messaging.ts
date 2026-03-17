/**
 * Messaging routes — /api/v1/messaging
 *
 * POST /send               — Send a text message (JSON body, string payload → UTF-8 bytes)
 * POST /send-binary        — Send a binary message (octet-stream body, metadata in headers)
 * POST /send/batch         — Multicast text to multiple DIDs (JSON body)
 * POST /send-binary/batch  — Multicast binary to multiple DIDs (octet-stream + headers)
 * GET  /inbox              — List inbox messages (metadata + text payload inline)
 * GET  /inbox/:messageId/payload — Download raw message payload (binary)
 * DELETE /inbox/:messageId — Acknowledge (consume) a message
 * GET  /peers              — Show DID → PeerId mapping (debug)
 * POST /relay-attachment    — Relay a binary attachment to a target DID via P2P
 * GET  /attachments         — List received attachments
 * GET  /attachments/:id     — Download a received attachment
 * DELETE /attachments/:id   — Delete a received attachment
 */

import { Router } from '../router.js';
import { ok, created, noContent, badRequest, notFound, internalError, tooManyRequests } from '../response.js';
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

    // Text-only: encode string payload as UTF-8 bytes.
    // For binary payloads, use POST /send-binary instead.
    const resolvedPayload = new Uint8Array(Buffer.from(payload, 'utf-8'));

    try {
      const result = await ctx.messagingService.send(targetDid, topic, resolvedPayload, {
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

    // Text-only: encode string payload as UTF-8 bytes.
    // For binary payloads, use POST /send-binary/batch instead.
    const resolvedPayload = new Uint8Array(Buffer.from(payload, 'utf-8'));

    try {
      const result = await ctx.messagingService.sendMulticast(targetDids, topic, resolvedPayload, {
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

  // ── POST /send-binary — send a binary message to a target DID ──
  // Payload is the raw request body (application/octet-stream).
  // Metadata is passed via headers: X-Target-Did, X-Topic, etc.
  r.post('/send-binary', async (req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const rawBody = route.rawBody;
    if (!rawBody || rawBody.length === 0) {
      badRequest(res, 'Binary body required (Content-Type: application/octet-stream)', route.url.pathname);
      return;
    }

    const targetDid = req.headers['x-target-did'] as string | undefined;
    const topic = req.headers['x-topic'] as string | undefined;
    const ttlSecStr = req.headers['x-ttl-sec'] as string | undefined;
    const priorityStr = req.headers['x-priority'] as string | undefined;
    const compressStr = req.headers['x-compress'] as string | undefined;
    const encryptForKeyHex = req.headers['x-encrypt-for-key'] as string | undefined;
    const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;

    if (!targetDid || !targetDid.startsWith('did:claw:')) {
      badRequest(res, 'Missing or invalid X-Target-Did header', route.url.pathname);
      return;
    }
    if (!topic) {
      badRequest(res, 'Missing X-Topic header', route.url.pathname);
      return;
    }
    if (topic.length > 256) {
      badRequest(res, 'Topic too long (max 256 characters)', route.url.pathname);
      return;
    }

    const ttlSec = ttlSecStr ? Number(ttlSecStr) : undefined;
    const priority = priorityStr ? Number(priorityStr) : undefined;
    const compress = compressStr === 'true' || compressStr === '1' ? true
      : compressStr === 'false' || compressStr === '0' ? false : undefined;

    try {
      const result = await ctx.messagingService.send(
        targetDid, topic, new Uint8Array(rawBody),
        { ttlSec, priority, compress, encryptForKeyHex, idempotencyKey },
      );
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

  // ── POST /send-binary/batch — multicast binary to multiple DIDs ──
  r.post('/send-binary/batch', async (req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const rawBody = route.rawBody;
    if (!rawBody || rawBody.length === 0) {
      badRequest(res, 'Binary body required (Content-Type: application/octet-stream)', route.url.pathname);
      return;
    }

    const targetDidsHeader = req.headers['x-target-dids'] as string | undefined;
    const topic = req.headers['x-topic'] as string | undefined;
    const ttlSecStr = req.headers['x-ttl-sec'] as string | undefined;
    const priorityStr = req.headers['x-priority'] as string | undefined;
    const compressStr = req.headers['x-compress'] as string | undefined;
    const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;

    if (!targetDidsHeader) {
      badRequest(res, 'Missing X-Target-Dids header (comma-separated DIDs)', route.url.pathname);
      return;
    }
    const targetDids = targetDidsHeader.split(',').map((s) => s.trim()).filter(Boolean);
    if (targetDids.length === 0) {
      badRequest(res, 'Empty X-Target-Dids header', route.url.pathname);
      return;
    }
    if (targetDids.length > 100) {
      badRequest(res, 'Too many targets (max 100)', route.url.pathname);
      return;
    }
    for (const did of targetDids) {
      if (!did.startsWith('did:claw:')) {
        badRequest(res, `Invalid DID in X-Target-Dids: ${did}`, route.url.pathname);
        return;
      }
    }
    if (!topic) {
      badRequest(res, 'Missing X-Topic header', route.url.pathname);
      return;
    }
    if (topic.length > 256) {
      badRequest(res, 'Topic too long (max 256 characters)', route.url.pathname);
      return;
    }

    const ttlSec = ttlSecStr ? Number(ttlSecStr) : undefined;
    const priority = priorityStr ? Number(priorityStr) : undefined;
    const compress = compressStr === 'true' || compressStr === '1' ? true
      : compressStr === 'false' || compressStr === '0' ? false : undefined;

    try {
      const result = await ctx.messagingService.sendMulticast(
        targetDids, topic, new Uint8Array(rawBody),
        { ttlSec, priority, compress, idempotencyKey },
      );
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

    const messages = ctx.messagingService.getInbox({ topic, sinceMs, sinceSeq, limit })
      .map((msg) => ({
        messageId: msg.messageId,
        sourceDid: msg.sourceDid,
        topic: msg.topic,
        receivedAtMs: msg.receivedAtMs,
        priority: msg.priority,
        seq: msg.seq,
        payloadSize: msg.payload.length,
        compressed: msg.compressed,
        encrypted: msg.encrypted,
        // Include inline text payload only for uncompressed+unencrypted messages.
        // Use GET /inbox/:messageId/payload to download raw bytes for any message.
        ...(!msg.compressed && !msg.encrypted
          ? { payload: msg.payload.toString('utf-8') }
          : {}),
      }));
    ok(res, { messages }, { self: '/api/v1/messaging/inbox' });
  });

  // ── GET /inbox/:messageId/payload — download raw message payload ──
  r.get('/inbox/:messageId/payload', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const { messageId } = route.params;
    const msg = ctx.messagingService.getInboxMessage(messageId);
    if (!msg) {
      notFound(res, `Message not found: ${messageId}`, route.url.pathname);
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(msg.payload.length),
    };
    if (msg.compressed) headers['X-Compressed'] = '1';
    if (msg.encrypted) headers['X-Encrypted'] = '1';

    res.writeHead(200, headers);
    res.end(msg.payload);
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

  // ── POST /relay-attachment — relay binary attachment via P2P ───
  r.post('/relay-attachment', async (_req, res, route) => {
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
    const data = body.data as string | undefined; // base64-encoded binary
    const contentType = body.contentType as string | undefined;
    const fileName = typeof body.fileName === 'string' ? body.fileName : undefined;
    const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : undefined;

    if (!targetDid || typeof targetDid !== 'string') {
      badRequest(res, 'Missing or invalid "targetDid"', route.url.pathname);
      return;
    }
    if (!targetDid.startsWith('did:claw:')) {
      badRequest(res, 'targetDid must be a valid DID (did:claw:...)', route.url.pathname);
      return;
    }
    if (!data || typeof data !== 'string') {
      badRequest(res, 'Missing or invalid "data" (base64-encoded)', route.url.pathname);
      return;
    }
    if (!contentType || typeof contentType !== 'string') {
      badRequest(res, 'Missing or invalid "contentType"', route.url.pathname);
      return;
    }

    let binaryData: Buffer;
    try {
      binaryData = Buffer.from(data, 'base64');
    } catch {
      badRequest(res, 'Invalid base64 data', route.url.pathname);
      return;
    }

    if (binaryData.length === 0) {
      badRequest(res, 'Attachment data is empty', route.url.pathname);
      return;
    }

    try {
      const result = await ctx.messagingService.relayAttachment({
        targetDid,
        data: binaryData,
        contentType,
        fileName,
        attachmentId,
      });
      created(res, result, { self: '/api/v1/messaging/attachments' });
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

  // ── GET /attachments — list received attachments ──────────────
  r.get('/attachments', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const limitStr = route.query.get('limit');
    const sinceStr = route.query.get('since');
    const limit = limitStr ? Math.min(Math.max(Number(limitStr), 1), 500) : undefined;
    const since = sinceStr ? Number(sinceStr) : undefined;

    const attachments = ctx.messagingService.listAttachments({ limit, since });
    ok(res, { attachments }, { self: '/api/v1/messaging/attachments' });
  });

  // ── GET /attachments/:id — download a received attachment ─────
  r.get('/attachments/:id', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const { id } = route.params;
    const result = await ctx.messagingService.getAttachment(id);
    if (!result) {
      notFound(res, `Attachment not found: ${id}`, route.url.pathname);
      return;
    }

    // Return raw binary data with correct Content-Type
    res.writeHead(200, {
      'Content-Type': result.contentType || 'application/octet-stream',
      'Content-Length': String(result.data.length),
      ...(result.fileName ? { 'Content-Disposition': `inline; filename="${result.fileName}"` } : {}),
    });
    res.end(result.data);
  });

  // ── DELETE /attachments/:id — delete a received attachment ────
  r.delete('/attachments/:id', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const { id } = route.params;
    const deleted = await ctx.messagingService.deleteAttachment(id);
    if (!deleted) {
      notFound(res, `Attachment not found: ${id}`, route.url.pathname);
      return;
    }
    noContent(res);
  });

  // ── Subscription Delegations ─────────────────────────────────

  r.post('/subscription-delegations', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const delegateDid = body.delegateDid as string | undefined;
    const topics = body.topics as string[] | undefined;
    const expiresInSec = typeof body.expiresInSec === 'number' ? body.expiresInSec : undefined;
    const metadataOnly = typeof body.metadataOnly === 'boolean' ? body.metadataOnly : undefined;

    if (!delegateDid || typeof delegateDid !== 'string') {
      badRequest(res, 'Missing or invalid "delegateDid"', route.url.pathname);
      return;
    }
    if (!Array.isArray(topics) || topics.length === 0) {
      badRequest(res, 'Missing or invalid "topics": must be a non-empty array', route.url.pathname);
      return;
    }
    if (expiresInSec === undefined || expiresInSec <= 0) {
      badRequest(res, 'Missing or invalid "expiresInSec": must be a positive number', route.url.pathname);
      return;
    }

    try {
      const record = ctx.messagingService.createSubscriptionDelegation({
        delegateDid,
        topics,
        expiresInSec,
        metadataOnly,
      });
      created(res, record, {
        self: `/api/v1/messaging/subscription-delegations/${record.delegationId}`,
      });
    } catch (err) {
      badRequest(res, (err as Error).message, route.url.pathname);
    }
  });

  r.get('/subscription-delegations', async (_req, res, _route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const delegations = ctx.messagingService.listSubscriptionDelegations({
      activeOnly: true,
    });
    ok(res, delegations);
  });

  r.get('/subscription-delegations/:id', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const id = route.params.id;
    const record = ctx.messagingService.getSubscriptionDelegation(id);
    if (!record) {
      notFound(res, `Delegation not found: ${id}`, route.url.pathname);
      return;
    }
    ok(res, record);
  });

  r.delete('/subscription-delegations/:id', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const id = route.params.id;
    const revoked = ctx.messagingService.revokeSubscriptionDelegation(id);
    if (!revoked) {
      notFound(res, `Delegation not found or already revoked: ${id}`, route.url.pathname);
      return;
    }
    noContent(res);
  });

  return r;
}
