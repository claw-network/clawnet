/**
 * ReputationService — on-chain reputation operations for ClawReputation.
 *
 * This service handles all reputation write/read operations that hit the
 * chain.  Route handlers delegate to it; it calls ClawReputation.sol via
 * ContractProvider and reads indexed review data from IndexerQuery.
 *
 * Design decisions:
 * - DID → bytes32 hash via `keccak256(toUtf8Bytes(did))`.
 * - Review hash is `keccak256(toUtf8Bytes(reviewId))` where
 *   `reviewId` is the opaque identifier from the REST layer.
 * - `anchorReputation` requires ANCHOR_ROLE — the node signer
 *   must hold that role on the contract.
 * - `recordReview` also requires ANCHOR_ROLE.
 * - Scores are uint16, max 1000 (contract-enforced).
 */

import { keccak256, toUtf8Bytes } from 'ethers';

import { createLogger } from '../logger.js';
import type { ContractProvider } from './contract-provider.js';
import type { IndexerQuery, ReviewFilter } from '../indexer/query.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Logger = ReturnType<typeof createLogger>;

// ── Dimension names (match contract order) ────────────────────────────────

export type ReputationDimensionName =
  | 'transaction'
  | 'fulfillment'
  | 'quality'
  | 'social'
  | 'behavior';

// ── Response shapes ───────────────────────────────────────────────────────

export interface ReputationProfile {
  did: string;
  score: number;
  epoch: number;
  dimensions: {
    transaction: number;
    fulfillment: number;
    quality: number;
    social: number;
    behavior: number;
  };
  merkleRoot: string;
  timestamp: number;
}

export interface ReviewRecordResult {
  txHash: string;
  reviewHash: string;
  subjectDid: string;
  reviewerDid: string;
  timestamp: number;
}

export interface AnchorResult {
  txHash: string;
  did: string;
  overallScore: number;
  epoch: number;
  timestamp: number;
}

export interface DeliveryStats {
  total: number;
  verified_l1: number;
  verified_l2: number;
  verified_l3: number;
  disputed: number;
  disputeWinRate: number;
}

export interface DeliveryRecord {
  deliverableId: string;
  verificationLevel: 1 | 2 | 3;
  timestamp: number;
}

export interface DisputeOutcome {
  deliverableId: string;
  won: boolean;
  timestamp: number;
}

export interface ReviewListResult {
  reviews: ReviewItem[];
  total: number;
  pagination: { limit: number; offset: number; hasMore: boolean };
}

export interface ReviewItem {
  reviewHash: string;
  reviewerDid: string;
  subjectDid: string;
  relatedTxHash: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// ReputationService
// ---------------------------------------------------------------------------

export class ReputationService {
  private readonly log: Logger;

  constructor(
    private readonly contracts: ContractProvider,
    private readonly indexer?: IndexerQuery,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ level: 'info' });
  }

  // ========================================================================
  // READ operations
  // ========================================================================

  /**
   * Fetch an agent's on-chain reputation profile.
   *
   * Reads `getReputation()` for the top-level score and epoch, then
   * `getLatestSnapshot()` for dimensional scores and merkle root.
   *
   * @returns Profile, or `null` if DID has no reputation on-chain.
   */
  async getProfile(did: string): Promise<ReputationProfile | null> {
    const didHash = this.hashDid(did);
    const reputation = this.contracts.reputation;

    try {
      const [score, epoch] = await reputation.getReputation(didHash);
      const overallScore = Number(score);
      const epochNum = Number(epoch);

      // If score and epoch are both 0, no reputation exists yet.
      if (overallScore === 0 && epochNum === 0) {
        return null;
      }

      const snapshot = await reputation.getLatestSnapshot(didHash);

      return {
        did,
        score: overallScore,
        epoch: epochNum,
        dimensions: {
          transaction: Number(snapshot.transactionScore),
          fulfillment: Number(snapshot.fulfillmentScore),
          quality: Number(snapshot.qualityScore),
          social: Number(snapshot.socialScore),
          behavior: Number(snapshot.behaviorScore),
        },
        merkleRoot: snapshot.merkleRoot,
        timestamp: Number(snapshot.timestamp),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get reviews for a DID from the indexer.
   *
   * @param subjectDid  The DID whose reviews to fetch.
   * @param opts        Pagination options.
   */
  getReviews(
    subjectDid: string,
    opts: { limit?: number; offset?: number } = {},
  ): ReviewListResult | null {
    if (!this.indexer) return null;

    const filter: ReviewFilter = {
      subjectDid: this.hashDid(subjectDid),
      limit: opts.limit,
      offset: opts.offset,
    };
    const result = this.indexer.getReviews(filter);

    const reviews: ReviewItem[] = result.items.map((r) => ({
      reviewHash: r.reviewHash,
      reviewerDid: r.reviewerDid,
      subjectDid: r.subjectDid,
      relatedTxHash: r.relatedTxHash,
      timestamp: r.timestamp,
    }));

    return {
      reviews,
      total: result.total,
      pagination: {
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + result.limit < result.total,
      },
    };
  }

  /**
   * Verify a review anchor on-chain.
   */
  async verifyReview(reviewId: string): Promise<{
    reviewerDid: string;
    subjectDid: string;
    txHash: string;
    timestamp: number;
    exists: boolean;
  } | null> {
    const reviewHash = this.hashId(reviewId);
    try {
      const anchor = await this.contracts.reputation.verifyReview(reviewHash);
      return {
        reviewerDid: anchor.reviewerDIDHash,
        subjectDid: anchor.subjectDIDHash,
        txHash: anchor.txHash,
        timestamp: Number(anchor.timestamp),
        exists: anchor.exists,
      };
    } catch {
      return null;
    }
  }

  // ========================================================================
  // WRITE operations
  // ========================================================================

  /**
   * Record a review on-chain.
   *
   * The node signer must have ANCHOR_ROLE on ClawReputation.
   *
   * @param reviewId    Opaque review identifier (hashed to bytes32).
   * @param reviewerDid Reviewer's full DID string.
   * @param subjectDid  Subject's full DID string.
   * @param relatedTxHash Associated transaction hash (bytes32).
   */
  async recordReview(
    reviewId: string,
    reviewerDid: string,
    subjectDid: string,
    relatedTxHash: string,
  ): Promise<ReviewRecordResult> {
    const reviewHash = this.hashId(reviewId);
    const reviewerHash = this.hashDid(reviewerDid);
    const subjectHash = this.hashDid(subjectDid);

    this.log.info(
      'Reputation recordReview: reviewer=%s subject=%s',
      reviewerDid,
      subjectDid,
    );

    const tx = await this.contracts.reputation.recordReview(
      reviewHash,
      reviewerHash,
      subjectHash,
      relatedTxHash,
    );
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      reviewHash,
      subjectDid,
      reviewerDid,
      timestamp: Date.now(),
    };
  }

  /**
   * Anchor a reputation snapshot on-chain.
   *
   * The node signer must have ANCHOR_ROLE on ClawReputation.
   *
   * @param did              Agent's full DID string.
   * @param overallScore     0–1000.
   * @param dimensionScores  [transaction, fulfillment, quality, social, behavior] — each 0–1000.
   * @param merkleRoot       Merkle root of all reviews in this epoch.
   */
  async anchorReputation(
    did: string,
    overallScore: number,
    dimensionScores: [number, number, number, number, number],
    merkleRoot: string,
  ): Promise<AnchorResult> {
    const didHash = this.hashDid(did);

    this.log.info(
      'Reputation anchor: %s score=%d',
      did,
      overallScore,
    );

    const tx = await this.contracts.reputation.anchorReputation(
      didHash,
      overallScore,
      dimensionScores,
      merkleRoot,
    );
    const receipt = await tx.wait();

    // Parse epoch from ReputationAnchored event
    let epoch = 0;
    for (const log of receipt.logs) {
      try {
        const parsed = this.contracts.reputation.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === 'ReputationAnchored') {
          epoch = Number(parsed.args[1]);
          break;
        }
      } catch {
        // Not our event — skip.
      }
    }

    return {
      txHash: receipt.hash,
      did,
      overallScore,
      epoch,
      timestamp: Date.now(),
    };
  }

  // ========================================================================
  // Delivery reputation tracking (Phase 3)
  // ========================================================================

  /** In-memory delivery records per DID (production would use indexer). */
  private readonly deliveryRecords = new Map<string, DeliveryRecord[]>();
  private readonly disputeOutcomes = new Map<string, DisputeOutcome[]>();

  /**
   * Record a successful delivery with its verification level.
   *
   * Called after Layer 3 verification passes (or highest achieved layer).
   */
  recordDelivery(
    sellerDid: string,
    record: { deliverableId: string; verificationLevel: 1 | 2 | 3 },
  ): void {
    let records = this.deliveryRecords.get(sellerDid);
    if (!records) {
      records = [];
      this.deliveryRecords.set(sellerDid, records);
    }
    records.push({
      deliverableId: record.deliverableId,
      verificationLevel: record.verificationLevel,
      timestamp: Date.now(),
    });

    this.log.info(
      'Delivery recorded: seller=%s deliverable=%s level=%d',
      sellerDid,
      record.deliverableId,
      record.verificationLevel,
    );
  }

  /**
   * Record a delivery violation (buyer wins dispute).
   */
  recordViolation(
    sellerDid: string,
    opts: { type: string; deliverableId: string },
  ): void {
    let outcomes = this.disputeOutcomes.get(sellerDid);
    if (!outcomes) {
      outcomes = [];
      this.disputeOutcomes.set(sellerDid, outcomes);
    }
    outcomes.push({ deliverableId: opts.deliverableId, won: false, timestamp: Date.now() });

    this.log.warn(
      'Delivery violation: seller=%s type=%s deliverable=%s',
      sellerDid,
      opts.type,
      opts.deliverableId,
    );
  }

  /**
   * Record a false dispute (seller wins, buyer penalized).
   */
  recordFalseDispute(
    buyerDid: string,
    opts: { deliverableId: string },
  ): void {
    let outcomes = this.disputeOutcomes.get(buyerDid);
    if (!outcomes) {
      outcomes = [];
      this.disputeOutcomes.set(buyerDid, outcomes);
    }
    outcomes.push({ deliverableId: opts.deliverableId, won: true, timestamp: Date.now() });

    this.log.warn(
      'False dispute recorded: buyer=%s deliverable=%s',
      buyerDid,
      opts.deliverableId,
    );
  }

  /**
   * Get delivery statistics for a DID.
   */
  getDeliveryStats(did: string): DeliveryStats {
    const records = this.deliveryRecords.get(did) ?? [];
    const outcomes = this.disputeOutcomes.get(did) ?? [];

    const total = records.length;
    const verified_l1 = records.filter(r => r.verificationLevel >= 1).length;
    const verified_l2 = records.filter(r => r.verificationLevel >= 2).length;
    const verified_l3 = records.filter(r => r.verificationLevel >= 3).length;
    const disputed = outcomes.length;
    const wins = outcomes.filter(o => o.won).length;
    const disputeWinRate = disputed > 0 ? wins / disputed : 0;

    return { total, verified_l1, verified_l2, verified_l3, disputed, disputeWinRate };
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  /** Hash a DID string to bytes32. */
  private hashDid(did: string): string {
    return keccak256(toUtf8Bytes(did));
  }

  /** Hash an opaque identifier string to bytes32. */
  private hashId(id: string): string {
    return keccak256(toUtf8Bytes(id));
  }
}
