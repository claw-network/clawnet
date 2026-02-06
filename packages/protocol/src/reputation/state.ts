import { EventEnvelope, eventHashHex } from '@clawtoken/core/protocol';
import { parseReputationRecordPayload, ReputationRecordPayload } from './events.js';
import {
  calculateDimensionScore,
  calculateOverallScore,
  DEFAULT_BASELINE_SCORE,
  DEFAULT_DECAY_CONFIG,
  DEFAULT_DIMENSION_WEIGHTS,
  DecayConfig,
  ReputationDimension,
  ReputationDimensionScores,
  ReputationDimensionWeights,
  ReputationLevel,
  reputationLevelForScore,
  REPUTATION_DIMENSIONS,
} from './scoring.js';

export interface ReputationRecord {
  hash: string;
  issuer: string;
  target: string;
  dimension: ReputationDimension;
  score: number;
  ref: string;
  ts: number;
}

export interface ReputationState {
  records: ReputationRecord[];
  recordsByTarget: Record<string, ReputationRecord[]>;
  recordIndex: Set<string>;
}

export interface ReputationDimensionSummary {
  score: number;
  recordCount: number;
  lastUpdatedAt: number | null;
}

export interface ReputationProfile {
  did: string;
  dimensions: Record<ReputationDimension, ReputationDimensionSummary>;
  overallScore: number;
  level: ReputationLevel;
  updatedAt: number | null;
}

export interface ReputationProfileOptions {
  now?: number;
  weights?: ReputationDimensionWeights;
  decay?: DecayConfig;
  baseline?: number;
}

export function createReputationState(): ReputationState {
  return {
    records: [],
    recordsByTarget: {},
    recordIndex: new Set(),
  };
}

function cloneState(state: ReputationState): ReputationState {
  return {
    records: [...state.records],
    recordsByTarget: { ...state.recordsByTarget },
    recordIndex: new Set(state.recordIndex),
  };
}

export function addReputationRecord(
  state: ReputationState,
  record: ReputationRecord,
): ReputationState {
  if (state.recordIndex.has(record.hash)) {
    return state;
  }
  const next = cloneState(state);
  next.recordIndex.add(record.hash);
  next.records.push(record);
  const current = state.recordsByTarget[record.target] ?? [];
  next.recordsByTarget[record.target] = [...current, record];
  return next;
}

export function mergeReputationRecords(
  state: ReputationState,
  records: ReputationRecord[],
): { state: ReputationState; added: number } {
  let next = state;
  let added = 0;
  for (const record of records) {
    const updated = addReputationRecord(next, record);
    if (updated !== next) {
      next = updated;
      added += 1;
    }
  }
  return { state: next, added };
}

export function applyReputationEvent(
  state: ReputationState,
  envelope: EventEnvelope,
): ReputationState {
  if (String(envelope.type ?? '') !== 'reputation.record') {
    return state;
  }
  const issuer = typeof envelope.issuer === 'string' ? envelope.issuer : '';
  if (!issuer) {
    throw new Error('reputation record missing issuer');
  }
  const payload = parseReputationRecordPayload(
    (envelope.payload ?? {}) as Record<string, unknown>,
  );
  const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
  const hash =
    typeof envelope.hash === 'string' && envelope.hash.length
      ? envelope.hash
      : eventHashHex(envelope);
  const record: ReputationRecord = {
    hash,
    issuer,
    target: payload.target,
    dimension: payload.dimension,
    score: payload.score,
    ref: payload.ref,
    ts,
  };
  return addReputationRecord(state, record);
}

export function getReputationRecords(
  state: ReputationState,
  target: string,
  dimension?: ReputationDimension,
): ReputationRecord[] {
  const list = state.recordsByTarget[target] ?? [];
  if (!dimension) {
    return [...list];
  }
  return list.filter((record) => record.dimension === dimension);
}

export function buildReputationProfile(
  state: ReputationState,
  target: string,
  options: ReputationProfileOptions = {},
): ReputationProfile {
  const records = getReputationRecords(state, target);
  const now = options.now ?? Date.now();
  const decay = options.decay ?? DEFAULT_DECAY_CONFIG;
  const baseline = options.baseline ?? DEFAULT_BASELINE_SCORE;
  const weights = options.weights ?? DEFAULT_DIMENSION_WEIGHTS;

  const byDimension = new Map<ReputationDimension, ReputationRecord[]>();
  for (const dimension of REPUTATION_DIMENSIONS) {
    byDimension.set(dimension, []);
  }
  for (const record of records) {
    const list = byDimension.get(record.dimension);
    if (list) {
      list.push(record);
    }
  }

  const dimensions = {} as Record<ReputationDimension, ReputationDimensionSummary>;
  let updatedAt: number | null = null;
  const scoreMap = {} as ReputationDimensionScores;

  for (const dimension of REPUTATION_DIMENSIONS) {
    const list = byDimension.get(dimension) ?? [];
    const score = calculateDimensionScore(list, { now, decay, baseline });
    let lastUpdatedAt: number | null = null;
    for (const record of list) {
      if (lastUpdatedAt === null || record.ts > lastUpdatedAt) {
        lastUpdatedAt = record.ts;
      }
    }
    if (lastUpdatedAt !== null && (updatedAt === null || lastUpdatedAt > updatedAt)) {
      updatedAt = lastUpdatedAt;
    }
    dimensions[dimension] = {
      score,
      recordCount: list.length,
      lastUpdatedAt,
    };
    scoreMap[dimension] = score;
  }

  const overallScore = calculateOverallScore(scoreMap, weights, baseline);
  const level = reputationLevelForScore(overallScore);

  return {
    did: target,
    dimensions,
    overallScore,
    level,
    updatedAt,
  };
}

export function recordFromPayload(
  payload: ReputationRecordPayload,
  issuer: string,
  ts: number,
  hash: string,
): ReputationRecord {
  return {
    hash,
    issuer,
    target: payload.target,
    dimension: payload.dimension,
    score: payload.score,
    ref: payload.ref,
    ts,
  };
}
