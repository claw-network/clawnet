import { describe, expect, it } from 'vitest';
import {
  sealDeliveryAuth,
  openDeliveryAuth,
  deliveryTokenHash,
  verifyDeliveryToken,
  encodeStreamMessage,
  decodeStreamMessage,
  acceptResponse,
  rejectResponse,
} from '../src/p2p/delivery-auth.js';
import type { DeliveryAuthPayload } from '../src/p2p/delivery-auth.js';
import { generateX25519Keypair } from '../src/crypto/x25519.js';
import {
  DELIVERY_AUTH_PROTOCOL,
  isDeliveryAuthRequest,
  isDeliveryAuthPayload,
  isDeliveryAuthResponse,
} from '../../protocol/src/deliverables/delivery-auth.js';

describe('delivery-auth', () => {
  // ── Protocol constant ─────────────────────────────────────

  it('protocol ID is correct', () => {
    expect(DELIVERY_AUTH_PROTOCOL).toBe('/clawnet/1.0.0/delivery-auth');
  });

  // ── Seal / Open round-trip ────────────────────────────────

  it('encrypts and decrypts a delivery auth payload', () => {
    const recipient = generateX25519Keypair();
    const payload: DeliveryAuthPayload = {
      deliverableId: 'env-001',
      token: 'secret-access-token-xyz',
      orderId: 'order-42',
      providerDid: 'did:claw:zProvider123',
      expiresAt: Date.now() + 3600_000,
    };

    const request = sealDeliveryAuth(payload, recipient.publicKey);

    // Verify request structure
    expect(isDeliveryAuthRequest(request)).toBe(true);
    expect(request.version).toBe(1);
    expect(request.senderPublicKeyHex).toHaveLength(64); // 32 bytes hex

    // Decrypt
    const decrypted = openDeliveryAuth(request, recipient.privateKey);
    expect(decrypted).toEqual(payload);
    expect(isDeliveryAuthPayload(decrypted)).toBe(true);
  });

  it('fails to decrypt with wrong private key', () => {
    const recipient = generateX25519Keypair();
    const wrongKey = generateX25519Keypair();
    const payload: DeliveryAuthPayload = {
      deliverableId: 'env-002',
      token: 'another-secret',
      orderId: 'order-99',
      providerDid: 'did:claw:zProvider456',
    };

    const request = sealDeliveryAuth(payload, recipient.publicKey);
    expect(() => openDeliveryAuth(request, wrongKey.privateKey)).toThrow();
  });

  it('each seal produces different ciphertext (ephemeral key)', () => {
    const recipient = generateX25519Keypair();
    const payload: DeliveryAuthPayload = {
      deliverableId: 'env-003',
      token: 'same-token',
      orderId: 'order-1',
      providerDid: 'did:claw:zP',
    };

    const req1 = sealDeliveryAuth(payload, recipient.publicKey);
    const req2 = sealDeliveryAuth(payload, recipient.publicKey);

    // Different ephemeral keys → different senderPublicKeyHex, nonce, ciphertext
    expect(req1.senderPublicKeyHex).not.toBe(req2.senderPublicKeyHex);
    expect(req1.ciphertextHex).not.toBe(req2.ciphertextHex);

    // Both decrypt to the same payload
    expect(openDeliveryAuth(req1, recipient.privateKey)).toEqual(payload);
    expect(openDeliveryAuth(req2, recipient.privateKey)).toEqual(payload);
  });

  // ── Token hash ────────────────────────────────────────────

  it('computes deterministic token hash', () => {
    const hash1 = deliveryTokenHash('my-secret-token');
    const hash2 = deliveryTokenHash('my-secret-token');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // BLAKE3 hex
  });

  it('different tokens produce different hashes', () => {
    const h1 = deliveryTokenHash('token-a');
    const h2 = deliveryTokenHash('token-b');
    expect(h1).not.toBe(h2);
  });

  it('verifies token against hash', () => {
    const token = 'access-token-123';
    const hash = deliveryTokenHash(token);
    expect(verifyDeliveryToken(token, hash)).toBe(true);
    expect(verifyDeliveryToken('wrong-token', hash)).toBe(false);
  });

  // ── Stream message encoding ───────────────────────────────

  it('encodes and decodes stream messages', () => {
    const msg = { foo: 'bar', num: 42 };
    const encoded = encodeStreamMessage(msg);

    // First 4 bytes are the length prefix
    const length = new DataView(encoded.buffer).getUint32(0, false);
    expect(length).toBeGreaterThan(0);
    expect(encoded.length).toBe(4 + length);

    const result = decodeStreamMessage(encoded);
    expect(result).not.toBeNull();
    const [decoded, consumed] = result!;
    expect(decoded).toEqual(msg);
    expect(consumed).toBe(encoded.length);
  });

  it('returns null for incomplete buffer', () => {
    const msg = { hello: 'world' };
    const encoded = encodeStreamMessage(msg);

    // Truncated — only 3 bytes (less than length prefix)
    expect(decodeStreamMessage(encoded.slice(0, 3))).toBeNull();

    // Truncated — has length prefix but incomplete body
    expect(decodeStreamMessage(encoded.slice(0, 6))).toBeNull();
  });

  // ── Response helpers ──────────────────────────────────────

  it('creates accept response', () => {
    const resp = acceptResponse();
    expect(resp.accepted).toBe(true);
    expect(resp.reason).toBeUndefined();
    expect(isDeliveryAuthResponse(resp)).toBe(true);
  });

  it('creates reject response', () => {
    const resp = rejectResponse('token hash mismatch');
    expect(resp.accepted).toBe(false);
    expect(resp.reason).toBe('token hash mismatch');
    expect(isDeliveryAuthResponse(resp)).toBe(true);
  });

  // ── Type guards ───────────────────────────────────────────

  it('isDeliveryAuthRequest rejects invalid objects', () => {
    expect(isDeliveryAuthRequest(null)).toBe(false);
    expect(isDeliveryAuthRequest({})).toBe(false);
    expect(isDeliveryAuthRequest({ version: 2, senderPublicKeyHex: '', nonceHex: '', ciphertextHex: '', tagHex: '' })).toBe(false);
    expect(isDeliveryAuthRequest({ version: 1 })).toBe(false);
  });

  it('isDeliveryAuthPayload rejects invalid objects', () => {
    expect(isDeliveryAuthPayload(null)).toBe(false);
    expect(isDeliveryAuthPayload({})).toBe(false);
    expect(isDeliveryAuthPayload({ deliverableId: 'x', token: 'y', orderId: 'z' })).toBe(false);
  });

  it('isDeliveryAuthResponse rejects invalid objects', () => {
    expect(isDeliveryAuthResponse(null)).toBe(false);
    expect(isDeliveryAuthResponse({})).toBe(false);
    expect(isDeliveryAuthResponse({ accepted: 'yes' })).toBe(false);
  });

  // ── End-to-end scenario ───────────────────────────────────

  it('full delivery-auth flow: seal → open → verify token', () => {
    const recipient = generateX25519Keypair();
    const token = 'real-access-token-for-stream';
    const tokenHash = deliveryTokenHash(token);

    const payload: DeliveryAuthPayload = {
      deliverableId: 'env-full-test',
      token,
      orderId: 'order-full-test',
      providerDid: 'did:claw:zProviderFull',
      expiresAt: Date.now() + 60_000,
    };

    // Provider seals
    const request = sealDeliveryAuth(payload, recipient.publicKey);
    const encoded = encodeStreamMessage(request);

    // Simulate stream transfer
    const [decoded] = decodeStreamMessage<typeof request>(encoded)!;

    // Consumer opens
    const opened = openDeliveryAuth(decoded, recipient.privateKey);

    // Consumer verifies token hash
    expect(verifyDeliveryToken(opened.token, tokenHash)).toBe(true);
    expect(opened.deliverableId).toBe('env-full-test');
    expect(opened.orderId).toBe('order-full-test');

    // Consumer accepts
    const response = acceptResponse();
    expect(response.accepted).toBe(true);
  });
});
