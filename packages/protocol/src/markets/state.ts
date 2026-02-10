import { EventEnvelope, eventHashHex } from '@clawtoken/core/protocol';
import {
  MarketListing,
  ListingStats,
  Order,
  OrderStatus,
  TaskBid,
  TaskSubmission,
  CapabilityLease,
  CapabilityUsageRecord,
} from './types.js';
import {
  MarketListingPublishPayload,
  MarketListingUpdatePayload,
  MarketOrderCreatePayload,
  MarketOrderUpdatePayload,
  MarketBidSubmitPayload,
  MarketBidUpdatePayload,
  MarketSubmissionSubmitPayload,
  MarketSubmissionReviewPayload,
  MarketCapabilityLeaseStartPayload,
  MarketCapabilityLeaseUpdatePayload,
  MarketCapabilityInvokePayload,
  parseMarketListingPublishPayload,
  parseMarketListingUpdatePayload,
  parseMarketOrderCreatePayload,
  parseMarketOrderUpdatePayload,
  parseMarketBidSubmitPayload,
  parseMarketBidUpdatePayload,
  parseMarketSubmissionSubmitPayload,
  parseMarketSubmissionReviewPayload,
  parseMarketCapabilityLeaseStartPayload,
  parseMarketCapabilityLeaseUpdatePayload,
  parseMarketCapabilityInvokePayload,
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
  bids: Record<string, TaskBid>;
  bidEvents: Record<string, string>;
  submissions: Record<string, TaskSubmission>;
  submissionEvents: Record<string, string>;
  leases: Record<string, CapabilityLease>;
  leaseEvents: Record<string, string>;
  usageRecords: Record<string, CapabilityUsageRecord>;
  usageByLease: Record<string, string[]>;
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
    bids: {},
    bidEvents: {},
    submissions: {},
    submissionEvents: {},
    leases: {},
    leaseEvents: {},
    usageRecords: {},
    usageByLease: {},
    history: [],
  };
}

function cloneState(state: MarketState): MarketState {
  return {
    listings: { ...state.listings },
    orders: { ...state.orders },
    listingEvents: { ...state.listingEvents },
    orderEvents: { ...state.orderEvents },
    bids: { ...state.bids },
    bidEvents: { ...state.bidEvents },
    submissions: { ...state.submissions },
    submissionEvents: { ...state.submissionEvents },
    leases: { ...state.leases },
    leaseEvents: { ...state.leaseEvents },
    usageRecords: { ...state.usageRecords },
    usageByLease: { ...state.usageByLease },
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
  let seller = listing.seller;
  if (payload.seller) {
    if (payload.marketType !== 'task' && payload.seller.did !== listing.seller.did) {
      throw new Error('order seller mismatch');
    }
    seller = payload.seller;
  }
  const order: Order = {
    id: payload.orderId,
    marketType: payload.marketType,
    listingId: payload.listingId,
    buyer: payload.buyer,
    seller: {
      did: seller.did,
      name: seller.name ?? listing.seller.name,
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

function applyBidSubmit(
  state: MarketState,
  payload: MarketBidSubmitPayload,
  hash: string,
  ts: number,
): void {
  if (state.bids[payload.bidId]) {
    throw new Error('bid already exists');
  }
  const bid: TaskBid = {
    id: payload.bidId,
    taskId: payload.taskId,
    bidder: payload.bidder,
    proposal: payload.proposal,
    status: 'submitted',
    createdAt: ts,
    updatedAt: ts,
  };
  state.bids[payload.bidId] = bid;
  state.bidEvents[payload.bidId] = hash;
}

function applyBidUpdate(
  state: MarketState,
  payload: MarketBidUpdatePayload,
  hash: string,
  ts: number,
  status: TaskBid['status'],
): void {
  const bid = state.bids[payload.bidId];
  if (!bid) {
    throw new Error('bid not found');
  }
  requireResourcePrev(state.bidEvents[payload.bidId], payload.resourcePrev, 'bid');
  bid.status = status;
  bid.updatedAt = ts;
  state.bidEvents[payload.bidId] = hash;
}

function applySubmissionSubmit(
  state: MarketState,
  payload: MarketSubmissionSubmitPayload,
  hash: string,
  ts: number,
): void {
  if (state.submissions[payload.submissionId]) {
    throw new Error('submission already exists');
  }
  const submission: TaskSubmission = {
    id: payload.submissionId,
    orderId: payload.orderId,
    worker: payload.worker,
    deliverables: payload.deliverables,
    notes: payload.notes,
    status: 'pending_review',
    submittedAt: ts,
    updatedAt: ts,
  };
  state.submissions[payload.submissionId] = submission;
  state.submissionEvents[payload.submissionId] = hash;
}

function applySubmissionReview(
  state: MarketState,
  payload: MarketSubmissionReviewPayload,
  hash: string,
  ts: number,
): void {
  const submission = state.submissions[payload.submissionId];
  if (!submission) {
    throw new Error('submission not found');
  }
  requireResourcePrev(state.submissionEvents[payload.submissionId], payload.resourcePrev, 'submission');
  if (payload.approved) {
    submission.status = 'approved';
  } else if (payload.revisionDeadline !== undefined) {
    submission.status = 'revision';
  } else {
    submission.status = 'rejected';
  }
  submission.review = {
    approved: payload.approved,
    feedback: payload.feedback,
    rating: payload.rating,
    reviewedAt: ts,
    revisionDeadline: payload.revisionDeadline,
  };
  submission.updatedAt = ts;
  state.submissionEvents[payload.submissionId] = hash;
}

function applyCapabilityLeaseStart(
  state: MarketState,
  payload: MarketCapabilityLeaseStartPayload,
  hash: string,
  ts: number,
): void {
  if (state.leases[payload.leaseId]) {
    throw new Error('lease already exists');
  }
  const listing = state.listings[payload.listingId];
  if (!listing) {
    throw new Error('listing not found');
  }
  if (listing.marketType !== 'capability') {
    throw new Error('listing marketType mismatch');
  }
  const lease: CapabilityLease = {
    id: payload.leaseId,
    listingId: payload.listingId,
    lessee: payload.lessee,
    lessor: listing.seller.did,
    plan: payload.plan,
    credentials: payload.credentials,
    status: 'active',
    startedAt: ts,
    updatedAt: ts,
    expiresAt: payload.expiresAt,
    metadata: payload.metadata,
  };
  state.leases[payload.leaseId] = lease;
  state.leaseEvents[payload.leaseId] = hash;
}

function applyCapabilityLeaseUpdate(
  state: MarketState,
  payload: MarketCapabilityLeaseUpdatePayload,
  hash: string,
  ts: number,
  status: CapabilityLease['status'],
): void {
  const lease = state.leases[payload.leaseId];
  if (!lease) {
    throw new Error('lease not found');
  }
  requireResourcePrev(state.leaseEvents[payload.leaseId], payload.resourcePrev, 'lease');
  lease.status = status;
  lease.updatedAt = ts;
  state.leaseEvents[payload.leaseId] = hash;
}

function applyCapabilityInvoke(
  state: MarketState,
  payload: MarketCapabilityInvokePayload,
  hash: string,
  ts: number,
): void {
  if (state.usageRecords[hash]) {
    return;
  }
  const lease = state.leases[payload.leaseId];
  if (!lease) {
    throw new Error('lease not found');
  }
  if (lease.status !== 'active') {
    throw new Error('lease not active');
  }
  if (lease.expiresAt !== undefined && ts > lease.expiresAt) {
    throw new Error('lease expired');
  }
  const record: CapabilityUsageRecord = {
    id: hash,
    leaseId: payload.leaseId,
    resource: payload.resource,
    units: payload.units,
    latency: payload.latency,
    success: payload.success,
    cost: payload.cost,
    timestamp: ts,
  };
  state.usageRecords[record.id] = record;
  const list = state.usageByLease[payload.leaseId] ?? [];
  list.push(record.id);
  state.usageByLease[payload.leaseId] = list;
  lease.lastUsedAt = ts;
  lease.updatedAt = ts;
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
    case 'market.bid.submit': {
      const parsed = parseMarketBidSubmitPayload(payload);
      applyBidSubmit(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'market.bid.accept': {
      const parsed = parseMarketBidUpdatePayload(payload);
      applyBidUpdate(next, parsed, hash, ts, 'accepted');
      applied = true;
      break;
    }
    case 'market.bid.reject': {
      const parsed = parseMarketBidUpdatePayload(payload);
      applyBidUpdate(next, parsed, hash, ts, 'rejected');
      applied = true;
      break;
    }
    case 'market.bid.withdraw': {
      const parsed = parseMarketBidUpdatePayload(payload);
      applyBidUpdate(next, parsed, hash, ts, 'withdrawn');
      applied = true;
      break;
    }
    case 'market.submission.submit': {
      const parsed = parseMarketSubmissionSubmitPayload(payload);
      applySubmissionSubmit(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'market.submission.review': {
      const parsed = parseMarketSubmissionReviewPayload(payload);
      applySubmissionReview(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'market.capability.lease.start': {
      const parsed = parseMarketCapabilityLeaseStartPayload(payload);
      applyCapabilityLeaseStart(next, parsed, hash, ts);
      applied = true;
      break;
    }
    case 'market.capability.lease.pause': {
      const parsed = parseMarketCapabilityLeaseUpdatePayload(payload);
      applyCapabilityLeaseUpdate(next, parsed, hash, ts, 'paused');
      applied = true;
      break;
    }
    case 'market.capability.lease.resume': {
      const parsed = parseMarketCapabilityLeaseUpdatePayload(payload);
      applyCapabilityLeaseUpdate(next, parsed, hash, ts, 'active');
      applied = true;
      break;
    }
    case 'market.capability.lease.terminate': {
      const parsed = parseMarketCapabilityLeaseUpdatePayload(payload);
      applyCapabilityLeaseUpdate(next, parsed, hash, ts, 'terminated');
      applied = true;
      break;
    }
    case 'market.capability.invoke': {
      const parsed = parseMarketCapabilityInvokePayload(payload);
      applyCapabilityInvoke(next, parsed, hash, ts);
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
