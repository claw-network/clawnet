import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { ApiServer } from '../src/api/server.js';
import { RateLimitError } from '../src/services/messaging-service.js';
import WebSocket from 'ws';

async function readData<T>(res: Response): Promise<T> {
  const payload = (await res.json()) as { data?: T };
  return (payload.data ?? payload) as T;
}

/**
 * A simple mock that implements the MessagingService interface used by the
 * route module, without requiring P2P or SQLite.
 */
function createMockMessagingService() {
  const inbox: Array<{
    messageId: string;
    sourceDid: string;
    topic: string;
    payload: Buffer;
    receivedAtMs: number;
    priority: number;
    seq: number;
    compressed: boolean;
    encrypted: boolean;
  }> = [];
  let consumed = new Set<string>();
  const subscribers = new Set<(msg: { messageId: string; sourceDid: string; topic: string; payload: Buffer; receivedAtMs: number; priority: number; seq: number; compressed: boolean; encrypted: boolean }) => void>();
  let rateLimitOn = false;
  let seqCounter = 0;

  return {
    send: vi.fn(async (_target: string, _topic: string, _payload: Uint8Array) => {
      if (rateLimitOn) throw new RateLimitError('did:claw:test', 600);
      return { messageId: 'msg_test123', delivered: true };
    }),
    sendMulticast: vi.fn(async (targets: string[], _topic: string, _payload: Uint8Array) => {
      if (rateLimitOn) throw new RateLimitError('did:claw:test', 600);
      return {
        results: targets.map((t) => ({ targetDid: t, messageId: `msg_${t.slice(-4)}`, delivered: true })),
      };
    }),
    getInbox: vi.fn((opts?: { topic?: string; sinceMs?: number; sinceSeq?: number; limit?: number }) => {
      let result = inbox.filter((m) => !consumed.has(m.messageId));
      if (opts?.topic) result = result.filter((m) => m.topic === opts.topic);
      if (opts?.sinceMs) result = result.filter((m) => m.receivedAtMs > opts.sinceMs!);
      if (opts?.sinceSeq !== undefined) result = result.filter((m) => m.seq > opts.sinceSeq!);
      if (opts?.limit) result = result.slice(0, opts.limit);
      return result;
    }),
    getInboxMessage: vi.fn((messageId: string) => {
      const msg = inbox.find((m) => m.messageId === messageId && !consumed.has(m.messageId));
      return msg ?? null;
    }),
    ackMessage: vi.fn((messageId: string) => {
      const found = inbox.some((m) => m.messageId === messageId) && !consumed.has(messageId);
      if (found) consumed.add(messageId);
      return found;
    }),
    getDidPeerMap: vi.fn(() => ({ 'did:claw:alice': '12D3KooW...' })),
    getCurrentSeq: vi.fn(() => seqCounter),
    addSubscriber: vi.fn((cb: (msg: { messageId: string; sourceDid: string; topic: string; payload: Buffer; receivedAtMs: number; priority: number; seq: number; compressed: boolean; encrypted: boolean }) => void) => {
      subscribers.add(cb);
    }),
    removeSubscriber: vi.fn((cb: (msg: { messageId: string; sourceDid: string; topic: string; payload: Buffer; receivedAtMs: number; priority: number; seq: number; compressed: boolean; encrypted: boolean }) => void) => {
      subscribers.delete(cb);
    }),
    // Helpers for test control
    _addToInbox(msg: { sourceDid: string; topic: string; payload: string; compressed?: boolean; encrypted?: boolean }) {
      const id = `msg_${inbox.length}`;
      seqCounter++;
      inbox.push({
        messageId: id,
        sourceDid: msg.sourceDid,
        topic: msg.topic,
        payload: Buffer.from(msg.payload, 'utf-8'),
        receivedAtMs: Date.now(),
        priority: 1,
        seq: seqCounter,
        compressed: msg.compressed ?? false,
        encrypted: msg.encrypted ?? false,
      });
      return id;
    },
    _addBinaryToInbox(msg: { sourceDid: string; topic: string; payload: Buffer; compressed?: boolean; encrypted?: boolean }) {
      const id = `msg_${inbox.length}`;
      seqCounter++;
      inbox.push({
        messageId: id,
        sourceDid: msg.sourceDid,
        topic: msg.topic,
        payload: msg.payload,
        receivedAtMs: Date.now(),
        priority: 1,
        seq: seqCounter,
        compressed: msg.compressed ?? false,
        encrypted: msg.encrypted ?? false,
      });
      return id;
    },
    _setRateLimit(on: boolean) { rateLimitOn = on; },
    _notifySubscribers(msg: { messageId: string; sourceDid: string; topic: string; payload: string; receivedAtMs: number }) {
      for (const cb of subscribers) cb({ ...msg, payload: Buffer.from(msg.payload, 'utf-8'), priority: 1, seq: ++seqCounter, compressed: false, encrypted: false });
    },
    get _subscriberCount() { return subscribers.size; },
    // Attachment methods
    relayAttachment: vi.fn(async (params: { targetDid: string; data: Buffer; contentType: string; fileName?: string; attachmentId?: string }) => {
      if (rateLimitOn) throw new RateLimitError('did:claw:test', 600);
      return { attachmentId: params.attachmentId || 'sha256_test_hash', delivered: true };
    }),
    listAttachments: vi.fn((_opts?: { limit?: number; since?: number }) => {
      return [
        { attachmentId: 'att_1', sourceDid: 'did:claw:zAlice', contentType: 'image/png', fileName: 'photo.png', totalSize: 1024, receivedAtMs: Date.now() },
      ];
    }),
    getAttachment: vi.fn(async (id: string) => {
      if (id === 'att_1') return { data: Buffer.from('fake-image'), contentType: 'image/png', fileName: 'photo.png' };
      return null;
    }),
    deleteAttachment: vi.fn(async (id: string) => id === 'att_1'),
  };
}

describe('messaging api', () => {
  let api: ApiServer;
  let baseUrl: string;
  let mockService: ReturnType<typeof createMockMessagingService>;

  beforeEach(async () => {
    mockService = createMockMessagingService();

    api = new ApiServer(
      { host: '127.0.0.1', port: 0, network: 'testnet' },
      {
        publishEvent: async () => 'hash',
        messagingService: mockService as unknown as import('../src/services/messaging-service.js').MessagingService,
      },
    );
    await api.start();
    const address = (api as unknown as { server: { address: () => AddressInfo } }).server.address();
    baseUrl = `http://${address.address}:${address.port}`;
  });

  afterEach(async () => {
    await api.stop();
  });

  // ── POST /api/v1/messaging/send ───────────────────────────────

  it('sends a message and receives messageId', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDid: 'did:claw:zBobPeerId123',
        topic: 'telagent/envelope',
        payload: 'hello world',
        ttlSec: 3600,
      }),
    });

    expect(res.status).toBe(201);
    const data = await readData<{ messageId: string; delivered: boolean }>(res);
    expect(data.messageId).toBe('msg_test123');
    expect(data.delivered).toBe(true);
    // Text-only: payload is encoded as UTF-8 bytes at the API boundary
    expect(mockService.send).toHaveBeenCalledWith(
      'did:claw:zBobPeerId123',
      'telagent/envelope',
      new Uint8Array(Buffer.from('hello world', 'utf-8')),
      { ttlSec: 3600, priority: undefined, compress: undefined, encryptForKeyHex: undefined, idempotencyKey: undefined },
    );
  });

  it('rejects send without targetDid', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: 'test', payload: 'data' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects send with invalid DID', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDid: 'not-a-did',
        topic: 'test',
        payload: 'data',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects send without payload', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDid: 'did:claw:zBob',
        topic: 'test',
      }),
    });
    expect(res.status).toBe(400);
  });

  // ── GET /api/v1/messaging/inbox ───────────────────────────────

  it('returns inbox messages', async () => {
    mockService._addToInbox({
      sourceDid: 'did:claw:alice',
      topic: 'telagent/envelope',
      payload: 'data123',
    });

    const res = await fetch(`${baseUrl}/api/v1/messaging/inbox`);
    expect(res.status).toBe(200);
    const data = await readData<{ messages: unknown[] }>(res);
    expect(data.messages).toHaveLength(1);
  });

  it('filters inbox by topic', async () => {
    mockService._addToInbox({ sourceDid: 'did:claw:alice', topic: 'a', payload: '1' });
    mockService._addToInbox({ sourceDid: 'did:claw:alice', topic: 'b', payload: '2' });

    const res = await fetch(`${baseUrl}/api/v1/messaging/inbox?topic=a`);
    expect(res.status).toBe(200);
    const data = await readData<{ messages: unknown[] }>(res);
    expect(data.messages).toHaveLength(1);
  });

  // ── DELETE /api/v1/messaging/inbox/:messageId ─────────────────

  it('acknowledges a message (204)', async () => {
    const id = mockService._addToInbox({
      sourceDid: 'did:claw:alice',
      topic: 'test',
      payload: 'data',
    });

    const res = await fetch(`${baseUrl}/api/v1/messaging/inbox/${id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
  });

  it('returns 400 for unknown messageId', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/inbox/msg_nonexistent`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(400);
  });

  // ── GET /api/v1/messaging/peers ───────────────────────────────

  it('returns DID peer map', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/peers`);
    expect(res.status).toBe(200);
    const data = await readData<{ didPeerMap: Record<string, string> }>(res);
    expect(data.didPeerMap['did:claw:alice']).toBe('12D3KooW...');
  });

  // ── POST /api/v1/messaging/send/batch — multicast ────────────

  it('sends batch to multiple DIDs', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDids: ['did:claw:zAlice', 'did:claw:zBob'],
        topic: 'test/batch',
        payload: 'hello-all',
      }),
    });

    expect(res.status).toBe(201);
    const data = await readData<{ results: Array<{ targetDid: string; messageId: string; delivered: boolean }> }>(res);
    expect(data.results).toHaveLength(2);
    expect(data.results[0].delivered).toBe(true);
    expect(mockService.sendMulticast).toHaveBeenCalledWith(
      ['did:claw:zAlice', 'did:claw:zBob'],
      'test/batch',
      new Uint8Array(Buffer.from('hello-all', 'utf-8')),
      { ttlSec: undefined, priority: undefined, compress: undefined, idempotencyKey: undefined },
    );
  });

  it('rejects batch with empty targetDids', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDids: [],
        topic: 'test',
        payload: 'data',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects batch with invalid DID in array', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDids: ['did:claw:zAlice', 'not-a-did'],
        topic: 'test',
        payload: 'data',
      }),
    });
    expect(res.status).toBe(400);
  });

  // ── Rate limiting → 429 ───────────────────────────────────────

  it('returns 429 when rate-limited on send', async () => {
    mockService._setRateLimit(true);
    const res = await fetch(`${baseUrl}/api/v1/messaging/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDid: 'did:claw:zBob',
        topic: 'test',
        payload: 'data',
      }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('returns 429 when rate-limited on batch send', async () => {
    mockService._setRateLimit(true);
    const res = await fetch(`${baseUrl}/api/v1/messaging/send/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDids: ['did:claw:zAlice'],
        topic: 'test',
        payload: 'data',
      }),
    });
    expect(res.status).toBe(429);
  });

  // ── WebSocket subscribe ───────────────────────────────────────

  it('connects to WebSocket and receives messages', async () => {
    const wsUrl = baseUrl.replace('http', 'ws') + '/api/v1/messaging/subscribe';
    const ws = new WebSocket(wsUrl);

    const messages: unknown[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('ws open timeout')), 3000);
    });

    // Wait for the connected frame
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // The mock service should now have a subscriber registered
    expect(mockService.addSubscriber).toHaveBeenCalled();
    expect(mockService._subscriberCount).toBe(1);

    // Simulate an incoming message by notifying subscribers
    mockService._notifySubscribers({
      messageId: 'msg_ws_test',
      sourceDid: 'did:claw:zAlice',
      topic: 'telagent/envelope',
      payload: 'ws-payload',
      receivedAtMs: Date.now(),
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // Should have received: { type: 'connected' } + { type: 'message', data: ... }
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const connectFrame = messages[0] as { type: string };
    expect(connectFrame.type).toBe('connected');

    const msgFrame = messages[1] as { type: string; data: { messageId: string } };
    expect(msgFrame.type).toBe('message');
    expect(msgFrame.data.messageId).toBe('msg_ws_test');

    ws.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // Subscriber should be removed after close
    expect(mockService.removeSubscriber).toHaveBeenCalled();
  });

  it('filters WS messages by topic query param', async () => {
    const wsUrl = baseUrl.replace('http', 'ws') + '/api/v1/messaging/subscribe?topic=wanted';
    const ws = new WebSocket(wsUrl);

    const messages: unknown[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('ws open timeout')), 3000);
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // Send a message with wrong topic — should be filtered
    mockService._notifySubscribers({
      messageId: 'msg_1',
      sourceDid: 'did:claw:zAlice',
      topic: 'unwanted',
      payload: 'nope',
      receivedAtMs: Date.now(),
    });

    // Send a message with matching topic
    mockService._notifySubscribers({
      messageId: 'msg_2',
      sourceDid: 'did:claw:zBob',
      topic: 'wanted',
      payload: 'yes',
      receivedAtMs: Date.now(),
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    // Should have: connected + 1 message (not the unwanted one)
    const msgFrames = messages.filter((m) => (m as { type: string }).type === 'message');
    expect(msgFrames).toHaveLength(1);
    expect((msgFrames[0] as { data: { messageId: string } }).data.messageId).toBe('msg_2');

    ws.close();
  });

  // ── WS replay missed messages ─────────────────────────────────

  it('replays missed messages on WS reconnect via sinceSeq', async () => {
    // Add messages to inbox before connecting
    mockService._addToInbox({ sourceDid: 'did:claw:zAlice', topic: 'test', payload: 'missed-1' });
    mockService._addToInbox({ sourceDid: 'did:claw:zAlice', topic: 'test', payload: 'missed-2' });

    // Connect with sinceSeq=0 to replay all
    const wsUrl = baseUrl.replace('http', 'ws') + '/api/v1/messaging/subscribe?sinceSeq=0';
    const ws = new WebSocket(wsUrl);

    const messages: unknown[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('ws open timeout')), 3000);
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    // Should have: connected + 2 replayed messages + replay_done
    const connected = messages.find((m) => (m as { type: string }).type === 'connected');
    expect(connected).toBeDefined();

    const replayed = messages.filter((m) => (m as { type: string }).type === 'message');
    expect(replayed).toHaveLength(2);

    const replayDone = messages.find((m) => (m as { type: string }).type === 'replay_done');
    expect(replayDone).toBeDefined();
    expect((replayDone as { lastSeq: number }).lastSeq).toBe(2);

    ws.close();
  });

  // ── Send with priority and idempotency ─────────────────────────

  it('passes priority and idempotencyKey to send', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDid: 'did:claw:zBobPeerId123',
        topic: 'urgent/alert',
        payload: 'important-data',
        priority: 3,
        idempotencyKey: 'idem-123',
      }),
    });

    expect(res.status).toBe(201);
    expect(mockService.send).toHaveBeenCalledWith(
      'did:claw:zBobPeerId123',
      'urgent/alert',
      new Uint8Array(Buffer.from('important-data', 'utf-8')),
      expect.objectContaining({ priority: 3, idempotencyKey: 'idem-123' }),
    );
  });

  // ── Inbox with sinceSeq ────────────────────────────────────────

  it('queries inbox with sinceSeq parameter', async () => {
    mockService._addToInbox({ sourceDid: 'did:claw:alice', topic: 'test', payload: 'msg1' });
    mockService._addToInbox({ sourceDid: 'did:claw:alice', topic: 'test', payload: 'msg2' });

    const res = await fetch(`${baseUrl}/api/v1/messaging/inbox?sinceSeq=1`);
    expect(res.status).toBe(200);
    const data = await readData<{ messages: unknown[] }>(res);
    expect(data.messages).toHaveLength(1);
  });

  // ── POST /api/v1/messaging/relay-attachment ────────────────────

  it('relays an attachment and returns attachmentId', async () => {
    const testData = Buffer.from('hello-image').toString('base64');
    const res = await fetch(`${baseUrl}/api/v1/messaging/relay-attachment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDid: 'did:claw:zBobPeerId123',
        data: testData,
        contentType: 'image/png',
        fileName: 'photo.png',
      }),
    });

    expect(res.status).toBe(201);
    const data = await readData<{ attachmentId: string; delivered: boolean }>(res);
    expect(data.attachmentId).toBeDefined();
    expect(data.delivered).toBe(true);
    expect(mockService.relayAttachment).toHaveBeenCalled();
  });

  it('rejects relay-attachment without targetDid', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/relay-attachment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: Buffer.from('test').toString('base64'),
        contentType: 'image/png',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects relay-attachment with invalid DID', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/relay-attachment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDid: 'not-a-did',
        data: Buffer.from('test').toString('base64'),
        contentType: 'image/png',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects relay-attachment without data', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/relay-attachment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDid: 'did:claw:zBob123',
        contentType: 'image/png',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects relay-attachment without contentType', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/relay-attachment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targetDid: 'did:claw:zBob123',
        data: Buffer.from('test').toString('base64'),
      }),
    });
    expect(res.status).toBe(400);
  });

  // ── GET /api/v1/messaging/attachments ──────────────────────────

  it('lists received attachments', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/attachments`);
    expect(res.status).toBe(200);
    const data = await readData<{ attachments: unknown[] }>(res);
    expect(data.attachments).toHaveLength(1);
  });

  // ── GET /api/v1/messaging/attachments/:id ──────────────────────

  it('downloads a received attachment', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/attachments/att_1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const buf = await res.arrayBuffer();
    expect(Buffer.from(buf).toString()).toBe('fake-image');
  });

  it('returns 404 for unknown attachment', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/attachments/att_nonexistent`);
    expect(res.status).toBe(404);
  });

  // ── DELETE /api/v1/messaging/attachments/:id ───────────────────

  it('deletes a received attachment', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/attachments/att_1`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
  });

  it('returns 404 when deleting unknown attachment', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/attachments/att_nonexistent`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  // ── Binary payload (POST /send-binary) ─────────────────────────

  it('sends binary payload via /send-binary endpoint', async () => {
    const binaryData = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0xde, 0xad]);

    const res = await fetch(`${baseUrl}/api/v1/messaging/send-binary`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-target-did': 'did:claw:zBobPeerId123',
        'x-topic': 'binary/test',
      },
      body: binaryData,
    });

    expect(res.status).toBe(201);
    const callArgs = mockService.send.mock.calls.at(-1)!;
    expect(callArgs[0]).toBe('did:claw:zBobPeerId123');
    expect(callArgs[1]).toBe('binary/test');
    expect(callArgs[2]).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(callArgs[2] as Uint8Array)).toEqual(Buffer.from(binaryData));
  });

  it('rejects /send-binary without X-Target-Did header', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send-binary`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-topic': 'test',
      },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(400);
  });

  it('rejects /send-binary without body', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send-binary`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-target-did': 'did:claw:zBob',
        'x-topic': 'test',
      },
    });
    expect(res.status).toBe(400);
  });

  it('passes optional headers to /send-binary', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send-binary`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-target-did': 'did:claw:zBobPeerId123',
        'x-topic': 'test/priority',
        'x-ttl-sec': '7200',
        'x-priority': '3',
        'x-compress': 'true',
        'x-idempotency-key': 'idem-bin-1',
      },
      body: new Uint8Array([42]),
    });

    expect(res.status).toBe(201);
    const callArgs = mockService.send.mock.calls.at(-1)!;
    expect(callArgs[3]).toEqual(expect.objectContaining({
      ttlSec: 7200,
      priority: 3,
      compress: true,
      idempotencyKey: 'idem-bin-1',
    }));
  });

  // ── Binary batch (POST /send-binary/batch) ────────────────────

  it('sends binary batch via /send-binary/batch', async () => {
    const binaryData = new Uint8Array([0xca, 0xfe]);

    const res = await fetch(`${baseUrl}/api/v1/messaging/send-binary/batch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-target-dids': 'did:claw:zAlice,did:claw:zBob',
        'x-topic': 'binary/batch',
      },
      body: binaryData,
    });

    expect(res.status).toBe(201);
    expect(mockService.sendMulticast).toHaveBeenCalledWith(
      ['did:claw:zAlice', 'did:claw:zBob'],
      'binary/batch',
      new Uint8Array(Buffer.from(binaryData)),
      expect.objectContaining({}),
    );
  });

  it('rejects /send-binary/batch without X-Target-Dids', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/send-binary/batch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-topic': 'test',
      },
      body: new Uint8Array([1]),
    });
    expect(res.status).toBe(400);
  });

  // ── GET /inbox/:messageId/payload — raw payload download ──────

  it('downloads raw message payload', async () => {
    const id = mockService._addBinaryToInbox({
      sourceDid: 'did:claw:zAlice',
      topic: 'binary/test',
      payload: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
    });

    const res = await fetch(`${baseUrl}/api/v1/messaging/inbox/${id}/payload`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    const buf = await res.arrayBuffer();
    expect(Buffer.from(buf)).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
  });

  it('returns compressed/encrypted headers on payload download', async () => {
    const id = mockService._addBinaryToInbox({
      sourceDid: 'did:claw:zAlice',
      topic: 'binary/enc',
      payload: Buffer.from([0x01, 0x02]),
      compressed: true,
      encrypted: true,
    });

    const res = await fetch(`${baseUrl}/api/v1/messaging/inbox/${id}/payload`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-compressed')).toBe('1');
    expect(res.headers.get('x-encrypted')).toBe('1');
  });

  it('returns 404 for unknown message payload download', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/inbox/msg_nonexistent/payload`);
    expect(res.status).toBe(404);
  });

  // ── Inbox returns payloadSize and flags ────────────────────────

  it('inbox returns payloadSize, compressed, encrypted fields', async () => {
    mockService._addToInbox({
      sourceDid: 'did:claw:alice',
      topic: 'test',
      payload: 'hello',
    });

    const res = await fetch(`${baseUrl}/api/v1/messaging/inbox`);
    expect(res.status).toBe(200);
    const data = await readData<{ messages: Array<{ payload?: string; payloadSize: number; compressed: boolean; encrypted: boolean }> }>(res);
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0]!.payload).toBe('hello');
    expect(data.messages[0]!.payloadSize).toBe(Buffer.from('hello', 'utf-8').length);
    expect(data.messages[0]!.compressed).toBe(false);
    expect(data.messages[0]!.encrypted).toBe(false);
  });

  it('inbox omits payload for compressed messages', async () => {
    mockService._addToInbox({
      sourceDid: 'did:claw:alice',
      topic: 'test',
      payload: 'compressed-data',
      compressed: true,
    });

    const res = await fetch(`${baseUrl}/api/v1/messaging/inbox`);
    expect(res.status).toBe(200);
    const data = await readData<{ messages: Array<{ payload?: string; compressed: boolean }> }>(res);
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0]!.payload).toBeUndefined();
    expect(data.messages[0]!.compressed).toBe(true);
  });
});
