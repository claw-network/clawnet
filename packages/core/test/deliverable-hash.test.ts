import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  DELIVERABLE_DOMAIN_PREFIX,
  computeEnvelopeId,
  contentHash,
  deliverableSigningBytes,
  envelopeDigest,
  signDeliverable,
  verifyDeliverableSignature,
} from '../src/protocol/deliverable-hash.js';
import { generateKeypair } from '../src/crypto/ed25519.js';
import { bytesToHex, utf8ToBytes } from '../src/utils/bytes.js';
import { blake3Hex } from '../src/crypto/hash.js';
import { EVENT_DOMAIN_PREFIX } from '../src/protocol/event-hash.js';

describe('deliverable-hash', () => {
  // ── Domain prefix ─────────────────────────────────────────

  it('has correct domain prefix', () => {
    expect(DELIVERABLE_DOMAIN_PREFIX).toBe('clawnet:deliverable:v1:');
  });

  it('domain prefix differs from event prefix', () => {
    expect(DELIVERABLE_DOMAIN_PREFIX).not.toBe(EVENT_DOMAIN_PREFIX);
  });

  // ── computeEnvelopeId ─────────────────────────────────────

  it('computes deterministic envelope id', () => {
    const id1 = computeEnvelopeId('order-1', 'did:claw:zProducer', 'abc123', '2026-03-01T00:00:00Z');
    const id2 = computeEnvelopeId('order-1', 'did:claw:zProducer', 'abc123', '2026-03-01T00:00:00Z');
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(64); // SHA-256 hex
  });

  it('different inputs produce different ids', () => {
    const id1 = computeEnvelopeId('order-1', 'did:claw:zProducer', 'abc123', '2026-03-01T00:00:00Z');
    const id2 = computeEnvelopeId('order-2', 'did:claw:zProducer', 'abc123', '2026-03-01T00:00:00Z');
    expect(id1).not.toBe(id2);
  });

  // ── contentHash ───────────────────────────────────────────

  it('computes BLAKE3 content hash', () => {
    const data = utf8ToBytes('hello world');
    const hash = contentHash(data);
    expect(hash).toHaveLength(64); // BLAKE3 outputs 256-bit = 64 hex chars
    // Deterministic
    expect(contentHash(data)).toBe(hash);
  });

  it('different content produces different hash', () => {
    const h1 = contentHash(utf8ToBytes('hello'));
    const h2 = contentHash(utf8ToBytes('world'));
    expect(h1).not.toBe(h2);
  });

  // ── Sign / Verify ────────────────────────────────────────

  const sampleEnvelope = {
    id: 'abc123',
    nonce: bytesToHex(randomBytes(32)),
    contextId: 'order-1',
    type: 'text',
    format: 'text/plain',
    name: 'test.txt',
    contentHash: blake3Hex(utf8ToBytes('test content')),
    size: 12,
    producer: 'did:claw:zTest',
    createdAt: '2026-03-01T00:00:00Z',
    transport: { method: 'inline', data: Buffer.from('test content').toString('base64') },
  };

  it('signing bytes include domain prefix', () => {
    const bytes = deliverableSigningBytes(sampleEnvelope);
    const prefix = utf8ToBytes(DELIVERABLE_DOMAIN_PREFIX);
    // First N bytes should be the prefix
    const head = bytes.slice(0, prefix.length);
    expect(bytesToHex(head)).toBe(bytesToHex(prefix));
  });

  it('sign and verify round-trip', async () => {
    const keypair = await generateKeypair();
    const sig = await signDeliverable(sampleEnvelope, keypair.privateKey);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);

    const valid = await verifyDeliverableSignature(sampleEnvelope, sig, keypair.publicKey);
    expect(valid).toBe(true);
  });

  it('verify rejects wrong key', async () => {
    const keypair1 = await generateKeypair();
    const keypair2 = await generateKeypair();
    const sig = await signDeliverable(sampleEnvelope, keypair1.privateKey);
    const valid = await verifyDeliverableSignature(sampleEnvelope, sig, keypair2.publicKey);
    expect(valid).toBe(false);
  });

  it('verify rejects tampered envelope', async () => {
    const keypair = await generateKeypair();
    const sig = await signDeliverable(sampleEnvelope, keypair.privateKey);
    const tampered = { ...sampleEnvelope, name: 'tampered.txt' };
    const valid = await verifyDeliverableSignature(tampered, sig, keypair.publicKey);
    expect(valid).toBe(false);
  });

  it('signature field is excluded from signing bytes', async () => {
    const keypair = await generateKeypair();
    const sig = await signDeliverable(sampleEnvelope, keypair.privateKey);
    // Adding signature field to envelope should not affect verification
    const withSig = { ...sampleEnvelope, signature: sig };
    const valid = await verifyDeliverableSignature(withSig, sig, keypair.publicKey);
    expect(valid).toBe(true);
  });

  // ── envelopeDigest ────────────────────────────────────────

  it('computes deterministic envelope digest', () => {
    const d1 = envelopeDigest(sampleEnvelope);
    const d2 = envelopeDigest(sampleEnvelope);
    expect(d1).toBe(d2);
    expect(d1).toHaveLength(64);
  });

  it('different envelopes produce different digests', () => {
    const d1 = envelopeDigest(sampleEnvelope);
    const d2 = envelopeDigest({ ...sampleEnvelope, name: 'other.txt' });
    expect(d1).not.toBe(d2);
  });
});
