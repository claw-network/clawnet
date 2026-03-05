import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { ApiServer } from '../src/api/server.js';

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
    payload: string;
    receivedAtMs: number;
  }> = [];
  let consumed = new Set<string>();

  return {
    send: vi.fn(async (_target: string, _topic: string, _payload: string) => ({
      messageId: 'msg_test123',
      delivered: true,
    })),
    getInbox: vi.fn((opts?: { topic?: string; sinceMs?: number; limit?: number }) => {
      let result = inbox.filter((m) => !consumed.has(m.messageId));
      if (opts?.topic) result = result.filter((m) => m.topic === opts.topic);
      if (opts?.sinceMs) result = result.filter((m) => m.receivedAtMs > opts.sinceMs!);
      if (opts?.limit) result = result.slice(0, opts.limit);
      return result;
    }),
    ackMessage: vi.fn((messageId: string) => {
      const found = inbox.some((m) => m.messageId === messageId) && !consumed.has(messageId);
      if (found) consumed.add(messageId);
      return found;
    }),
    getDidPeerMap: vi.fn(() => ({ 'did:claw:alice': '12D3KooW...' })),
    // Helper to seed test data
    _addToInbox(msg: { sourceDid: string; topic: string; payload: string }) {
      const id = `msg_${inbox.length}`;
      inbox.push({
        messageId: id,
        sourceDid: msg.sourceDid,
        topic: msg.topic,
        payload: msg.payload,
        receivedAtMs: Date.now(),
      });
      return id;
    },
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
        payload: 'dGVzdA==',
        ttlSec: 3600,
      }),
    });

    expect(res.status).toBe(201);
    const data = await readData<{ messageId: string; delivered: boolean }>(res);
    expect(data.messageId).toBe('msg_test123');
    expect(data.delivered).toBe(true);
    expect(mockService.send).toHaveBeenCalledWith(
      'did:claw:zBobPeerId123',
      'telagent/envelope',
      'dGVzdA==',
      3600,
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
});
