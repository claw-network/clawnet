/**
 * Wallet / Transfer / Escrow Zod schemas.
 */

import { z } from 'zod';
import { AmountSchema, SignedRequestBase } from './common.js';

export const WalletQuerySchema = z
  .object({
    did: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
  })
  .refine((data) => data.did || data.address, { message: 'missing address' });

export const TransferSchema = z
  .object({
    ...SignedRequestBase,
    to: z.string().min(1),
    amount: AmountSchema,
    fee: AmountSchema.optional(),
    memo: z.string().optional(),
  })
  .passthrough();

export const EscrowCreateSchema = z
  .object({
    ...SignedRequestBase,
    escrowId: z.string().optional(),
    beneficiary: z.string().min(1),
    amount: AmountSchema,
    releaseRules: z.array(z.record(z.unknown())).min(1),
    resourcePrev: z.union([z.string(), z.null()]).optional(),
    arbiter: z.string().optional(),
    refundRules: z.array(z.record(z.unknown())).optional(),
    expiresAt: z.number().optional(),
    autoFund: z.boolean().optional(),
  })
  .passthrough();

export const EscrowActionSchema = z
  .object({
    ...SignedRequestBase,
    amount: AmountSchema,
    resourcePrev: z.string().min(1),
    ruleId: z.string().optional(),
    reason: z.string().optional(),
    evidence: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const EscrowExpireSchema = z
  .object({
    ...SignedRequestBase,
    action: z.enum(['refund', 'release']).optional(),
    ruleId: z.string().optional(),
    reason: z.string().optional(),
    evidence: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();
