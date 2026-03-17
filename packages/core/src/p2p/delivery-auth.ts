/**
 * Delivery-auth: point-to-point credential exchange over libp2p streams.
 *
 * Protocol: /clawnet/1.0.0/delivery-auth
 *
 * Encrypts access tokens via X25519 ECDH + HKDF-SHA-256 + AES-256-GCM
 * so that credentials never appear on gossip. The recipient verifies
 * BLAKE3(token) against the public tokenHash in the DeliverableEnvelope.
 *
 * Spec: docs/implementation/deliverable-spec.md §6.6
 */

import { generateX25519Keypair, x25519SharedSecret } from '../crypto/x25519.js';
import { hkdfSha256 } from '../crypto/hkdf.js';
import { encryptAes256Gcm, decryptAes256Gcm } from '../crypto/aes.js';
import { blake3Hex } from '../crypto/hash.js';
import { utf8ToBytes, bytesToUtf8, bytesToHex, hexToBytes } from '../utils/bytes.js';

// ── Re-export types from protocol (lightweight inline versions) ────
// These mirror the types in @claw-network/protocol/deliverables/delivery-auth
// to avoid a circular dependency (core must not depend on protocol).

export interface DeliveryAuthRequest {
  version: 1;
  senderPublicKeyHex: string;
  nonceHex: string;
  ciphertextHex: string;
  tagHex: string;
}

export interface DeliveryAuthPayload {
  deliverableId: string;
  token: string;
  orderId: string;
  providerDid: string;
  expiresAt?: number;
}

export interface DeliveryAuthResponse {
  accepted: boolean;
  reason?: string;
}

// HKDF info tag — domain-separated from info-store key sealing
const DELIVERY_AUTH_INFO = utf8ToBytes('clawnet:delivery-auth:v1');

// ── Sender (provider) side ─────────────────────────────────────────

/**
 * Encrypt a `DeliveryAuthPayload` for the given recipient X25519 public key.
 * Returns a `DeliveryAuthRequest` ready to be JSON-serialized onto the stream.
 */
export function sealDeliveryAuth(
  payload: DeliveryAuthPayload,
  recipientPublicKey: Uint8Array,
): DeliveryAuthRequest {
  const sender = generateX25519Keypair();
  const shared = x25519SharedSecret(sender.privateKey, recipientPublicKey);
  const derived = hkdfSha256(shared, undefined, DELIVERY_AUTH_INFO, 32);
  const plaintext = utf8ToBytes(JSON.stringify(payload));
  const encrypted = encryptAes256Gcm(derived, plaintext);
  return {
    version: 1,
    senderPublicKeyHex: bytesToHex(sender.publicKey),
    nonceHex: encrypted.nonceHex,
    ciphertextHex: encrypted.ciphertextHex,
    tagHex: encrypted.tagHex,
  };
}

// ── Receiver (consumer) side ───────────────────────────────────────

/**
 * Decrypt a `DeliveryAuthRequest` using the recipient's X25519 private key.
 * Returns the plaintext `DeliveryAuthPayload`.
 *
 * @throws if decryption or JSON parsing fails.
 */
export function openDeliveryAuth(
  request: DeliveryAuthRequest,
  recipientPrivateKey: Uint8Array,
): DeliveryAuthPayload {
  const senderPublicKey = hexToBytes(request.senderPublicKeyHex);
  const shared = x25519SharedSecret(recipientPrivateKey, senderPublicKey);
  const derived = hkdfSha256(shared, undefined, DELIVERY_AUTH_INFO, 32);
  const plaintext = decryptAes256Gcm(derived, {
    nonceHex: request.nonceHex,
    ciphertextHex: request.ciphertextHex,
    tagHex: request.tagHex,
  });
  return JSON.parse(bytesToUtf8(plaintext)) as DeliveryAuthPayload;
}

// ── Token hash verification ────────────────────────────────────────

/**
 * Compute the token hash that should appear in the public envelope.
 * `tokenHash = hex(BLAKE3(utf8(token)))`
 */
export function deliveryTokenHash(token: string): string {
  return blake3Hex(utf8ToBytes(token));
}

/**
 * Verify that a received token matches the expected tokenHash from the envelope.
 */
export function verifyDeliveryToken(token: string, expectedHash: string): boolean {
  return deliveryTokenHash(token) === expectedHash;
}

// ── Stream helpers ─────────────────────────────────────────────────

/**
 * Encode a JSON message into length-prefixed bytes for stream transport.
 * Format: 4-byte big-endian length + UTF-8 JSON body.
 */
export function encodeStreamMessage(message: unknown): Uint8Array {
  const json = utf8ToBytes(JSON.stringify(message));
  const frame = new Uint8Array(4 + json.length);
  new DataView(frame.buffer).setUint32(0, json.length, false);
  frame.set(json, 4);
  return frame;
}

/**
 * Decode a length-prefixed message from a buffer.
 * Returns [parsed message, bytes consumed] or null if buffer is incomplete.
 */
export function decodeStreamMessage<T = unknown>(
  buffer: Uint8Array,
): [T, number] | null {
  if (buffer.length < 4) return null;
  const length = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, false);
  if (buffer.length < 4 + length) return null;
  const json = bytesToUtf8(buffer.slice(4, 4 + length));
  return [JSON.parse(json) as T, 4 + length];
}

/**
 * Create an accepted response.
 */
export function acceptResponse(): DeliveryAuthResponse {
  return { accepted: true };
}

/**
 * Create a rejected response.
 */
export function rejectResponse(reason: string): DeliveryAuthResponse {
  return { accepted: false, reason };
}
