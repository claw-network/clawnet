/**
 * StakingService — on-chain staking operations for ClawStaking.
 *
 * Wraps ClawStaking.sol via ContractProvider.  Route handlers delegate to
 * this service for all staking reads and writes.
 *
 * Token amounts are **integers** (ClawToken has 0 decimals).
 */

import { createLogger } from '../logger.js';
import type { ContractProvider } from './contract-provider.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Logger = ReturnType<typeof createLogger>;

export interface StakingInfo {
  totalStaked: string;
  activeValidatorCount: number;
  minStake: string;
  unstakeCooldown: number;
  rewardPerEpoch: string;
  slashPerViolation: string;
}

export interface StakerView {
  address: string;
  staked: string;
  nodeType: number;
  pendingRewards: string;
  unstakeRequestTime: number;
  isActive: boolean;
}

export interface StakeTxResult {
  txHash: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// StakingService
// ---------------------------------------------------------------------------

export class StakingService {
  private readonly log: Logger;

  constructor(
    private readonly contracts: ContractProvider,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ level: 'info' });
  }

  // =====================================================================
  // READ operations
  // =====================================================================

  /**
   * Get global staking information.
   */
  async getInfo(): Promise<StakingInfo> {
    const staking = this.contracts.staking;
    const [totalStaked, minStake, unstakeCooldown, rewardPerEpoch, slashPerViolation, validatorCount] =
      await Promise.all([
        staking.totalStaked(),
        staking.minStake(),
        staking.unstakeCooldown(),
        staking.rewardPerEpoch(),
        staking.slashPerViolation(),
        staking.activeValidatorCount(),
      ]);

    return {
      totalStaked: totalStaked.toString(),
      activeValidatorCount: Number(validatorCount),
      minStake: minStake.toString(),
      unstakeCooldown: Number(unstakeCooldown),
      rewardPerEpoch: rewardPerEpoch.toString(),
      slashPerViolation: slashPerViolation.toString(),
    };
  }

  /**
   * Get staking info for a specific address.
   */
  async getStaker(address: string): Promise<StakerView> {
    const staking = this.contracts.staking;
    const [info, isActive] = await Promise.all([
      staking.getStakeInfo(address),
      staking.isActiveValidator(address),
    ]);

    return {
      address,
      staked: info.amount.toString(),
      nodeType: Number(info.nodeType),
      pendingRewards: info.rewards.toString(),
      unstakeRequestTime: Number(info.unstakeRequestAt),
      isActive,
    };
  }

  /**
   * Get the list of active validators.
   */
  async getActiveValidators(): Promise<string[]> {
    return this.contracts.staking.getActiveValidators();
  }

  // =====================================================================
  // WRITE operations (executed by the node signer)
  // =====================================================================

  /**
   * Stake tokens. This uses the node signer, so actually stakes on behalf
   * of the node operator.
   */
  async stake(amount: number, nodeType: number): Promise<StakeTxResult> {
    this.log.info('Staking %d Token (nodeType=%d)', amount, nodeType);
    const tx = await this.contracts.staking.stake(amount, nodeType);
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      timestamp: Date.now(),
    };
  }

  /**
   * Request to unstake (begins cooldown period).
   */
  async requestUnstake(): Promise<StakeTxResult> {
    this.log.info('Requesting unstake');
    const tx = await this.contracts.staking.requestUnstake();
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      timestamp: Date.now(),
    };
  }

  /**
   * Complete unstaking after cooldown has elapsed.
   */
  async unstake(): Promise<StakeTxResult> {
    this.log.info('Completing unstake');
    const tx = await this.contracts.staking.unstake();
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      timestamp: Date.now(),
    };
  }

  /**
   * Claim pending staking rewards.
   */
  async claimRewards(): Promise<StakeTxResult> {
    this.log.info('Claiming staking rewards');
    const tx = await this.contracts.staking.claimRewards();
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      timestamp: Date.now(),
    };
  }
}
