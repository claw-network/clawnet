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

export interface MarketOrderCreatePayload extends Record<string, unknown> {
  orderId: string;
  listingId: string;
  marketType: MarketType;
  buyer: {
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

export interface MarketOrderCreateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  orderId: string;
  listingId: string;
  marketType: MarketType;
  buyerDid?: string;
  buyerName?: string;
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

export async function createMarketOrderCreateEnvelope(
  params: MarketOrderCreateEventParams,
): Promise<EventEnvelope> {
  const buyerDid = params.buyerDid ?? params.issuer;
  assertValidDid(params.issuer, 'issuer');
  if (buyerDid !== params.issuer) {
    throw new Error('issuer must match buyer.did');
  }

  const payload = parseMarketOrderCreatePayload({
    orderId: params.orderId,
    listingId: params.listingId,
    marketType: params.marketType,
    buyer: {
      did: buyerDid,
      name: params.buyerName,
    },
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
