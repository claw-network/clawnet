import { multibaseEncode } from '@clawtoken/core/encoding';
import { publicKeyFromDid } from '@clawtoken/core/identity';
import { EventEnvelope, eventHashHex, signEvent } from '@clawtoken/core/protocol';
import { isReputationDimension, normalizeScore, ReputationDimension } from './scoring.js';

export interface ReputationRecordPayload extends Record<string, unknown> {
  target: string;
  dimension: ReputationDimension;
  score: number;
  ref: string;
}

export interface ReputationRecordEventParams {
  issuer: string;
  privateKey: Uint8Array;
  target: string;
  dimension: ReputationDimension;
  score: number;
  ref: string;
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
  } catch (error) {
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

  assertValidDid(target, 'target');
  if (!isReputationDimension(dimensionValue)) {
    throw new Error('dimension must be a supported reputation dimension');
  }
  if (!Number.isFinite(rawScore)) {
    throw new Error('score must be a number');
  }
  const score = normalizeScore(rawScore, 'score');
  requireNonEmpty(ref, 'ref');

  return {
    target,
    dimension: dimensionValue,
    score,
    ref,
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
