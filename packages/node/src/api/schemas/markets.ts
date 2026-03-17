/**
 * Market-related Zod schemas (info, tasks, capabilities, disputes).
 */

import { z } from 'zod';
import { AmountSchema, RatingSchema, SignedRequestBase } from './common.js';

// ─── Info Market ────────────────────────────────────────────────

export const InfoPublishSchema = z
  .object({
    ...SignedRequestBase,
    listingId: z.string().optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    category: z.string().min(1),
    tags: z.array(z.string()).optional(),
    pricing: z.record(z.unknown()),
    visibility: z.string().optional(),
    infoType: z.string().min(1),
    content: z.record(z.unknown()),
    accessMethod: z.record(z.unknown()),
    license: z.record(z.unknown()),
    quality: z.record(z.unknown()).optional(),
    usageRestrictions: z.record(z.unknown()).optional(),
    restrictions: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    expiresAt: z.number().optional(),
    status: z.string().optional(),
    contentKeyHex: z.string().optional(),
  })
  .passthrough();

export const InfoPurchaseSchema = z
  .object({
    ...SignedRequestBase,
    orderId: z.string().optional(),
    escrowId: z.string().optional(),
    quantity: z.number().int().positive().optional(),
    unitPrice: AmountSchema.optional(),
    releaseRules: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const InfoDeliverSchema = z
  .object({
    ...SignedRequestBase,
    orderId: z.string().min(1),
    deliveryId: z.string().optional(),
    contentKeyHex: z.string().optional(),
    buyerPublicKeyHex: z.string().optional(),
    accessToken: z.string().optional(),
    accessUrl: z.string().optional(),
    expiresAt: z.number().optional(),
  })
  .passthrough();

export const InfoConfirmSchema = z
  .object({
    ...SignedRequestBase,
    orderId: z.string().min(1),
    escrowId: z.string().optional(),
    ruleId: z.string().optional(),
  })
  .passthrough();

export const InfoReviewSchema = z
  .object({
    ...SignedRequestBase,
    orderId: z.string().min(1),
    rating: RatingSchema,
    comment: z.string().optional(),
    detailedRatings: z.record(RatingSchema).optional(),
    by: z.enum(['buyer', 'seller']).optional(),
  })
  .passthrough();

export const InfoSubscriptionSchema = z
  .object({
    ...SignedRequestBase,
    subscriptionId: z.string().optional(),
  })
  .passthrough();

export const InfoSubscriptionCancelSchema = z
  .object({ ...SignedRequestBase })
  .passthrough();

// ─── Task Market ────────────────────────────────────────────────

export const TaskPublishSchema = z
  .object({
    ...SignedRequestBase,
    listingId: z.string().optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    category: z.string().min(1),
    tags: z.array(z.string()).optional(),
    pricing: z.record(z.unknown()),
    visibility: z.string().optional(),
    taskType: z.string().min(1),
    task: z.record(z.unknown()),
    timeline: z.record(z.unknown()),
    workerRequirements: z.record(z.unknown()).optional(),
    bidding: z.record(z.unknown()).optional(),
    milestones: z.array(z.record(z.unknown())).optional(),
    restrictions: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    expiresAt: z.number().optional(),
    status: z.string().optional(),
  })
  .passthrough();

export const TaskBidSchema = z
  .object({
    ...SignedRequestBase,
    bidId: z.string().optional(),
    price: AmountSchema,
    timeline: z.number(),
    approach: z.string().min(1),
    milestones: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const TaskBidActionSchema = z
  .object({
    ...SignedRequestBase,
    bidId: z.string().min(1),
  })
  .passthrough();

export const TaskAcceptSchema = z
  .object({
    ...SignedRequestBase,
    bidId: z.string().min(1),
    orderId: z.string().optional(),
    escrowId: z.string().optional(),
    releaseRules: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const TaskDeliverSchema = z
  .object({
    ...SignedRequestBase,
    orderId: z.string().min(1),
    submissionId: z.string().optional(),
    /** Legacy deliverables (optional when delivery.envelope is provided) */
    deliverables: z.array(z.record(z.unknown())).optional(),
    notes: z.string().optional(),
    /** New delivery envelope (Phase 1 transition) */
    delivery: z.object({
      envelope: z.record(z.unknown()).optional(),
      /** Composite: multiple envelopes submitted together */
      envelopes: z.array(z.record(z.unknown())).optional(),
    }).optional(),
  })
  .passthrough();

export const TaskConfirmSchema = z
  .object({
    ...SignedRequestBase,
    orderId: z.string().min(1),
    submissionId: z.string().min(1),
    approved: z.boolean(),
    feedback: z.string().min(1),
    rating: RatingSchema.optional(),
    revisionDeadline: z.number().optional(),
    escrowId: z.string().optional(),
    ruleId: z.string().optional(),
    /**
     * Optional delivery verification (Phase 2).
     * When provided: envelope + content → Layer 1 + Layer 2.
     * When only envelope → Layer 2 schema check only.
     */
    delivery: z.object({
      envelope: z.record(z.unknown()).optional(),
      /** Base64-encoded plaintext content for Layer 1 hash verification. */
      content: z.string().optional(),
    }).optional(),
  })
  .passthrough();

export const TaskReviewSchema = z
  .object({
    ...SignedRequestBase,
    orderId: z.string().min(1),
    rating: RatingSchema,
    comment: z.string().optional(),
    detailedRatings: z.record(RatingSchema).optional(),
    by: z.enum(['buyer', 'seller']).optional(),
  })
  .passthrough();

export const TaskVerifySchema = z
  .object({
    /** Delivery envelope to verify */
    envelope: z.record(z.unknown()),
    /** Base64-encoded plaintext content for Layer 1 hash verification */
    content: z.string(),
    /** Skip Ed25519 signature check */
    skipSignature: z.boolean().optional(),
    /** Buyer-declared acceptance tests for Layer 3 */
    acceptanceTests: z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(['script', 'assertion', 'manual']),
      scriptHash: z.string().optional(),
      assertions: z.array(z.object({
        field: z.string(),
        operator: z.enum(['eq', 'gt', 'lt', 'contains', 'matches']),
        value: z.unknown(),
      })).optional(),
      required: z.boolean(),
    })).optional(),
  })
  .passthrough();

// ─── Capability Market ──────────────────────────────────────────

export const CapabilityPublishSchema = z
  .object({
    ...SignedRequestBase,
    listingId: z.string().optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    category: z.string().min(1),
    tags: z.array(z.string()).optional(),
    pricing: z.record(z.unknown()),
    visibility: z.string().optional(),
    capabilityType: z.string().min(1),
    capability: z.record(z.unknown()),
    performance: z.record(z.unknown()).optional(),
    quota: z.record(z.unknown()),
    access: z.record(z.unknown()),
    sla: z.record(z.unknown()).optional(),
    restrictions: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    expiresAt: z.number().optional(),
    status: z.string().optional(),
  })
  .passthrough();

export const CapabilityLeaseSchema = z
  .object({
    ...SignedRequestBase,
    leaseId: z.string().optional(),
    plan: z.record(z.unknown()),
    credentials: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    expiresAt: z.number().optional(),
    resourcePrev: z.union([z.string(), z.null()]).optional(),
  })
  .passthrough();

export const CapabilityLeaseActionSchema = z
  .object({ ...SignedRequestBase })
  .passthrough();

export const CapabilityInvokeSchema = z
  .object({
    ...SignedRequestBase,
    resource: z.string().min(1),
    units: z.number().int().positive().optional(),
    latency: z.number().nonnegative(),
    success: z.boolean(),
    cost: AmountSchema.optional(),
  })
  .passthrough();

// ─── Market Disputes ────────────────────────────────────────────

export const DisputeOpenSchema = z
  .object({
    ...SignedRequestBase,
    disputeId: z.string().optional(),
    type: z.string().min(1),
    description: z.string().min(1),
    claimAmount: AmountSchema.optional(),
  })
  .passthrough();

export const DisputeResponseSchema = z
  .object({
    ...SignedRequestBase,
    response: z.string().min(1),
    evidence: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const DisputeResolveSchema = z
  .object({
    ...SignedRequestBase,
    resolution: z.string().min(1),
    notes: z.string().optional(),
  })
  .passthrough();

// ─── Reputation ─────────────────────────────────────────────────

export const ReputationRecordSchema = z
  .object({
    ...SignedRequestBase,
    target: z.string().min(1),
    dimension: z.string().min(1),
    score: z.union([z.number(), z.string()]),
    ref: z.string().min(1),
    comment: z.string().optional(),
    aspects: z.record(z.union([z.number(), z.string()])).optional(),
  })
  .passthrough();
