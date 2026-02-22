/**
 * On-chain Wallet API — calls ClawToken + ClawEscrow smart contracts directly.
 *
 * Drop-in replacement for the REST-based `WalletApi` when running in on-chain mode.
 * Requires ethers v6 as a peer dependency.
 *
 * @example
 * ```ts
 * import { ethers } from 'ethers';
 * import { WalletOnChainApi } from '@claw-network/sdk';
 *
 * const provider = new ethers.JsonRpcProvider('https://rpc.clawnetd.com');
 * const signer = new ethers.Wallet(privateKey, provider);
 * const wallet = new WalletOnChainApi(signer, {
 *   tokenAddress: '0x...',
 *   escrowAddress: '0x...',
 * });
 * const balance = await wallet.getBalance();
 * ```
 */
import {
  type ContractTransactionReceipt,
  Contract,
  type Signer,
  type Provider,
  type AddressLike,
} from 'ethers';
import type {
  Balance,
  TransferResult,
  Escrow,
} from './types.js';

// ---------------------------------------------------------------------------
// Minimal ABI fragments (avoids import of full typechain artifacts)
// ---------------------------------------------------------------------------

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const;

const ESCROW_ABI = [
  'function createEscrow(bytes32 escrowId, address beneficiary, address arbiter, uint256 amount, uint256 expiresAt)',
  'function fund(bytes32 escrowId, uint256 amount)',
  'function release(bytes32 escrowId)',
  'function refund(bytes32 escrowId)',
  'function expire(bytes32 escrowId)',
  'function escrows(bytes32) view returns (address depositor, address beneficiary, address arbiter, uint256 amount, uint256 createdAt, uint256 expiresAt, uint8 status)',
] as const;

/** Escrow status enum mirroring on-chain EscrowStatus. */
const ESCROW_STATUS_MAP: Record<number, string> = {
  0: 'Active',
  1: 'Released',
  2: 'Refunded',
  3: 'Expired',
  4: 'Disputed',
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Addresses of deployed P0 contracts. */
export interface OnChainWalletConfig {
  /** ClawToken proxy address. */
  tokenAddress: string;
  /** ClawEscrow proxy address. */
  escrowAddress: string;
}

// ---------------------------------------------------------------------------
// WalletOnChainApi
// ---------------------------------------------------------------------------

/**
 * On-chain wallet implementation that calls ClawToken and ClawEscrow contracts.
 *
 * Mirrors the method signatures of the REST-based `WalletApi` where applicable,
 * returning the same type shapes.
 */
export class WalletOnChainApi {
  private readonly token: Contract;
  private readonly escrow: Contract;
  private readonly signer: Signer;
  private readonly config: OnChainWalletConfig;

  constructor(signer: Signer, config: OnChainWalletConfig) {
    this.signer = signer;
    this.config = config;
    this.token = new Contract(config.tokenAddress, ERC20_ABI, signer);
    this.escrow = new Contract(config.escrowAddress, ESCROW_ABI, signer);
  }

  // -----------------------------------------------------------------------
  // Balance & Transfer
  // -----------------------------------------------------------------------

  /**
   * Get Token balance for an address. Defaults to the connected signer.
   *
   * @param address Optional address to query. Defaults to signer's address.
   */
  async getBalance(address?: string): Promise<Balance> {
    const target = address ?? (await this.signer.getAddress());
    const raw: bigint = await this.token.balanceOf(target);
    const balance = Number(raw); // decimals=0, safe for JS number range
    return {
      balance,
      available: balance,
      pending: 0,
      locked: 0,
    };
  }

  /**
   * Transfer Tokens to another address.
   *
   * @param to      Recipient address.
   * @param amount  Amount in Token (integer).
   * @returns       Transfer result with tx hash and metadata.
   */
  async transfer(to: string, amount: number): Promise<TransferResult> {
    const tx = await this.token.transfer(to, amount);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    const from = await this.signer.getAddress();

    return {
      txHash: receipt?.hash ?? tx.hash,
      from,
      to,
      amount,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
      timestamp: Date.now(),
    };
  }

  // -----------------------------------------------------------------------
  // Escrow
  // -----------------------------------------------------------------------

  /**
   * Approve + create a new escrow.
   *
   * Automatically calls `ClawToken.approve()` for the total amount before
   * creating the escrow.
   *
   * @param escrowId    Unique escrow identifier (bytes32 hex string).
   * @param beneficiary Beneficiary address.
   * @param arbiter     Arbiter address.
   * @param amount      Amount in Token (integer) — fee is deducted on-chain.
   * @param expiresAt   Expiry timestamp (seconds since epoch).
   */
  async createEscrow(
    escrowId: string,
    beneficiary: string,
    arbiter: string,
    amount: number,
    expiresAt: number,
  ): Promise<TransferResult> {
    // Step 1: Approve the Escrow contract to spend tokens
    const approveTx = await this.token.approve(this.config.escrowAddress, amount);
    await approveTx.wait();

    // Step 2: Create the escrow
    const tx = await this.escrow.createEscrow(
      escrowId,
      beneficiary,
      arbiter,
      amount,
      expiresAt,
    );
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    const from = await this.signer.getAddress();

    return {
      txHash: receipt?.hash ?? tx.hash,
      from,
      to: beneficiary,
      amount,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
      timestamp: Date.now(),
    };
  }

  /**
   * Release escrow funds to the beneficiary.
   *
   * Only callable by the depositor or arbiter (per contract rules).
   */
  async releaseEscrow(escrowId: string): Promise<TransferResult> {
    const tx = await this.escrow.release(escrowId);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    const from = await this.signer.getAddress();

    return {
      txHash: receipt?.hash ?? tx.hash,
      from,
      to: '', // beneficiary resolved on-chain
      amount: 0,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
      timestamp: Date.now(),
    };
  }

  /**
   * Refund escrow funds to the depositor.
   *
   * Only callable by the beneficiary or arbiter (per contract rules).
   */
  async refundEscrow(escrowId: string): Promise<TransferResult> {
    const tx = await this.escrow.refund(escrowId);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    const from = await this.signer.getAddress();

    return {
      txHash: receipt?.hash ?? tx.hash,
      from,
      to: '',
      amount: 0,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
      timestamp: Date.now(),
    };
  }

  /**
   * Get escrow details by ID.
   *
   * @param escrowId bytes32 hex string.
   */
  async getEscrow(escrowId: string): Promise<Escrow> {
    const result = await this.escrow.escrows(escrowId);
    const [depositor, beneficiary, arbiter, amount, createdAt, expiresAt, status] = result;

    return {
      id: escrowId,
      depositor: depositor as string,
      beneficiary: beneficiary as string,
      amount: Number(amount as bigint),
      funded: Number(amount as bigint),
      released: 0,
      status: ESCROW_STATUS_MAP[Number(status)] ?? 'Unknown',
      releaseRules: [],
      arbiter: arbiter as string,
      expiresAt: Number(expiresAt as bigint),
      createdAt: Number(createdAt as bigint),
    };
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  /**
   * Approve the Escrow contract to spend a given amount of tokens.
   * Useful when calling `fund()` or doing multi-step operations.
   */
  async approveEscrow(amount: number): Promise<string> {
    const tx = await this.token.approve(this.config.escrowAddress, amount);
    const receipt = await tx.wait();
    return receipt?.hash ?? tx.hash;
  }

  /**
   * Check current allowance for the Escrow contract.
   */
  async escrowAllowance(owner?: string): Promise<number> {
    const addr = owner ?? (await this.signer.getAddress());
    const raw: bigint = await this.token.allowance(addr, this.config.escrowAddress);
    return Number(raw);
  }

  /** Get the connected signer's address. */
  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }
}
