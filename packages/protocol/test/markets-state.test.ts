import { describe, expect, it } from 'vitest';
import { generateKeypair } from '@clawtoken/core/crypto';
import { didFromPublicKey } from '@clawtoken/core/identity';
import {
  applyMarketEvent,
  createMarketState,
  createMarketListingPublishEnvelope,
  createMarketOrderCreateEnvelope,
  createMarketOrderUpdateEnvelope,
} from '../src/markets/index.js';

const pricing = {
  type: 'fixed',
  fixedPrice: '10',
  negotiable: false,
  currency: 'TOKEN',
};

describe('market state', () => {
  it('applies listing publish and order updates', async () => {
    const sellerKeys = await generateKeypair();
    const buyerKeys = await generateKeypair();
    const sellerDid = didFromPublicKey(sellerKeys.publicKey);
    const buyerDid = didFromPublicKey(buyerKeys.publicKey);

    const listingEnvelope = await createMarketListingPublishEnvelope({
      issuer: sellerDid,
      privateKey: sellerKeys.privateKey,
      listingId: 'listing-1',
      marketType: 'info',
      title: 'Test listing',
      description: 'desc',
      category: 'general',
      tags: ['alpha'],
      pricing,
      visibility: 'public',
      marketData: {},
      ts: Date.now(),
      nonce: 1,
    });

    let state = createMarketState();
    state = applyMarketEvent(state, listingEnvelope);
    expect(state.listings['listing-1']).toBeTruthy();
    expect(state.listings['listing-1'].status).toBe('active');

    const orderEnvelope = await createMarketOrderCreateEnvelope({
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

    state = applyMarketEvent(state, orderEnvelope);
    expect(state.orders['order-1']).toBeTruthy();
    expect(state.orders['order-1'].seller.did).toBe(sellerDid);
    expect(state.orders['order-1'].status).toBe('pending');

    const updateEnvelope = await createMarketOrderUpdateEnvelope({
      issuer: sellerDid,
      privateKey: sellerKeys.privateKey,
      orderId: 'order-1',
      resourcePrev: orderEnvelope.hash as string,
      status: 'delivered',
      ts: Date.now(),
      nonce: 2,
    });

    state = applyMarketEvent(state, updateEnvelope);
    expect(state.orders['order-1'].status).toBe('delivered');

    const invalidUpdate = await createMarketOrderUpdateEnvelope({
      issuer: sellerDid,
      privateKey: sellerKeys.privateKey,
      orderId: 'order-1',
      resourcePrev: updateEnvelope.hash as string,
      status: 'pending',
      ts: Date.now(),
      nonce: 3,
    });

    expect(() => applyMarketEvent(state, invalidUpdate)).toThrow('invalid order status transition');
  });
});
