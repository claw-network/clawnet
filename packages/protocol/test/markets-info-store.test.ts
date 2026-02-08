import { describe, expect, it } from 'vitest';
import { canonicalizeBytes, blake3Hex, generateKeypair, generateX25519Keypair } from '@clawtoken/core/crypto';
import { EventStore, MemoryStore } from '@clawtoken/core/storage';
import { didFromPublicKey } from '@clawtoken/core/identity';
import { bytesToHex, bytesToUtf8, utf8ToBytes } from '@clawtoken/core/utils';
import {
  createInfoListingPublishEnvelope,
  InfoContentStore,
  createInfoOrderDeliveryEnvelope,
  decryptInfoContent,
  generateInfoContentKey,
  openInfoContentKey,
  prepareInfoDeliveryRecord,
  sealInfoContentKey,
} from '../src/markets/index.js';

const pricing = {
  type: 'fixed',
  fixedPrice: '10',
  negotiable: false,
  currency: 'TOKEN',
};

const baseMarketData = (hash?: string) => ({
  infoType: 'dataset',
  content: {
    format: 'csv',
    hash,
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
});

describe('info content store', () => {
  it('stores encrypted payloads and decrypts with key', async () => {
    const store = new InfoContentStore(new MemoryStore());
    const key = generateInfoContentKey();
    const plaintext = utf8ToBytes('secret payload');

    const record = await store.storeEncryptedContent('listing-1', plaintext, key);
    const loaded = await store.getEncryptedContent(record.hash);
    expect(loaded).toBeTruthy();

    const decrypted = decryptInfoContent(loaded!, key);
    expect(bytesToUtf8(decrypted)).toBe('secret payload');

    const listingHash = await store.getListingContentHash('listing-1');
    expect(listingHash).toBe(record.hash);
  });

  it('seals and opens content keys with x25519 envelopes', () => {
    const buyerKeys = generateX25519Keypair();
    const contentKey = generateInfoContentKey();
    const envelope = sealInfoContentKey(contentKey, buyerKeys.publicKey);
    const opened = openInfoContentKey(envelope, buyerKeys.privateKey);
    expect(bytesToHex(opened)).toBe(bytesToHex(contentKey));
  });

  it('rebuilds listing content links from event log', async () => {
    const eventStore = new EventStore(new MemoryStore());
    const store = new InfoContentStore(new MemoryStore());

    const keys = await generateKeypair();
    const sellerDid = didFromPublicKey(keys.publicKey);
    const contentHash = blake3Hex(utf8ToBytes('data')).toLowerCase();

    const publish = await createInfoListingPublishEnvelope({
      issuer: sellerDid,
      privateKey: keys.privateKey,
      listingId: 'listing-1',
      title: 'Data pack',
      description: 'Quality dataset',
      category: 'data',
      tags: ['dataset'],
      pricing,
      visibility: 'public',
      marketData: baseMarketData(contentHash),
      ts: Date.now(),
      nonce: 1,
    });

    await eventStore.appendEvent(publish.hash as string, canonicalizeBytes(publish));

    await store.rebuildFromEventLog(eventStore);
    const linked = await store.getListingContentHash('listing-1');
    expect(linked).toBe(contentHash);
  });

  it('stores delivery records and references them in order updates', async () => {
    const store = new InfoContentStore(new MemoryStore());
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);

    const delivery = await prepareInfoDeliveryRecord({
      store,
      deliveryId: 'delivery-1',
      orderId: 'order-1',
      listingId: 'listing-1',
      contentHash: blake3Hex(utf8ToBytes('payload')).toLowerCase(),
      accessToken: 'token-1',
    });

    const update = await createInfoOrderDeliveryEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      orderId: 'order-1',
      resourcePrev: 'prev-hash',
      deliveryId: delivery.deliveryId,
      method: 'download',
      ts: Date.now(),
      nonce: 2,
    });

    const payload = update.payload as Record<string, unknown>;
    const deliveryPayload = payload.delivery as Record<string, unknown>;
    const tracking = deliveryPayload.tracking as Record<string, unknown>;
    expect(tracking.deliveryId).toBe('delivery-1');
  });
});
