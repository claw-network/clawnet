/**
 * Tests for ReputationApi — profile, reviews, record.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ClawTokenClient } from '../src/index.js';
import { createMockServer, type MockServer } from './helpers/mock-server.js';

let mock: MockServer;

afterEach(async () => {
  if (mock) await mock.close();
});

describe('ReputationApi', () => {
  it('getProfile returns reputation profile', async () => {
    mock = await createMockServer();
    const did = 'did:claw:z6MkAgent';
    mock.addRoute('GET', `/api/reputation/${encodeURIComponent(did)}`, 200, {
      did,
      score: 85,
      level: 'gold',
      levelNumber: 4,
      dimensions: { transaction: 90, delivery: 80, quality: 85, social: 75, behavior: 95 },
      totalTransactions: 50,
      successRate: 0.96,
      averageRating: 4.5,
      badges: ['early_adopter'],
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const rep = await client.reputation.getProfile(did);

    expect(rep.did).toBe(did);
    expect(rep.score).toBe(85);
    expect(rep.level).toBe('gold');
    expect(rep.dimensions.transaction).toBe(90);
    expect(rep.totalTransactions).toBe(50);
    expect(rep.badges).toContain('early_adopter');
  });

  it('getReviews returns review list', async () => {
    mock = await createMockServer();
    const did = 'did:claw:z6MkAgent';
    mock.addRoute('GET', `/api/reputation/${encodeURIComponent(did)}/reviews`, 200, {
      reviews: [
        {
          id: 'rev-1',
          reviewer: 'did:claw:z6MkOther',
          reviewee: did,
          rating: 5,
          comment: 'Excellent work!',
          createdAt: 1700000000000,
        },
      ],
      total: 1,
      averageRating: 5.0,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.reputation.getReviews(did, { limit: 10 });

    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0].rating).toBe(5);
    expect(result.averageRating).toBe(5.0);
  });

  it('record submits reputation event', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/reputation/record', 200, {
      txHash: 'rep-tx-1',
      status: 'confirmed',
      timestamp: 1700000000000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.reputation.record({
      did: 'did:claw:z6MkReviewer',
      passphrase: 'pass',
      nonce: 1,
      target: 'did:claw:z6MkTarget',
      dimension: 'quality',
      score: 5,
      ref: 'contract-id-123',
      comment: 'Great delivery',
    });

    expect(result.txHash).toBe('rep-tx-1');
    const body = mock.requests[0].body as Record<string, unknown>;
    expect(body.target).toBe('did:claw:z6MkTarget');
    expect(body.dimension).toBe('quality');
    expect(body.score).toBe(5);
  });
});
