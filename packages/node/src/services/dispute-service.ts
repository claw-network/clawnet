/**
 * DisputeService — automatic dispute triggering for delivery verification failures.
 *
 * Phase 3: when Layer 1/2/3 verification detects a mismatch or failure,
 * this service opens an on-chain dispute with evidence.
 *
 * Spec: docs/implementation/deliverable-spec.md §3.3
 */

import { createLogger } from '../logger.js';
import type { ContractProvider } from './contract-provider.js';
import type { FullVerificationResult } from './deliverable-verifier.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Logger = ReturnType<typeof createLogger>;

export type DisputeReason =
  | 'content_hash_mismatch'
  | 'signature_invalid'
  | 'schema_validation_failed'
  | 'acceptance_test_failed'
  | 'final_hash_mismatch'
  | 'sla_violation';

export interface DisputeEvidence {
  /** The verification result that triggered the dispute */
  verificationResult?: FullVerificationResult;
  /** Original envelope ID */
  envelopeId?: string;
  /** Additional context */
  details?: string;
}

export interface AutoDisputeResult {
  disputeId: string;
  orderId: string;
  deliverableId: string;
  reason: DisputeReason;
  txHash?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// DisputeService
// ---------------------------------------------------------------------------

export class DisputeService {
  private readonly log: Logger;

  constructor(
    private readonly contracts?: ContractProvider,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ level: 'info' });
  }

  /**
   * Automatically open a dispute based on verification failure.
   *
   * If a ContractProvider is available and has service contracts,
   * calls `disputeContract` on-chain. Otherwise, records the dispute
   * locally and returns a local dispute ID.
   */
  async autoOpenDispute(
    orderId: string,
    deliverableId: string,
    reason: DisputeReason,
    evidence: DisputeEvidence,
  ): Promise<AutoDisputeResult> {
    const disputeId = `dispute-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.log.warn(
      'Auto-dispute triggered: order=%s deliverable=%s reason=%s',
      orderId,
      deliverableId,
      reason,
    );

    let txHash: string | undefined;

    if (this.contracts) {
      try {
        const evidenceJson = JSON.stringify({
          disputeId,
          deliverableId,
          reason,
          envelopeId: evidence.envelopeId,
          details: evidence.details,
          timestamp: Date.now(),
        });

        const result = await this.contracts.serviceContracts.disputeContract(
          this.hashId(orderId),
          this.hashId(evidenceJson),
        );
        const receipt = await result.wait();
        txHash = receipt.hash;
      } catch (err) {
        this.log.error(
          'On-chain dispute failed for order=%s: %s',
          orderId,
          (err as Error).message,
        );
        // Fall through to local-only dispute
      }
    }

    return {
      disputeId,
      orderId,
      deliverableId,
      reason,
      txHash,
      timestamp: Date.now(),
    };
  }

  /**
   * Analyze a FullVerificationResult and determine if an auto-dispute
   * should be triggered. Returns the reason if yes, null otherwise.
   */
  shouldDispute(result: FullVerificationResult): DisputeReason | null {
    // Layer 1 failures
    if (!result.layer1.passed) {
      const hashCheck = result.layer1.checks.find(c => c.name === 'contentHash');
      if (hashCheck && !hashCheck.passed) return 'content_hash_mismatch';

      const sigCheck = result.layer1.checks.find(c => c.name === 'signature');
      if (sigCheck && !sigCheck.passed) return 'signature_invalid';

      return 'content_hash_mismatch'; // fallback
    }

    // Layer 2 failures (required schema)
    if (result.layer2 && !result.layer2.passed) {
      return 'schema_validation_failed';
    }

    // Layer 3 failures (required acceptance tests)
    if (result.layer3 && !result.layer3.passed) {
      return 'acceptance_test_failed';
    }

    return null;
  }

  /**
   * Run auto-dispute logic: check verification result and open dispute if needed.
   *
   * Returns the dispute result if a dispute was opened, null otherwise.
   */
  async checkAndDispute(
    orderId: string,
    deliverableId: string,
    verificationResult: FullVerificationResult,
  ): Promise<AutoDisputeResult | null> {
    const reason = this.shouldDispute(verificationResult);
    if (!reason) return null;

    return this.autoOpenDispute(orderId, deliverableId, reason, {
      verificationResult,
      envelopeId: deliverableId,
    });
  }

  private hashId(id: string): string {
    // Simple deterministic hash for on-chain ID mapping
    // In production this would use keccak256
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    }
    return '0x' + Math.abs(hash).toString(16).padStart(64, '0');
  }
}
