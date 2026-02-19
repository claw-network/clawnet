/**
 * Tests for WalletApi — balance, transfer, escrow.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ClawTokenClient } from '../src/index.js';
import { createMockServer, type MockServer } from './helpers/mock-server.js';

let mock: MockServer;

afterEach(async () => {
  if (mock) await mock.close();
});

describe('WalletApi', () => {
  it('getBalance returns balance', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/wallet/balance', 200, {
      balance: 1000,
      available: 800,
      pending: 100,
      locked: 100,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const b = await client.wallet.getBalance();

    expect(b.balance).toBe(1000);
    expect(b.available).toBe(800);
    expect(b.pending).toBe(100);
    expect(b.locked).toBe(100);
  });

  it('getBalance with DID passes query param', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/wallet/balance', 200, {
      balance: 500,
      available: 500,
      pending: 0,
      locked: 0,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    await client.wallet.getBalance({ did: 'did:claw:z6MkOther' });

    expect(mock.requests[0].url).toContain('did=');
  });

  it('transfer sends tokens', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/wallet/transfer', 200, {
      txHash: 'abc123',
      from: 'did:claw:z6MkSender',
      to: 'did:claw:z6MkReceiver',
      amount: 50,
      fee: 1,
      status: 'confirmed',
      timestamp: 1700000000000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.wallet.transfer({
      did: 'did:claw:z6MkSender',
      passphrase: 'pass',
      nonce: 1,
      to: 'did:claw:z6MkReceiver',
      amount: 50,
      memo: 'payment',
    });

    expect(result.txHash).toBe('abc123');
    expect(result.amount).toBe(50);
    const body = mock.requests[0].body as Record<string, unknown>;
    expect(body.to).toBe('did:claw:z6MkReceiver');
    expect(body.amount).toBe(50);
    expect(body.memo).toBe('payment');
  });

  it('getHistory returns transactions', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/wallet/history', 200, {
      transactions: [
        { txHash: 'tx1', from: 'a', to: 'b', amount: 10, type: 'transfer', status: 'confirmed', timestamp: 1 },
      ],
      total: 1,
      hasMore: false,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.wallet.getHistory({ limit: 10, offset: 0 });

    expect(result.transactions).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('createEscrow creates escrow', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/wallet/escrow', 201, {
      id: 'escrow-1',
      depositor: 'did:claw:z6MkA',
      beneficiary: 'did:claw:z6MkB',
      amount: 100,
      funded: 100,
      released: 0,
      status: 'funded',
      releaseRules: [],
      createdAt: 1700000000000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.wallet.createEscrow({
      did: 'did:claw:z6MkA',
      passphrase: 'pass',
      nonce: 1,
      beneficiary: 'did:claw:z6MkB',
      amount: 100,
      releaseRules: [{ type: 'manual' }],
    });

    expect(result.id).toBe('escrow-1');
    expect(result.status).toBe('funded');
  });

  it('getEscrow retrieves escrow details', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/wallet/escrow/escrow-1', 200, {
      id: 'escrow-1',
      depositor: 'did:claw:z6MkA',
      beneficiary: 'did:claw:z6MkB',
      amount: 100,
      funded: 100,
      released: 0,
      status: 'funded',
      releaseRules: [],
      createdAt: 1700000000000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.wallet.getEscrow('escrow-1');

    expect(result.id).toBe('escrow-1');
  });

  it('releaseEscrow releases funds', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/wallet/escrow/escrow-1/release', 200, {
      txHash: 'release-tx',
      from: 'escrow-1',
      to: 'did:claw:z6MkB',
      amount: 50,
      status: 'confirmed',
      timestamp: 1700000000000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.wallet.releaseEscrow('escrow-1', {
      did: 'did:claw:z6MkA',
      passphrase: 'pass',
      nonce: 2,
      amount: 50,
      resourcePrev: 'prev-hash',
    });

    expect(result.txHash).toBe('release-tx');
  });

  it('fundEscrow adds funds', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/wallet/escrow/escrow-2/fund', 200, {
      txHash: 'fund-tx',
      from: 'did:claw:z6MkA',
      to: 'escrow-2',
      amount: 25,
      status: 'confirmed',
      timestamp: 1700000000000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.wallet.fundEscrow('escrow-2', {
      did: 'did:claw:z6MkA',
      passphrase: 'pass',
      nonce: 3,
      amount: 25,
      resourcePrev: 'prev-hash',
    });

    expect(result.txHash).toBe('fund-tx');
  });

  it('refundEscrow refunds depositor', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/wallet/escrow/escrow-3/refund', 200, {
      txHash: 'refund-tx',
      from: 'escrow-3',
      to: 'did:claw:z6MkA',
      amount: 100,
      status: 'confirmed',
      timestamp: 1700000000000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.wallet.refundEscrow('escrow-3', {
      did: 'did:claw:z6MkA',
      passphrase: 'pass',
      nonce: 4,
      amount: 100,
      resourcePrev: 'prev-hash',
    });

    expect(result.txHash).toBe('refund-tx');
  });

  it('expireEscrow handles expiration', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/wallet/escrow/escrow-4/expire', 200, {
      txHash: 'expire-tx',
      from: 'escrow-4',
      to: 'did:claw:z6MkA',
      amount: 75,
      status: 'confirmed',
      timestamp: 1700000000000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.wallet.expireEscrow('escrow-4', {
      did: 'did:claw:z6MkA',
      passphrase: 'pass',
      nonce: 5,
      action: 'refund',
    });

    expect(result.txHash).toBe('expire-tx');
  });
});
