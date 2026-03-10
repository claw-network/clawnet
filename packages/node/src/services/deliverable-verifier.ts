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
import { type AcceptanceTest, runAcceptanceTests, type AcceptanceTestResult } from '@claw-network/protocol';
import { SchemaValidator } from './schema-validator.js';
import { ssrfSafeFetch } from './ssrf-guard.js';
import { DisputeService, type DisputeReason } from './dispute-service.js';

// ── Result types ─────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface VerificationResult {
  passed: boolean;
  layer: 1 | 2 | 3;
  checks: CheckResult[];
  /** True when signature check was skipped (key unavailable) but hash passed. */
  degraded?: boolean;
  /** Layer 3 acceptance test details (only present for layer 3). */
  acceptanceTestResult?: AcceptanceTestResult;
}

/** Combined result from verifyAll (Layer 1 → 2 → 3). */
export interface FullVerificationResult {
  passed: boolean;
  layer1: VerificationResult;
  layer2?: VerificationResult;
  layer3?: VerificationResult;
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
  private readonly disputeService?: DisputeService;

  constructor(opts?: { disputeService?: DisputeService }) {
    this.disputeService = opts?.disputeService;
  }
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
   * Report a content mismatch and trigger auto-dispute if DisputeService is available.
   *
   * Returns a MismatchReport for backward compat. If DisputeService is wired,
   * also opens an on-chain dispute asynchronously.
   */
  reportMismatch(
    orderId: string,
    deliverableId: string,
    reason: string,
  ): MismatchReport {
    const report: MismatchReport = {
      orderId,
      deliverableId,
      reason,
      reportedAtMs: Date.now(),
    };

    // Fire auto-dispute asynchronously (non-blocking)
    if (this.disputeService) {
      void this.disputeService.autoOpenDispute(
        orderId,
        deliverableId,
        'content_hash_mismatch' as DisputeReason,
        { details: reason },
      );
    }

    return report;
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

  /**
   * Layer 3 verification: acceptance test assertions.
   *
   * Runs declarative assertions (JSONPath + operator) against the parsed content.
   * Only evaluates tests of type 'assertion'; 'script' and 'manual' tests
   * produce an automatic skip/fail result.
   *
   * @param tests   AcceptanceTest array declared by the buyer.
   * @param content Parsed JSON value (the deliverable content).
   */
  verifyLayer3(
    tests: AcceptanceTest[],
    content: unknown,
  ): VerificationResult {
    if (tests.length === 0) {
      return { passed: true, layer: 3, checks: [{ name: 'acceptanceTests', passed: true, detail: 'no tests declared' }] };
    }

    const result = runAcceptanceTests(tests, content);
    const detail = result.passed
      ? `${result.results.length} assertion(s) passed`
      : `${result.results.filter(r => !r.passed).length}/${result.results.length} assertion(s) failed`;

    return {
      passed: result.passed,
      layer: 3,
      checks: [{ name: 'acceptanceTests', passed: result.passed, detail }],
      acceptanceTestResult: result,
    };
  }

  /**
   * Full verification pipeline: Layer 1 → Layer 2 → Layer 3.
   *
   * Stops at the first failing layer (unless `runAll` is true).
   *
   * @param envelope      The signed DeliverableEnvelope.
   * @param plaintext     Decrypted content bytes.
   * @param opts.skipSignature  Skip Ed25519 signature verification.
   * @param opts.acceptanceTests  Buyer-declared acceptance tests for Layer 3.
   */
  async verifyAll(
    envelope: DeliverableEnvelope | DeliverableEnvelopeRecord,
    plaintext: Uint8Array,
    opts: {
      skipSignature?: boolean;
      acceptanceTests?: AcceptanceTest[];
    } = {},
  ): Promise<FullVerificationResult> {
    const l1 = await this.verifyLayer1(envelope, plaintext, { skipSignature: opts.skipSignature });
    if (!l1.passed) {
      return { passed: false, layer1: l1 };
    }

    let l2: VerificationResult | undefined;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(plaintext));
      l2 = await this.verifyLayer2(envelope, parsed);

      if (!l2.passed) {
        return { passed: false, layer1: l1, layer2: l2 };
      }

      // Layer 3
      if (opts.acceptanceTests && opts.acceptanceTests.length > 0) {
        const l3 = this.verifyLayer3(opts.acceptanceTests, parsed);
        return { passed: l3.passed, layer1: l1, layer2: l2, layer3: l3 };
      }
    } catch {
      // Non-JSON content — skip Layer 2 and Layer 3
    }

    return { passed: true, layer1: l1, ...(l2 ? { layer2: l2 } : {}) };
  }

  /**
   * Endpoint transport smoke test — verify that the endpoint URL is reachable.
   *
   * Sends a HEAD (or GET) request to `{baseUrl}/health` with SSRF guard.
   * Returns a check result (not a full VerificationResult).
   *
   * @param baseUrl  The endpoint transport base URL (e.g. https://agent.example.com).
   * @param timeoutMs  Request timeout (default: 5 000 ms).
   */
  async smokeTestEndpoint(
    baseUrl: string,
    timeoutMs = 5_000,
  ): Promise<CheckResult> {
    let parsed: URL;
    try {
      parsed = new URL('/health', baseUrl);
    } catch {
      return { name: 'endpointSmoke', passed: false, detail: `Invalid base URL: ${baseUrl}` };
    }

    try {
      const resp = await ssrfSafeFetch(parsed.href, {
        timeoutMs,
        init: { method: 'HEAD' },
      });
      const ok = resp.status >= 200 && resp.status < 400;
      return {
        name: 'endpointSmoke',
        passed: ok,
        detail: ok ? `HTTP ${resp.status}` : `HTTP ${resp.status} (non-2xx/3xx)`,
      };
    } catch (err) {
      return {
        name: 'endpointSmoke',
        passed: false,
        detail: (err as Error).message ?? 'Unknown error',
      };
    }
  }
}
