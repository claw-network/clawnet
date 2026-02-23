/**
 * Service contract Zod schemas.
 */

import { z } from 'zod';
import { AmountSchema, RatingSchema, SignedRequestBase } from './common.js';

export const ContractCreateSchema = z
  .object({
    ...SignedRequestBase,
    contractId: z.string().optional(),
    provider: z.string().min(1),
    parties: z.record(z.unknown()).optional(),
    service: z.record(z.unknown()).optional(),
    terms: z.record(z.unknown()),
    payment: z.record(z.unknown()).optional(),
    timeline: z.record(z.unknown()).optional(),
    milestones: z.array(z.record(z.unknown())).optional(),
    attachments: z.array(z.record(z.unknown())).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const ContractSignSchema = z
  .object({ ...SignedRequestBase })
  .passthrough();

export const ContractFundSchema = z
  .object({
    ...SignedRequestBase,
    escrowId: z.string().optional(),
    amount: AmountSchema,
    releaseRules: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const ContractCompleteSchema = z
  .object({ ...SignedRequestBase })
  .passthrough();

export const ContractMilestoneSubmitSchema = z
  .object({
    ...SignedRequestBase,
    submissionId: z.string().optional(),
    deliverables: z.array(z.record(z.unknown())).optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export const ContractMilestoneReviewSchema = z
  .object({
    ...SignedRequestBase,
    notes: z.string().optional(),
    rating: RatingSchema.optional(),
    feedback: z.string().optional(),
  })
  .passthrough();

export const ContractDisputeSchema = z
  .object({
    ...SignedRequestBase,
    reason: z.string().min(1),
    description: z.string().optional(),
    evidence: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const ContractDisputeResolveSchema = z
  .object({
    ...SignedRequestBase,
    resolution: z.string().min(1),
    notes: z.string().optional(),
  })
  .passthrough();

export const ContractSettlementSchema = z
  .object({
    ...SignedRequestBase,
    settlement: z.record(z.unknown()),
    notes: z.string().optional(),
  })
  .passthrough();
