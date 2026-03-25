export const REPUTATION_DIMENSIONS = [
  'transaction',
  'fulfillment',
  'quality',
  'social',
  'behavior',
] as const;

export type ReputationDimension = (typeof REPUTATION_DIMENSIONS)[number];

export function isReputationDimension(value: string): value is ReputationDimension {
  return (REPUTATION_DIMENSIONS as readonly string[]).includes(value);
}

export type ReputationLevel =
  | 'legend'
  | 'elite'
  | 'expert'
  | 'trusted'
  | 'newcomer'
  | 'observed'
  | 'risky';

export interface ReputationDimensionWeights {
  transaction: number;
  fulfillment: number;
  quality: number;
  social: number;
  behavior: number;
}

export const DEFAULT_DIMENSION_WEIGHTS: ReputationDimensionWeights = {
  transaction: 0.25,
  fulfillment: 0.3,
  quality: 0.2,
  social: 0.15,
  behavior: 0.1,
};

export interface DecayConfig {
  halfLifeMs: number;
  minWeight: number;
  maxAgeMs: number;
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  halfLifeMs: 180 * 24 * 60 * 60 * 1000,
  minWeight: 0.1,
  maxAgeMs: 2 * 365 * 24 * 60 * 60 * 1000,
};

export const DEFAULT_BASELINE_SCORE = 500;

export function normalizeScore(value: number, field = 'score'): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
  if (value < 0 || value > 1000) {
    throw new Error(`${field} must be between 0 and 1000`);
  }
  return value;
}

export function clampScore(value: number, fallback = DEFAULT_BASELINE_SCORE): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1000, Math.round(value)));
}

export function decayWeight(
  timestamp: number,
  now: number = Date.now(),
  config: DecayConfig = DEFAULT_DECAY_CONFIG,
): number {
  const age = Math.max(0, now - timestamp);
  if (!Number.isFinite(age)) {
    return config.minWeight;
  }
  if (age > config.maxAgeMs) {
    return 0;
  }
  if (config.halfLifeMs <= 0) {
    return 1;
  }
  const raw = Math.pow(0.5, age / config.halfLifeMs);
  return Math.max(config.minWeight, raw);
}

export interface ScoredRecord {
  score: number;
  ts: number;
}

export function calculateDecayedAverage(
  records: ScoredRecord[],
  options: { now?: number; decay?: DecayConfig; baseline?: number } = {},
): number {
  const baseline = options.baseline ?? DEFAULT_BASELINE_SCORE;
  if (!records.length) {
    return clampScore(baseline, baseline);
  }
  const now = options.now ?? Date.now();
  const decay = options.decay ?? DEFAULT_DECAY_CONFIG;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const record of records) {
    const weight = decayWeight(record.ts, now, decay);
    if (weight <= 0) {
      continue;
    }
    weightedSum += record.score * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) {
    return clampScore(baseline, baseline);
  }
  return clampScore(weightedSum / totalWeight, baseline);
}

export type ReputationDimensionScores = Record<ReputationDimension, number>;

export function calculateDimensionScore(
  records: ScoredRecord[],
  options: { now?: number; decay?: DecayConfig; baseline?: number } = {},
): number {
  return calculateDecayedAverage(records, options);
}

export function calculateOverallScore(
  scores: Partial<ReputationDimensionScores>,
  weights: ReputationDimensionWeights = DEFAULT_DIMENSION_WEIGHTS,
  baseline: number = DEFAULT_BASELINE_SCORE,
): number {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const dimension of REPUTATION_DIMENSIONS) {
    const weight = weights[dimension] ?? 0;
    const score = scores[dimension] ?? baseline;
    weightedSum += score * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0) {
    return clampScore(baseline, baseline);
  }
  return clampScore(weightedSum / totalWeight, baseline);
}

export function reputationLevelForScore(score: number): ReputationLevel {
  const normalized = clampScore(score, DEFAULT_BASELINE_SCORE);
  if (normalized >= 900) {
    return 'legend';
  }
  if (normalized >= 800) {
    return 'elite';
  }
  if (normalized >= 700) {
    return 'expert';
  }
  if (normalized >= 500) {
    return 'trusted';
  }
  if (normalized >= 300) {
    return 'newcomer';
  }
  if (normalized >= 100) {
    return 'observed';
  }
  return 'risky';
}
