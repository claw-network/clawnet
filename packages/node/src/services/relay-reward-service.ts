/**
 * RelayRewardService — orchestrates on-chain relay reward claims.
 *
 * Flow per period:
 *   1. RelayService generates a period proof (with co-sign confirmations).
 *   2. computeRelayReward() calculates the reward amount off-chain.
 *   3. This service submits `claimReward()` to ClawRelayReward contract.
 *
 * The service exposes methods for:
 *   - Manual claim (triggered via API)
 *   - Querying on-chain reward state (params, pool balance, claim history)
 */

import { keccak256, toUtf8Bytes } from 'ethers';

import {
  computeRelayReward,
  type RewardInput,
  type RewardResult,
} from '@claw-network/core';

import { createLogger } from '../logger.js';
import type { ContractProvider } from './contract-provider.js';
import type { RelayService, RelayPeriodProof } from './relay-service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Logger = ReturnType<typeof createLogger>;

export interface ClaimResult {
  txHash: string;
  periodId: number;
  rewardAmount: string;
  confirmedBytes: string;
  confirmedPeers: number;
}

export interface RelayRewardStatus {
  poolBalance: string;
  totalDistributed: string;
  lastClaimedPeriod: number;
  params: {
    baseRate: number;
    maxRewardPerPeriod: number;
    minBytesThreshold: number;
    minPeersThreshold: number;
    attachmentWeightBps: number;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RelayRewardService {
  private readonly log: Logger;
  private readonly contracts: ContractProvider;
  private readonly relayService: RelayService;
  private readonly relayDid: string;

  /** Number of consecutive periods claimed (for uptime bonus). */
  private consecutivePeriods = 0;

  constructor(opts: {
    contracts: ContractProvider;
    relayService: RelayService;
    relayDid: string;
    logger?: Logger;
  }) {
    this.contracts = opts.contracts;
    this.relayService = opts.relayService;
    this.relayDid = opts.relayDid;
    this.log = opts.logger ?? createLogger({ level: 'info' });
  }

  /**
   * Claim the reward for the most recent period proof.
   * Computes reward off-chain and submits to the contract.
   */
  async claimReward(proof: RelayPeriodProof): Promise<ClaimResult> {
    const contract = this.contracts.relayReward;
    if (!contract) {
      throw new Error('ClawRelayReward contract not available');
    }

    // Compute reward off-chain
    const confirmations = proof.peerConfirmations;
    const totalConfirmedBytes = confirmations.reduce(
      (sum, c) => sum + c.bytesConfirmed,
      0,
    );

    const rewardInput: RewardInput = {
      messagingConfirmedBytes: Math.max(
        0,
        totalConfirmedBytes - proof.attachmentBytesRelayed,
      ),
      attachmentConfirmedBytes: Math.min(
        proof.attachmentBytesRelayed,
        totalConfirmedBytes,
      ),
      claimedBytes: proof.bytesRelayed,
      confirmedUniquePeers: confirmations.length,
      consecutivePeriods: this.consecutivePeriods,
    };

    const result: RewardResult = computeRelayReward(rewardInput);

    if (!result.eligible || result.rewardAmount === 0) {
      this.log.info(
        'Period %d: not eligible for reward (bytes=%d, peers=%d)',
        proof.periodId,
        totalConfirmedBytes,
        confirmations.length,
      );
      this.consecutivePeriods = 0;
      throw new Error('Not eligible for reward this period');
    }

    // Build on-chain confirmation structs
    const relayDidHash = keccak256(toUtf8Bytes(this.relayDid));
    const onChainConfirmations = confirmations.map((c) => ({
      peerDidHash: keccak256(toUtf8Bytes(c.peerDid)),
      bytesConfirmed: c.bytesConfirmed,
      circuitsConfirmed: c.circuitsConfirmed,
      signature: toUtf8Bytes(c.signature),
    }));

    const messagingBytes = rewardInput.messagingConfirmedBytes;
    const attachmentBytes = rewardInput.attachmentConfirmedBytes;

    this.log.info(
      'Claiming period %d: reward=%d Token, bytes=%d, peers=%d',
      proof.periodId,
      result.rewardAmount,
      totalConfirmedBytes,
      confirmations.length,
    );

    const tx = await contract.claimReward(
      relayDidHash,
      proof.periodId,
      messagingBytes,
      attachmentBytes,
      proof.circuitsServed,
      result.rewardAmount,
      onChainConfirmations,
    );
    const receipt = await tx.wait();

    this.consecutivePeriods++;

    this.log.info(
      'Reward claimed: period=%d, amount=%d, tx=%s',
      proof.periodId,
      result.rewardAmount,
      receipt.hash,
    );

    return {
      txHash: receipt.hash,
      periodId: proof.periodId,
      rewardAmount: String(result.rewardAmount),
      confirmedBytes: String(totalConfirmedBytes),
      confirmedPeers: confirmations.length,
    };
  }

  /**
   * Query on-chain reward status for this relay node.
   */
  async getStatus(): Promise<RelayRewardStatus> {
    const contract = this.contracts.relayReward;
    if (!contract) {
      throw new Error('ClawRelayReward contract not available');
    }

    const relayDidHash = keccak256(toUtf8Bytes(this.relayDid));

    const [poolBalance, totalDistributed, lastClaimed, params] = await Promise.all([
      contract.poolBalance() as Promise<bigint>,
      contract.totalRewardsDistributed() as Promise<bigint>,
      contract.lastClaimedPeriod(relayDidHash) as Promise<bigint>,
      contract.getRewardParams() as Promise<[bigint, bigint, bigint, bigint, bigint]>,
    ]);

    return {
      poolBalance: poolBalance.toString(),
      totalDistributed: totalDistributed.toString(),
      lastClaimedPeriod: Number(lastClaimed),
      params: {
        baseRate: Number(params[0]),
        maxRewardPerPeriod: Number(params[1]),
        minBytesThreshold: Number(params[2]),
        minPeersThreshold: Number(params[3]),
        attachmentWeightBps: Number(params[4]),
      },
    };
  }

  /**
   * Compute the reward preview for the current period (without claiming).
   */
  previewReward(proof: RelayPeriodProof): RewardResult {
    const totalConfirmedBytes = proof.peerConfirmations.reduce(
      (sum, c) => sum + c.bytesConfirmed,
      0,
    );

    return computeRelayReward({
      messagingConfirmedBytes: Math.max(
        0,
        totalConfirmedBytes - proof.attachmentBytesRelayed,
      ),
      attachmentConfirmedBytes: Math.min(
        proof.attachmentBytesRelayed,
        totalConfirmedBytes,
      ),
      claimedBytes: proof.bytesRelayed,
      confirmedUniquePeers: proof.peerConfirmations.length,
      consecutivePeriods: this.consecutivePeriods,
    });
  }
}
