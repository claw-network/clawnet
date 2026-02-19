/**
 * Tests for MarketsApi — search, info, task, capability markets and disputes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ClawTokenClient } from '../src/index.js';
import { createMockServer, type MockServer } from './helpers/mock-server.js';

let mock: MockServer;

afterEach(async () => {
  if (mock) await mock.close();
});

const EVENT_FIELDS = {
  did: 'did:claw:z6MkAgent',
  passphrase: 'pass',
  nonce: 1,
};

describe('MarketsApi.search', () => {
  it('searches across all markets', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/markets/search', 200, {
      listings: [
        { id: 'l1', type: 'info', seller: 'did:claw:z6Mk1', title: 'Data Set', status: 'active', createdAt: 1 },
        { id: 'l2', type: 'task', seller: 'did:claw:z6Mk2', title: 'Code Review', status: 'active', createdAt: 2 },
      ],
      total: 2,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.markets.search({ q: 'data', limit: 10 });

    expect(result.listings).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(mock.requests[0].url).toContain('q=data');
    expect(mock.requests[0].url).toContain('limit=10');
  });
});

describe('InfoMarketApi', () => {
  it('list returns info listings', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/markets/info', 200, {
      listings: [{ id: 'info-1', type: 'info', seller: 'seller', title: 'Report', status: 'active', createdAt: 1 }],
      total: 1,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.markets.info.list();

    expect(result.listings).toHaveLength(1);
    expect(result.listings[0].id).toBe('info-1');
  });

  it('publish creates info listing', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/markets/info', 201, {
      listingId: 'info-new',
      txHash: 'tx-info-1',
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.markets.info.publish({
      ...EVENT_FIELDS,
      title: 'Market Analysis',
      infoType: 'report',
      contentFormat: 'markdown',
      pricing: { model: 'fixed', basePrice: 10 },
    });

    expect(result.listingId).toBe('info-new');
    expect(result.txHash).toBe('tx-info-1');
  });

  it('purchase buys info listing', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/markets/info/info-1/purchase', 200, {
      orderId: 'order-1',
      txHash: 'tx-purchase-1',
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.markets.info.purchase('info-1', EVENT_FIELDS);

    expect(result.orderId).toBe('order-1');
  });

  it('deliver, confirm, review lifecycle', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/markets/info/info-1/deliver', 200, { txHash: 'tx-deliver' });
    mock.addRoute('POST', '/api/markets/info/info-1/confirm', 200, { txHash: 'tx-confirm' });
    mock.addRoute('POST', '/api/markets/info/info-1/review', 200, { txHash: 'tx-review' });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });

    const d = await client.markets.info.deliver('info-1', { ...EVENT_FIELDS, orderId: 'order-1' });
    expect(d.txHash).toBe('tx-deliver');

    const c = await client.markets.info.confirm('info-1', { ...EVENT_FIELDS, orderId: 'order-1' });
    expect(c.txHash).toBe('tx-confirm');

    const r = await client.markets.info.review('info-1', {
      ...EVENT_FIELDS,
      orderId: 'order-1',
      rating: 5,
      comment: 'Great data',
    });
    expect(r.txHash).toBe('tx-review');
  });

  it('subscribe and unsubscribe', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/markets/info/info-1/subscribe', 200, { txHash: 'tx-sub' });
    mock.addRoute('POST', '/api/markets/info/info-1/unsubscribe', 200, { txHash: 'tx-unsub' });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });

    const sub = await client.markets.info.subscribe('info-1', { ...EVENT_FIELDS, resourcePrev: null });
    expect(sub.txHash).toBe('tx-sub');

    const unsub = await client.markets.info.unsubscribe('info-1', EVENT_FIELDS);
    expect(unsub.txHash).toBe('tx-unsub');
  });

  it('remove removes listing', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/markets/info/info-1/remove', 200, { txHash: 'tx-rm' });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.markets.info.remove('info-1', EVENT_FIELDS);
    expect(result.txHash).toBe('tx-rm');
  });
});

describe('TaskMarketApi', () => {
  it('publish and list tasks', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/markets/tasks', 201, { listingId: 'task-1', txHash: 'tx-task' });
    mock.addRoute('GET', '/api/markets/tasks', 200, {
      listings: [{ id: 'task-1', type: 'task', seller: 'seller', title: 'Code Audit', status: 'active', createdAt: 1 }],
      total: 1,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });

    const pub = await client.markets.tasks.publish({
      ...EVENT_FIELDS,
      title: 'Code Audit',
      taskType: 'development',
      pricing: { model: 'fixed', basePrice: 100 },
    });
    expect(pub.listingId).toBe('task-1');

    const list = await client.markets.tasks.list();
    expect(list.listings).toHaveLength(1);
  });

  it('bid → acceptBid → deliver → confirm → review', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/markets/tasks/task-1/bids', 200, { bidId: 'bid-1', txHash: 'tx-bid' });
    mock.addRoute('POST', '/api/markets/tasks/task-1/accept', 200, { txHash: 'tx-accept' });
    mock.addRoute('POST', '/api/markets/tasks/task-1/deliver', 200, { txHash: 'tx-deliver' });
    mock.addRoute('POST', '/api/markets/tasks/task-1/confirm', 200, { txHash: 'tx-confirm' });
    mock.addRoute('POST', '/api/markets/tasks/task-1/review', 200, { txHash: 'tx-review' });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });

    const bid = await client.markets.tasks.bid('task-1', { ...EVENT_FIELDS, amount: 80, message: 'I can do it' });
    expect(bid.bidId).toBe('bid-1');

    const accept = await client.markets.tasks.acceptBid('task-1', { ...EVENT_FIELDS, bidId: 'bid-1' });
    expect(accept.txHash).toBe('tx-accept');

    const deliver = await client.markets.tasks.deliver('task-1', {
      ...EVENT_FIELDS,
      submission: { url: 'https://github.com/pr/1' },
    });
    expect(deliver.txHash).toBe('tx-deliver');

    const confirm = await client.markets.tasks.confirm('task-1', EVENT_FIELDS);
    expect(confirm.txHash).toBe('tx-confirm');

    const review = await client.markets.tasks.review('task-1', { ...EVENT_FIELDS, rating: 5 });
    expect(review.txHash).toBe('tx-review');
  });

  it('rejectBid and withdrawBid', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/markets/tasks/task-1/reject', 200, { txHash: 'tx-reject' });
    mock.addRoute('POST', '/api/markets/tasks/task-1/withdraw', 200, { txHash: 'tx-withdraw' });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });

    const reject = await client.markets.tasks.rejectBid('task-1', { ...EVENT_FIELDS, bidId: 'bid-2' });
    expect(reject.txHash).toBe('tx-reject');

    const withdraw = await client.markets.tasks.withdrawBid('task-1', { ...EVENT_FIELDS, bidId: 'bid-3' });
    expect(withdraw.txHash).toBe('tx-withdraw');
  });

  it('getBids returns bid list', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/markets/tasks/task-1/bids', 200, {
      bids: [{ bidId: 'bid-1', amount: 80 }],
      total: 1,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.markets.tasks.getBids('task-1');
    expect(result.bids).toHaveLength(1);
  });
});

describe('CapabilityMarketApi', () => {
  it('publish capability listing', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/markets/capabilities', 201, { listingId: 'cap-1', txHash: 'tx-cap' });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.markets.capabilities.publish({
      ...EVENT_FIELDS,
      title: 'Translation API',
      capabilityType: 'nlp',
      pricing: { model: 'per_call', basePrice: 0.01 },
    });

    expect(result.listingId).toBe('cap-1');
  });

  it('lease → invoke → pause → resume → terminate', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/markets/capabilities/cap-1/lease', 200, {
      leaseId: 'lease-1',
      txHash: 'tx-lease',
    });
    mock.addRoute('POST', '/api/markets/capabilities/leases/lease-1/invoke', 200, {
      leaseId: 'lease-1',
      txHash: 'tx-invoke',
      usage: { id: 'u1', leaseId: 'lease-1', resource: '/translate', success: true, timestamp: 1 },
    });
    mock.addRoute('POST', '/api/markets/capabilities/leases/lease-1/pause', 200, {
      leaseId: 'lease-1',
      txHash: 'tx-pause',
      action: 'pause',
    });
    mock.addRoute('POST', '/api/markets/capabilities/leases/lease-1/resume', 200, {
      leaseId: 'lease-1',
      txHash: 'tx-resume',
      action: 'resume',
    });
    mock.addRoute('POST', '/api/markets/capabilities/leases/lease-1/terminate', 200, {
      leaseId: 'lease-1',
      txHash: 'tx-terminate',
      action: 'terminate',
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });

    const lease = await client.markets.capabilities.lease('cap-1', {
      ...EVENT_FIELDS,
      plan: { type: 'pay_per_use' },
    });
    expect(lease.leaseId).toBe('lease-1');

    const invoke = await client.markets.capabilities.invoke('lease-1', {
      ...EVENT_FIELDS,
      resource: '/translate',
      latency: 150,
      success: true,
    });
    expect(invoke.usage.success).toBe(true);

    const pause = await client.markets.capabilities.pauseLease('lease-1', EVENT_FIELDS);
    expect(pause.action).toBe('pause');

    const resume = await client.markets.capabilities.resumeLease('lease-1', EVENT_FIELDS);
    expect(resume.action).toBe('resume');

    const term = await client.markets.capabilities.terminateLease('lease-1', EVENT_FIELDS);
    expect(term.action).toBe('terminate');
  });

  it('getLeaseDetail returns lease + usage', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/markets/capabilities/leases/lease-1', 200, {
      lease: {
        id: 'lease-1',
        listingId: 'cap-1',
        lessee: 'did:claw:z6MkA',
        lessor: 'did:claw:z6MkB',
        plan: { type: 'pay_per_use' },
        status: 'active',
        startedAt: 1,
      },
      usage: [],
      stats: {
        totalCalls: 10,
        successfulCalls: 9,
        failedCalls: 1,
        totalUnits: 100,
        averageLatency: 50,
        p95Latency: 120,
        totalCost: '0.1',
      },
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const detail = await client.markets.capabilities.getLeaseDetail('lease-1');

    expect(detail.lease.id).toBe('lease-1');
    expect(detail.stats.totalCalls).toBe(10);
  });
});

describe('MarketDisputeApi', () => {
  it('open, respond, resolve dispute', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/markets/orders/order-1/dispute', 200, { txHash: 'tx-dispute' });
    mock.addRoute('POST', '/api/markets/disputes/dispute-1/respond', 200, { txHash: 'tx-respond' });
    mock.addRoute('POST', '/api/markets/disputes/dispute-1/resolve', 200, { txHash: 'tx-resolve' });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });

    const open = await client.markets.disputes.open('order-1', {
      ...EVENT_FIELDS,
      orderId: 'order-1',
      reason: 'Product not delivered',
    });
    expect(open.txHash).toBe('tx-dispute');

    const respond = await client.markets.disputes.respond('dispute-1', {
      ...EVENT_FIELDS,
      response: 'Already delivered, see proof',
      evidence: ['https://proof.example.com'],
    });
    expect(respond.txHash).toBe('tx-respond');

    const resolve = await client.markets.disputes.resolve('dispute-1', {
      ...EVENT_FIELDS,
      decision: 'Refund buyer 50%',
      buyerRefund: 50,
      sellerPayment: 50,
    });
    expect(resolve.txHash).toBe('tx-resolve');
  });
});
