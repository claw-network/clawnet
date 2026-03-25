/**
 * Relay reward formula (F11) — computes relay incentive amounts.
 *
 * Formula:
 *   weightedBytes  = messagingConfirmedBytes × 1.0
 *                  + attachmentConfirmedBytes × 0.3
 *
 *   rewardAmount = baseRate
 *     × log2(1 + weightedBytes / 1 GB)
 *     × min(confirmedUniquePeers / 10, 3.0)
 *     × uptimeBonus
 *     × confirmationRatio
 *
 * Parameters:
 *   - baseRate: DAO-adjustable base Token/period (from ParamRegistry)
 *   - attachmentWeight: weight for attachment bytes (default 0.3)
 *   - uptimeBonus: min(consecutivePeriods / 30, 1.5)
 *   - confirmationRatio: confirmedBytes / claimedBytes (0..1)
 *   - maxRewardPerPeriod: hard cap per node per period
 */

// ── Types ──────────────────────────────────────────────────────

export interface RewardInput {
  /** Messaging bytes confirmed by co-signers. */
  messagingConfirmedBytes: number;
  /** Attachment bytes confirmed by co-signers. */
  attachmentConfirmedBytes: number;
  /** Total bytes claimed by the relay (before confirmation). */
  claimedBytes: number;
  /** Number of unique peers that provided co-sign confirmations. */
  confirmedUniquePeers: number;
  /** Number of consecutive periods this relay has been online. */
  consecutivePeriods: number;
}

export interface RewardParams {
  /** Base reward rate (Token per period). */
  baseRate: number;
  /** Weight for attachment bytes (0..1). Default: 0.3 */
  attachmentWeight: number;
  /** Maximum reward per node per period. */
  maxRewardPerPeriod: number;
  /** Minimum bytes threshold to qualify for reward. */
  minBytesThreshold: number;
  /** Minimum confirmed peers to qualify for reward. */
  minPeersThreshold: number;
}

export interface RewardResult {
  /** Computed reward amount (integer Token). */
  rewardAmount: number;
  /** Whether the relay met the minimum thresholds. */
  eligible: boolean;
  /** Breakdown of the reward computation. */
  breakdown: {
    weightedBytes: number;
    byteFactor: number;
    peerFactor: number;
    uptimeBonus: number;
    confirmationRatio: number;
    rawReward: number;
    capped: boolean;
  };
}

// ── Constants ──────────────────────────────────────────────────

const ONE_GB = 1_073_741_824; // 1 GiB in bytes

export const DEFAULT_REWARD_PARAMS: RewardParams = {
  baseRate: 100,            // 100 Token per period
  attachmentWeight: 0.3,
  maxRewardPerPeriod: 1000, // 10× base rate
  minBytesThreshold: 1_048_576, // 1 MB minimum
  minPeersThreshold: 1,
};

// ── Core computation ───────────────────────────────────────────

/**
 * Compute the relay reward for a single period.
 * Returns integer Token amount (floored) and eligibility.
 */
export function computeRelayReward(
  input: RewardInput,
  params: RewardParams = DEFAULT_REWARD_PARAMS,
): RewardResult {
  const totalConfirmed = input.messagingConfirmedBytes + input.attachmentConfirmedBytes;

  // Eligibility check
  if (
    totalConfirmed < params.minBytesThreshold ||
    input.confirmedUniquePeers < params.minPeersThreshold
  ) {
    return {
      rewardAmount: 0,
      eligible: false,
      breakdown: {
        weightedBytes: 0,
        byteFactor: 0,
        peerFactor: 0,
        uptimeBonus: 0,
        confirmationRatio: 0,
        rawReward: 0,
        capped: false,
      },
    };
  }

  // Weighted bytes: messaging × 1.0 + attachment × attachmentWeight
  const weightedBytes =
    input.messagingConfirmedBytes +
    input.attachmentConfirmedBytes * params.attachmentWeight;

  // Byte factor: log2(1 + weightedBytes / 1 GB)
  const byteFactor = Math.log2(1 + weightedBytes / ONE_GB);

  // Peer factor: min(confirmedUniquePeers / 10, 3.0)
  const peerFactor = Math.min(input.confirmedUniquePeers / 10, 3.0);

  // Uptime bonus: min(consecutivePeriods / 30, 1.5)
  const uptimeBonus = Math.min(input.consecutivePeriods / 30, 1.5);

  // Confirmation ratio: confirmedBytes / claimedBytes (0..1)
  const confirmationRatio = input.claimedBytes > 0
    ? Math.min(totalConfirmed / input.claimedBytes, 1.0)
    : 0;

  // Raw reward
  const rawReward = params.baseRate * byteFactor * peerFactor * uptimeBonus * confirmationRatio;

  // Cap and floor
  const capped = rawReward > params.maxRewardPerPeriod;
  const rewardAmount = Math.floor(Math.min(rawReward, params.maxRewardPerPeriod));

  return {
    rewardAmount,
    eligible: true,
    breakdown: {
      weightedBytes,
      byteFactor,
      peerFactor,
      uptimeBonus,
      confirmationRatio,
      rawReward,
      capped,
    },
  };
}
