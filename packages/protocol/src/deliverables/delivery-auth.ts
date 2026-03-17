/**
 * Delivery-auth protocol message types.
 *
 * Protocol ID: /clawnet/1.0.0/delivery-auth
 *
 * Used for point-to-point credential delivery via libp2p streams.
 * The actual token/credential is NEVER broadcast over gossip — only
 * the `tokenHash` appears in the public DeliverableEnvelope.
 *
 * Message flow:
 *   1. Provider opens stream → consumer
 *   2. Provider sends DeliveryAuthRequest (encrypted via X25519-AES-256-GCM)
 *   3. Consumer decrypts, verifies BLAKE3(token) == envelope.tokenHash
 *   4. Consumer sends DeliveryAuthResponse (ack / reject)
 *   5. Stream closes
 *
 * Spec: docs/implementation/deliverable-spec.md §6.6
 */

// ── Protocol ID ────────────────────────────────────────────────────

export const DELIVERY_AUTH_PROTOCOL = '/clawnet/1.0.0/delivery-auth';

// ── Wire messages ──────────────────────────────────────────────────

/**
 * Encrypted request sent from provider → consumer over the stream.
 * The outer wrapper carries the X25519 key-exchange params; the inner
 * plaintext is a JSON-encoded `DeliveryAuthPayload`.
 */
export interface DeliveryAuthRequest {
  /** Protocol version for forward compat */
  version: 1;
  /** X25519 ephemeral sender public key (hex) */
  senderPublicKeyHex: string;
  /** AES-256-GCM nonce (hex) */
  nonceHex: string;
  /** AES-256-GCM ciphertext of JSON(DeliveryAuthPayload) (hex) */
  ciphertextHex: string;
  /** AES-256-GCM auth tag (hex) */
  tagHex: string;
}

/**
 * Plaintext payload inside the encrypted request.
 */
export interface DeliveryAuthPayload {
  /** Envelope ID this credential belongs to */
  deliverableId: string;
  /** The actual access token / session token */
  token: string;
  /** Order ID binding */
  orderId: string;
  /** Provider DID (for verification) */
  providerDid: string;
  /** Unix ms — must match envelope expiresAt */
  expiresAt?: number;
}

/**
 * Response from consumer → provider.
 */
export interface DeliveryAuthResponse {
  /** Whether the token was accepted */
  accepted: boolean;
  /** Error reason if rejected */
  reason?: string;
}

// ── Validation helpers ─────────────────────────────────────────────

export function isDeliveryAuthRequest(value: unknown): value is DeliveryAuthRequest {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r.version === 1 &&
    typeof r.senderPublicKeyHex === 'string' &&
    typeof r.nonceHex === 'string' &&
    typeof r.ciphertextHex === 'string' &&
    typeof r.tagHex === 'string'
  );
}

export function isDeliveryAuthPayload(value: unknown): value is DeliveryAuthPayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.deliverableId === 'string' &&
    typeof p.token === 'string' &&
    typeof p.orderId === 'string' &&
    typeof p.providerDid === 'string'
  );
}

export function isDeliveryAuthResponse(value: unknown): value is DeliveryAuthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.accepted === 'boolean';
}
