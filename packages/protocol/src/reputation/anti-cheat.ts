import { ReputationRecord } from './state.js';

export type FraudSignalType =
  | 'self_review'
  | 'burst'
  | 'issuer_dominance'
  | 'outlier_score';

export type FraudSeverity = 'low' | 'medium' | 'high';

export interface FraudSignal {
  type: FraudSignalType;
  severity: FraudSeverity;
  details?: string;
}

export interface FraudDetectionOptions {
  windowMs: number;
  maxRecordsPerWindow: number;
  maxSameIssuerRatio: number;
  outlierThreshold: number;
  minRecordsForDominance: number;
}

export interface FraudDetectionResult {
  target: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  signals: FraudSignal[];
}

export const DEFAULT_FRAUD_OPTIONS: FraudDetectionOptions = {
  windowMs: 60 * 60 * 1000,
  maxRecordsPerWindow: 10,
  maxSameIssuerRatio: 0.6,
  outlierThreshold: 400,
  minRecordsForDominance: 5,
};

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function detectReputationFraud(
  records: ReputationRecord[],
  options: Partial<FraudDetectionOptions> = {},
  now: number = Date.now(),
): FraudDetectionResult {
  const config = { ...DEFAULT_FRAUD_OPTIONS, ...options };
  const target = records[0]?.target ?? '';
  const signals: FraudSignal[] = [];

  const hasSelfReview = records.some((record) => record.issuer === record.target);
  if (hasSelfReview) {
    signals.push({
      type: 'self_review',
      severity: 'high',
      details: 'issuer matches target',
    });
  }

  const recentCount = records.filter((record) => now - record.ts <= config.windowMs).length;
  if (recentCount > config.maxRecordsPerWindow) {
    signals.push({
      type: 'burst',
      severity: 'medium',
      details: `records in window: ${recentCount}`,
    });
  }

  if (records.length >= config.minRecordsForDominance) {
    const counts = new Map<string, number>();
    for (const record of records) {
      counts.set(record.issuer, (counts.get(record.issuer) ?? 0) + 1);
    }
    let max = 0;
    for (const count of counts.values()) {
      if (count > max) {
        max = count;
      }
    }
    const ratio = records.length ? max / records.length : 0;
    if (ratio >= config.maxSameIssuerRatio) {
      signals.push({
        type: 'issuer_dominance',
        severity: 'medium',
        details: `top issuer ratio: ${ratio.toFixed(2)}`,
      });
    }
  }

  if (records.length > 0) {
    const scores = records.map((record) => record.score);
    const mid = median(scores);
    const outlierCount = scores.filter((score) => Math.abs(score - mid) >= config.outlierThreshold)
      .length;
    if (outlierCount > 0) {
      signals.push({
        type: 'outlier_score',
        severity: outlierCount > 1 ? 'medium' : 'low',
        details: `outliers: ${outlierCount}`,
      });
    }
  }

  let riskScore = 0;
  for (const signal of signals) {
    switch (signal.type) {
      case 'self_review':
        riskScore += 0.4;
        break;
      case 'burst':
        riskScore += 0.25;
        break;
      case 'issuer_dominance':
        riskScore += 0.2;
        break;
      case 'outlier_score':
        riskScore += 0.15;
        break;
      default:
        break;
    }
  }
  riskScore = Math.min(1, riskScore);

  let riskLevel: FraudDetectionResult['riskLevel'] = 'low';
  if (riskScore >= 0.9) {
    riskLevel = 'critical';
  } else if (riskScore >= 0.7) {
    riskLevel = 'high';
  } else if (riskScore >= 0.4) {
    riskLevel = 'medium';
  }

  return {
    target,
    riskScore,
    riskLevel,
    signals,
  };
}
