/**
 * High-level helpers for building and validating DeliverableEnvelope.
 * Spec: docs/implementation/deliverable-spec.md v0.4.0
 */

import type {
  DeliverableEnvelope,
  DeliverableType,
  ContentFormat,
  DeliverableTransport,
  DeliverableEncryption,
  DeliverableSchema,
} from './types.js';

// Re-export types for convenience
export type { DeliverableEnvelope } from './types.js';

// ── Builder input ──────────────────────────────────────────

export interface BuildEnvelopeInput {
  contextId: string;
  producer: string;
  nonce: string;
  type: DeliverableType;
  format: ContentFormat;
  name: string;
  description?: string;
  contentHash: string;
  size: number;
  createdAt: string;
  transport: DeliverableTransport;
  encryption?: DeliverableEncryption;
  schema?: DeliverableSchema;
  parts?: string[];
}

/**
 * Build an unsigned DeliverableEnvelope.
 * The caller must then sign it with `signDeliverable()` and set `signature`.
 *
 * @param input - Envelope fields (without id, signature)
 * @param computeId - function(contextId, producer, nonce, createdAt) => id hex
 */
export function buildUnsignedEnvelope(
  input: BuildEnvelopeInput,
  computeId: (contextId: string, producer: string, nonce: string, createdAt: string) => string,
): Omit<DeliverableEnvelope, 'signature'> {
  const id = computeId(input.contextId, input.producer, input.nonce, input.createdAt);
  return {
    id,
    nonce: input.nonce,
    contextId: input.contextId,
    type: input.type,
    format: input.format,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    contentHash: input.contentHash,
    size: input.size,
    producer: input.producer,
    createdAt: input.createdAt,
    transport: input.transport,
    ...(input.encryption ? { encryption: input.encryption } : {}),
    ...(input.schema ? { schema: input.schema } : {}),
    ...(input.parts ? { parts: input.parts } : {}),
  } as Omit<DeliverableEnvelope, 'signature'>;
}

// ── Composite content hash ─────────────────────────────────

/**
 * Compute composite contentHash = BLAKE3(parts[0].hash + parts[1].hash + ...)
 * Parts order = declaration order in `parts` array (no sorting).
 *
 * @param partHashes — BLAKE3 hex hashes in parts declaration order
 * @param blake3HexFn — hash function (injected to avoid core dependency here)
 * @param utf8ToBytesFn — encoding function
 */
export function computeCompositeHash(
  partHashes: string[],
  blake3HexFn: (data: Uint8Array) => string,
  utf8ToBytesFn: (input: string) => Uint8Array,
): string {
  const joined = partHashes.join('');
  return blake3HexFn(utf8ToBytesFn(joined));
}

// ── Validation ─────────────────────────────────────────────

export interface EnvelopeValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Basic structural validation (does not verify signature or content hash).
 */
export function validateEnvelopeStructure(
  envelope: DeliverableEnvelope,
): EnvelopeValidationResult {
  const errors: string[] = [];

  if (!envelope.id || typeof envelope.id !== 'string') {
    errors.push('id is required');
  }
  if (!envelope.nonce || typeof envelope.nonce !== 'string') {
    errors.push('nonce is required');
  }
  if (!envelope.contextId || typeof envelope.contextId !== 'string') {
    errors.push('contextId is required');
  }
  if (!envelope.type || typeof envelope.type !== 'string') {
    errors.push('type is required');
  }
  if (!envelope.format || typeof envelope.format !== 'string') {
    errors.push('format is required');
  }
  if (!envelope.name || typeof envelope.name !== 'string') {
    errors.push('name is required');
  }
  if (!envelope.contentHash || typeof envelope.contentHash !== 'string') {
    errors.push('contentHash is required');
  }
  if (typeof envelope.size !== 'number' || envelope.size < 0) {
    errors.push('size must be a non-negative number');
  }
  if (!envelope.producer || typeof envelope.producer !== 'string') {
    errors.push('producer is required');
  }
  if (!envelope.signature || typeof envelope.signature !== 'string') {
    errors.push('signature is required');
  }
  if (!envelope.createdAt || typeof envelope.createdAt !== 'string') {
    errors.push('createdAt is required');
  }
  if (!envelope.transport || typeof envelope.transport !== 'object') {
    errors.push('transport is required');
  } else {
    const method = (envelope.transport as unknown as Record<string, unknown>).method;
    if (!['inline', 'external', 'stream', 'endpoint'].includes(method as string)) {
      errors.push(`transport.method must be inline|external|stream|endpoint, got: ${method}`);
    }
  }

  // Composite must have parts
  if (envelope.type === 'composite' && (!envelope.parts || envelope.parts.length === 0)) {
    errors.push('composite type requires non-empty parts array');
  }

  // Encryption structure check
  if (envelope.encryption) {
    if (envelope.encryption.algorithm !== 'x25519-aes-256-gcm') {
      errors.push(`encryption.algorithm must be 'x25519-aes-256-gcm'`);
    }
    if (!envelope.encryption.keyEnvelopes || typeof envelope.encryption.keyEnvelopes !== 'object') {
      errors.push('encryption.keyEnvelopes is required');
    }
    if (!envelope.encryption.nonce) {
      errors.push('encryption.nonce is required');
    }
    if (!envelope.encryption.tag) {
      errors.push('encryption.tag is required');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Legacy wrapper ─────────────────────────────────────────

/**
 * Wrap a legacy `Record<string, unknown>` deliverable into a minimal envelope
 * suitable for the Phase 1 transition period.
 * The caller should sign this with the node's key and set signedBy='node'.
 */
export function wrapLegacyDeliverable(
  legacy: Record<string, unknown>,
  contextId: string,
  producer: string,
  nonce: string,
  createdAt: string,
  computeId: (contextId: string, producer: string, nonce: string, createdAt: string) => string,
  computeContentHash: (data: Uint8Array) => string,
  utf8ToBytesFn: (input: string) => Uint8Array,
): Omit<DeliverableEnvelope, 'signature'> {
  const content = JSON.stringify(legacy);
  const bytes = utf8ToBytesFn(content);
  const hash = computeContentHash(bytes);

  return {
    id: computeId(contextId, producer, nonce, createdAt),
    nonce,
    contextId,
    type: 'data',
    format: 'application/json',
    name: (legacy.name as string) || 'legacy-deliverable',
    contentHash: hash,
    size: bytes.length,
    producer,
    createdAt,
    transport: { method: 'inline', data: Buffer.from(bytes).toString('base64') },
    legacy: true,
    signedBy: 'node',
  } as Omit<DeliverableEnvelope, 'signature'>;
}
