/**
 * DeliverableVerifier service — Phase 2 content verification.
 *
 * Layer 1: contentHash + Ed25519 signature integrity.
 * Layer 2: JSON Schema structural validation (Phase 2B).
 *
 * Spec: docs/implementation/deliverable-spec.md §5
 */

import {
  blake3Hex,
  verifyDeliverableSignature,
  publicKeyFromDid,
  type DeliverableEnvelopeRecord,
} from '@claw-network/core';
import type { DeliverableEnvelope } from '@claw-network/protocol';
import { SchemaValidator } from './schema-validator.js';

// ── Result types ─────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface VerificationResult {
  passed: boolean;
  layer: 1 | 2;
  checks: CheckResult[];
  /** True when signature check was skipped (key unavailable) but hash passed. */
  degraded?: boolean;
}

// ── Mismatch report (Phase 3 hook) ───────────────────────────────

export interface MismatchReport {
  orderId: string;
  deliverableId: string;
  reason: string;
  reportedAtMs: number;
}

// ── Service ──────────────────────────────────────────────────────

export class DeliverableVerifier {
  private readonly schemaValidator = new SchemaValidator();
  /**
   * Layer 1 verification:
   *  - check BLAKE3(plaintext) === envelope.contentHash
   *  - verify Ed25519 signature over canonical(envelope \ {signature})
   *
   * @param envelope  The signed DeliverableEnvelope (or a plain Record).
   * @param plaintext Decrypted content bytes.
   * @param opts.skipSignature Skip signature check when producer public key unavailable.
   */
  async verifyLayer1(
    envelope: DeliverableEnvelope | DeliverableEnvelopeRecord,
    plaintext: Uint8Array,
    opts: { skipSignature?: boolean } = {},
  ): Promise<VerificationResult> {
    const checks: CheckResult[] = [];
    let degraded = false;

    // ── Check 1: content hash ──────────────────────────────────
    const actualHash = blake3Hex(plaintext);
    const expectedHash = (envelope as DeliverableEnvelope).contentHash;
    const hashPassed = actualHash === expectedHash;
    checks.push({
      name: 'contentHash',
      passed: hashPassed,
      detail: hashPassed
        ? `blake3:${actualHash.slice(0, 16)}…`
        : `expected ${expectedHash?.slice(0, 16)}… got ${actualHash.slice(0, 16)}…`,
    });

    if (!hashPassed) {
      return { passed: false, layer: 1, checks };
    }

    // ── Check 2: signature ──────────────────────────────────────
    if (opts.skipSignature) {
      degraded = true;
      checks.push({ name: 'signature', passed: true, detail: 'skipped (no public key)' });
    } else {
      const sig = (envelope as DeliverableEnvelope).signature;
      const producerDid = (envelope as DeliverableEnvelope).producer;

      if (!sig || !producerDid) {
        checks.push({
          name: 'signature',
          passed: false,
          detail: 'missing signature or producer DID',
        });
        return { passed: false, layer: 1, checks };
      }

      let sigPassed = false;
      try {
        const publicKey = publicKeyFromDid(producerDid);
        sigPassed = await verifyDeliverableSignature(
          envelope as DeliverableEnvelopeRecord,
          sig,
          publicKey,
        );
      } catch {
        sigPassed = false;
      }

      checks.push({
        name: 'signature',
        passed: sigPassed,
        detail: sigPassed ? 'ok' : 'invalid Ed25519 signature',
      });

      if (!sigPassed) {
        return { passed: false, layer: 1, checks };
      }
    }

    const result: VerificationResult = { passed: true, layer: 1, checks };
    if (degraded) result.degraded = true;
    return result;
  }

  /**
   * Report a content mismatch (Phase 3 hook — stub for now).
   * In Phase 3 this will emit an on-chain dispute event.
   */
  reportMismatch(orderId: string, deliverableId: string, reason: string): MismatchReport {
    return {
      orderId,
      deliverableId,
      reason,
      reportedAtMs: Date.now(),
    };
  }

  /**
   * Layer 2 verification: JSON Schema structural validation.
   * Validates `content` against envelope.schema.ref if present.
   *
   * Returns passed: true immediately when envelope has no schema reference.
   *
   * @param envelope  The signed DeliverableEnvelope.
   * @param content   Parsed JSON value (the deliverable content).
   */
  async verifyLayer2(
    envelope: DeliverableEnvelope | DeliverableEnvelopeRecord,
    content: unknown,
  ): Promise<VerificationResult> {
    const result = await this.schemaValidator.validate(
      envelope as DeliverableEnvelope,
      content,
    );

    const check: CheckResult = {
      name: 'jsonSchema',
      passed: result.passed,
      detail: result.passed ? 'ok' : result.errors.join('; '),
    };

    return { passed: result.passed, layer: 2, checks: [check] };
  }
}
