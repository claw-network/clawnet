/**
 * Tests for SlaMonitor — Phase 3 SLA monitoring and violation detection.
 */

import { describe, it, expect, vi } from 'vitest';
import { SlaMonitor, type UsageRecord } from '../../src/services/sla-monitor.js';

function makeRecord(leaseId: string, overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    leaseId,
    resource: '/api/predict',
    units: 1,
    latency: 50,
    success: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('SlaMonitor', () => {
  describe('getMetrics', () => {
    it('returns null for unknown lease', () => {
      const mon = new SlaMonitor();
      expect(mon.getMetrics('unknown')).toBeNull();
    });

    it('computes metrics after recording usage', async () => {
      const mon = new SlaMonitor();
      for (let i = 0; i < 20; i++) {
        await mon.recordUsage(makeRecord('l1', { latency: i * 10, success: i < 18 }));
      }
      const m = mon.getMetrics('l1');
      expect(m).not.toBeNull();
      expect(m!.totalCalls).toBe(20);
      expect(m!.successfulCalls).toBe(18);
      expect(m!.failedCalls).toBe(2);
      expect(m!.successRate).toBe(0.9);
      expect(m!.p99Latency).toBeGreaterThan(0);
    });
  });

  describe('violation detection', () => {
    it('detects latency violation', async () => {
      const mon = new SlaMonitor();
      mon.registerLease('l2', { maxLatencyMs: 100 });

      // Record enough high-latency calls
      for (let i = 0; i < 15; i++) {
        await mon.recordUsage(makeRecord('l2', { latency: 200 }));
      }

      const m = mon.getMetrics('l2');
      expect(m!.p99Latency).toBeGreaterThan(100);
    });

    it('detects success rate violation', async () => {
      const mockDispute = {
        autoOpenDispute: vi.fn().mockResolvedValue({ disputeId: 'disp-1' }),
      };
      const mon = new SlaMonitor(mockDispute as never);
      mon.registerLease('l3', { minSuccessRate: 0.95 });

      // Record 15 calls, 5 failures (67% success)
      for (let i = 0; i < 15; i++) {
        await mon.recordUsage(makeRecord('l3', { success: i < 10 }));
      }

      expect(mockDispute.autoOpenDispute).toHaveBeenCalledWith(
        'l3', 'l3', 'sla_violation',
        expect.objectContaining({ details: expect.stringContaining('success_rate') }),
      );
    });

    it('no violation when thresholds met', async () => {
      const mon = new SlaMonitor();
      mon.registerLease('l4', { maxLatencyMs: 1000, minSuccessRate: 0.5 });

      for (let i = 0; i < 15; i++) {
        await mon.recordUsage(makeRecord('l4', { latency: 50, success: true }));
      }

      const m = mon.getMetrics('l4');
      expect(m!.successRate).toBe(1);
      expect(m!.p99Latency).toBeLessThanOrEqual(1000);
    });

    it('ignores leases without registered thresholds', async () => {
      const mon = new SlaMonitor();
      // No registerLease call - should never violate
      for (let i = 0; i < 15; i++) {
        const violation = await mon.recordUsage(makeRecord('l5', { latency: 99999 }));
        expect(violation).toBeNull();
      }
    });

    it('needs minimum sample size before checking', async () => {
      const mon = new SlaMonitor();
      mon.registerLease('l6', { maxLatencyMs: 10 });
      // Only 5 records - below minimum of 10
      for (let i = 0; i < 5; i++) {
        const violation = await mon.recordUsage(makeRecord('l6', { latency: 99999 }));
        expect(violation).toBeNull();
      }
    });
  });

  describe('ring buffer', () => {
    it('caps records per lease', async () => {
      const mon = new SlaMonitor(undefined, { maxRecordsPerLease: 50 });
      for (let i = 0; i < 100; i++) {
        await mon.recordUsage(makeRecord('l7'));
      }
      const m = mon.getMetrics('l7');
      expect(m!.totalCalls).toBe(50);
    });
  });
});
