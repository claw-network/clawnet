/**
 * ReputationService unit tests.
 *
 * Tests all public methods with mocked ContractProvider and IndexerQuery.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { keccak256, toUtf8Bytes } from 'ethers';
import { ReputationService } from '../../src/services/reputation-service.js';
import {
  createMockProvider,
  createMockIndexer,
  mockTxResponse,
  TX_HASH,
} from './_mock-contracts.js';

describe('ReputationService', () => {
  let service: ReputationService;
  let provider: ReturnType<typeof createMockProvider>;
  let indexer: ReturnType<typeof createMockIndexer>;

  const DID = 'did:claw:alice';
  const DID_HASH = keccak256(toUtf8Bytes(DID));
  const REVIEWER_DID = 'did:claw:bob';
  const TX = '0x' + 'ff'.repeat(32);

  beforeEach(() => {
    provider = createMockProvider({
      reputation: {
        // getReputation returns [score, epoch] tuple
        getReputation: vi.fn().mockResolvedValue([85n, 10n]),
        // getLatestSnapshot returns flat object with dimensional scores
        getLatestSnapshot: vi.fn().mockResolvedValue({
          transactionScore: 90n,
          fulfillmentScore: 80n,
          qualityScore: 85n,
          socialScore: 70n,
          behaviorScore: 95n,
          merkleRoot: '0x' + 'aa'.repeat(32),
          timestamp: 1700000000n,
        }),
        // verifyReview returns flat object
        verifyReview: vi.fn().mockResolvedValue({
          reviewerDIDHash: keccak256(toUtf8Bytes(REVIEWER_DID)),
          subjectDIDHash: DID_HASH,
          txHash: TX,
          timestamp: 1700000000n,
          exists: true,
        }),
        recordReview: vi.fn().mockResolvedValue(mockTxResponse()),
        anchorReputation: vi.fn().mockResolvedValue(mockTxResponse()),
      },
    });
    indexer = createMockIndexer();
     
    service = new ReputationService(provider as any, indexer as any);
  });

  // ── READ ───────────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('returns reputation profile from on-chain', async () => {
      const profile = await service.getProfile(DID);
      expect(profile).not.toBeNull();
      expect(profile!.score).toBe(85);
      expect(profile!.epoch).toBe(10);
      expect(profile!.dimensions.transaction).toBe(90);
      expect(profile!.dimensions.quality).toBe(85);
    });

    it('returns null when score and epoch are both 0', async () => {
      provider.reputation.getReputation.mockResolvedValue([0n, 0n]);
      const profile = await service.getProfile(DID);
      expect(profile).toBeNull();
    });
  });

  describe('getReviews (indexer)', () => {
    it('returns null when no indexer', () => {
       
      const noIndexer = new ReputationService(provider as any);
      const result = noIndexer.getReviews(DID);
      expect(result).toBeNull();
    });

    it('returns reviews from indexer', () => {
      indexer.getReviews.mockReturnValue({
        items: [
          {
            reviewHash: 'rev-1',
            reviewerDid: REVIEWER_DID,
            subjectDid: DID,
            relatedTxHash: TX,
            timestamp: 1700000000,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });
      const result = service.getReviews(DID);
      expect(result).not.toBeNull();
      expect(result!.reviews).toHaveLength(1);
      expect(result!.reviews[0].reviewerDid).toBe(REVIEWER_DID);
      expect(result!.total).toBe(1);
    });
  });

  describe('verifyReview', () => {
    it('returns review verification data from on-chain', async () => {
      const result = await service.verifyReview('rev-1');
      expect(result).not.toBeNull();
      expect(result!.exists).toBe(true);
      expect(result!.timestamp).toBe(1700000000);
    });
  });

  // ── WRITE ──────────────────────────────────────────────────────────

  describe('recordReview', () => {
    it('calls reputation.recordReview with correct args', async () => {
      const result = await service.recordReview('rev-1', REVIEWER_DID, DID, TX);
      expect(provider.reputation.recordReview).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('anchorReputation', () => {
    it('calls reputation.anchorReputation', async () => {
      const merkle = '0x' + 'dd'.repeat(32);
      const result = await service.anchorReputation(
        DID, 85, [90, 80, 85, 70, 95], merkle,
      );
      expect(provider.reputation.anchorReputation).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });
});
