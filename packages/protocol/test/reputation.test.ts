import { describe, expect, it } from 'vitest';
import { generateKeypair } from '@clawnet/core/crypto';
import { didFromPublicKey } from '@clawnet/core/identity';
import {
  applyReputationEvent,
  buildReputationProfile,
  calculateDimensionScore,
  calculateOverallScore,
  createReputationRecordEnvelope,
  createReputationState,
  decayWeight,
  DEFAULT_BASELINE_SCORE,
  DEFAULT_DIMENSION_WEIGHTS,
  detectReputationFraud,
  reputationLevelForScore,
} from '../src/reputation/index.js';

describe('reputation scoring', () => {
  it('decays weight over time', () => {
    const config = { halfLifeMs: 1000, minWeight: 0.1, maxAgeMs: 10000 };
    const now = 10_000;
    const fresh = decayWeight(now, now, config);
    const older = decayWeight(now - 1000, now, config);
    expect(older).toBeLessThan(fresh);
    expect(Number(older.toFixed(2))).toBe(0.5);
  });

  it('uses baseline when no records exist', () => {
    const score = calculateDimensionScore([], { baseline: DEFAULT_BASELINE_SCORE });
    expect(score).toBe(DEFAULT_BASELINE_SCORE);
  });

  it('calculates overall score with weights', () => {
    const overall = calculateOverallScore(
      { quality: 800 },
      DEFAULT_DIMENSION_WEIGHTS,
      DEFAULT_BASELINE_SCORE,
    );
    expect(overall).toBe(560);
  });

  it('maps score to reputation level', () => {
    expect(reputationLevelForScore(950)).toBe('legend');
    expect(reputationLevelForScore(850)).toBe('elite');
    expect(reputationLevelForScore(750)).toBe('expert');
    expect(reputationLevelForScore(500)).toBe('trusted');
    expect(reputationLevelForScore(300)).toBe('newcomer');
    expect(reputationLevelForScore(100)).toBe('observed');
    expect(reputationLevelForScore(50)).toBe('risky');
  });
});

describe('reputation state', () => {
  it('applies reputation record events', async () => {
    const issuerKeys = await generateKeypair();
    const targetKeys = await generateKeypair();
    const issuer = didFromPublicKey(issuerKeys.publicKey);
    const target = didFromPublicKey(targetKeys.publicKey);

    const envelope = await createReputationRecordEnvelope({
      issuer,
      privateKey: issuerKeys.privateKey,
      target,
      dimension: 'quality',
      score: 800,
      ref: 'contract-1',
      ts: 1_000,
      nonce: 1,
    });

    let state = createReputationState();
    state = applyReputationEvent(state, envelope);

    const profile = buildReputationProfile(state, target, { now: 1_000 });
    expect(profile.dimensions.quality.score).toBe(800);
    expect(profile.overallScore).toBe(560);
    expect(profile.level).toBe('trusted');
  });
});

describe('reputation anti-cheat', () => {
  it('flags self reviews and bursts', () => {
    const now = 5_000;
    const target = 'did:claw:self';
    const records = [
      {
        hash: 'a',
        issuer: target,
        target,
        dimension: 'transaction' as const,
        score: 900,
        ref: 'ref-1',
        ts: now - 100,
      },
      {
        hash: 'b',
        issuer: target,
        target,
        dimension: 'transaction' as const,
        score: 910,
        ref: 'ref-2',
        ts: now - 50,
      },
      {
        hash: 'c',
        issuer: target,
        target,
        dimension: 'transaction' as const,
        score: 920,
        ref: 'ref-3',
        ts: now - 10,
      },
    ];

    const result = detectReputationFraud(records, { maxRecordsPerWindow: 2 }, now);
    const types = result.signals.map((signal) => signal.type);
    expect(types).toContain('self_review');
    expect(types).toContain('burst');
    expect(result.riskLevel).not.toBe('low');
  });
});
