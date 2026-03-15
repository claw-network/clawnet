/**
 * Tests for ReputationService delivery tracking — Phase 3 reputation integration.
 */

import { describe, it, expect } from 'vitest';
import { ReputationService } from '../../src/services/reputation-service.js';

// We need a mock ContractProvider for the constructor
function createMockContracts() {
  return {
    reputation: {
      getReputation: async () => [0n, 0n],
      getLatestSnapshot: async () => ({
        transactionScore: 0n,
        fulfillmentScore: 0n,
        qualityScore: 0n,
        socialScore: 0n,
        behaviorScore: 0n,
        merkleRoot: '0x0',
        timestamp: 0n,
      }),
      recordReview: async () => ({ wait: async () => ({ hash: '0x0', logs: [] }) }),
      anchorReputation: async () => ({ wait: async () => ({ hash: '0x0', logs: [] }) }),
      verifyReview: async () => ({ exists: false }),
    },
  };
}

describe('ReputationService delivery tracking', () => {
  function createService() {
    return new ReputationService(createMockContracts() as never);
  }

  describe('recordDelivery', () => {
    it('records a delivery and updates stats', () => {
      const svc = createService();
      svc.recordDelivery('did:claw:seller1', { deliverableId: 'd1', verificationLevel: 3 });
      const stats = svc.getDeliveryStats('did:claw:seller1');
      expect(stats.total).toBe(1);
      expect(stats.verified_l1).toBe(1);
      expect(stats.verified_l2).toBe(1);
      expect(stats.verified_l3).toBe(1);
    });

    it('tracks multiple deliveries', () => {
      const svc = createService();
      svc.recordDelivery('did:claw:s2', { deliverableId: 'd1', verificationLevel: 1 });
      svc.recordDelivery('did:claw:s2', { deliverableId: 'd2', verificationLevel: 2 });
      svc.recordDelivery('did:claw:s2', { deliverableId: 'd3', verificationLevel: 3 });

      const stats = svc.getDeliveryStats('did:claw:s2');
      expect(stats.total).toBe(3);
      expect(stats.verified_l1).toBe(3);
      expect(stats.verified_l2).toBe(2); // d2 and d3
      expect(stats.verified_l3).toBe(1); // d3 only
    });
  });

  describe('recordViolation', () => {
    it('records violation and affects stats', () => {
      const svc = createService();
      svc.recordViolation('did:claw:bad', { type: 'delivery_failure', deliverableId: 'd1' });
      const stats = svc.getDeliveryStats('did:claw:bad');
      expect(stats.disputed).toBe(1);
      expect(stats.disputeWinRate).toBe(0); // violation = seller lost
    });
  });

  describe('recordFalseDispute', () => {
    it('records false dispute as a win', () => {
      const svc = createService();
      svc.recordFalseDispute('did:claw:buyer', { deliverableId: 'd1' });
      const stats = svc.getDeliveryStats('did:claw:buyer');
      expect(stats.disputed).toBe(1);
      expect(stats.disputeWinRate).toBe(1); // false dispute = buyer won the dispute record
    });
  });

  describe('getDeliveryStats', () => {
    it('returns zero stats for unknown DID', () => {
      const svc = createService();
      const stats = svc.getDeliveryStats('did:claw:unknown');
      expect(stats.total).toBe(0);
      expect(stats.disputed).toBe(0);
      expect(stats.disputeWinRate).toBe(0);
    });

    it('computes mixed stats correctly', () => {
      const svc = createService();
      svc.recordDelivery('did:claw:mix', { deliverableId: 'd1', verificationLevel: 3 });
      svc.recordDelivery('did:claw:mix', { deliverableId: 'd2', verificationLevel: 1 });
      svc.recordViolation('did:claw:mix', { type: 'delivery_failure', deliverableId: 'd3' });
      svc.recordFalseDispute('did:claw:mix', { deliverableId: 'd4' });

      const stats = svc.getDeliveryStats('did:claw:mix');
      expect(stats.total).toBe(2);
      expect(stats.verified_l3).toBe(1);
      expect(stats.disputed).toBe(2);
      expect(stats.disputeWinRate).toBe(0.5); // 1 won out of 2
    });
  });
});
