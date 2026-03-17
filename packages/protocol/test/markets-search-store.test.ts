import { describe, expect, it } from 'vitest';
import { canonicalizeBytes } from '@claw-network/core/crypto';
import { EventStore, MemoryStore } from '@claw-network/core/storage';
import { generateKeypair } from '@claw-network/core/crypto';
import { didFromPublicKey } from '@claw-network/core/identity';
import {
  createMarketListingPublishEnvelope,
  createMarketListingUpdateEnvelope,
  createMarketOrderCreateEnvelope,
  createMarketOrderUpdateEnvelope,
  MarketSearchStore,
} from '../src/markets/index.js';

const pricing = {
  type: 'fixed',
  fixedPrice: '10',
  negotiable: false,
  currency: 'TOKEN',
};

describe('market search store', () => {
  it('rebuilds from event log and persists listings', async () => {
    const eventStore = new EventStore(new MemoryStore());
    const indexDb = new MemoryStore();

    const keys = await generateKeypair();
    const sellerDid = didFromPublicKey(keys.publicKey);

    const publish = await createMarketListingPublishEnvelope({
      issuer: sellerDid,
      privateKey: keys.privateKey,
      listingId: 'listing-1',
      marketType: 'info',
      title: 'Data pack',
      description: 'Quality dataset',
      category: 'data',
      tags: ['dataset'],
      pricing,
      visibility: 'public',
      marketData: {},
      ts: Date.now(),
      nonce: 1,
    });

    await eventStore.appendEvent(publish.hash as string, canonicalizeBytes(publish));

    const update = await createMarketListingUpdateEnvelope({
      issuer: sellerDid,
      privateKey: keys.privateKey,
      listingId: 'listing-1',
      resourcePrev: publish.hash as string,
      status: 'paused',
      ts: Date.now(),
      nonce: 2,
    });

    await eventStore.appendEvent(update.hash as string, canonicalizeBytes(update));

    const buyerKeys = await generateKeypair();
    const buyerDid = didFromPublicKey(buyerKeys.publicKey);

    const orderCreate = await createMarketOrderCreateEnvelope({
      issuer: buyerDid,
      privateKey: buyerKeys.privateKey,
      orderId: 'order-1',
      listingId: 'listing-1',
      marketType: 'info',
      items: [
        {
          listingId: 'listing-1',
          quantity: 1,
          unitPrice: '10',
        },
      ],
      pricing: {
        subtotal: '10',
        total: '10',
      },
      ts: Date.now(),
      nonce: 1,
    });

    await eventStore.appendEvent(orderCreate.hash as string, canonicalizeBytes(orderCreate));

    const orderUpdate = await createMarketOrderUpdateEnvelope({
      issuer: sellerDid,
      privateKey: keys.privateKey,
      orderId: 'order-1',
      resourcePrev: orderCreate.hash as string,
      status: 'completed',
      review: {
        byBuyer: {
          rating: 5,
          comment: 'great',
          createdAt: Date.now(),
        },
      },
      ts: Date.now(),
      nonce: 3,
    });

    await eventStore.appendEvent(orderUpdate.hash as string, canonicalizeBytes(orderUpdate));

    const refundUpdate = await createMarketOrderUpdateEnvelope({
      issuer: sellerDid,
      privateKey: keys.privateKey,
      orderId: 'order-1',
      resourcePrev: orderUpdate.hash as string,
      status: 'refunded',
      payment: {
        status: 'refunded',
      },
      ts: Date.now(),
      nonce: 4,
    });

    await eventStore.appendEvent(refundUpdate.hash as string, canonicalizeBytes(refundUpdate));

    const store = new MarketSearchStore(indexDb);
    await store.rebuildFromEventLog(eventStore);

    const paused = store.search({ statuses: ['paused'] });
    expect(paused.listings.map((item) => item.id)).toEqual(['listing-1']);

    const reload = new MarketSearchStore(indexDb);
    await reload.loadFromStore();
    const reloaded = reload.search({ statuses: ['paused'] });
    expect(reloaded.listings.map((item) => item.id)).toEqual(['listing-1']);

    const updatedListing = await reload.getListing('listing-1');
    expect(updatedListing?.status).toBe('paused');
    expect(updatedListing?.stats.orders).toBe(1);
    expect(updatedListing?.stats.completedOrders).toBe(0);
    expect(updatedListing?.stats.totalRevenue).toBe('0');
    expect(updatedListing?.stats.ratingCount).toBe(1);
    expect(updatedListing?.stats.averageRating).toBe(5);
  });
});
