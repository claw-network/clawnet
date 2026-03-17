import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { ApiServer } from '../src/api/server.js';
import { MarketListing, MarketSearchIndex } from '@claw-network/protocol';

async function readData<T>(res: Response): Promise<T> {
  const payload = (await res.json()) as { data?: T };
  return (payload.data ?? payload) as T;
}

async function readProblem(
  res: Response,
): Promise<{ type: string; title: string; status: number }> {
  return (await res.json()) as { type: string; title: string; status: number };
}

function createListing(overrides: Partial<MarketListing>): MarketListing {
  const base: MarketListing = {
    id: 'listing-1',
    marketType: 'info',
    seller: {
      did: 'did:claw:test',
      name: 'seller',
      reputation: 5,
      verified: true,
    },
    title: 'Base listing',
    description: 'Base description',
    category: 'general',
    tags: ['base'],
    pricing: {
      type: 'fixed',
      fixedPrice: '10',
      negotiable: false,
      currency: 'TOKEN',
    },
    status: 'active',
    visibility: 'public',
    stats: {
      views: 0,
      favorites: 0,
      inquiries: 0,
      orders: 0,
      completedOrders: 0,
      totalRevenue: '0',
      averageRating: 0,
      ratingCount: 0,
    },
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    marketData: {},
  };
  return { ...base, ...overrides } as MarketListing;
}

describe('markets search api', () => {
  let api: ApiServer;
  let baseUrl: string;

  beforeEach(async () => {
    const index = new MarketSearchIndex();
    index.indexListing(
      createListing({
        id: 'info-1',
        marketType: 'info',
        title: 'Data pack',
        description: 'Dataset for ML',
        category: 'data',
        tags: ['data', 'ml'],
        pricing: {
          type: 'fixed',
          fixedPrice: '15',
          negotiable: false,
          currency: 'TOKEN',
        },
        marketData: {
          infoType: 'dataset',
          content: {
            format: 'csv',
          },
          accessMethod: {
            type: 'download',
          },
        },
        stats: {
          views: 10,
          favorites: 2,
          inquiries: 1,
          orders: 3,
          completedOrders: 2,
          totalRevenue: '30',
          averageRating: 4.8,
          ratingCount: 4,
        },
      }),
    );
    index.indexListing(
      createListing({
        id: 'task-1',
        marketType: 'task',
        title: 'Translate docs',
        description: 'Translate technical documentation',
        category: 'translation',
        tags: ['translation'],
        pricing: {
          type: 'fixed',
          fixedPrice: '50',
          negotiable: true,
          currency: 'TOKEN',
        },
        marketData: {
          taskType: 'one_time',
          task: {
            requirements: 'Translate to English',
            skills: [{ name: 'translation' }],
          },
        },
        stats: {
          views: 1,
          favorites: 0,
          inquiries: 0,
          orders: 1,
          completedOrders: 1,
          totalRevenue: '50',
          averageRating: 4.2,
          ratingCount: 1,
        },
      }),
    );

    api = new ApiServer(
      { host: '127.0.0.1', port: 0 },
      {
        publishEvent: async () => 'hash-1',
        searchMarkets: (query) => index.search(query),
      },
    );
    await api.start();
    const address = (api as unknown as { server: { address: () => AddressInfo } }).server.address();
    baseUrl = `http://${address.address}:${address.port}`;
  });

  afterEach(async () => {
    await api.stop();
  });

  it('filters search results', async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/markets/search?markets=info&tags=data&minPrice=10&maxPrice=20&sort=price_asc`,
    );
    expect(res.status).toBe(200);
    const json = await readData<Array<{ id: string }>>(res);
    expect(json.map((item) => item.id)).toEqual(['info-1']);

    const taskRes = await fetch(`${baseUrl}/api/v1/markets/search?markets=task&skills=translation`);
    expect(taskRes.status).toBe(200);
    const taskJson = await readData<Array<{ id: string }>>(taskRes);
    expect(taskJson.map((item) => item.id)).toEqual(['task-1']);

    const taskTypeRes = await fetch(`${baseUrl}/api/v1/markets/search?taskTypes=one_time`);
    expect(taskTypeRes.status).toBe(200);
    const taskTypeJson = await readData<Array<{ id: string }>>(taskTypeRes);
    expect(taskTypeJson.map((item) => item.id)).toEqual(['task-1']);

    const infoRes = await fetch(
      `${baseUrl}/api/v1/markets/search?infoTypes=dataset&contentFormats=csv&accessMethods=download`,
    );
    expect(infoRes.status).toBe(200);
    const infoJson = await readData<Array<{ id: string }>>(infoRes);
    expect(infoJson.map((item) => item.id)).toEqual(['info-1']);
  });

  it('returns 400 for invalid market type', async () => {
    const res = await fetch(`${baseUrl}/api/v1/markets/search?markets=unknown`);
    expect(res.status).toBe(400);
    const json = await readProblem(res);
    expect(json.type).toContain('validation-error');
  });
});
