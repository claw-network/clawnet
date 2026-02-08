import { EventEnvelope, eventHashHex } from '@clawtoken/core/protocol';
import {
  MarketListing,
  ListingStats,
  Order,
  OrderStatus,
} from './types.js';
import {
  MarketListingPublishPayload,
  MarketListingUpdatePayload,
  MarketOrderCreatePayload,
  MarketOrderUpdatePayload,
  parseMarketListingPublishPayload,
  parseMarketListingUpdatePayload,
  parseMarketOrderCreatePayload,
  parseMarketOrderUpdatePayload,
} from './events.js';

export interface MarketHistoryEntry {
  hash: string;
  type: string;
  ts: number;
  payload: Record<string, unknown>;
}

export interface MarketState {
  listings: Record<string, MarketListing>;
  orders: Record<string, Order>;
  listingEvents: Record<string, string>;
  orderEvents: Record<string, string>;
  history: MarketHistoryEntry[];
}

const ORDER_FLOW: OrderStatus[] = [
  'draft',
  'pending',
  'accepted',
  'payment_pending',
  'paid',
  'in_progress',
  'delivered',
  'completed',
];

const ORDER_TERMINAL = new Set<OrderStatus>(['completed', 'cancelled', 'refunded']);

export function createMarketState(): MarketState {
  return {
    listings: {},
    orders: {},
    listingEvents: {},
    orderEvents: {},
    history: [],
  };
}

function cloneState(state: MarketState): MarketState {
  return {
    listings: { ...state.listings },
    orders: { ...state.orders },
    listingEvents: { ...state.listingEvents },
    orderEvents: { ...state.orderEvents },
    history: [...state.history],
  };
}

function createListingStats(): ListingStats {
  return {
    views: 0,
    favorites: 0,
    inquiries: 0,
    orders: 0,
    completedOrders: 0,
    totalRevenue: '0',
    averageRating: 0,
    ratingCount: 0,
  };
}

function isForwardOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) {
    return true;
  }
  if (ORDER_TERMINAL.has(from)) {
    return false;
  }
  if (from === 'disputed') {
    return to === 'refunded' || to === 'completed' || to === 'cancelled';
  }
  if (to === 'cancelled' || to === 'disputed' || to === 'refunded') {
    return true;
  }
  const fromIndex = ORDER_FLOW.indexOf(from);
  const toIndex = ORDER_FLOW.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) {
    return false;
  }
  return toIndex > fromIndex;
}

function requireResourcePrev(current: string | undefined, provided: string, field: string): void {
  if (!current) {
    throw new Error(`${field} has no previous event`);
  }
  if (current !== provided) {
    throw new Error(`${field} resourcePrev does not match`);
  }
}

function applyListingPublish(
  state: MarketState,
  payload: MarketListingPublishPayload,
  hash: string,
  ts: number,
): void {
  if (state.listings[payload.listingId]) {
    throw new Error('listing already exists');
  }
  const listing: MarketListing = {
    id: payload.listingId,
    marketType: payload.marketType,
    seller: {
      did: payload.seller.did,
      name: payload.seller.name,
      reputation: 0,
      verified: false,
    },
    title: payload.title,
    description: payload.description,
    category: payload.category,
    tags: payload.tags,
    pricing: payload.pricing,
    status: payload.status ?? 'active',
    visibility: payload.visibility,
    restrictions: payload.restrictions,
    stats: createListingStats(),
    createdAt: ts,
    updatedAt: ts,
    expiresAt: payload.expiresAt,
    metadata: payload.metadata ?? {},
    marketData: payload.marketData,
  };
  state.listings[payload.listingId] = listing;
  state.listingEvents[payload.listingId] = hash;
}

function applyListingUpdate(
  state: MarketState,
  payload: MarketListingUpdatePayload,
  hash: string,
  ts: number,
): void {
  const listing = state.listings[payload.listingId];
  if (!listing) {
    throw new Error('listing not found');
  }
  requireResourcePrev(state.listingEvents[payload.listingId], payload.resourcePrev, 'listing');
  listing.status = payload.status;
  if (payload.metadata) {
    listing.metadata = { ...listing.metadata, ...payload.metadata };
  }
  listing.updatedAt = ts;
  state.listingEvents[payload.listingId] = hash;
}

function applyOrderCreate(
  state: MarketState,
  payload: MarketOrderCreatePayload,
  hash: string,
  ts: number,
): void {
  if (state.orders[payload.orderId]) {
    throw new Error('order already exists');
  }
  const listing = state.listings[payload.listingId];
  if (!listing) {
    throw new Error('listing not found');
  }
  if (listing.marketType !== payload.marketType) {
    throw new Error('listing marketType mismatch');
  }
  const order: Order = {
    id: payload.orderId,
    marketType: payload.marketType,
    listingId: payload.listingId,
    buyer: payload.buyer,
    seller: {
      did: listing.seller.did,
      name: listing.seller.name,
    },
    items: payload.items,
    pricing: payload.pricing,
    payment: payload.payment,
    delivery: payload.delivery,
    status: payload.status ?? 'pending',
    createdAt: ts,
    updatedAt: ts,
    messages: [],
    metadata: {},
  };
  state.orders[payload.orderId] = order;
  state.orderEvents[payload.orderId] = hash;
}

function applyOrderUpdate(
  state: MarketState,
  payload: MarketOrderUpdatePayload,
  hash: string,
  ts: number,
): void {
  const order = state.orders[payload.orderId];
  if (!order) {
    throw new Error('order not found');
  }
  requireResourcePrev(state.orderEvents[payload.orderId], payload.resourcePrev, 'order');
  if (!isForwardOrderTransition(order.status, payload.status)) {
    throw new Error('invalid order status transition');
  }
  order.status = payload.status;
  if (payload.payment) {
    order.payment = { ...order.payment, ...payload.payment };
  }
  if (payload.delivery) {
    order.delivery = { ...order.delivery, ...payload.delivery };
  }
  if (payload.review) {
    order.reviews = { ...order.reviews, ...payload.review };
  }
  order.updatedAt = ts;
  if (payload.status === 'completed') {
    order.completedAt = ts;
  }
  state.orderEvents[payload.orderId] = hash;
}

export function applyMarketEvent(state: MarketState, envelope: EventEnvelope): MarketState {
  const next = cloneState(state);
  const type = String(envelope.type ?? '');
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
  const hash =
    typeof envelope.hash === 'string' && envelope.hash.length > 0
      ? envelope.hash
      : eventHashHex(envelope);

  let applied = false;

  switch (type) {
    case 'market.listing.publish': {
      const parsed = parseMarketListingPublishPayload(payload);
      applyListingPublish(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'market.listing.update': {
      const parsed = parseMarketListingUpdatePayload(payload);
      applyListingUpdate(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'market.order.create': {
      const parsed = parseMarketOrderCreatePayload(payload);
      applyOrderCreate(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'market.order.update': {
      const parsed = parseMarketOrderUpdatePayload(payload);
      applyOrderUpdate(next, parsed, hash, ts);
      applied = true;
      break;
    }
    default: {
      return next;
    }
  }

  if (applied) {
    next.history.push({
      hash,
      type,
      ts,
      payload,
    });
  }

  return next;
}
