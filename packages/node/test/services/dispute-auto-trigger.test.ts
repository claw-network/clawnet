/**
 * Tests for DisputeService — Phase 3 auto-dispute triggering.
 */

import { describe, it, expect, vi } from 'vitest';
import { DisputeService } from '../../src/services/dispute-service.js';
import type { FullVerificationResult } from '../../src/services/deliverable-verifier.js';

describe('DisputeService', () => {
  describe('shouldDispute', () => {
    const svc = new DisputeService();

    it('returns null when all layers pass', () => {
      const result: FullVerificationResult = {
        passed: true,
        layer1: { passed: true, layer: 1, checks: [{ name: 'contentHash', passed: true }] },
        layer2: { passed: true, layer: 2, checks: [{ name: 'jsonSchema', passed: true }] },
        layer3: { passed: true, layer: 3, checks: [{ name: 'acceptanceTests', passed: true }] },
      };
      expect(svc.shouldDispute(result)).toBeNull();
    });

    it('returns content_hash_mismatch for Layer 1 hash failure', () => {
      const result: FullVerificationResult = {
        passed: false,
        layer1: {
          passed: false, layer: 1,
          checks: [{ name: 'contentHash', passed: false, detail: 'mismatch' }],
        },
      };
      expect(svc.shouldDispute(result)).toBe('content_hash_mismatch');
    });

    it('returns signature_invalid for Layer 1 signature failure', () => {
      const result: FullVerificationResult = {
        passed: false,
        layer1: {
          passed: false, layer: 1,
          checks: [
            { name: 'contentHash', passed: true },
            { name: 'signature', passed: false, detail: 'invalid' },
          ],
        },
      };
      expect(svc.shouldDispute(result)).toBe('signature_invalid');
    });

    it('returns schema_validation_failed for Layer 2 failure', () => {
      const result: FullVerificationResult = {
        passed: false,
        layer1: { passed: true, layer: 1, checks: [{ name: 'contentHash', passed: true }] },
        layer2: { passed: false, layer: 2, checks: [{ name: 'jsonSchema', passed: false }] },
      };
      expect(svc.shouldDispute(result)).toBe('schema_validation_failed');
    });

    it('returns acceptance_test_failed for Layer 3 failure', () => {
      const result: FullVerificationResult = {
        passed: false,
        layer1: { passed: true, layer: 1, checks: [{ name: 'contentHash', passed: true }] },
        layer2: { passed: true, layer: 2, checks: [{ name: 'jsonSchema', passed: true }] },
        layer3: { passed: false, layer: 3, checks: [{ name: 'acceptanceTests', passed: false }] },
      };
      expect(svc.shouldDispute(result)).toBe('acceptance_test_failed');
    });
  });

  describe('autoOpenDispute', () => {
    it('creates a dispute without contracts', async () => {
      const svc = new DisputeService();
      const result = await svc.autoOpenDispute('order-1', 'del-1', 'content_hash_mismatch', {
        details: 'hash mismatch',
      });
      expect(result.disputeId).toMatch(/^dispute-/);
      expect(result.orderId).toBe('order-1');
      expect(result.deliverableId).toBe('del-1');
      expect(result.reason).toBe('content_hash_mismatch');
      expect(result.txHash).toBeUndefined();
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('attempts on-chain dispute with contracts', async () => {
      const mockWait = vi.fn().mockResolvedValue({ hash: '0xabc' });
      const mockContracts = {
        serviceContracts: {
          disputeContract: vi.fn().mockResolvedValue({ wait: mockWait }),
        },
      };
      const svc = new DisputeService(mockContracts as never);
      const result = await svc.autoOpenDispute('order-2', 'del-2', 'signature_invalid', {});
      expect(result.txHash).toBe('0xabc');
      expect(mockContracts.serviceContracts.disputeContract).toHaveBeenCalled();
    });

    it('gracefully handles on-chain failure', async () => {
      const mockContracts = {
        serviceContracts: {
          disputeContract: vi.fn().mockRejectedValue(new Error('tx reverted')),
        },
      };
      const svc = new DisputeService(mockContracts as never);
      const result = await svc.autoOpenDispute('order-3', 'del-3', 'content_hash_mismatch', {});
      expect(result.txHash).toBeUndefined();
      expect(result.disputeId).toMatch(/^dispute-/);
    });
  });

  describe('checkAndDispute', () => {
    it('returns null when verification passes', async () => {
      const svc = new DisputeService();
      const result: FullVerificationResult = {
        passed: true,
        layer1: { passed: true, layer: 1, checks: [] },
      };
      expect(await svc.checkAndDispute('o1', 'd1', result)).toBeNull();
    });

    it('opens dispute when verification fails', async () => {
      const svc = new DisputeService();
      const result: FullVerificationResult = {
        passed: false,
        layer1: {
          passed: false, layer: 1,
          checks: [{ name: 'contentHash', passed: false }],
        },
      };
      const dispute = await svc.checkAndDispute('o2', 'd2', result);
      expect(dispute).not.toBeNull();
      expect(dispute!.reason).toBe('content_hash_mismatch');
    });
  });
});
