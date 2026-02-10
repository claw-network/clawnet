export type TokenAmount = string;

export const MARKET_TYPES = ['info', 'task', 'capability'] as const;
export type MarketType = (typeof MARKET_TYPES)[number];

export function isMarketType(value: string): value is MarketType {
  return (MARKET_TYPES as readonly string[]).includes(value);
}

export const LISTING_STATUSES = [
  'draft',
  'active',
  'paused',
  'sold_out',
  'expired',
  'removed',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export function isListingStatus(value: string): value is ListingStatus {
  return (LISTING_STATUSES as readonly string[]).includes(value);
}

export const LISTING_VISIBILITIES = ['public', 'private', 'unlisted'] as const;
export type ListingVisibility = (typeof LISTING_VISIBILITIES)[number];

export function isListingVisibility(value: string): value is ListingVisibility {
  return (LISTING_VISIBILITIES as readonly string[]).includes(value);
}

export const PRICING_TYPES = [
  'fixed',
  'range',
  'usage',
  'subscription',
  'auction',
  'negotiation',
] as const;
export type PricingType = (typeof PRICING_TYPES)[number];

export function isPricingType(value: string): value is PricingType {
  return (PRICING_TYPES as readonly string[]).includes(value);
}

export interface Discount {
  type: 'percentage' | 'fixed' | 'bundle';
  value: number;
  condition?: {
    minQuantity?: number;
    minValue?: TokenAmount;
    couponCode?: string;
    reputationLevel?: string;
    firstTime?: boolean;
  };
  validFrom?: number;
  validUntil?: number;
}

export interface PricingModel {
  type: PricingType;
  fixedPrice?: TokenAmount;
  priceRange?: {
    min: TokenAmount;
    max: TokenAmount;
  };
  usagePrice?: {
    unit: string;
    pricePerUnit: TokenAmount;
    minimumUnits?: number;
    maximumUnits?: number;
  };
  subscriptionPrice?: {
    period: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
    price: TokenAmount;
    trialPeriod?: number;
  };
  auction?: {
    startingPrice: TokenAmount;
    reservePrice?: TokenAmount;
    bidIncrement: TokenAmount;
    duration: number;
    endTime: number;
  };
  negotiable: boolean;
  currency: 'TOKEN';
  discounts?: Discount[];
}

export interface ListingRestrictions {
  buyerRequirements?: {
    minReputation?: number;
    verifiedOnly?: boolean;
    allowedCategories?: string[];
    blockedAgents?: string[];
  };
  regionRestrictions?: {
    allowed?: string[];
    blocked?: string[];
  };
  quantityLimits?: {
    total?: number;
    perBuyer?: number;
    perPeriod?: {
      count: number;
      period: number;
    };
  };
  availabilityWindow?: {
    startTime?: number;
    endTime?: number;
    schedule?: AvailabilitySchedule[];
  };
}

export interface AvailabilitySchedule {
  startTime: number;
  endTime: number;
  recurring?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    interval: number;
    dayOfWeek?: number[];
    dayOfMonth?: number[];
  };
}

export interface ListingStats {
  views: number;
  favorites: number;
  inquiries: number;
  orders: number;
  completedOrders: number;
  totalRevenue: TokenAmount;
  averageRating: number;
  ratingCount: number;
}

export interface MarketListing {
  id: string;
  marketType: MarketType;
  seller: {
    did: string;
    name?: string;
    reputation: number;
    verified: boolean;
  };
  title: string;
  description: string;
  category: string;
  tags: string[];
  pricing: PricingModel;
  status: ListingStatus;
  visibility: ListingVisibility;
  restrictions?: ListingRestrictions;
  stats: ListingStats;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  metadata: Record<string, unknown>;
  marketData: Record<string, unknown>;
}

export interface OrderItem {
  id: string;
  listingId: string;
  title?: string;
  description?: string;
  quantity: number;
  unitPrice: TokenAmount;
  totalPrice: TokenAmount;
  itemData?: Record<string, unknown>;
}

export interface OrderFee {
  type: 'platform' | 'escrow' | 'priority' | 'insurance' | 'other';
  name: string;
  amount: TokenAmount;
  percentage?: number;
}

export interface AppliedDiscount extends Discount {
  amount: TokenAmount;
}

export const ORDER_STATUSES = [
  'draft',
  'pending',
  'accepted',
  'payment_pending',
  'paid',
  'in_progress',
  'delivered',
  'completed',
  'cancelled',
  'disputed',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export const PAYMENT_STATUSES = [
  'pending',
  'escrowed',
  'partial',
  'released',
  'refunded',
  'disputed',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value);
}

export const DELIVERY_STATUSES = [
  'pending',
  'in_progress',
  'delivered',
  'confirmed',
  'rejected',
  'revision',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export function isDeliveryStatus(value: string): value is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(value);
}

export interface OrderPayment {
  status: PaymentStatus;
  method?: string;
  escrowId?: string;
  paidAt?: number;
  releasedAt?: number;
}

export interface OrderDelivery {
  status: DeliveryStatus;
  method?: string;
  tracking?: OrderDeliveryTracking;
  deliveredAt?: number;
  confirmedAt?: number;
}

export interface OrderDeliveryTracking {
  deliveryId: string;
  accessUrl?: string;
  accessToken?: string;
  expiresAt?: number;
}

export interface OrderReview {
  rating: number;
  comment: string;
  detailedRatings?: {
    quality?: number;
    communication?: number;
    timeliness?: number;
    value?: number;
  };
  createdAt: number;
  updatedAt?: number;
}

export interface Attachment {
  id?: string;
  name?: string;
  url?: string;
  size?: number;
  mimeType?: string;
}

export interface OrderMessage {
  id: string;
  sender: string;
  content: string;
  attachments?: Attachment[];
  createdAt: number;
  readAt?: number;
}

export interface OrderDisputeRef {
  disputeId: string;
  status?: string;
}

export interface Order {
  id: string;
  marketType: MarketType;
  listingId: string;
  buyer: {
    did: string;
    name?: string;
  };
  seller: {
    did: string;
    name?: string;
  };
  items: OrderItem[];
  pricing: {
    subtotal: TokenAmount;
    discounts?: AppliedDiscount[];
    fees?: OrderFee[];
    total: TokenAmount;
  };
  payment: OrderPayment;
  delivery: OrderDelivery;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  reviews?: {
    byBuyer?: OrderReview;
    bySeller?: OrderReview;
  };
  dispute?: OrderDisputeRef;
  messages: OrderMessage[];
  metadata: Record<string, unknown>;
}

export const BID_STATUSES = ['submitted', 'shortlisted', 'accepted', 'rejected', 'withdrawn'] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export function isBidStatus(value: string): value is BidStatus {
  return (BID_STATUSES as readonly string[]).includes(value);
}

export interface TaskBid {
  id: string;
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
  status: BidStatus;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export const SUBMISSION_STATUSES = ['pending_review', 'approved', 'rejected', 'revision'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export function isSubmissionStatus(value: string): value is SubmissionStatus {
  return (SUBMISSION_STATUSES as readonly string[]).includes(value);
}

export interface TaskSubmission {
  id: string;
  orderId: string;
  worker: string;
  deliverables: Record<string, unknown>[];
  notes?: string;
  status: SubmissionStatus;
  review?: {
    approved: boolean;
    feedback: string;
    rating?: number;
    reviewedAt?: number;
    revisionDeadline?: number;
  };
  submittedAt: number;
  updatedAt: number;
}

export const CAPABILITY_LEASE_STATUSES = [
  'active',
  'paused',
  'exhausted',
  'expired',
  'cancelled',
  'terminated',
] as const;
export type CapabilityLeaseStatus = (typeof CAPABILITY_LEASE_STATUSES)[number];

export function isCapabilityLeaseStatus(value: string): value is CapabilityLeaseStatus {
  return (CAPABILITY_LEASE_STATUSES as readonly string[]).includes(value);
}

export type CapabilityPlanType = 'pay_per_use' | 'time_based' | 'subscription' | 'credits';

export interface CapabilityLeasePlan {
  type: CapabilityPlanType;
  details?: Record<string, unknown>;
}

export interface CapabilityLease {
  id: string;
  listingId: string;
  lessee: string;
  lessor: string;
  plan: CapabilityLeasePlan;
  credentials?: Record<string, unknown>;
  status: CapabilityLeaseStatus;
  startedAt: number;
  updatedAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface CapabilityUsageRecord {
  id: string;
  leaseId: string;
  resource: string;
  units: number;
  latency: number;
  success: boolean;
  cost?: TokenAmount;
  timestamp: number;
}
