import { describe, expect, it } from 'vitest';
import { generateKeypair } from '@claw-network/core/crypto';
import { didFromPublicKey } from '@claw-network/core/identity';
import {
  createInfoListingPublishEnvelope,
  parseInfoMarketData,
} from '../src/markets/index.js';

const pricing = {
  type: 'fixed',
  fixedPrice: '12',
  negotiable: false,
  currency: 'TOKEN',
};

const baseMarketData = {
  infoType: 'dataset',
  content: {
    format: 'csv',
    size: 128,
  },
  accessMethod: {
    type: 'download',
    download: {
      formats: ['csv'],
    },
  },
  license: {
    type: 'non_exclusive',
    permissions: {
      use: true,
      modify: false,
      distribute: false,
      commercialize: false,
      sublicense: false,
    },
    restrictions: {
      attribution: true,
      shareAlike: false,
      nonCompete: false,
      confidential: false,
    },
  },
};

describe('info market helpers', () => {
  it('parses info market data', () => {
    const parsed = parseInfoMarketData(baseMarketData);
    expect(parsed.infoType).toBe('dataset');
    expect(parsed.content.format).toBe('csv');
    expect(parsed.accessMethod.type).toBe('download');
    expect(parsed.license.type).toBe('non_exclusive');
  });

  it('rejects invalid info market data', () => {
    expect(() => parseInfoMarketData({ ...baseMarketData, infoType: 'bad' })).toThrow(
      'infoType is invalid',
    );
    expect(() =>
      parseInfoMarketData({
        ...baseMarketData,
        license: {
          ...baseMarketData.license,
          permissions: {
            ...(baseMarketData.license.permissions as Record<string, unknown>),
            use: 'yes',
          },
        },
      }),
    ).toThrow('license.permissions.use must be a boolean');
  });

  it('creates a listing publish envelope', async () => {
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);
    const envelope = await createInfoListingPublishEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      listingId: 'info-1',
      title: 'Data pack',
      description: 'desc',
      category: 'data',
      tags: ['data'],
      pricing,
      visibility: 'public',
      marketData: baseMarketData,
      ts: Date.now(),
      nonce: 1,
    });

    const payload = envelope.payload as Record<string, unknown>;
    expect(envelope.type).toBe('market.listing.publish');
    expect(payload.marketType).toBe('info');
    const marketData = payload.marketData as Record<string, unknown>;
    expect(marketData.infoType).toBe('dataset');
  });
});
