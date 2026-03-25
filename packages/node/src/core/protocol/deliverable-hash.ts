/**
 * Deliverable envelope signing & verification.
 * Domain prefix: "clawnet:deliverable:v1:" (distinct from event prefix).
 * Spec: docs/implementation/deliverable-spec.md §4.2
 */

import { canonicalizeBytes } from '../crypto/jcs.js';
import { blake3Hex } from '../crypto/hash.js';
import { sha256Hex } from '../crypto/hash.js';
import { concatBytes, utf8ToBytes } from '../utils/bytes.js';
import { signBase58, verifyBase58 } from '../crypto/ed25519.js';

export const DELIVERABLE_DOMAIN_PREFIX = 'clawnet:deliverable:v1:';

// ── Strip signature before canonicalization ────────────────

export type DeliverableEnvelopeRecord = Record<string, unknown>;

function stripSignature(envelope: DeliverableEnvelopeRecord): DeliverableEnvelopeRecord {
  const { signature, ...rest } = envelope;
  void signature;
  return rest;
}

// ── Canonical bytes ────────────────────────────────────────

/**
 * Compute the canonical bytes of an envelope (without signature field).
 */
export function canonicalDeliverableBytes(envelope: DeliverableEnvelopeRecord): Uint8Array {
  return canonicalizeBytes(stripSignature(envelope));
}

// ── Signing bytes (domain-prefixed) ────────────────────────

/**
 * signingBytes = utf8(DOMAIN_PREFIX) + JCS(envelope \ {signature})
 */
export function deliverableSigningBytes(envelope: DeliverableEnvelopeRecord): Uint8Array {
  const canonical = canonicalDeliverableBytes(envelope);
  const prefix = utf8ToBytes(DELIVERABLE_DOMAIN_PREFIX);
  return concatBytes(prefix, canonical);
}

// ── Sign ───────────────────────────────────────────────────

/**
 * Sign a deliverable envelope.
 * Returns base58btc-encoded Ed25519 signature.
 */
export async function signDeliverable(
  envelope: DeliverableEnvelopeRecord,
  privateKey: Uint8Array,
): Promise<string> {
  return signBase58(deliverableSigningBytes(envelope), privateKey);
}

// ── Verify ─────────────────────────────────────────────────

/**
 * Verify an Ed25519 signature on a deliverable envelope.
 */
export async function verifyDeliverableSignature(
  envelope: DeliverableEnvelopeRecord,
  signatureBase58: string,
  publicKey: Uint8Array,
): Promise<boolean> {
  return verifyBase58(signatureBase58, deliverableSigningBytes(envelope), publicKey);
}

// ── Envelope digest (for on-chain anchoring) ───────────────

/**
 * BLAKE3(JCS(envelope)) — the value stored on-chain as `deliverableHash`.
 * No double-hashing: this hex string is passed directly to the contract.
 */
export function envelopeDigest(envelope: DeliverableEnvelopeRecord): string {
  const canonical = canonicalizeBytes(envelope as Record<string, unknown>);
  return blake3Hex(canonical);
}

// ── Content hash ───────────────────────────────────────────

/**
 * BLAKE3 hash of plaintext content bytes.
 */
export function contentHash(data: Uint8Array): string {
  return blake3Hex(data);
}

// ── Deterministic envelope ID ──────────────────────────────

/**
 * id = hex(SHA-256(contextId + producer + nonce + createdAt))
 */
export function computeEnvelopeId(
  contextId: string,
  producer: string,
  nonce: string,
  createdAt: string,
): string {
  const input = utf8ToBytes(contextId + producer + nonce + createdAt);
  return sha256Hex(input);
}
