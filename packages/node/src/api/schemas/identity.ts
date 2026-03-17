/**
 * Identity-related Zod schemas.
 */

import { z } from 'zod';
import { SignedRequestBase } from './common.js';

export const IdentityRegisterSchema = z
  .object({
    ...SignedRequestBase,
    publicKey: z.string().min(1),
    purpose: z.enum(['authentication', 'assertion', 'keyAgreement', 'recovery']).optional(),
    evmAddress: z.string().optional(),
  })
  .passthrough();

export const IdentityRotateKeySchema = z
  .object({
    did: z.string().min(1),
    newPublicKey: z.string().min(1),
    rotationProof: z.string().optional(),
  })
  .passthrough();

export const IdentityRevokeSchema = z
  .object({
    did: z.string().min(1),
  })
  .passthrough();

export const CapabilityRegisterSchema = z
  .object({
    ...SignedRequestBase,
    credential: z.unknown(),
  })
  .passthrough();
