/**
 * Tests for relay-reward.ts — F11 reward formula utility.
 */
import { describe, expect, it } from 'vitest';
import {
  computeRelayReward,
  DEFAULT_REWARD_PARAMS,
  type RewardInput,
  type RewardParams,
} from '../src/p2p/relay-reward.js';

describe('relay reward formula', () => {
  const defaultInput: RewardInput = {
    messagingConfirmedBytes: 500_000_000, // 500 MB
    attachmentConfirmedBytes: 200_000_000, // 200 MB
    claimedBytes: 700_000_000,
    confirmedUniquePeers: 5,
    consecutivePeriods: 15,
  };

  it('computes a positive reward for valid input', () => {
    const result = computeRelayReward(defaultInput);
    expect(result.eligible).toBe(true);
    expect(result.rewardAmount).toBeGreaterThan(0);
  });

  it('returns ineligible when below minimum bytes threshold', () => {
    const result = computeRelayReward({
      ...defaultInput,
      messagingConfirmedBytes: 100,
      attachmentConfirmedBytes: 0,
      claimedBytes: 100,
    });
    expect(result.eligible).toBe(false);
    expect(result.rewardAmount).toBe(0);
  });

  it('returns ineligible when below minimum peers threshold', () => {
    const params: RewardParams = { ...DEFAULT_REWARD_PARAMS, minPeersThreshold: 3 };
    const result = computeRelayReward(
      { ...defaultInput, confirmedUniquePeers: 2 },
      params,
    );
    expect(result.eligible).toBe(false);
    expect(result.rewardAmount).toBe(0);
  });

  it('applies attachment weight (0.3) to attachment bytes', () => {
    // All messaging
    const allMessaging = computeRelayReward({
      ...defaultInput,
      messagingConfirmedBytes: 700_000_000,
      attachmentConfirmedBytes: 0,
      claimedBytes: 700_000_000,
    });
    // All attachment (same total bytes)
    const allAttachment = computeRelayReward({
      ...defaultInput,
      messagingConfirmedBytes: 0,
      attachmentConfirmedBytes: 700_000_000,
      claimedBytes: 700_000_000,
    });
    // Attachment should give less reward
    expect(allMessaging.rewardAmount).toBeGreaterThan(allAttachment.rewardAmount);
    expect(allAttachment.breakdown.weightedBytes).toBe(700_000_000 * 0.3);
  });

  it('caps reward at maxRewardPerPeriod', () => {
    const params: RewardParams = { ...DEFAULT_REWARD_PARAMS, maxRewardPerPeriod: 10 };
    const result = computeRelayReward(defaultInput, params);
    expect(result.eligible).toBe(true);
    expect(result.rewardAmount).toBeLessThanOrEqual(10);
    expect(result.breakdown.capped).toBe(true);
  });

  it('peer factor caps at 3.0', () => {
    const r30 = computeRelayReward({ ...defaultInput, confirmedUniquePeers: 30 });
    const r50 = computeRelayReward({ ...defaultInput, confirmedUniquePeers: 50 });
    // Both should have peer factor = 3.0, so same reward
    expect(r30.breakdown.peerFactor).toBe(3.0);
    expect(r50.breakdown.peerFactor).toBe(3.0);
    expect(r30.rewardAmount).toBe(r50.rewardAmount);
  });

  it('uptime bonus caps at 1.5', () => {
    const r30 = computeRelayReward({ ...defaultInput, consecutivePeriods: 30 });
    const r60 = computeRelayReward({ ...defaultInput, consecutivePeriods: 60 });
    expect(r30.breakdown.uptimeBonus).toBe(1.0);
    expect(r60.breakdown.uptimeBonus).toBe(1.5);
    // r60 should have higher reward than r30 due to uptime bonus
    expect(r60.rewardAmount).toBeGreaterThanOrEqual(r30.rewardAmount);
  });

  it('confirmation ratio reduces reward when partial', () => {
    const full = computeRelayReward({
      ...defaultInput,
      claimedBytes: 700_000_000, // confirmed == claimed
    });
    const partial = computeRelayReward({
      ...defaultInput,
      claimedBytes: 1_400_000_000, // only 50% confirmed
    });
    expect(full.breakdown.confirmationRatio).toBe(1.0);
    expect(partial.breakdown.confirmationRatio).toBeCloseTo(0.5, 2);
    expect(full.rewardAmount).toBeGreaterThan(partial.rewardAmount);
  });

  it('floors reward to integer', () => {
    const result = computeRelayReward(defaultInput);
    expect(result.rewardAmount).toBe(Math.floor(result.rewardAmount));
    expect(Number.isInteger(result.rewardAmount)).toBe(true);
  });
});
