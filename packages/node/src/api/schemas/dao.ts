/**
 * DAO governance Zod schemas.
 */

import { z } from 'zod';
import { AmountSchema, SignedRequestBase } from './common.js';

// For endpoints that have an on-chain daoService path, did/passphrase/nonce
// are not required — they are only used in the event-sourced fallback path.
const SignedRequestBaseOptional = {
  did: SignedRequestBase.did.optional(),
  passphrase: SignedRequestBase.passphrase.optional(),
  nonce: SignedRequestBase.nonce.optional(),
  prev: SignedRequestBase.prev,
  ts: SignedRequestBase.ts,
};

export const DaoProposalCreateSchema = z
  .object({
    ...SignedRequestBaseOptional,
    proposalId: z.string().min(1).optional(),
    type: z.enum(['parameter_change', 'treasury_spend', 'protocol_upgrade', 'emergency', 'signal']),
    title: z.string().min(1),
    description: z.string().min(1),
    discussionUrl: z.string().optional(),
    actions: z.array(z.record(z.unknown())).min(1),
    discussionPeriod: z.number().nonnegative().optional(),
    votingPeriod: z.number().nonnegative().optional(),
    timelockDelay: z.number().nonnegative().optional(),
  })
  .passthrough();

export const DaoProposalAdvanceSchema = z
  .object({
    ...SignedRequestBaseOptional,
    proposalId: z.string().min(1),
    newStatus: z.string().min(1),
    resourcePrev: z.string().optional().default(''),
  })
  .passthrough();

export const DaoVoteCastSchema = z
  .object({
    ...SignedRequestBaseOptional,
    proposalId: z.string().min(1),
    option: z.enum(['for', 'against', 'abstain']),
    power: AmountSchema,
    reason: z.string().optional(),
  })
  .passthrough();

export const DaoDelegateSetSchema = z
  .object({
    ...SignedRequestBase,
    delegate: z.string().min(1),
    scope: z
      .object({
        proposalTypes: z.array(z.string()).optional(),
        topics: z.array(z.string()).optional(),
        all: z.boolean().optional(),
      })
      .optional(),
    percentage: z.number().min(0).max(100).optional(),
    expiresAt: z.number().optional(),
  })
  .passthrough();

export const DaoDelegateRevokeSchema = z
  .object({
    ...SignedRequestBase,
    delegate: z.string().min(1),
  })
  .passthrough();

export const DaoTimelockExecuteSchema = z
  .object({
    ...SignedRequestBaseOptional,
    actionId: z.string().min(1),
  })
  .passthrough();

export const DaoTimelockCancelSchema = z
  .object({
    ...SignedRequestBaseOptional,
    actionId: z.string().min(1),
    reason: z.string().min(1),
  })
  .passthrough();

export const DaoTreasuryDepositSchema = z
  .object({
    ...SignedRequestBaseOptional,
    amount: AmountSchema,
    source: z.string().min(1),
  })
  .passthrough();
