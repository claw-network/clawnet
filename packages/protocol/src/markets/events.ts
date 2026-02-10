import { multibaseEncode } from '@clawtoken/core/encoding';
import { publicKeyFromDid } from '@clawtoken/core/identity';
import { EventEnvelope, eventHashHex, signEvent } from '@clawtoken/core/protocol';
import {
  AppliedDiscount,
  ListingRestrictions,
  ListingStatus,
  ListingVisibility,
  MarketType,
  OrderDelivery,
  OrderItem,
  OrderPayment,
  OrderReview,
  OrderStatus,
  PricingModel,
  TokenAmount,
  CapabilityLeasePlan,
  isDeliveryStatus,
  isListingStatus,
  isListingVisibility,
  isMarketType,
  isOrderStatus,
  isPaymentStatus,
  isPricingType,
} from './types.js';

export type TokenAmountLike = TokenAmount | number | bigint;

export interface MarketListingPublishPayload extends Record<string, unknown> {
  listingId: string;
  marketType: MarketType;
  seller: {
    did: string;
    name?: string;
  };
  title: string;
  description: string;
  category: string;
  tags: string[];
  pricing: PricingModel;
  visibility: ListingVisibility;
  marketData: Record<string, unknown>;
  restrictions?: ListingRestrictions;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
  status?: ListingStatus;
  resourcePrev?: null;
}

export interface MarketListingUpdatePayload extends Record<string, unknown> {
  listingId: string;
  resourcePrev: string;
  status: ListingStatus;
  metadata?: Record<string, unknown>;
}

export interface MarketListingRemovePayload extends Record<string, unknown> {
  listingId: string;
  resourcePrev: string;
}

export interface MarketOrderCreatePayload extends Record<string, unknown> {
  orderId: string;
  listingId: string;
  marketType: MarketType;
  buyer: {
    did: string;
    name?: string;
  };
  seller?: {
    did: string;
    name?: string;
  };
  items: OrderItem[];
  pricing: {
    subtotal: TokenAmount;
    discounts?: AppliedDiscount[];
    fees?: {
      type: 'platform' | 'escrow' | 'priority' | 'insurance' | 'other';
      name: string;
      amount: TokenAmount;
      percentage?: number;
    }[];
    total: TokenAmount;
  };
  payment: OrderPayment;
  delivery: OrderDelivery;
  status?: OrderStatus;
  resourcePrev?: null;
}

export interface MarketOrderUpdatePayload extends Record<string, unknown> {
  orderId: string;
  resourcePrev: string;
  status: OrderStatus;
  payment?: Partial<OrderPayment>;
  delivery?: Partial<OrderDelivery>;
  review?: {
    byBuyer?: OrderReview;
    bySeller?: OrderReview;
  };
}

export interface MarketBidSubmitPayload extends Record<string, unknown> {
  bidId: string;
  taskId: string;
  bidder: {
    did: string;
    name?: string;
  };
  proposal: {
    price: TokenAmount;
    timeline: number;
    approach: string;
    milestones?: Record<string, unknown>[];
  };
  resourcePrev?: null;
}

export interface MarketBidUpdatePayload extends Record<string, unknown> {
  bidId: string;
  resourcePrev: string;
}

export interface MarketSubmissionSubmitPayload extends Record<string, unknown> {
  orderId: string;
  submissionId: string;
  worker: string;
  deliverables: Record<string, unknown>[];
  notes?: string;
  resourcePrev?: null;
}

export interface MarketSubmissionReviewPayload extends Record<string, unknown> {
  submissionId: string;
  resourcePrev: string;
  approved: boolean;
  feedback: string;
  rating?: number;
  revisionDeadline?: number;
}

export interface MarketSubscriptionStartPayload extends Record<string, unknown> {
  subscriptionId: string;
  listingId: string;
  buyer: {
    did: string;
    name?: string;
  };
  resourcePrev?: null;
}

export interface MarketSubscriptionCancelPayload extends Record<string, unknown> {
  subscriptionId: string;
  resourcePrev: string;
}

export interface MarketDisputeOpenPayload extends Record<string, unknown> {
  disputeId: string;
  orderId: string;
  type: string;
  description: string;
  claimAmount?: TokenAmount;
  resourcePrev?: null;
}

export interface MarketDisputeResponsePayload extends Record<string, unknown> {
  disputeId: string;
  resourcePrev: string;
  response: string;
  evidence?: Record<string, unknown>[];
}

export interface MarketDisputeResolvePayload extends Record<string, unknown> {
  disputeId: string;
  resourcePrev: string;
  resolution: string;
  notes?: string;
}

export interface MarketCapabilityLeaseStartPayload extends Record<string, unknown> {
  listingId: string;
  leaseId: string;
  lessee: string;
  plan: CapabilityLeasePlan;
  credentials?: Record<string, unknown>;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
  resourcePrev?: null;
}

export interface MarketCapabilityLeaseUpdatePayload extends Record<string, unknown> {
  leaseId: string;
  resourcePrev: string;
}

export interface MarketCapabilityInvokePayload extends Record<string, unknown> {
  leaseId: string;
  resource: string;
  units: number;
  latency: number;
  success: boolean;
  cost?: TokenAmount;
}

export interface MarketListingPublishEventParams {
  issuer: string;
  privateKey: Uint8Array;
  listingId: string;
  marketType: MarketType;
  sellerDid?: string;
  sellerName?: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  pricing: PricingModel;
  visibility: ListingVisibility;
  marketData: Record<string, unknown>;
  restrictions?: ListingRestrictions;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
  status?: ListingStatus;
  resourcePrev?: null;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketListingUpdateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  listingId: string;
  resourcePrev: string;
  status: ListingStatus;
  metadata?: Record<string, unknown>;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketListingRemoveEventParams {
  issuer: string;
  privateKey: Uint8Array;
  listingId: string;
  resourcePrev: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketOrderCreateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  orderId: string;
  listingId: string;
  marketType: MarketType;
  buyerDid?: string;
  buyerName?: string;
  sellerDid?: string;
  sellerName?: string;
  items: OrderItemInput[];
  pricing: OrderPricingInput;
  payment?: Partial<OrderPayment>;
  delivery?: Partial<OrderDelivery>;
  status?: OrderStatus;
  resourcePrev?: null;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketOrderUpdateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  orderId: string;
  resourcePrev: string;
  status: OrderStatus;
  payment?: Partial<OrderPayment>;
  delivery?: Partial<OrderDelivery>;
  review?: {
    byBuyer?: OrderReview;
    bySeller?: OrderReview;
  };
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketBidSubmitEventParams {
  issuer: string;
  privateKey: Uint8Array;
  bidId: string;
  taskId: string;
  bidderDid?: string;
  bidderName?: string;
  proposal: {
    price: TokenAmountLike;
    timeline: number;
    approach: string;
    milestones?: Record<string, unknown>[];
  };
  resourcePrev?: null;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketBidUpdateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  bidId: string;
  resourcePrev: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketSubmissionSubmitEventParams {
  issuer: string;
  privateKey: Uint8Array;
  orderId: string;
  submissionId: string;
  workerDid?: string;
  deliverables: Record<string, unknown>[];
  notes?: string;
  resourcePrev?: null;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketSubmissionReviewEventParams {
  issuer: string;
  privateKey: Uint8Array;
  submissionId: string;
  resourcePrev: string;
  approved: boolean;
  feedback: string;
  rating?: number;
  revisionDeadline?: number;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketSubscriptionStartEventParams {
  issuer: string;
  privateKey: Uint8Array;
  subscriptionId: string;
  listingId: string;
  buyerDid?: string;
  buyerName?: string;
  resourcePrev?: null;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketSubscriptionCancelEventParams {
  issuer: string;
  privateKey: Uint8Array;
  subscriptionId: string;
  resourcePrev: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketDisputeOpenEventParams {
  issuer: string;
  privateKey: Uint8Array;
  disputeId: string;
  orderId: string;
  type: string;
  description: string;
  claimAmount?: TokenAmountLike;
  resourcePrev?: null;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketDisputeResponseEventParams {
  issuer: string;
  privateKey: Uint8Array;
  disputeId: string;
  resourcePrev: string;
  response: string;
  evidence?: Record<string, unknown>[];
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketDisputeResolveEventParams {
  issuer: string;
  privateKey: Uint8Array;
  disputeId: string;
  resourcePrev: string;
  resolution: string;
  notes?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketCapabilityLeaseStartEventParams {
  issuer: string;
  privateKey: Uint8Array;
  listingId: string;
  leaseId: string;
  lessee?: string;
  plan: CapabilityLeasePlan | Record<string, unknown>;
  credentials?: Record<string, unknown>;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
  resourcePrev?: null;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketCapabilityLeaseUpdateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  leaseId: string;
  resourcePrev: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface MarketCapabilityInvokeEventParams {
  issuer: string;
  privateKey: Uint8Array;
  leaseId: string;
  resource: string;
  units: number;
  latency: number;
  success: boolean;
  cost?: TokenAmountLike;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface OrderItemInput {
  id?: string;
  listingId: string;
  title?: string;
  description?: string;
  quantity: number;
  unitPrice: TokenAmountLike;
  totalPrice?: TokenAmountLike;
  itemData?: Record<string, unknown>;
}

export interface OrderPricingInput {
  subtotal: TokenAmountLike;
  discounts?: AppliedDiscount[];
  fees?: {
    type: 'platform' | 'escrow' | 'priority' | 'insurance' | 'other';
    name: string;
    amount: TokenAmountLike;
    percentage?: number;
  }[];
  total: TokenAmountLike;
}

function requireNonEmpty(value: string, field: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function assertRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertValidDid(value: string, field: string): void {
  requireNonEmpty(value, field);
  try {
    publicKeyFromDid(value);
  } catch {
    throw new Error(`${field} must be a valid did:claw identifier`);
  }
}

function normalizeTokenAmount(value: TokenAmountLike, field: string): string {
  let parsed: bigint;
  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${field} must be an integer`);
    }
    parsed = BigInt(value);
  } else if (typeof value === 'string') {
    if (value.trim().length === 0) {
      throw new Error(`${field} is required`);
    }
    parsed = BigInt(value);
  } else {
    throw new Error(`${field} must be a token amount`);
  }
  if (parsed < 0n) {
    throw new Error(`${field} must be >= 0`);
  }
  return parsed.toString();
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error(`${field} must contain strings`);
    }
    const trimmed = entry.trim();
    if (trimmed.length) {
      result.push(trimmed);
    }
  }
  if (result.length === 0) {
    throw new Error(`${field} must contain at least one tag`);
  }
  return result;
}

const CAPABILITY_PLAN_TYPES = ['pay_per_use', 'time_based', 'subscription', 'credits'] as const;

function parseCapabilityLeasePlan(value: unknown): CapabilityLeasePlan {
  const record = assertRecord(value, 'plan');
  const typeValue = String(record.type ?? '');
  if (!CAPABILITY_PLAN_TYPES.includes(typeValue as (typeof CAPABILITY_PLAN_TYPES)[number])) {
    throw new Error('plan.type is invalid');
  }
  let details: Record<string, unknown> | undefined;
  if (record.details !== undefined) {
    details = assertRecord(record.details, 'plan.details');
  }
  return {
    type: typeValue as CapabilityLeasePlan['type'],
    details,
  };
}

function parsePricingModel(value: unknown): PricingModel {
  const pricing = assertRecord(value, 'pricing');
  const typeValue = String(pricing.type ?? '');
  if (!isPricingType(typeValue)) {
    throw new Error('pricing.type is invalid');
  }
  const currencyValue = pricing.currency ?? 'TOKEN';
  if (currencyValue !== 'TOKEN') {
    throw new Error('pricing.currency must be TOKEN');
  }
  const negotiable = pricing.negotiable;
  if (typeof negotiable !== 'boolean') {
    throw new Error('pricing.negotiable must be a boolean');
  }
  type SubscriptionPrice = NonNullable<PricingModel['subscriptionPrice']>;

  const model: PricingModel = {
    type: typeValue,
    currency: 'TOKEN',
    negotiable,
  };

  if (pricing.fixedPrice !== undefined) {
    model.fixedPrice = normalizeTokenAmount(pricing.fixedPrice as TokenAmountLike, 'pricing.fixedPrice');
  }
  if (pricing.priceRange) {
    const range = assertRecord(pricing.priceRange, 'pricing.priceRange');
    model.priceRange = {
      min: normalizeTokenAmount(range.min as TokenAmountLike, 'pricing.priceRange.min'),
      max: normalizeTokenAmount(range.max as TokenAmountLike, 'pricing.priceRange.max'),
    };
  }
  if (pricing.usagePrice) {
    const usage = assertRecord(pricing.usagePrice, 'pricing.usagePrice');
    model.usagePrice = {
      ...(usage as PricingModel['usagePrice']),
      unit: String(usage.unit ?? ''),
      pricePerUnit: normalizeTokenAmount(usage.pricePerUnit as TokenAmountLike, 'pricing.usagePrice.pricePerUnit'),
    };
  }
  if (pricing.subscriptionPrice) {
    const sub = assertRecord(pricing.subscriptionPrice, 'pricing.subscriptionPrice');
    model.subscriptionPrice = {
      ...(sub as PricingModel['subscriptionPrice']),
      period: String(sub.period ?? '') as SubscriptionPrice['period'],
      price: normalizeTokenAmount(sub.price as TokenAmountLike, 'pricing.subscriptionPrice.price'),
      trialPeriod: typeof sub.trialPeriod === 'number' ? sub.trialPeriod : undefined,
    };
  }
  if (pricing.auction) {
    const auction = assertRecord(pricing.auction, 'pricing.auction');
    model.auction = {
      ...(auction as PricingModel['auction']),
      startingPrice: normalizeTokenAmount(auction.startingPrice as TokenAmountLike, 'pricing.auction.startingPrice'),
      reservePrice:
        auction.reservePrice !== undefined
          ? normalizeTokenAmount(auction.reservePrice as TokenAmountLike, 'pricing.auction.reservePrice')
          : undefined,
      bidIncrement: normalizeTokenAmount(auction.bidIncrement as TokenAmountLike, 'pricing.auction.bidIncrement'),
      duration: Number(auction.duration ?? 0),
      endTime: Number(auction.endTime ?? 0),
    };
  }
  if (pricing.discounts) {
    if (!Array.isArray(pricing.discounts)) {
      throw new Error('pricing.discounts must be an array');
    }
    model.discounts = pricing.discounts as PricingModel['discounts'];
    for (const discount of model.discounts ?? []) {
      if (discount.condition?.minValue !== undefined) {
        discount.condition.minValue = normalizeTokenAmount(
          discount.condition.minValue as TokenAmountLike,
          'pricing.discounts.minValue',
        );
      }
    }
  }

  return model;
}

function parseOrderPricing(value: unknown): MarketOrderCreatePayload['pricing'] {
  const pricing = assertRecord(value, 'pricing');
  const subtotal = normalizeTokenAmount(pricing.subtotal as TokenAmountLike, 'pricing.subtotal');
  const total = normalizeTokenAmount(pricing.total as TokenAmountLike, 'pricing.total');

  let discounts: AppliedDiscount[] | undefined;
  if (pricing.discounts !== undefined) {
    if (!Array.isArray(pricing.discounts)) {
      throw new Error('pricing.discounts must be an array');
    }
    discounts = pricing.discounts.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error('pricing.discounts entries must be objects');
      }
      const record = entry as AppliedDiscount;
      return {
        ...record,
        amount: normalizeTokenAmount(record.amount as TokenAmountLike, 'pricing.discounts.amount'),
      };
    });
  }

  let fees: MarketOrderCreatePayload['pricing']['fees'];
  if (pricing.fees !== undefined) {
    if (!Array.isArray(pricing.fees)) {
      throw new Error('pricing.fees must be an array');
    }
    fees = pricing.fees.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error('pricing.fees entries must be objects');
      }
      const record =
        entry as NonNullable<MarketOrderCreatePayload['pricing']['fees']>[number];
      return {
        ...record,
        amount: normalizeTokenAmount(record.amount as TokenAmountLike, 'pricing.fees.amount'),
      };
    });
  }

  return {
    subtotal,
    discounts,
    fees,
    total,
  };
}

function parseOrderPayment(value: unknown, field: string, requireStatus: boolean): OrderPayment {
  const payment = assertRecord(value, field);
  const statusValue = payment.status;
  if (statusValue === undefined && requireStatus) {
    throw new Error(`${field}.status is required`);
  }
  const statusString = statusValue !== undefined ? String(statusValue) : 'pending';
  if (!isPaymentStatus(statusString)) {
    throw new Error(`${field}.status is invalid`);
  }
  return {
    ...(payment as Record<string, unknown>),
    status: statusString,
  } as unknown as OrderPayment;
}

function parseOrderDelivery(value: unknown, field: string, requireStatus: boolean): OrderDelivery {
  const delivery = assertRecord(value, field);
  const statusValue = delivery.status;
  if (statusValue === undefined && requireStatus) {
    throw new Error(`${field}.status is required`);
  }
  const statusString = statusValue !== undefined ? String(statusValue) : 'pending';
  if (!isDeliveryStatus(statusString)) {
    throw new Error(`${field}.status is invalid`);
  }
  return {
    ...(delivery as Record<string, unknown>),
    status: statusString,
  } as unknown as OrderDelivery;
}

function parseOrderItems(orderId: string, value: unknown): OrderItem[] {
  if (!Array.isArray(value)) {
    throw new Error('items must be an array');
  }
  if (value.length === 0) {
    throw new Error('items must not be empty');
  }
  return value.map((entry, index) => {
    const record = assertRecord(entry, `items[${index}]`);
    const listingId = String(record.listingId ?? '');
    requireNonEmpty(listingId, `items[${index}].listingId`);
    const quantity = Number(record.quantity ?? 0);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`items[${index}].quantity must be a positive integer`);
    }
    const unitPrice = normalizeTokenAmount(record.unitPrice as TokenAmountLike, `items[${index}].unitPrice`);
    const totalPrice =
      record.totalPrice !== undefined
        ? normalizeTokenAmount(record.totalPrice as TokenAmountLike, `items[${index}].totalPrice`)
        : (BigInt(unitPrice) * BigInt(quantity)).toString();

    const id = typeof record.id === 'string' && record.id.trim().length > 0
      ? record.id
      : `${orderId}:${index}`;

    return {
      id,
      listingId,
      title: typeof record.title === 'string' ? record.title : undefined,
      description: typeof record.description === 'string' ? record.description : undefined,
      quantity,
      unitPrice,
      totalPrice,
      itemData: typeof record.itemData === 'object' && record.itemData !== null
        ? (record.itemData as Record<string, unknown>)
        : undefined,
    };
  });
}

function buildEnvelope(
  type: string,
  issuer: string,
  publicKey: Uint8Array,
  payload: Record<string, unknown>,
  ts: number,
  nonce: number,
  prev?: string,
): EventEnvelope {
  return {
    v: 1,
    type,
    issuer,
    ts,
    nonce,
    payload,
    prev,
    sig: '',
    pub: multibaseEncode(publicKey),
    hash: '',
  };
}

export function parseMarketListingPublishPayload(
  payload: Record<string, unknown>,
): MarketListingPublishPayload {
  const listingId = String(payload.listingId ?? '');
  requireNonEmpty(listingId, 'listingId');
  const marketTypeValue = String(payload.marketType ?? '');
  if (!isMarketType(marketTypeValue)) {
    throw new Error('marketType is invalid');
  }
  const sellerRecord = assertRecord(payload.seller, 'seller');
  const sellerDid = String(sellerRecord.did ?? '');
  assertValidDid(sellerDid, 'seller.did');
  const title = String(payload.title ?? '').trim();
  requireNonEmpty(title, 'title');
  const description = String(payload.description ?? '').trim();
  requireNonEmpty(description, 'description');
  const category = String(payload.category ?? '').trim();
  requireNonEmpty(category, 'category');
  const tags = parseStringArray(payload.tags, 'tags');
  const pricing = parsePricingModel(payload.pricing);
  const visibilityValue = String(payload.visibility ?? '');
  if (!isListingVisibility(visibilityValue)) {
    throw new Error('visibility is invalid');
  }
  const marketData = assertRecord(payload.marketData, 'marketData');
  const restrictions = payload.restrictions
    ? (assertRecord(payload.restrictions, 'restrictions') as ListingRestrictions)
    : undefined;
  const metadata = payload.metadata
    ? (assertRecord(payload.metadata, 'metadata') as Record<string, unknown>)
    : undefined;
  const expiresAt = payload.expiresAt;
  if (expiresAt !== undefined && typeof expiresAt !== 'number') {
    throw new Error('expiresAt must be a number');
  }
  const statusValue = payload.status !== undefined ? String(payload.status) : undefined;
  if (statusValue !== undefined && !isListingStatus(statusValue)) {
    throw new Error('status is invalid');
  }
  if (payload.resourcePrev !== undefined && payload.resourcePrev !== null) {
    throw new Error('resourcePrev must be null for listing publish');
  }

  return {
    listingId,
    marketType: marketTypeValue,
    seller: {
      did: sellerDid,
      name: typeof sellerRecord.name === 'string' ? sellerRecord.name : undefined,
    },
    title,
    description,
    category,
    tags,
    pricing,
    visibility: visibilityValue,
    marketData,
    restrictions,
    expiresAt: typeof expiresAt === 'number' ? expiresAt : undefined,
    metadata,
    status: statusValue as ListingStatus | undefined,
    resourcePrev: undefined,
  };
}

export function parseMarketListingUpdatePayload(
  payload: Record<string, unknown>,
): MarketListingUpdatePayload {
  const listingId = String(payload.listingId ?? '');
  requireNonEmpty(listingId, 'listingId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const statusValue = String(payload.status ?? '');
  if (!isListingStatus(statusValue)) {
    throw new Error('status is invalid');
  }
  const metadata = payload.metadata
    ? (assertRecord(payload.metadata, 'metadata') as Record<string, unknown>)
    : undefined;

  return {
    listingId,
    resourcePrev,
    status: statusValue,
    metadata,
  };
}

export function parseMarketListingRemovePayload(
  payload: Record<string, unknown>,
): MarketListingRemovePayload {
  const listingId = String(payload.listingId ?? '');
  requireNonEmpty(listingId, 'listingId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  return {
    listingId,
    resourcePrev,
  };
}

export function parseMarketOrderCreatePayload(
  payload: Record<string, unknown>,
): MarketOrderCreatePayload {
  const orderId = String(payload.orderId ?? '');
  requireNonEmpty(orderId, 'orderId');
  const listingId = String(payload.listingId ?? '');
  requireNonEmpty(listingId, 'listingId');
  const marketTypeValue = String(payload.marketType ?? '');
  if (!isMarketType(marketTypeValue)) {
    throw new Error('marketType is invalid');
  }
  const buyerRecord = assertRecord(payload.buyer, 'buyer');
  const buyerDid = String(buyerRecord.did ?? '');
  assertValidDid(buyerDid, 'buyer.did');
  const sellerRecord = payload.seller !== undefined
    ? assertRecord(payload.seller, 'seller')
    : undefined;
  if (sellerRecord) {
    const sellerDid = String(sellerRecord.did ?? '');
    assertValidDid(sellerDid, 'seller.did');
  }
  const items = parseOrderItems(orderId, payload.items);
  const pricing = parseOrderPricing(payload.pricing);
  const payment = parseOrderPayment(payload.payment, 'payment', true);
  const delivery = parseOrderDelivery(payload.delivery, 'delivery', true);
  const statusValue = payload.status !== undefined ? String(payload.status) : undefined;
  if (statusValue !== undefined && !isOrderStatus(statusValue)) {
    throw new Error('status is invalid');
  }
  if (payload.resourcePrev !== undefined && payload.resourcePrev !== null) {
    throw new Error('resourcePrev must be null for order create');
  }

  return {
    orderId,
    listingId,
    marketType: marketTypeValue,
    buyer: {
      did: buyerDid,
      name: typeof buyerRecord.name === 'string' ? buyerRecord.name : undefined,
    },
    seller: sellerRecord
      ? {
        did: String(sellerRecord.did ?? ''),
        name: typeof sellerRecord.name === 'string' ? sellerRecord.name : undefined,
      }
      : undefined,
    items,
    pricing,
    payment,
    delivery,
    status: statusValue as OrderStatus | undefined,
    resourcePrev: undefined,
  };
}

export function parseMarketOrderUpdatePayload(
  payload: Record<string, unknown>,
): MarketOrderUpdatePayload {
  const orderId = String(payload.orderId ?? '');
  requireNonEmpty(orderId, 'orderId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const statusValue = String(payload.status ?? '');
  if (!isOrderStatus(statusValue)) {
    throw new Error('status is invalid');
  }
  const payment = payload.payment
    ? (parseOrderPayment(payload.payment, 'payment', false) as Partial<OrderPayment>)
    : undefined;
  const delivery = payload.delivery
    ? (parseOrderDelivery(payload.delivery, 'delivery', false) as Partial<OrderDelivery>)
    : undefined;
  const review = payload.review
    ? (assertRecord(payload.review, 'review') as MarketOrderUpdatePayload['review'])
    : undefined;

  return {
    orderId,
    resourcePrev,
    status: statusValue,
    payment,
    delivery,
    review,
  };
}

function parseBidder(value: unknown): { did: string; name?: string } {
  const bidder = assertRecord(value, 'bidder');
  const bidderDid = String(bidder.did ?? '');
  assertValidDid(bidderDid, 'bidder.did');
  return {
    did: bidderDid,
    name: typeof bidder.name === 'string' ? bidder.name : undefined,
  };
}

function parseBidProposal(value: unknown): MarketBidSubmitPayload['proposal'] {
  const proposal = assertRecord(value, 'proposal');
  const price = normalizeTokenAmount(proposal.price as TokenAmountLike, 'proposal.price');
  const timeline = Number(proposal.timeline ?? NaN);
  if (!Number.isFinite(timeline)) {
    throw new Error('proposal.timeline must be a number');
  }
  const approach = String(proposal.approach ?? '').trim();
  requireNonEmpty(approach, 'proposal.approach');
  let milestones: Record<string, unknown>[] | undefined;
  if (proposal.milestones !== undefined) {
    if (!Array.isArray(proposal.milestones)) {
      throw new Error('proposal.milestones must be an array');
    }
    milestones = proposal.milestones.map((entry, index) => {
      return assertRecord(entry, `proposal.milestones[${index}]`);
    });
  }
  return {
    price,
    timeline,
    approach,
    milestones,
  };
}

function parseSubmissionDeliverables(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error('deliverables must be an array');
  }
  return value.map((entry, index) => assertRecord(entry, `deliverables[${index}]`));
}

export function parseMarketBidSubmitPayload(
  payload: Record<string, unknown>,
): MarketBidSubmitPayload {
  const bidId = String(payload.bidId ?? '');
  requireNonEmpty(bidId, 'bidId');
  const taskId = String(payload.taskId ?? '');
  requireNonEmpty(taskId, 'taskId');
  const bidder = parseBidder(payload.bidder);
  const proposal = parseBidProposal(payload.proposal);
  if (payload.resourcePrev !== undefined && payload.resourcePrev !== null) {
    throw new Error('resourcePrev must be null for bid submit');
  }
  return {
    bidId,
    taskId,
    bidder,
    proposal,
    resourcePrev: undefined,
  };
}

export function parseMarketBidUpdatePayload(
  payload: Record<string, unknown>,
): MarketBidUpdatePayload {
  const bidId = String(payload.bidId ?? '');
  requireNonEmpty(bidId, 'bidId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  return {
    bidId,
    resourcePrev,
  };
}

export function parseMarketSubmissionSubmitPayload(
  payload: Record<string, unknown>,
): MarketSubmissionSubmitPayload {
  const orderId = String(payload.orderId ?? '');
  requireNonEmpty(orderId, 'orderId');
  const submissionId = String(payload.submissionId ?? '');
  requireNonEmpty(submissionId, 'submissionId');
  const worker = String(payload.worker ?? '');
  assertValidDid(worker, 'worker');
  const deliverables = parseSubmissionDeliverables(payload.deliverables);
  const notes = typeof payload.notes === 'string' ? payload.notes : undefined;
  if (payload.resourcePrev !== undefined && payload.resourcePrev !== null) {
    throw new Error('resourcePrev must be null for submission submit');
  }
  return {
    orderId,
    submissionId,
    worker,
    deliverables,
    notes,
    resourcePrev: undefined,
  };
}

export function parseMarketSubmissionReviewPayload(
  payload: Record<string, unknown>,
): MarketSubmissionReviewPayload {
  const submissionId = String(payload.submissionId ?? '');
  requireNonEmpty(submissionId, 'submissionId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const approved = payload.approved;
  if (typeof approved !== 'boolean') {
    throw new Error('approved must be a boolean');
  }
  const feedback = String(payload.feedback ?? '').trim();
  requireNonEmpty(feedback, 'feedback');
  const ratingValue = payload.rating;
  if (ratingValue !== undefined && typeof ratingValue !== 'number') {
    throw new Error('rating must be a number');
  }
  const revisionDeadline = payload.revisionDeadline;
  if (revisionDeadline !== undefined && typeof revisionDeadline !== 'number') {
    throw new Error('revisionDeadline must be a number');
  }
  return {
    submissionId,
    resourcePrev,
    approved,
    feedback,
    rating: typeof ratingValue === 'number' ? ratingValue : undefined,
    revisionDeadline: typeof revisionDeadline === 'number' ? revisionDeadline : undefined,
  };
}

export function parseMarketSubscriptionStartPayload(
  payload: Record<string, unknown>,
): MarketSubscriptionStartPayload {
  const subscriptionId = String(payload.subscriptionId ?? '');
  requireNonEmpty(subscriptionId, 'subscriptionId');
  const listingId = String(payload.listingId ?? '');
  requireNonEmpty(listingId, 'listingId');
  const buyerRecord = assertRecord(payload.buyer, 'buyer');
  const buyerDid = String(buyerRecord.did ?? '');
  assertValidDid(buyerDid, 'buyer.did');
  if (payload.resourcePrev !== undefined && payload.resourcePrev !== null) {
    throw new Error('resourcePrev must be null for subscription start');
  }
  return {
    subscriptionId,
    listingId,
    buyer: {
      did: buyerDid,
      name: typeof buyerRecord.name === 'string' ? buyerRecord.name : undefined,
    },
    resourcePrev: undefined,
  };
}

export function parseMarketSubscriptionCancelPayload(
  payload: Record<string, unknown>,
): MarketSubscriptionCancelPayload {
  const subscriptionId = String(payload.subscriptionId ?? '');
  requireNonEmpty(subscriptionId, 'subscriptionId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  return {
    subscriptionId,
    resourcePrev,
  };
}

export function parseMarketDisputeOpenPayload(
  payload: Record<string, unknown>,
): MarketDisputeOpenPayload {
  const disputeId = String(payload.disputeId ?? '');
  requireNonEmpty(disputeId, 'disputeId');
  const orderId = String(payload.orderId ?? '');
  requireNonEmpty(orderId, 'orderId');
  const type = String(payload.type ?? '').trim();
  requireNonEmpty(type, 'type');
  const description = String(payload.description ?? '').trim();
  requireNonEmpty(description, 'description');
  let claimAmount: string | undefined;
  if (payload.claimAmount !== undefined) {
    claimAmount = normalizeTokenAmount(payload.claimAmount as TokenAmountLike, 'claimAmount');
  }
  if (payload.resourcePrev !== undefined && payload.resourcePrev !== null) {
    throw new Error('resourcePrev must be null for dispute open');
  }
  return {
    disputeId,
    orderId,
    type,
    description,
    claimAmount,
    resourcePrev: undefined,
  };
}

export function parseMarketDisputeResponsePayload(
  payload: Record<string, unknown>,
): MarketDisputeResponsePayload {
  const disputeId = String(payload.disputeId ?? '');
  requireNonEmpty(disputeId, 'disputeId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const response = String(payload.response ?? '').trim();
  requireNonEmpty(response, 'response');
  let evidence: Record<string, unknown>[] | undefined;
  if (payload.evidence !== undefined) {
    if (!Array.isArray(payload.evidence)) {
      throw new Error('evidence must be an array');
    }
    evidence = payload.evidence.map((entry, index) => assertRecord(entry, `evidence[${index}]`));
  }
  return {
    disputeId,
    resourcePrev,
    response,
    evidence,
  };
}

export function parseMarketDisputeResolvePayload(
  payload: Record<string, unknown>,
): MarketDisputeResolvePayload {
  const disputeId = String(payload.disputeId ?? '');
  requireNonEmpty(disputeId, 'disputeId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  const resolution = String(payload.resolution ?? '').trim();
  requireNonEmpty(resolution, 'resolution');
  const notes = typeof payload.notes === 'string' ? payload.notes : undefined;
  return {
    disputeId,
    resourcePrev,
    resolution,
    notes,
  };
}

export function parseMarketCapabilityLeaseStartPayload(
  payload: Record<string, unknown>,
): MarketCapabilityLeaseStartPayload {
  const listingId = String(payload.listingId ?? '');
  requireNonEmpty(listingId, 'listingId');
  const leaseId = String(payload.leaseId ?? '');
  requireNonEmpty(leaseId, 'leaseId');
  const lessee = String(payload.lessee ?? '');
  assertValidDid(lessee, 'lessee');
  const plan = parseCapabilityLeasePlan(payload.plan);
  const credentials = payload.credentials
    ? assertRecord(payload.credentials, 'credentials')
    : undefined;
  const metadata = payload.metadata
    ? (assertRecord(payload.metadata, 'metadata') as Record<string, unknown>)
    : undefined;
  const expiresAt = payload.expiresAt;
  if (expiresAt !== undefined && typeof expiresAt !== 'number') {
    throw new Error('expiresAt must be a number');
  }
  if (payload.resourcePrev !== undefined && payload.resourcePrev !== null) {
    throw new Error('resourcePrev must be null for lease start');
  }

  return {
    listingId,
    leaseId,
    lessee,
    plan,
    credentials,
    metadata,
    expiresAt: typeof expiresAt === 'number' ? expiresAt : undefined,
    resourcePrev: undefined,
  };
}

export function parseMarketCapabilityLeaseUpdatePayload(
  payload: Record<string, unknown>,
): MarketCapabilityLeaseUpdatePayload {
  const leaseId = String(payload.leaseId ?? '');
  requireNonEmpty(leaseId, 'leaseId');
  const resourcePrev = String(payload.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  return {
    leaseId,
    resourcePrev,
  };
}

export function parseMarketCapabilityInvokePayload(
  payload: Record<string, unknown>,
): MarketCapabilityInvokePayload {
  const leaseId = String(payload.leaseId ?? '');
  requireNonEmpty(leaseId, 'leaseId');
  const resource = String(payload.resource ?? '').trim();
  requireNonEmpty(resource, 'resource');
  const unitsValue = Number(payload.units ?? NaN);
  if (!Number.isFinite(unitsValue) || !Number.isInteger(unitsValue) || unitsValue <= 0) {
    throw new Error('units must be a positive integer');
  }
  const latencyValue = Number(payload.latency ?? NaN);
  if (!Number.isFinite(latencyValue) || latencyValue < 0) {
    throw new Error('latency must be a non-negative number');
  }
  const successValue = payload.success;
  if (typeof successValue !== 'boolean') {
    throw new Error('success must be a boolean');
  }
  let cost: string | undefined;
  if (payload.cost !== undefined) {
    cost = normalizeTokenAmount(payload.cost as TokenAmountLike, 'cost');
  }

  return {
    leaseId,
    resource,
    units: unitsValue,
    latency: latencyValue,
    success: successValue,
    cost,
  };
}

export async function createMarketListingPublishEnvelope(
  params: MarketListingPublishEventParams,
): Promise<EventEnvelope> {
  const sellerDid = params.sellerDid ?? params.issuer;
  assertValidDid(params.issuer, 'issuer');
  if (sellerDid !== params.issuer) {
    throw new Error('issuer must match seller.did');
  }

  const payload = parseMarketListingPublishPayload({
    listingId: params.listingId,
    marketType: params.marketType,
    seller: {
      did: sellerDid,
      name: params.sellerName,
    },
    title: params.title,
    description: params.description,
    category: params.category,
    tags: params.tags,
    pricing: params.pricing,
    visibility: params.visibility,
    marketData: params.marketData,
    restrictions: params.restrictions,
    expiresAt: params.expiresAt,
    metadata: params.metadata,
    status: params.status,
    resourcePrev: params.resourcePrev,
  });

  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.listing.publish',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketListingUpdateEnvelope(
  params: MarketListingUpdateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketListingUpdatePayload({
    listingId: params.listingId,
    resourcePrev: params.resourcePrev,
    status: params.status,
    metadata: params.metadata,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.listing.update',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketListingRemoveEnvelope(
  params: MarketListingRemoveEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketListingRemovePayload({
    listingId: params.listingId,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.listing.remove',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketOrderCreateEnvelope(
  params: MarketOrderCreateEventParams,
): Promise<EventEnvelope> {
  const buyerDid = params.buyerDid ?? params.issuer;
  assertValidDid(params.issuer, 'issuer');
  if (buyerDid !== params.issuer) {
    throw new Error('issuer must match buyer.did');
  }
  const sellerDid = params.sellerDid;

  const payload = parseMarketOrderCreatePayload({
    orderId: params.orderId,
    listingId: params.listingId,
    marketType: params.marketType,
    buyer: {
      did: buyerDid,
      name: params.buyerName,
    },
    seller: sellerDid
      ? {
        did: sellerDid,
        name: params.sellerName,
      }
      : undefined,
    items: params.items,
    pricing: params.pricing,
    payment: {
      status: params.payment?.status ?? 'pending',
      ...params.payment,
    },
    delivery: {
      status: params.delivery?.status ?? 'pending',
      ...params.delivery,
    },
    status: params.status,
    resourcePrev: params.resourcePrev,
  });

  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.order.create',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketOrderUpdateEnvelope(
  params: MarketOrderUpdateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketOrderUpdatePayload({
    orderId: params.orderId,
    resourcePrev: params.resourcePrev,
    status: params.status,
    payment: params.payment,
    delivery: params.delivery,
    review: params.review,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.order.update',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketBidSubmitEnvelope(
  params: MarketBidSubmitEventParams,
): Promise<EventEnvelope> {
  const bidderDid = params.bidderDid ?? params.issuer;
  assertValidDid(params.issuer, 'issuer');
  if (bidderDid !== params.issuer) {
    throw new Error('issuer must match bidder.did');
  }
  const payload = parseMarketBidSubmitPayload({
    bidId: params.bidId,
    taskId: params.taskId,
    bidder: {
      did: bidderDid,
      name: params.bidderName,
    },
    proposal: params.proposal,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.bid.submit',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketBidAcceptEnvelope(
  params: MarketBidUpdateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketBidUpdatePayload({
    bidId: params.bidId,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.bid.accept',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketBidRejectEnvelope(
  params: MarketBidUpdateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketBidUpdatePayload({
    bidId: params.bidId,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.bid.reject',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketBidWithdrawEnvelope(
  params: MarketBidUpdateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketBidUpdatePayload({
    bidId: params.bidId,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.bid.withdraw',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketSubmissionSubmitEnvelope(
  params: MarketSubmissionSubmitEventParams,
): Promise<EventEnvelope> {
  const workerDid = params.workerDid ?? params.issuer;
  assertValidDid(params.issuer, 'issuer');
  if (workerDid !== params.issuer) {
    throw new Error('issuer must match worker');
  }
  const payload = parseMarketSubmissionSubmitPayload({
    orderId: params.orderId,
    submissionId: params.submissionId,
    worker: workerDid,
    deliverables: params.deliverables,
    notes: params.notes,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.submission.submit',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketSubmissionReviewEnvelope(
  params: MarketSubmissionReviewEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketSubmissionReviewPayload({
    submissionId: params.submissionId,
    resourcePrev: params.resourcePrev,
    approved: params.approved,
    feedback: params.feedback,
    rating: params.rating,
    revisionDeadline: params.revisionDeadline,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.submission.review',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketSubscriptionStartEnvelope(
  params: MarketSubscriptionStartEventParams,
): Promise<EventEnvelope> {
  const buyerDid = params.buyerDid ?? params.issuer;
  assertValidDid(params.issuer, 'issuer');
  if (buyerDid !== params.issuer) {
    throw new Error('issuer must match buyer.did');
  }
  const payload = parseMarketSubscriptionStartPayload({
    subscriptionId: params.subscriptionId,
    listingId: params.listingId,
    buyer: {
      did: buyerDid,
      name: params.buyerName,
    },
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.subscription.start',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketSubscriptionCancelEnvelope(
  params: MarketSubscriptionCancelEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketSubscriptionCancelPayload({
    subscriptionId: params.subscriptionId,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.subscription.cancel',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketDisputeOpenEnvelope(
  params: MarketDisputeOpenEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketDisputeOpenPayload({
    disputeId: params.disputeId,
    orderId: params.orderId,
    type: params.type,
    description: params.description,
    claimAmount: params.claimAmount,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.dispute.open',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketDisputeResponseEnvelope(
  params: MarketDisputeResponseEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketDisputeResponsePayload({
    disputeId: params.disputeId,
    resourcePrev: params.resourcePrev,
    response: params.response,
    evidence: params.evidence,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.dispute.response',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketDisputeResolveEnvelope(
  params: MarketDisputeResolveEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketDisputeResolvePayload({
    disputeId: params.disputeId,
    resourcePrev: params.resourcePrev,
    resolution: params.resolution,
    notes: params.notes,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.dispute.resolve',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketCapabilityLeaseStartEnvelope(
  params: MarketCapabilityLeaseStartEventParams,
): Promise<EventEnvelope> {
  const lessee = params.lessee ?? params.issuer;
  assertValidDid(params.issuer, 'issuer');
  if (lessee !== params.issuer) {
    throw new Error('issuer must match lessee');
  }
  const payload = parseMarketCapabilityLeaseStartPayload({
    listingId: params.listingId,
    leaseId: params.leaseId,
    lessee,
    plan: params.plan,
    credentials: params.credentials,
    metadata: params.metadata,
    expiresAt: params.expiresAt,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.capability.lease.start',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

async function createMarketCapabilityLeaseUpdateEnvelope(
  type: string,
  params: MarketCapabilityLeaseUpdateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketCapabilityLeaseUpdatePayload({
    leaseId: params.leaseId,
    resourcePrev: params.resourcePrev,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    type,
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createMarketCapabilityLeasePauseEnvelope(
  params: MarketCapabilityLeaseUpdateEventParams,
): Promise<EventEnvelope> {
  return createMarketCapabilityLeaseUpdateEnvelope('market.capability.lease.pause', params);
}

export async function createMarketCapabilityLeaseResumeEnvelope(
  params: MarketCapabilityLeaseUpdateEventParams,
): Promise<EventEnvelope> {
  return createMarketCapabilityLeaseUpdateEnvelope('market.capability.lease.resume', params);
}

export async function createMarketCapabilityLeaseTerminateEnvelope(
  params: MarketCapabilityLeaseUpdateEventParams,
): Promise<EventEnvelope> {
  return createMarketCapabilityLeaseUpdateEnvelope('market.capability.lease.terminate', params);
}

export async function createMarketCapabilityInvokeEnvelope(
  params: MarketCapabilityInvokeEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const payload = parseMarketCapabilityInvokePayload({
    leaseId: params.leaseId,
    resource: params.resource,
    units: params.units,
    latency: params.latency,
    success: params.success,
    cost: params.cost,
  });
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'market.capability.invoke',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}
