import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { ApiServer } from '../src/api/server.js';
import {
  createKeyRecord,
  EventStore,
  MemoryStore,
  resolveStoragePaths,
  saveKeyRecord,
} from '@clawnet/core';
import { generateKeypair } from '@clawnet/core/crypto';
import { didFromPublicKey } from '@clawnet/core/identity';
import {
  createInfoListingPublishEnvelope,
  InfoContentStore,
  MarketSearchStore,
} from '@clawnet/protocol';

const pricing = {
  type: 'fixed',
  fixedPrice: '10',
  negotiable: false,
  currency: 'TOKEN',
};

const license = {
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
};

describe('info market api', () => {
  let api: ApiServer;
  let baseUrl: string;
  let tempDir: string;
  let buyerDid: string;
  let passphrase: string;
  let published: Record<string, unknown>[];
  let marketStore: MarketSearchStore;
  let contentStore: InfoContentStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawnet-info-api-'));
    passphrase = 'test-passphrase-123';
    const { publicKey, privateKey } = await generateKeypair();
    buyerDid = didFromPublicKey(publicKey);
    const record = createKeyRecord(publicKey, privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    const paths = resolveStoragePaths(tempDir);
    await saveKeyRecord(paths, record);

    published = [];
    const eventStore = new EventStore(new MemoryStore());
    marketStore = new MarketSearchStore(new MemoryStore());
    contentStore = new InfoContentStore(new MemoryStore());
    await marketStore.loadFromStore();
    await contentStore.loadFromStore();

    api = new ApiServer(
      { host: '127.0.0.1', port: 0, dataDir: tempDir },
      {
        publishEvent: async (envelope) => {
          published.push(envelope);
          return `hash-${published.length}`;
        },
        eventStore,
        marketStore,
        infoContentStore: contentStore,
      },
    );
    await api.start();
    const address = (api as unknown as { server: { address: () => AddressInfo } }).server.address();
    baseUrl = `http://${address.address}:${address.port}`;
  });

  afterEach(async () => {
    await api.stop();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('publishes info listings and stores encrypted content', async () => {
    const res = await fetch(`${baseUrl}/api/markets/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: buyerDid,
        passphrase,
        title: 'Dataset',
        description: 'desc',
        category: 'data',
        tags: ['data'],
        pricing,
        visibility: 'public',
        infoType: 'dataset',
        content: {
          format: 'csv',
          data: 'a,b,c',
          encoding: 'utf8',
        },
        accessMethod: { type: 'download', download: { formats: ['csv'] } },
        license,
        nonce: 1,
      }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { listingId: string; contentHash: string };
    expect(published[0]?.type).toBe('market.listing.publish');
    const stored = await contentStore.getEncryptedContentForListing(json.listingId);
    expect(stored?.hash).toBe(json.contentHash);
  });

  it('creates order and escrow events on purchase', async () => {
    const sellerKeys = await generateKeypair();
    const sellerDid = didFromPublicKey(sellerKeys.publicKey);
    const listing = await createInfoListingPublishEnvelope({
      issuer: sellerDid,
      privateKey: sellerKeys.privateKey,
      listingId: 'listing-1',
      title: 'Dataset',
      description: 'desc',
      category: 'data',
      tags: ['data'],
      pricing,
      visibility: 'public',
      marketData: {
        infoType: 'dataset',
        content: { format: 'csv', hash: 'a'.repeat(64) },
        accessMethod: { type: 'download', download: { formats: ['csv'] } },
        license,
      },
      ts: Date.now(),
      nonce: 1,
    });
    await marketStore.applyEvent(listing);

    const res = await fetch(`${baseUrl}/api/markets/info/listing-1/purchase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: buyerDid,
        passphrase,
        nonce: 2,
      }),
    });
    expect(res.status).toBe(201);
    expect(published[0]?.type).toBe('market.order.create');
    expect(published[1]?.type).toBe('wallet.escrow.create');
    expect(published[2]?.type).toBe('wallet.escrow.fund');
    expect(published[3]?.type).toBe('market.order.update');
  });
});
