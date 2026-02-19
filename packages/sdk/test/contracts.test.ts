/**
 * Tests for ContractsApi — create, sign, fund, milestones, disputes, settlement.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ClawTokenClient } from '../src/index.js';
import { createMockServer, type MockServer } from './helpers/mock-server.js';

let mock: MockServer;

afterEach(async () => {
  if (mock) await mock.close();
});

const EVENT_FIELDS = {
  did: 'did:claw:z6MkClient',
  passphrase: 'pass',
  nonce: 1,
};

describe('ContractsApi', () => {
  it('create contract', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/contracts', 201, {
      contractId: 'ct-1',
      txHash: 'tx-ct-1',
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.contracts.create({
      ...EVENT_FIELDS,
      provider: 'did:claw:z6MkProvider',
      terms: {
        title: 'Website Development',
        description: 'Build a landing page',
        deliverables: ['design', 'frontend', 'deployment'],
        deadline: Date.now() + 30 * 86400_000,
      },
      payment: {
        type: 'milestone',
        totalAmount: 500,
        escrowRequired: true,
      },
      milestones: [
        { id: 'ms-1', title: 'Design', amount: 150, percentage: 30, deliverables: ['mockup.pdf'] },
        { id: 'ms-2', title: 'Frontend', amount: 250, percentage: 50, deliverables: ['code'] },
        { id: 'ms-3', title: 'Deployment', amount: 100, percentage: 20, deliverables: ['url'] },
      ],
    });

    expect(result.contractId).toBe('ct-1');
    expect(result.txHash).toBe('tx-ct-1');
  });

  it('list contracts', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/contracts', 200, {
      contracts: [
        {
          id: 'ct-1',
          client: 'did:claw:z6MkClient',
          provider: 'did:claw:z6MkProvider',
          status: 'active',
          terms: { title: 'Website' },
          payment: { type: 'fixed', totalAmount: 500 },
          milestones: [],
          signatures: [],
          createdAt: 1700000000000,
        },
      ],
      total: 1,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.contracts.list({ status: 'active' });

    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0].status).toBe('active');
    expect(mock.requests[0].url).toContain('status=active');
  });

  it('get contract by ID', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/contracts/ct-1', 200, {
      id: 'ct-1',
      client: 'did:claw:z6MkClient',
      provider: 'did:claw:z6MkProvider',
      status: 'pending_signature',
      terms: { title: 'Website' },
      payment: { type: 'fixed', totalAmount: 500 },
      milestones: [],
      signatures: [],
      createdAt: 1700000000000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.contracts.get('ct-1');

    expect(result.id).toBe('ct-1');
    expect(result.status).toBe('pending_signature');
  });

  it('sign contract', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/contracts/ct-1/sign', 200, { txHash: 'tx-sign' });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.contracts.sign('ct-1', EVENT_FIELDS);

    expect(result.txHash).toBe('tx-sign');
  });

  it('fund contract', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/contracts/ct-1/fund', 200, { txHash: 'tx-fund' });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.contracts.fund('ct-1', {
      ...EVENT_FIELDS,
      amount: 500,
    });

    expect(result.txHash).toBe('tx-fund');
    const body = mock.requests[0].body as Record<string, unknown>;
    expect(body.amount).toBe(500);
  });

  it('complete contract', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/contracts/ct-1/complete', 200, { txHash: 'tx-complete' });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.contracts.complete('ct-1', EVENT_FIELDS);

    expect(result.txHash).toBe('tx-complete');
  });

  describe('milestones', () => {
    it('submit milestone', async () => {
      mock = await createMockServer();
      mock.addRoute('POST', '/api/contracts/ct-1/milestones/ms-1/submit', 200, { txHash: 'tx-ms-submit' });

      const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
      const result = await client.contracts.submitMilestone('ct-1', 'ms-1', {
        ...EVENT_FIELDS,
        deliverables: ['mockup.pdf'],
        message: 'Design complete',
      });

      expect(result.txHash).toBe('tx-ms-submit');
    });

    it('approve milestone', async () => {
      mock = await createMockServer();
      mock.addRoute('POST', '/api/contracts/ct-1/milestones/ms-1/approve', 200, { txHash: 'tx-ms-approve' });

      const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
      const result = await client.contracts.approveMilestone('ct-1', 'ms-1', EVENT_FIELDS);

      expect(result.txHash).toBe('tx-ms-approve');
    });

    it('reject milestone', async () => {
      mock = await createMockServer();
      mock.addRoute('POST', '/api/contracts/ct-1/milestones/ms-1/reject', 200, { txHash: 'tx-ms-reject' });

      const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
      const result = await client.contracts.rejectMilestone('ct-1', 'ms-1', {
        ...EVENT_FIELDS,
        reason: 'Does not match requirements',
      });

      expect(result.txHash).toBe('tx-ms-reject');
    });
  });

  describe('disputes', () => {
    it('open dispute on contract', async () => {
      mock = await createMockServer();
      mock.addRoute('POST', '/api/contracts/ct-1/dispute', 200, { txHash: 'tx-dispute' });

      const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
      const result = await client.contracts.openDispute('ct-1', {
        ...EVENT_FIELDS,
        reason: 'Work not delivered',
        description: 'No response for 2 weeks',
      });

      expect(result.txHash).toBe('tx-dispute');
    });

    it('resolve dispute', async () => {
      mock = await createMockServer();
      mock.addRoute('POST', '/api/contracts/ct-1/dispute/resolve', 200, { txHash: 'tx-resolve' });

      const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
      const result = await client.contracts.resolveDispute('ct-1', {
        ...EVENT_FIELDS,
        decision: 'Partial refund',
        clientRefund: 250,
        providerPayment: 250,
      });

      expect(result.txHash).toBe('tx-resolve');
    });
  });

  describe('settlement', () => {
    it('execute settlement', async () => {
      mock = await createMockServer();
      mock.addRoute('POST', '/api/contracts/ct-1/settlement', 200, { txHash: 'tx-settle' });

      const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
      const result = await client.contracts.settlement('ct-1', EVENT_FIELDS);

      expect(result.txHash).toBe('tx-settle');
    });
  });
});
