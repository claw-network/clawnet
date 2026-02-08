import { describe, expect, it } from 'vitest';
import { MarketSearchIndex } from '../src/markets/search.js';
import { MarketListing } from '../src/markets/types.js';

function createListing(overrides: Partial<MarketListing>): MarketListing {
  const base: MarketListing = {
    id: 'listing-1',
    marketType: 'info',
    seller: { did: 'did:claw:tester', reputation: 0, verified: false },
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

describe('market search index', () => {
  it('filters and sorts listings', () => {
    const index = new MarketSearchIndex();

    const infoListing = createListing({
      id: 'info-1',
      marketType: 'info',
      title: 'Data pack',
      description: 'High quality dataset',
      category: 'data',
      tags: ['data', 'ml'],
      seller: { did: 'did:claw:info', reputation: 4, verified: true },
      pricing: {
        type: 'fixed',
        fixedPrice: '10',
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
        orders: 5,
        completedOrders: 4,
        totalRevenue: '40',
        averageRating: 4.6,
        ratingCount: 5,
      },
      createdAt: 10,
      updatedAt: 10,
    });

    const taskListing = createListing({
      id: 'task-1',
      marketType: 'task',
      title: 'Translate docs',
      description: 'Translate technical documentation',
      category: 'translation',
      tags: ['lang'],
      seller: { did: 'did:claw:task', reputation: 8, verified: true },
      pricing: {
        type: 'fixed',
        fixedPrice: '50',
        negotiable: true,
        currency: 'TOKEN',
      },
      marketData: {
        task: {
          requirements: 'Translate to English',
          skills: [{ name: 'translation' }, { name: 'writing' }],
        },
      },
      stats: {
        views: 3,
        favorites: 0,
        inquiries: 0,
        orders: 1,
        completedOrders: 1,
        totalRevenue: '50',
        averageRating: 4.2,
        ratingCount: 1,
      },
      createdAt: 20,
      updatedAt: 20,
    });

    const capabilityListing = createListing({
      id: 'cap-1',
      marketType: 'capability',
      title: 'Search API',
      description: 'Fast semantic search',
      category: 'api',
      tags: ['search'],
      seller: { did: 'did:claw:cap', reputation: 6, verified: true },
      pricing: {
        type: 'fixed',
        fixedPrice: '5',
        negotiable: false,
        currency: 'TOKEN',
      },
      marketData: {
        capabilityType: 'search',
      },
      stats: {
        views: 12,
        favorites: 4,
        inquiries: 2,
        orders: 3,
        completedOrders: 2,
        totalRevenue: '15',
        averageRating: 4.0,
        ratingCount: 3,
      },
      createdAt: 30,
      updatedAt: 30,
    });

    index.indexListing(infoListing);
    index.indexListing(taskListing);
    index.indexListing(capabilityListing);

    const keywordResult = index.search({ keyword: 'dataset' });
    expect(keywordResult.listings.map((item) => item.id)).toEqual(['info-1']);

    const marketResult = index.search({ markets: ['task'] });
    expect(marketResult.listings.map((item) => item.id)).toEqual(['task-1']);

    const skillResult = index.search({ skills: ['translation'] });
    expect(skillResult.listings.map((item) => item.id)).toEqual(['task-1']);

    const capabilityResult = index.search({ capabilityType: 'search' });
    expect(capabilityResult.listings.map((item) => item.id)).toEqual(['cap-1']);

    const infoTypeResult = index.search({ infoTypes: ['dataset'] });
    expect(infoTypeResult.listings.map((item) => item.id)).toEqual(['info-1']);

    const formatResult = index.search({ contentFormats: ['csv'] });
    expect(formatResult.listings.map((item) => item.id)).toEqual(['info-1']);

    const accessResult = index.search({ accessMethods: ['download'] });
    expect(accessResult.listings.map((item) => item.id)).toEqual(['info-1']);

    const priceResult = index.search({ priceRange: { min: '6', max: '20' } });
    expect(priceResult.listings.map((item) => item.id)).toEqual(['info-1']);

    const sorted = index.search({ sort: 'price_asc' });
    expect(sorted.listings.map((item) => item.id)).toEqual(['cap-1', 'info-1', 'task-1']);

    const facets = index.search({ includeFacets: true });
    expect(facets.facets?.categories?.length).toBeGreaterThan(0);
  });
});
