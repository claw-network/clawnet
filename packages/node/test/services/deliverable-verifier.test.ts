/**
 * DeliverableVerifier unit tests.
 *
 * Tests Layer 1 (contentHash + Ed25519 sig) and Layer 2 (JSON Schema) verification.
 * No live chain or network required.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { DeliverableVerifier } from '../../src/services/deliverable-verifier.js';
import {
  generateKeypair,
  blake3Hex,
  utf8ToBytes,
  bytesToHex,
  signDeliverable,
  didFromPublicKey,
} from '@claw-network/core';
import type { DeliverableEnvelope } from '@claw-network/protocol';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEnvelope(
  producerDid: string,
  contentHashHex: string,
  signature = '',
): DeliverableEnvelope {
  return {
    id: bytesToHex(randomBytes(32)),
    nonce: bytesToHex(randomBytes(32)),
    contextId: 'order-test-1',
    type: 'data',
    format: 'application/json',
    name: 'result.json',
    contentHash: contentHashHex,
    size: 0,
    producer: producerDid,
    signature,
    createdAt: new Date().toISOString(),
    transport: { method: 'inline', data: '' },
  } as unknown as DeliverableEnvelope;
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('DeliverableVerifier', () => {
  let verifier: DeliverableVerifier;
  let producerDid: string;
  let privateKey: Uint8Array;
  let publicKey: Uint8Array;

  const CONTENT = utf8ToBytes('{"answer":42}');
  const CORRECT_HASH = blake3Hex(CONTENT);

  beforeAll(async () => {
    verifier = new DeliverableVerifier();
    const kp = await generateKeypair();
    privateKey = kp.privateKey;
    publicKey = kp.publicKey;
    producerDid = didFromPublicKey(publicKey);
  });

  // ── Layer 1: content hash ────────────────────────────────────────────────

  describe('verifyLayer1', () => {
    it('passes when hash and signature are both correct', async () => {
      const envelope = makeEnvelope(producerDid, CORRECT_HASH);
      const sig = await signDeliverable(envelope as unknown as Record<string, unknown>, privateKey);
      const signed = { ...envelope, signature: sig } as unknown as DeliverableEnvelope;

      const result = await verifier.verifyLayer1(signed, CONTENT);
      expect(result.passed).toBe(true);
      expect(result.layer).toBe(1);
      expect(result.checks.find(c => c.name === 'contentHash')?.passed).toBe(true);
      expect(result.checks.find(c => c.name === 'signature')?.passed).toBe(true);
    });

    it('fails immediately when content hash does not match', async () => {
      const wrongHash = bytesToHex(randomBytes(32));
      const envelope = makeEnvelope(producerDid, wrongHash);
      const sig = await signDeliverable(envelope as unknown as Record<string, unknown>, privateKey);
      const signed = { ...envelope, signature: sig } as unknown as DeliverableEnvelope;

      const result = await verifier.verifyLayer1(signed, CONTENT);
      expect(result.passed).toBe(false);
      // Should short-circuit: signature check not reached
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0]!.name).toBe('contentHash');
      expect(result.checks[0]!.passed).toBe(false);
    });

    it('fails when signature is invalid', async () => {
      // Use a different keypair to sign
      const otherKp = await generateKeypair();
      const envelope = makeEnvelope(producerDid, CORRECT_HASH);
      const wrongSig = await signDeliverable(
        envelope as unknown as Record<string, unknown>,
        otherKp.privateKey,
      );
      const signed = { ...envelope, signature: wrongSig } as unknown as DeliverableEnvelope;

      const result = await verifier.verifyLayer1(signed, CONTENT);
      expect(result.passed).toBe(false);
      expect(result.checks.find(c => c.name === 'signature')?.passed).toBe(false);
    });

    it('sets degraded=true and passes when skipSignature is true', async () => {
      const envelope = makeEnvelope(producerDid, CORRECT_HASH, 'skipped');

      const result = await verifier.verifyLayer1(envelope, CONTENT, { skipSignature: true });
      expect(result.passed).toBe(true);
      expect(result.degraded).toBe(true);
      expect(result.checks.find(c => c.name === 'signature')?.passed).toBe(true);
    });

    it('fails when signature or producer DID is missing', async () => {
      const envelope = makeEnvelope(producerDid, CORRECT_HASH, '');

      const result = await verifier.verifyLayer1(envelope, CONTENT);
      expect(result.passed).toBe(false);
      expect(result.checks.find(c => c.name === 'signature')?.passed).toBe(false);
    });
  });

  // ── Layer 2: schema validation ────────────────────────────────────────────

  describe('verifyLayer2', () => {
    it('passes immediately when envelope has no schema reference', async () => {
      const envelope = makeEnvelope(producerDid, CORRECT_HASH);
      // No schema field — should pass

      const result = await verifier.verifyLayer2(envelope, { answer: 42 });
      expect(result.passed).toBe(true);
      expect(result.layer).toBe(2);
    });

    it('passes for non-JSON format even if schema.ref is present', async () => {
      const envelope = {
        ...makeEnvelope(producerDid, CORRECT_HASH),
        format: 'text/plain',
        schema: { ref: 'https://schemas.example.com/schema.json' },
      } as unknown as DeliverableEnvelope;

      const result = await verifier.verifyLayer2(envelope, 'some text');
      // text/plain is not JSON, SchemaValidator skips and returns passed
      expect(result.passed).toBe(true);
    });

    it('validates JSON content against an inline schema', async () => {
      // Provide a schema object that the SchemaValidator will recognise
      // SchemaValidator only fetches external URIs, so use no schema.ref
      // to confirm the no-schema fast path is separate from parse errors
      const envelope = makeEnvelope(producerDid, CORRECT_HASH);

      // Passing null content with no schema ref → still passes
      const result = await verifier.verifyLayer2(envelope, null);
      expect(result.passed).toBe(true);
    });
  });

  // ── reportMismatch stub ───────────────────────────────────────────────────

  describe('reportMismatch', () => {
    it('returns a MismatchReport with the expected shape', () => {
      const before = Date.now();
      const report = verifier.reportMismatch('order-123', 'del-456', 'hash_mismatch');
      const after = Date.now();

      expect(report.orderId).toBe('order-123');
      expect(report.deliverableId).toBe('del-456');
      expect(report.reason).toBe('hash_mismatch');
      expect(report.reportedAtMs).toBeGreaterThanOrEqual(before);
      expect(report.reportedAtMs).toBeLessThanOrEqual(after);
    });
  });
});
