import { multibaseEncode } from '@claw-network/core/encoding';
import { publicKeyFromDid } from '@claw-network/core/identity';
import { EventEnvelope, eventHashHex, signEvent } from '@claw-network/core/protocol';
import { isReputationDimension, normalizeScore, ReputationDimension } from './scoring.js';

export const REPUTATION_ASPECT_KEYS = [
  'communication',
  'quality',
  'timeliness',
  'professionalism',
] as const;

export type ReputationAspectKey = (typeof REPUTATION_ASPECT_KEYS)[number];

export function isReputationAspectKey(value: string): value is ReputationAspectKey {
  return (REPUTATION_ASPECT_KEYS as readonly string[]).includes(value);
}

export interface ReputationRecordPayload extends Record<string, unknown> {
  target: string;
  dimension: ReputationDimension;
  score: number;
  ref: string;
  comment?: string;
  aspects?: Record<ReputationAspectKey, number>;
}

export interface ReputationRecordEventParams {
  issuer: string;
  privateKey: Uint8Array;
  target: string;
  dimension: ReputationDimension;
  score: number;
  ref: string;
  comment?: string;
  aspects?: Record<ReputationAspectKey, number>;
  ts: number;
  nonce: number;
  prev?: string;
}

function requireNonEmpty(value: string, field: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function assertValidDid(value: string, field: string): void {
  requireNonEmpty(value, field);
  try {
    publicKeyFromDid(value);
  } catch {
    throw new Error(`${field} must be a valid did:claw identifier`);
  }
}

function parseScore(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return Number(value);
  }
  return Number.NaN;
}

export function parseReputationRecordPayload(
  payload: Record<string, unknown>,
): ReputationRecordPayload {
  const target = String(payload.target ?? '');
  const dimensionValue = String(payload.dimension ?? '');
  const ref = String(payload.ref ?? '');
  const rawScore = parseScore(payload.score);
  const rawComment = payload.comment;
  const rawAspects = payload.aspects;

  assertValidDid(target, 'target');
  if (!isReputationDimension(dimensionValue)) {
    throw new Error('dimension must be a supported reputation dimension');
  }
  if (!Number.isFinite(rawScore)) {
    throw new Error('score must be a number');
  }
  const score = normalizeScore(rawScore, 'score');
  requireNonEmpty(ref, 'ref');

  let comment: string | undefined;
  if (rawComment !== undefined && rawComment !== null) {
    if (typeof rawComment !== 'string') {
      throw new Error('comment must be a string');
    }
    const trimmed = rawComment.trim();
    if (trimmed.length) {
      comment = trimmed;
    }
  }

  let aspects: Record<ReputationAspectKey, number> | undefined;
  if (rawAspects !== undefined && rawAspects !== null) {
    if (typeof rawAspects !== 'object' || Array.isArray(rawAspects)) {
      throw new Error('aspects must be an object');
    }
    const entries = Object.entries(rawAspects as Record<string, unknown>);
    if (entries.length) {
      aspects = {} as Record<ReputationAspectKey, number>;
      for (const [key, value] of entries) {
        if (!isReputationAspectKey(key)) {
          throw new Error(`aspect ${key} is not supported`);
        }
        const numeric = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
          throw new Error(`aspect ${key} must be an integer`);
        }
        if (numeric < 1 || numeric > 5) {
          throw new Error(`aspect ${key} must be between 1 and 5`);
        }
        aspects[key] = numeric;
      }
    }
  }

  return {
    target,
    dimension: dimensionValue,
    score,
    ref,
    comment,
    aspects,
  };
}

export async function createReputationRecordEnvelope(
  params: ReputationRecordEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const publicKey = publicKeyFromDid(params.issuer);
  const payload = parseReputationRecordPayload({
    target: params.target,
    dimension: params.dimension,
    score: params.score,
    ref: params.ref,
    comment: params.comment,
    aspects: params.aspects,
  });

  const baseEnvelope: EventEnvelope = {
    v: 1,
    type: 'reputation.record',
    issuer: params.issuer,
    ts: params.ts,
    nonce: params.nonce,
    payload,
    prev: params.prev,
    sig: '',
    pub: multibaseEncode(publicKey),
    hash: '',
  };

  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}
