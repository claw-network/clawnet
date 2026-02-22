/**
 * On-chain Service Contracts API — calls ClawContracts smart contract directly.
 *
 * @example
 * ```ts
 * import { ethers } from 'ethers';
 * import { ContractsOnChainApi } from '@claw-network/sdk';
 *
 * const provider = new ethers.JsonRpcProvider('https://rpc.clawnetd.com');
 * const signer = new ethers.Wallet(privateKey, provider);
 * const contracts = new ContractsOnChainApi(signer, {
 *   contractsAddress: '0x...',
 *   tokenAddress: '0x...',
 * });
 * await contracts.createContract(id, provider, arbiter, 10000, termsHash, deadline, amounts, deadlines);
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

const CONTRACTS_ABI = [
  // Lifecycle
  'function createContract(bytes32 contractId, address provider, address arbiter, uint256 totalAmount, bytes32 termsHash, uint64 deadline, uint256[] milestoneAmounts, uint64[] milestoneDeadlines)',
  'function signContract(bytes32 contractId)',
  'function activateContract(bytes32 contractId)',
  'function completeContract(bytes32 contractId)',
  'function cancelContract(bytes32 contractId)',
  'function terminateContract(bytes32 contractId, bytes32 reason)',
  // Milestones
  'function submitMilestone(bytes32 contractId, uint8 index, bytes32 deliverableHash)',
  'function approveMilestone(bytes32 contractId, uint8 index)',
  'function rejectMilestone(bytes32 contractId, uint8 index, bytes32 reasonHash)',
  // Disputes
  'function disputeContract(bytes32 contractId, bytes32 evidenceHash)',
  'function resolveDispute(bytes32 contractId, uint8 resolution)',
  // Views
  'function getContract(bytes32 contractId) view returns (tuple(address client, address provider, address arbiter, uint256 totalAmount, uint256 fundedAmount, uint256 releasedAmount, bytes32 termsHash, uint8 milestoneCount, uint8 status, uint64 createdAt, uint64 deadline, bool clientSigned, bool providerSigned))',
  'function getMilestone(bytes32 contractId, uint8 index) view returns (tuple(uint256 amount, uint64 deadline, bytes32 deliverableHash, bytes32 rejectionHash, uint8 status))',
  'function getMilestones(bytes32 contractId) view returns (tuple(uint256 amount, uint64 deadline, bytes32 deliverableHash, bytes32 rejectionHash, uint8 status)[])',
  'function calculateFee(uint256 amount) view returns (uint256)',
] as const;

const ERC20_APPROVE_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Contract status enum mirroring ClawContracts.ContractStatus */
export enum ContractStatus {
  Draft = 0,
  Active = 1,
  Completed = 2,
  Disputed = 3,
  Terminated = 4,
  Cancelled = 5,
}

/** Milestone status enum mirroring ClawContracts.MilestoneStatus */
export enum MilestoneStatus {
  Pending = 0,
  Submitted = 1,
  Approved = 2,
  Rejected = 3,
}

/** Dispute resolution types. */
export enum DisputeResolution {
  ClientFavored = 0,
  ProviderFavored = 1,
  Split = 2,
}

/** On-chain service contract data. */
export interface OnChainServiceContract {
  client: string;
  provider: string;
  arbiter: string;
  totalAmount: number;
  fundedAmount: number;
  releasedAmount: number;
  termsHash: string;
  milestoneCount: number;
  status: ContractStatus;
  createdAt: number;
  deadline: number;
  clientSigned: boolean;
  providerSigned: boolean;
}

/** On-chain milestone data. */
export interface OnChainMilestone {
  amount: number;
  deadline: number;
  deliverableHash: string;
  rejectionHash: string;
  status: MilestoneStatus;
}

/** Transaction result. */
export interface ContractsTxResult {
  txHash: string;
  status: 'confirmed' | 'failed';
}

/** Configuration. */
export interface OnChainContractsConfig {
  /** ClawContracts proxy address. */
  contractsAddress: string;
  /** ClawToken proxy address (for approve on activate). */
  tokenAddress: string;
}

// ---------------------------------------------------------------------------
// ContractsOnChainApi
// ---------------------------------------------------------------------------

/**
 * On-chain service contracts implementation that calls ClawContracts + ClawToken.
 */
export class ContractsOnChainApi {
  private readonly contracts: Contract;
  private readonly token: Contract;
  private readonly signer: Signer;

  constructor(signer: Signer, config: OnChainContractsConfig) {
    this.signer = signer;
    this.contracts = new Contract(config.contractsAddress, CONTRACTS_ABI, signer);
    this.token = new Contract(config.tokenAddress, ERC20_APPROVE_ABI, signer);
  }

  /**
   * Create a read-only instance (no signer needed, just a provider).
   */
  static readOnly(provider: Provider, config: OnChainContractsConfig): ContractsOnChainApi {
    const api = Object.create(ContractsOnChainApi.prototype) as ContractsOnChainApi;
    (api as any).signer = null;
    (api as any).contracts = new Contract(config.contractsAddress, CONTRACTS_ABI, provider);
    (api as any).token = new Contract(config.tokenAddress, ERC20_APPROVE_ABI, provider);
    return api;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /** Create a new service contract. */
  async createContract(
    contractId: string,
    provider: string,
    arbiter: string,
    totalAmount: number,
    termsHash: string,
    deadline: number,
    milestoneAmounts: number[],
    milestoneDeadlines: number[],
  ): Promise<ContractsTxResult> {
    const tx = await this.contracts.createContract(
      contractId, provider, arbiter, totalAmount, termsHash,
      deadline, milestoneAmounts, milestoneDeadlines,
    );
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Sign a contract (as client or provider). */
  async signContract(contractId: string): Promise<ContractsTxResult> {
    const tx = await this.contracts.signContract(contractId);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /**
   * Activate a contract (client only).
   * Automatically approves token transfer for totalAmount + fee.
   */
  async activateContract(contractId: string): Promise<ContractsTxResult> {
    // Calculate total needed (amount + fee)
    const info = await this.getContract(contractId);
    const fee = await this.calculateFee(info.totalAmount);
    const total = info.totalAmount + fee;

    // Approve token transfer
    const contractsAddr = await this.contracts.getAddress();
    const approveTx = await this.token.approve(contractsAddr, total);
    await approveTx.wait();

    const tx = await this.contracts.activateContract(contractId);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Complete a contract (client). */
  async completeContract(contractId: string): Promise<ContractsTxResult> {
    const tx = await this.contracts.completeContract(contractId);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Cancel a contract (Draft status only). */
  async cancelContract(contractId: string): Promise<ContractsTxResult> {
    const tx = await this.contracts.cancelContract(contractId);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  // ── Milestones ───────────────────────────────────────────────────

  /** Submit a milestone deliverable (provider). */
  async submitMilestone(
    contractId: string,
    index: number,
    deliverableHash: string,
  ): Promise<ContractsTxResult> {
    const tx = await this.contracts.submitMilestone(contractId, index, deliverableHash);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Approve a submitted milestone (client). */
  async approveMilestone(contractId: string, index: number): Promise<ContractsTxResult> {
    const tx = await this.contracts.approveMilestone(contractId, index);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Reject a submitted milestone (client). */
  async rejectMilestone(
    contractId: string,
    index: number,
    reasonHash: string,
  ): Promise<ContractsTxResult> {
    const tx = await this.contracts.rejectMilestone(contractId, index, reasonHash);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  // ── Disputes ─────────────────────────────────────────────────────

  /** Open a dispute on a contract. */
  async disputeContract(contractId: string, evidenceHash: string): Promise<ContractsTxResult> {
    const tx = await this.contracts.disputeContract(contractId, evidenceHash);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Resolve a dispute (arbiter only). */
  async resolveDispute(
    contractId: string,
    resolution: DisputeResolution,
  ): Promise<ContractsTxResult> {
    const tx = await this.contracts.resolveDispute(contractId, resolution);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  // ── Read operations ──────────────────────────────────────────────

  /** Get service contract details. */
  async getContract(contractId: string): Promise<OnChainServiceContract> {
    const c = await this.contracts.getContract(contractId);
    return {
      client: c.client,
      provider: c.provider,
      arbiter: c.arbiter,
      totalAmount: Number(c.totalAmount),
      fundedAmount: Number(c.fundedAmount),
      releasedAmount: Number(c.releasedAmount),
      termsHash: c.termsHash,
      milestoneCount: Number(c.milestoneCount),
      status: Number(c.status) as ContractStatus,
      createdAt: Number(c.createdAt),
      deadline: Number(c.deadline),
      clientSigned: c.clientSigned,
      providerSigned: c.providerSigned,
    };
  }

  /** Get a single milestone. */
  async getMilestone(contractId: string, index: number): Promise<OnChainMilestone> {
    const m = await this.contracts.getMilestone(contractId, index);
    return {
      amount: Number(m.amount),
      deadline: Number(m.deadline),
      deliverableHash: m.deliverableHash,
      rejectionHash: m.rejectionHash,
      status: Number(m.status) as MilestoneStatus,
    };
  }

  /** Get all milestones for a contract. */
  async getMilestones(contractId: string): Promise<OnChainMilestone[]> {
    const milestones = await this.contracts.getMilestones(contractId);
    return milestones.map((m: any) => ({
      amount: Number(m.amount),
      deadline: Number(m.deadline),
      deliverableHash: m.deliverableHash,
      rejectionHash: m.rejectionHash,
      status: Number(m.status) as MilestoneStatus,
    }));
  }

  /** Calculate platform fee for a given amount. */
  async calculateFee(amount: number): Promise<number> {
    return Number(await this.contracts.calculateFee(amount));
  }

  /** Get the connected signer's address. */
  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }
}
