import { EventEnvelope } from '@clawtoken/core/protocol';
import { addressFromDid } from '@clawtoken/core/identity';
import {
  createMarketOrderCreateEnvelope,
  createMarketOrderUpdateEnvelope,
} from './events.js';
import {
  createWalletEscrowCreateEnvelope,
  createWalletEscrowFundEnvelope,
  createWalletEscrowReleaseEnvelope,
  WalletEscrowCreateEventParams,
  WalletEscrowFundEventParams,
  WalletEscrowReleaseEventParams,
} from '../wallet/events.js';
import {
  MarketListing,
  OrderDelivery,
  OrderPayment,
  OrderReview,
  OrderStatus,
  TokenAmount,
} from './types.js';
import { parseInfoMarketData } from './info.js';
import {
  InfoContentStore,
  InfoDeliveryRecord,
  InfoKeyEnvelope,
  sealInfoContentKey,
} from './info-store.js';

export type TokenAmountLike = TokenAmount | number | bigint;

function normalizeTokenAmount(value: TokenAmountLike, field: string): string {
  let parsed: bigint;
  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${field} must be an integer`);
    }
    parsed = BigInt(value);
  } else {
    if (value.trim().length === 0) {
      throw new Error(`${field} is required`);
    }
    parsed = BigInt(value);
  }
  if (parsed < 0n) {
    throw new Error(`${field} must be >= 0`);
  }
  return parsed.toString();
}

function resolveUnitPrice(listing: MarketListing, override?: TokenAmountLike): string {
  if (override !== undefined) {
    return normalizeTokenAmount(override, 'unitPrice');
  }
  const pricing = listing.pricing;
  switch (pricing.type) {
    case 'fixed':
      if (!pricing.fixedPrice) {
        break;
      }
      return normalizeTokenAmount(pricing.fixedPrice, 'pricing.fixedPrice');
    case 'subscription':
      if (!pricing.subscriptionPrice) {
        break;
      }
      return normalizeTokenAmount(pricing.subscriptionPrice.price, 'pricing.subscriptionPrice.price');
    default:
      break;
  }
  throw new Error('unitPrice is required for this pricing model');
}

function resolveQuantity(quantity?: number): number {
  const value = quantity ?? 1;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('quantity must be a positive integer');
  }
  return value;
}

export interface InfoOrderCreateParams {
  issuer: string;
  privateKey: Uint8Array;
  listing: MarketListing;
  orderId: string;
  buyerDid?: string;
  quantity?: number;
  unitPrice?: TokenAmountLike;
  pricing?: {
    subtotal?: TokenAmountLike;
    discounts?: {
      type: 'percentage' | 'fixed' | 'bundle';
      value: number;
      condition?: Record<string, unknown>;
      validFrom?: number;
      validUntil?: number;
      amount: TokenAmountLike;
    }[];
    fees?: {
      type: 'platform' | 'escrow' | 'priority' | 'insurance' | 'other';
      name: string;
      amount: TokenAmountLike;
      percentage?: number;
    }[];
    total?: TokenAmountLike;
  };
  payment?: Partial<OrderPayment>;
  delivery?: Partial<OrderDelivery>;
  status?: OrderStatus;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createInfoOrderCreateEnvelope(
  params: InfoOrderCreateParams,
): Promise<EventEnvelope> {
  const buyerDid = params.buyerDid ?? params.issuer;
  const quantity = resolveQuantity(params.quantity);
  const unitPrice = resolveUnitPrice(params.listing, params.unitPrice);
  const totalPrice = (BigInt(unitPrice) * BigInt(quantity)).toString();

  let itemData: Record<string, unknown> | undefined;
  if (params.listing.marketType === 'info') {
    try {
      const info = parseInfoMarketData(params.listing.marketData);
      itemData = {
        infoType: info.infoType,
        accessMethod: info.accessMethod,
      };
    } catch {
      itemData = undefined;
    }
  }

  const subtotal = params.pricing?.subtotal !== undefined
    ? normalizeTokenAmount(params.pricing.subtotal, 'pricing.subtotal')
    : totalPrice;
  const total = params.pricing?.total !== undefined
    ? normalizeTokenAmount(params.pricing.total, 'pricing.total')
    : totalPrice;

  return createMarketOrderCreateEnvelope({
    issuer: params.issuer,
    privateKey: params.privateKey,
    orderId: params.orderId,
    listingId: params.listing.id,
    marketType: params.listing.marketType,
    buyerDid,
    items: [
      {
        listingId: params.listing.id,
        title: params.listing.title,
        quantity,
        unitPrice,
        totalPrice,
        itemData,
      },
    ],
    pricing: {
      subtotal,
      total,
      discounts: params.pricing?.discounts,
      fees: params.pricing?.fees,
    },
    payment: {
      status: params.payment?.status ?? 'pending',
      ...(params.payment ?? {}),
    },
    delivery: {
      status: params.delivery?.status ?? 'pending',
      ...(params.delivery ?? {}),
    },
    status: params.status ?? 'pending',
    ts: params.ts,
    nonce: params.nonce,
    prev: params.prev,
  });
}

export interface InfoEscrowCreateParams {
  issuer: string;
  privateKey: Uint8Array;
  escrowId: string;
  buyerDid: string;
  sellerDid: string;
  amount: TokenAmountLike;
  releaseRules: Record<string, unknown>[];
  resourcePrev?: string | null;
  arbiter?: string;
  refundRules?: Record<string, unknown>[];
  expiresAt?: number;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createInfoEscrowCreateEnvelope(
  params: InfoEscrowCreateParams,
): Promise<EventEnvelope> {
  const depositor = addressFromDid(params.buyerDid);
  const beneficiary = addressFromDid(params.sellerDid);
  const payload: WalletEscrowCreateEventParams = {
    issuer: params.issuer,
    privateKey: params.privateKey,
    escrowId: params.escrowId,
    depositor,
    beneficiary,
    amount: params.amount,
    releaseRules: params.releaseRules,
    resourcePrev: params.resourcePrev,
    arbiter: params.arbiter,
    refundRules: params.refundRules,
    expiresAt: params.expiresAt,
    ts: params.ts,
    nonce: params.nonce,
    prev: params.prev,
  };
  return createWalletEscrowCreateEnvelope(payload);
}

export interface InfoEscrowFundParams {
  issuer: string;
  privateKey: Uint8Array;
  escrowId: string;
  resourcePrev: string;
  amount: TokenAmountLike;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createInfoEscrowFundEnvelope(
  params: InfoEscrowFundParams,
): Promise<EventEnvelope> {
  const payload: WalletEscrowFundEventParams = {
    issuer: params.issuer,
    privateKey: params.privateKey,
    escrowId: params.escrowId,
    resourcePrev: params.resourcePrev,
    amount: params.amount,
    ts: params.ts,
    nonce: params.nonce,
    prev: params.prev,
  };
  return createWalletEscrowFundEnvelope(payload);
}

export interface InfoEscrowReleaseParams {
  issuer: string;
  privateKey: Uint8Array;
  escrowId: string;
  resourcePrev: string;
  amount: TokenAmountLike;
  ruleId: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createInfoEscrowReleaseEnvelope(
  params: InfoEscrowReleaseParams,
): Promise<EventEnvelope> {
  const payload: WalletEscrowReleaseEventParams = {
    issuer: params.issuer,
    privateKey: params.privateKey,
    escrowId: params.escrowId,
    resourcePrev: params.resourcePrev,
    amount: params.amount,
    ruleId: params.ruleId,
    ts: params.ts,
    nonce: params.nonce,
    prev: params.prev,
  };
  return createWalletEscrowReleaseEnvelope(payload);
}

export interface InfoOrderPaymentUpdateParams {
  issuer: string;
  privateKey: Uint8Array;
  orderId: string;
  resourcePrev: string;
  status?: OrderStatus;
  escrowId?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createInfoOrderPaymentEscrowedEnvelope(
  params: InfoOrderPaymentUpdateParams,
): Promise<EventEnvelope> {
  return createMarketOrderUpdateEnvelope({
    issuer: params.issuer,
    privateKey: params.privateKey,
    orderId: params.orderId,
    resourcePrev: params.resourcePrev,
    status: params.status ?? 'payment_pending',
    payment: {
      status: 'escrowed',
      escrowId: params.escrowId,
    },
    ts: params.ts,
    nonce: params.nonce,
    prev: params.prev,
  });
}

export interface InfoDeliveryPrepareParams {
  store: InfoContentStore;
  deliveryId: string;
  orderId: string;
  listingId: string;
  contentHash: string;
  buyerPublicKey?: Uint8Array;
  contentKey?: Uint8Array;
  keyEnvelope?: InfoKeyEnvelope;
  accessToken?: string;
  createdAt?: number;
  expiresAt?: number;
}

export async function prepareInfoDeliveryRecord(
  params: InfoDeliveryPrepareParams,
): Promise<InfoDeliveryRecord> {
  let envelope = params.keyEnvelope;
  if (!envelope && params.contentKey && params.buyerPublicKey) {
    envelope = sealInfoContentKey(params.contentKey, params.buyerPublicKey);
  }

  const record: InfoDeliveryRecord = {
    deliveryId: params.deliveryId,
    orderId: params.orderId,
    listingId: params.listingId,
    contentHash: params.contentHash,
    keyEnvelope: envelope,
    accessToken: params.accessToken,
    createdAt: params.createdAt ?? Date.now(),
    expiresAt: params.expiresAt,
  };

  await params.store.storeDeliveryRecord(record);
  return record;
}

export interface InfoOrderDeliveryParams {
  issuer: string;
  privateKey: Uint8Array;
  orderId: string;
  resourcePrev: string;
  deliveryId: string;
  method: string;
  accessUrl?: string;
  accessToken?: string;
  expiresAt?: number;
  status?: OrderStatus;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createInfoOrderDeliveryEnvelope(
  params: InfoOrderDeliveryParams,
): Promise<EventEnvelope> {
  return createMarketOrderUpdateEnvelope({
    issuer: params.issuer,
    privateKey: params.privateKey,
    orderId: params.orderId,
    resourcePrev: params.resourcePrev,
    status: params.status ?? 'delivered',
    delivery: {
      status: 'delivered',
      method: params.method,
      tracking: {
        deliveryId: params.deliveryId,
        accessUrl: params.accessUrl,
        accessToken: params.accessToken,
        expiresAt: params.expiresAt,
      },
      deliveredAt: params.ts,
    },
    ts: params.ts,
    nonce: params.nonce,
    prev: params.prev,
  });
}

export interface InfoOrderCompletionParams {
  issuer: string;
  privateKey: Uint8Array;
  orderId: string;
  resourcePrev: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createInfoOrderCompletionEnvelope(
  params: InfoOrderCompletionParams,
): Promise<EventEnvelope> {
  return createMarketOrderUpdateEnvelope({
    issuer: params.issuer,
    privateKey: params.privateKey,
    orderId: params.orderId,
    resourcePrev: params.resourcePrev,
    status: 'completed',
    payment: {
      status: 'released',
      releasedAt: params.ts,
    },
    delivery: {
      status: 'confirmed',
      confirmedAt: params.ts,
    },
    ts: params.ts,
    nonce: params.nonce,
    prev: params.prev,
  });
}

export interface InfoOrderReviewParams {
  issuer: string;
  privateKey: Uint8Array;
  orderId: string;
  resourcePrev: string;
  status: OrderStatus;
  review: OrderReview;
  by?: 'buyer' | 'seller';
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createInfoOrderReviewEnvelope(
  params: InfoOrderReviewParams,
): Promise<EventEnvelope> {
  const by = params.by ?? 'buyer';
  const review = by === 'buyer' ? { byBuyer: params.review } : { bySeller: params.review };
  return createMarketOrderUpdateEnvelope({
    issuer: params.issuer,
    privateKey: params.privateKey,
    orderId: params.orderId,
    resourcePrev: params.resourcePrev,
    status: params.status,
    review,
    ts: params.ts,
    nonce: params.nonce,
    prev: params.prev,
  });
}
