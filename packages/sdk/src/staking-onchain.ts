/**
 * On-chain Staking API — calls ClawStaking smart contract directly.
 *
 * @example
 * ```ts
 * import { ethers } from 'ethers';
 * import { StakingOnChainApi } from '@claw-network/sdk';
 *
 * const provider = new ethers.JsonRpcProvider('https://rpc.clawnetd.com');
 * const signer = new ethers.Wallet(privateKey, provider);
 * const staking = new StakingOnChainApi(signer, {
 *   stakingAddress: '0x...',
 *   tokenAddress: '0x...',
 * });
 * await staking.stake(10000, 0);
 * ```
 */
import {
  type ContractTransactionReceipt,
  Contract,
  type Signer,
  type Provider,
} from 'ethers';

// ---------------------------------------------------------------------------
// Minimal ABI fragments
// ---------------------------------------------------------------------------

const STAKING_ABI = [
  'function stake(uint256 amount, uint8 nodeType)',
  'function requestUnstake()',
  'function unstake()',
  'function claimRewards()',
  'function slash(address node, uint256 amount, bytes32 reason)',
  'function distributeRewards(address[] validators, uint256[] amounts)',
  'function isActiveValidator(address node) view returns (bool)',
  'function getStakeInfo(address node) view returns (tuple(uint256 amount, uint64 stakedAt, uint64 unstakeRequestAt, uint256 rewards, uint256 slashed, uint8 nodeType, bool active))',
  'function getActiveValidators() view returns (address[])',
  'function activeValidatorCount() view returns (uint256)',
  'function minStake() view returns (uint256)',
  'function unstakeCooldown() view returns (uint64)',
  'function rewardPerEpoch() view returns (uint256)',
  'function slashPerViolation() view returns (uint256)',
] as const;

const ERC20_APPROVE_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Node type enum mirroring ClawStaking.NodeType */
export enum NodeType {
  Full = 0,
  Light = 1,
  Archive = 2,
  Validator = 3,
  Gateway = 4,
}

/** Stake info returned from the contract. */
export interface StakeInfo {
  amount: number;
  stakedAt: number;
  unstakeRequestAt: number;
  rewards: number;
  slashed: number;
  nodeType: NodeType;
  active: boolean;
}

/** Transaction result from a write operation. */
export interface StakingTxResult {
  txHash: string;
  status: 'confirmed' | 'failed';
}

/** Configuration for the on-chain staking API. */
export interface OnChainStakingConfig {
  /** ClawStaking proxy address. */
  stakingAddress: string;
  /** ClawToken proxy address (for approve). */
  tokenAddress: string;
}

// ---------------------------------------------------------------------------
// StakingOnChainApi
// ---------------------------------------------------------------------------

/**
 * On-chain staking implementation that calls ClawStaking + ClawToken contracts.
 */
export class StakingOnChainApi {
  private readonly staking: Contract;
  private readonly token: Contract;
  private readonly signer: Signer;

  constructor(signer: Signer, config: OnChainStakingConfig) {
    this.signer = signer;
    this.staking = new Contract(config.stakingAddress, STAKING_ABI, signer);
    this.token = new Contract(config.tokenAddress, ERC20_APPROVE_ABI, signer);
  }

  /**
   * Create a read-only instance (no signer needed, just a provider).
   */
  static readOnly(provider: Provider, config: OnChainStakingConfig): StakingOnChainApi {
    const api = Object.create(StakingOnChainApi.prototype) as StakingOnChainApi;
    (api as any).signer = null;
    (api as any).staking = new Contract(config.stakingAddress, STAKING_ABI, provider);
    (api as any).token = new Contract(config.tokenAddress, ERC20_APPROVE_ABI, provider);
    return api;
  }

  // ── Write operations ─────────────────────────────────────────────

  /**
   * Approve + stake Tokens to become a validator.
   *
   * @param amount   Amount of Tokens to stake (integer).
   * @param nodeType Node type (0=Full, 1=Light, 2=Archive, 3=Validator, 4=Gateway).
   */
  async stake(amount: number, nodeType: NodeType = NodeType.Full): Promise<StakingTxResult> {
    const approveTx = await this.token.approve(await this.staking.getAddress(), amount);
    await approveTx.wait();

    const tx = await this.staking.stake(amount, nodeType);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Request unstaking (starts cooldown period). */
  async requestUnstake(): Promise<StakingTxResult> {
    const tx = await this.staking.requestUnstake();
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Finalize unstaking after cooldown has elapsed. */
  async unstake(): Promise<StakingTxResult> {
    const tx = await this.staking.unstake();
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Claim accumulated staking rewards. */
  async claimRewards(): Promise<StakingTxResult> {
    const tx = await this.staking.claimRewards();
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  // ── Read operations ──────────────────────────────────────────────

  /** Get stake information for a given address. */
  async getStakeInfo(address: string): Promise<StakeInfo> {
    const info = await this.staking.getStakeInfo(address);
    return {
      amount: Number(info.amount),
      stakedAt: Number(info.stakedAt),
      unstakeRequestAt: Number(info.unstakeRequestAt),
      rewards: Number(info.rewards),
      slashed: Number(info.slashed),
      nodeType: Number(info.nodeType) as NodeType,
      active: info.active,
    };
  }

  /** Check if address is an active validator. */
  async isActiveValidator(address: string): Promise<boolean> {
    return this.staking.isActiveValidator(address);
  }

  /** Get all active validator addresses. */
  async getActiveValidators(): Promise<string[]> {
    return this.staking.getActiveValidators();
  }

  /** Get number of active validators. */
  async activeValidatorCount(): Promise<number> {
    const count = await this.staking.activeValidatorCount();
    return Number(count);
  }

  /** Get the minimum stake requirement. */
  async getMinStake(): Promise<number> {
    return Number(await this.staking.minStake());
  }

  /** Get the connected signer's address. */
  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }
}
