import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { MessageStore } from '../src/services/message-store.js';
import { ApiServer } from '../src/api/server.js';

// ── MessageStore Delegation CRUD ─────────────────────────────────

describe('MessageStore — Delegation', () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('createDelegation — creates and can be fetched', () => {
    const d = store.createDelegation({
      delegateDid: 'did:claw:zGateway1',
      topics: ['telagent/envelope', 'telagent/receipt'],
      metadataOnly: true,
      expiresAtMs: Date.now() + 3600_000,
    });
    expect(d.delegationId).toMatch(/^dlg_/);
    expect(d.topics).toEqual(['telagent/envelope', 'telagent/receipt']);
    expect(d.metadataOnly).toBe(true);
    expect(d.revoked).toBe(false);

    const fetched = store.getDelegation(d.delegationId);
    expect(fetched).toEqual(d);
  });

  it('revokeDelegation — no longer in active list', () => {
    const d = store.createDelegation({
      delegateDid: 'did:claw:zGateway1',
      topics: ['telagent/envelope'],
      metadataOnly: true,
      expiresAtMs: Date.now() + 3600_000,
    });
    expect(store.listDelegations({ activeOnly: true })).toHaveLength(1);

    store.revokeDelegation(d.delegationId);
    expect(store.listDelegations({ activeOnly: true })).toHaveLength(0);

    const fetched = store.getDelegation(d.delegationId);
    expect(fetched?.revoked).toBe(true);
  });

  it('getActiveDelegationsForTopic — filters by topic', () => {
    store.createDelegation({
      delegateDid: 'did:claw:zGateway1',
      topics: ['telagent/envelope'],
      metadataOnly: true,
      expiresAtMs: Date.now() + 3600_000,
    });
    store.createDelegation({
      delegateDid: 'did:claw:zGateway2',
      topics: ['telagent/receipt'],
      metadataOnly: true,
      expiresAtMs: Date.now() + 3600_000,
    });

    expect(store.getActiveDelegationsForTopic('telagent/envelope')).toHaveLength(1);
    expect(store.getActiveDelegationsForTopic('telagent/receipt')).toHaveLength(1);
    expect(store.getActiveDelegationsForTopic('telagent/other')).toHaveLength(0);
  });

  it('expired delegation not in active list', () => {
    store.createDelegation({
      delegateDid: 'did:claw:zGateway1',
      topics: ['telagent/envelope'],
      metadataOnly: true,
      expiresAtMs: Date.now() - 1000,
    });
    expect(store.getActiveDelegationsForTopic('telagent/envelope')).toHaveLength(0);
  });

  it('cleanupExpiredDelegations — removes expired records', () => {
    store.createDelegation({
      delegateDid: 'did:claw:zGateway1',
      topics: ['t'],
      metadataOnly: true,
      expiresAtMs: Date.now() - 1000,
    });
    expect(store.cleanupExpiredDelegations()).toBe(1);
  });

  it('activeDelegationCount — counts correctly', () => {
    for (let i = 0; i < 5; i++) {
      store.createDelegation({
        delegateDid: `did:claw:zGateway${i}`,
        topics: ['t'],
        metadataOnly: true,
        expiresAtMs: Date.now() + 3600_000,
      });
    }
    expect(store.activeDelegationCount()).toBe(5);
  });
});

// ── MessageStore Delegated Inbox ─────────────────────────────────

describe('MessageStore — Delegated Inbox', () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('addToDelegatedInbox — assigns incrementing seq', () => {
    const seq1 = store.addToDelegatedInbox({
      delegationId: 'dlg_abc',
      sourceDid: 'did:claw:zPeerC',
      originalTargetDid: 'did:claw:zTarget',
      topic: 'telagent/envelope',
      messageId: 'msg_001',
      payloadSize: 2048,
    });
    const seq2 = store.addToDelegatedInbox({
      delegationId: 'dlg_abc',
      sourceDid: 'did:claw:zPeerD',
      originalTargetDid: 'did:claw:zTarget',
      topic: 'telagent/envelope',
      messageId: 'msg_002',
      payloadSize: 1024,
    });
    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
  });

  it('addToDelegatedInbox — duplicate returns null', () => {
    store.addToDelegatedInbox({
      delegationId: 'dlg_abc',
      sourceDid: 'did:claw:zPeerC',
      originalTargetDid: 'did:claw:zTarget',
      topic: 'telagent/envelope',
      messageId: 'msg_001',
    });
    const dup = store.addToDelegatedInbox({
      delegationId: 'dlg_abc',
      sourceDid: 'did:claw:zPeerC',
      originalTargetDid: 'did:claw:zTarget',
      topic: 'telagent/envelope',
      messageId: 'msg_001',
    });
    expect(dup).toBeNull();
  });

  it('getDelegatedInbox — sinceSeq replay', () => {
    for (let i = 1; i <= 5; i++) {
      store.addToDelegatedInbox({
        delegationId: 'dlg_abc',
        sourceDid: 'did:claw:zPeerC',
        originalTargetDid: 'did:claw:zTarget',
        topic: 'telagent/envelope',
        messageId: `msg_${i}`,
      });
    }
    const results = store.getDelegatedInbox({ delegationId: 'dlg_abc', sinceSeq: 3 });
    expect(results).toHaveLength(2); // seq 4, 5
  });

  it('currentDelegatedSeq — tracks counter', () => {
    expect(store.currentDelegatedSeq()).toBe(0);
    store.addToDelegatedInbox({
      delegationId: 'dlg_abc',
      sourceDid: 'did:claw:zPeerC',
      originalTargetDid: 'did:claw:zTarget',
      topic: 't',
      messageId: 'msg_1',
    });
    expect(store.currentDelegatedSeq()).toBe(1);
  });

  it('cleanupDelegatedInbox — removes old records', () => {
    store.addToDelegatedInbox({
      delegationId: 'dlg_abc',
      sourceDid: 'did:claw:zPeerC',
      originalTargetDid: 'did:claw:zTarget',
      topic: 't',
      messageId: 'msg_1',
    });
    // Won't remove fresh entries
    expect(store.cleanupDelegatedInbox(86_400_000)).toBe(0);
    // Use a negative age to force cutoff into the future and remove all
    expect(store.cleanupDelegatedInbox(-1)).toBe(1);
  });
});

// ── Delegation REST API ──────────────────────────────────────────

async function readData<T>(res: Response): Promise<T> {
  const payload = (await res.json()) as { data?: T };
  return (payload.data ?? payload) as T;
}

function createMockMessagingServiceWithDelegation() {
  const delegations: Array<{
    delegationId: string;
    delegateDid: string;
    topics: string[];
    metadataOnly: boolean;
    expiresAtMs: number;
    createdAtMs: number;
    revoked: boolean;
  }> = [];
  let counter = 0;

  return {
    // Regular messaging methods (stubs)
    send: vi.fn(async () => ({ messageId: 'msg_test', delivered: true })),
    sendMulticast: vi.fn(async () => ({ results: [] })),
    getInbox: vi.fn(() => []),
    ackMessage: vi.fn(() => true),
    getDidPeerMap: vi.fn(() => ({})),
    getCurrentSeq: vi.fn(() => 0),
    addSubscriber: vi.fn(),
    removeSubscriber: vi.fn(),
    relayAttachment: vi.fn(async () => ({ attachmentId: 'att', delivered: true })),
    listAttachments: vi.fn(() => []),
    getAttachment: vi.fn(async () => null),
    deleteAttachment: vi.fn(async () => false),

    // Delegation methods
    createSubscriptionDelegation: vi.fn((params: {
      delegateDid: string;
      topics: string[];
      expiresInSec: number;
      metadataOnly?: boolean;
    }) => {
      counter++;
      const record = {
        delegationId: `dlg_test${counter}`,
        delegateDid: params.delegateDid,
        topics: params.topics,
        metadataOnly: params.metadataOnly ?? true,
        expiresAtMs: Date.now() + params.expiresInSec * 1000,
        createdAtMs: Date.now(),
        revoked: false,
      };
      delegations.push(record);
      return record;
    }),
    revokeSubscriptionDelegation: vi.fn((id: string) => {
      const d = delegations.find((d) => d.delegationId === id && !d.revoked);
      if (d) { d.revoked = true; return true; }
      return false;
    }),
    listSubscriptionDelegations: vi.fn((_opts?: { activeOnly?: boolean }) => {
      return delegations.filter((d) => !d.revoked);
    }),
    getSubscriptionDelegation: vi.fn((id: string) => {
      return delegations.find((d) => d.delegationId === id) ?? null;
    }),
  };
}

describe('Delegation REST API', () => {
  let api: ApiServer;
  let baseUrl: string;
  let mockService: ReturnType<typeof createMockMessagingServiceWithDelegation>;

  beforeEach(async () => {
    mockService = createMockMessagingServiceWithDelegation();

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

  it('POST /subscription-delegations — creates delegation', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        delegateDid: 'did:claw:zGateway1',
        topics: ['telagent/envelope', 'telagent/receipt'],
        expiresInSec: 3600,
        metadataOnly: true,
      }),
    });

    expect(res.status).toBe(201);
    const data = await readData<{ delegationId: string; topics: string[] }>(res);
    expect(data.delegationId).toMatch(/^dlg_/);
    expect(data.topics).toEqual(['telagent/envelope', 'telagent/receipt']);
  });

  it('POST /subscription-delegations — rejects missing delegateDid', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topics: ['t'], expiresInSec: 3600 }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /subscription-delegations — rejects missing topics', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delegateDid: 'did:claw:zGateway1', expiresInSec: 3600 }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /subscription-delegations — rejects missing expiresInSec', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delegateDid: 'did:claw:zGateway1', topics: ['t'] }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /subscription-delegations — lists active delegations', async () => {
    // Create one first
    await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        delegateDid: 'did:claw:zGateway1',
        topics: ['t'],
        expiresInSec: 3600,
      }),
    });

    const res = await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations`);
    expect(res.status).toBe(200);
    const data = await readData<Array<{ delegationId: string }>>(res);
    expect(data).toHaveLength(1);
  });

  it('GET /subscription-delegations/:id — fetches single', async () => {
    const createRes = await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        delegateDid: 'did:claw:zGateway1',
        topics: ['t'],
        expiresInSec: 3600,
      }),
    });
    const created = await readData<{ delegationId: string }>(createRes);

    const res = await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations/${created.delegationId}`);
    expect(res.status).toBe(200);
    const data = await readData<{ delegationId: string }>(res);
    expect(data.delegationId).toBe(created.delegationId);
  });

  it('GET /subscription-delegations/:id — 404 for missing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations/dlg_nonexistent`);
    expect(res.status).toBe(404);
  });

  it('DELETE /subscription-delegations/:id — revokes', async () => {
    const createRes = await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        delegateDid: 'did:claw:zGateway1',
        topics: ['t'],
        expiresInSec: 3600,
      }),
    });
    const created = await readData<{ delegationId: string }>(createRes);

    const res = await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations/${created.delegationId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
  });

  it('DELETE /subscription-delegations/:id — 404 for missing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/messaging/subscription-delegations/dlg_nonexistent`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});
