/**
 * SLA Monitor Service — tracks capability usage against SLA thresholds.
 *
 * Aggregates CapabilityUsageRecord metrics per lease, detects SLA violations
 * (latency, success rate), and triggers auto-disputes.
 *
 * Spec: docs/implementation/deliverable-spec.md §3.4
 */

import { createLogger } from '../logger.js';
import type { DisputeService } from './dispute-service.js';

type Logger = ReturnType<typeof createLogger>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlaThresholds {
  /** Max P99 latency in milliseconds */
  maxLatencyMs?: number;
  /** Minimum success rate (0.0 – 1.0) */
  minSuccessRate?: number;
  /** Max monthly downtime in seconds */
  maxMonthlyDowntimeSec?: number;
}

export interface UsageRecord {
  leaseId: string;
  resource: string;
  units: number;
  latency: number;
  success: boolean;
  timestamp: number;
}

export interface SlaMetrics {
  leaseId: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  successRate: number;
  latencies: number[];
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  windowStartMs: number;
  windowEndMs: number;
}

export interface SlaViolation {
  leaseId: string;
  type: 'latency' | 'success_rate' | 'downtime';
  threshold: number;
  actual: number;
  detectedAt: number;
}

// ---------------------------------------------------------------------------
// SlaMonitor
// ---------------------------------------------------------------------------

export class SlaMonitor {
  private readonly log: Logger;
  /** Usage records per lease (bounded ring buffer per lease) */
  private readonly records = new Map<string, UsageRecord[]>();
  /** SLA thresholds per lease */
  private readonly thresholds = new Map<string, SlaThresholds>();
  /** Max records to keep per lease */
  private readonly maxRecordsPerLease: number;

  constructor(
    private readonly disputeService?: DisputeService,
    opts?: { maxRecordsPerLease?: number; logger?: Logger },
  ) {
    this.log = opts?.logger ?? createLogger({ level: 'info' });
    this.maxRecordsPerLease = opts?.maxRecordsPerLease ?? 10_000;
  }

  /**
   * Register SLA thresholds for a lease.
   */
  registerLease(leaseId: string, thresholds: SlaThresholds): void {
    this.thresholds.set(leaseId, thresholds);
  }

  /**
   * Record a capability usage event and check for SLA violations.
   */
  async recordUsage(record: UsageRecord): Promise<SlaViolation | null> {
    let bucket = this.records.get(record.leaseId);
    if (!bucket) {
      bucket = [];
      this.records.set(record.leaseId, bucket);
    }

    bucket.push(record);
    // Ring buffer: drop oldest when exceeding limit
    if (bucket.length > this.maxRecordsPerLease) {
      bucket.splice(0, bucket.length - this.maxRecordsPerLease);
    }

    return this.checkViolation(record.leaseId);
  }

  /**
   * Get current SLA metrics for a lease.
   */
  getMetrics(leaseId: string): SlaMetrics | null {
    const bucket = this.records.get(leaseId);
    if (!bucket || bucket.length === 0) return null;

    const successfulCalls = bucket.filter(r => r.success).length;
    const latencies = bucket.map(r => r.latency).sort((a, b) => a - b);

    return {
      leaseId,
      totalCalls: bucket.length,
      successfulCalls,
      failedCalls: bucket.length - successfulCalls,
      successRate: bucket.length > 0 ? successfulCalls / bucket.length : 1,
      latencies,
      p50Latency: percentile(latencies, 50),
      p95Latency: percentile(latencies, 95),
      p99Latency: percentile(latencies, 99),
      windowStartMs: bucket[0].timestamp,
      windowEndMs: bucket[bucket.length - 1].timestamp,
    };
  }

  /**
   * Check if current metrics violate SLA thresholds.
   */
  private async checkViolation(leaseId: string): Promise<SlaViolation | null> {
    const sla = this.thresholds.get(leaseId);
    if (!sla) return null;

    const metrics = this.getMetrics(leaseId);
    if (!metrics || metrics.totalCalls < 10) return null; // need minimum sample

    // Check P99 latency
    if (sla.maxLatencyMs != null && metrics.p99Latency > sla.maxLatencyMs) {
      const violation: SlaViolation = {
        leaseId,
        type: 'latency',
        threshold: sla.maxLatencyMs,
        actual: metrics.p99Latency,
        detectedAt: Date.now(),
      };
      await this.handleViolation(violation);
      return violation;
    }

    // Check success rate
    if (sla.minSuccessRate != null && metrics.successRate < sla.minSuccessRate) {
      const violation: SlaViolation = {
        leaseId,
        type: 'success_rate',
        threshold: sla.minSuccessRate,
        actual: metrics.successRate,
        detectedAt: Date.now(),
      };
      await this.handleViolation(violation);
      return violation;
    }

    return null;
  }

  private async handleViolation(violation: SlaViolation): Promise<void> {
    this.log.warn(
      'SLA violation: lease=%s type=%s threshold=%s actual=%s',
      violation.leaseId,
      violation.type,
      violation.threshold,
      violation.actual,
    );

    if (this.disputeService) {
      await this.disputeService.autoOpenDispute(
        violation.leaseId,
        violation.leaseId,
        'sla_violation',
        { details: `${violation.type}: threshold=${violation.threshold}, actual=${violation.actual}` },
      );
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
