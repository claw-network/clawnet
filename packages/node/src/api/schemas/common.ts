/**
 * Shared Zod schemas used across multiple route modules.
 */

import { z } from 'zod';

/** Amount can be number or string (for large values). */
export const AmountSchema = z.union([z.number(), z.string()]);

/** Rating can be number or string. */
export const RatingSchema = z.union([z.number(), z.string()]);

/** Common envelope fields for signed requests. */
export const SignedRequestBase = {
  did: z.string().min(1),
  passphrase: z.string().min(1),
  nonce: z.number().int().positive(),
  prev: z.string().optional(),
  ts: z.number().optional(),
};

/** Listing removal (all market types). */
export const ListingRemoveSchema = z
  .object({ ...SignedRequestBase })
  .passthrough();

/** Validate Zod schema and return typed result or null (sets 400 response). */
export function validate<T>(
  schema: z.ZodType<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { success: false, error: issues };
  }
  return { success: true, data: result.data };
}
