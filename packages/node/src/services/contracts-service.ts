/**
 * ContractsService — on-chain service-contract operations for ClawContracts.
 *
 * This service handles all service-contract lifecycle operations that hit
 * the chain.  Route handlers delegate to it; it calls ClawContracts.sol
 * via ContractProvider and reads indexed contract data from IndexerQuery.
 *
 * Design decisions:
 * - Contract ID is an opaque string at the REST layer; it's hashed to
 *   `bytes32` via `keccak256(toUtf8Bytes(id))` before hitting the chain.
 * - `activateContract` requires the caller to have approved
 *   `totalAmount + fee` Tokens on ClawToken first.
 * - `approveMilestone` / `rejectMilestone` require client, contract
 *   arbiter, or global `ARBITER_ROLE`.
 * - `resolveDispute` requires contract arbiter or global `ARBITER_ROLE`.
 * - Token amounts are **integers** (ClawToken has 0 decimals).
 */

import { keccak256, toUtf8Bytes } from 'ethers';

import { createLogger } from '../logger.js';
import type { ContractProvider } from './contract-provider.js';
import type { IndexerQuery, ServiceContractFilter } from '../indexer/query.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Logger = ReturnType<typeof createLogger>;

// ── Enums mirroring Solidity ──────────────────────────────────────────────

export enum ContractStatus {
  Draft = 0,
  Signed = 1,
  Active = 2,
  Completed = 3,
  Disputed = 4,
  Terminated = 5,
  Cancelled = 6,
}

export enum MilestoneStatus {
  Pending = 0,
  Submitted = 1,
  Approved = 2,
  Rejected = 3,
}

export enum DisputeResolution {
  FavorProvider = 0,
  FavorClient = 1,
  Resume = 2,
}

// ── Response shapes ───────────────────────────────────────────────────────

export interface ServiceContractView {
  contractId: string;
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

export interface MilestoneView {
  index: number;
  amount: number;
  deliverableHash: string;
  status: MilestoneStatus;
  deadline: number;
}

export interface ContractCreateResult {
  txHash: string;
  contractId: string;
  status: string;
  timestamp: number;
}

export interface ContractTxResult {
  txHash: string;
  contractId: string;
  status: string;
  timestamp: number;
}

export interface MilestoneTxResult {
  txHash: string;
  contractId: string;
  milestoneIndex: number;
  status: string;
  timestamp: number;
}

export interface ContractListResult {
  contracts: ServiceContractListItem[];
  total: number;
  pagination: { limit: number; offset: number; hasMore: boolean };
}

export interface ServiceContractListItem {
  contractId: string;
  client: string;
  provider: string;
  status: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// ContractsService
// ---------------------------------------------------------------------------

export class ContractsService {
  private readonly log: Logger;

  constructor(
    private readonly contracts: ContractProvider,
    private readonly indexer?: IndexerQuery,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ level: 'info' });
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /** Hash an opaque string to bytes32 (contract ID, terms, evidence, etc.) */
  private hash(value: string): string {
    return keccak256(toUtf8Bytes(value));
  }

  // =====================================================================
  // READ operations
  // =====================================================================

  /**
   * Fetch a single contract from the chain.
   *
   * @param contractId  Opaque REST-layer contract ID.
   */
  async getContract(contractId: string): Promise<ServiceContractView | null> {
    try {
      const id = this.hash(contractId);
      const c = await this.contracts.serviceContracts.getContract(id);

      return {
        contractId,
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
    } catch (err) {
      this.log.debug('getContract failed: %s', (err as Error).message);
      return null;
    }
  }

  /**
   * Fetch all milestones for a contract from the chain.
   */
  async getMilestones(contractId: string): Promise<MilestoneView[]> {
    const id = this.hash(contractId);
    const milestones = await this.contracts.serviceContracts.getMilestones(id);

    return milestones.map((m: Record<string, unknown>, i: number) => ({
      index: i,
      amount: Number(m.amount),
      deliverableHash: m.deliverableHash as string,
      status: Number(m.status) as MilestoneStatus,
      deadline: Number(m.deadline),
    }));
  }

  /**
   * List contracts from the indexer (paginated, filterable).
   */
  listContracts(
    opts: { address?: string; status?: number; limit?: number; offset?: number } = {},
  ): ContractListResult | null {
    if (!this.indexer) return null;

    const filter: ServiceContractFilter = {
      address: opts.address,
      status: opts.status,
      limit: opts.limit,
      offset: opts.offset,
    };
    const result = this.indexer.getServiceContracts(filter);

    const contracts: ServiceContractListItem[] = result.items.map((r) => ({
      contractId: r.contractId,
      client: r.client,
      provider: r.provider,
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return {
      contracts,
      total: result.total,
      pagination: {
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + result.limit < result.total,
      },
    };
  }

  /**
   * Calculate the platform fee for a given amount.
   */
  async calculateFee(amount: number): Promise<number> {
    const fee = await this.contracts.serviceContracts.calculateFee(amount);
    return Number(fee);
  }

  // =====================================================================
  // WRITE operations
  // =====================================================================

  /**
   * Create a new service contract on-chain.
   */
  async createContract(params: {
    contractId: string;
    provider: string;
    arbiter: string;
    totalAmount: number;
    termsHash: string;
    deadline: number;
    milestoneAmounts: number[];
    milestoneDeadlines: number[];
  }): Promise<ContractCreateResult> {
    const id = this.hash(params.contractId);
    const terms = this.hash(params.termsHash);

    this.log.info('Creating contract %s on-chain', params.contractId);

    const tx = await this.contracts.serviceContracts.createContract(
      id,
      params.provider,
      params.arbiter,
      params.totalAmount,
      terms,
      params.deadline,
      params.milestoneAmounts,
      params.milestoneDeadlines,
    );
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      contractId: params.contractId,
      status: 'created',
      timestamp: Date.now(),
    };
  }

  /**
   * Sign a contract (both client & provider must call).
   */
  async signContract(contractId: string): Promise<ContractTxResult> {
    const id = this.hash(contractId);
    this.log.info('Signing contract %s', contractId);

    const tx = await this.contracts.serviceContracts.signContract(id);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      contractId,
      status: 'signed',
      timestamp: Date.now(),
    };
  }

  /**
   * Fund and activate a contract.
   * The caller (client) must have approved (totalAmount + fee) Tokens
   * on ClawToken before calling this.
   */
  async activateContract(contractId: string): Promise<ContractTxResult> {
    const id = this.hash(contractId);
    this.log.info('Activating contract %s', contractId);

    const tx = await this.contracts.serviceContracts.activateContract(id);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      contractId,
      status: 'active',
      timestamp: Date.now(),
    };
  }

  /**
   * Submit a milestone deliverable (provider only).
   *
   * @param envelopeDigest  Pre-computed BLAKE3(JCS(envelope)) hex — passed
   *   directly to the contract with **no** re-hashing.  Callers compute the
   *   digest themselves (see `envelopeDigest()` in @claw-network/core).
   */
  async submitMilestone(
    contractId: string,
    index: number,
    envelopeDigest: string,
  ): Promise<MilestoneTxResult> {
    const id = this.hash(contractId);
    // envelopeDigest is already a BLAKE3 hex digest — pass directly, no double-hash.
    const digest = envelopeDigest.startsWith('0x') ? envelopeDigest : `0x${envelopeDigest}`;
    this.log.info('Submitting milestone %d for contract %s', index, contractId);

    const tx = await this.contracts.serviceContracts.submitMilestone(id, index, digest);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      contractId,
      milestoneIndex: index,
      status: 'submitted',
      timestamp: Date.now(),
    };
  }

  /**
   * Approve a submitted milestone (client / arbiter).
   */
  async approveMilestone(
    contractId: string,
    index: number,
  ): Promise<MilestoneTxResult> {
    const id = this.hash(contractId);
    this.log.info('Approving milestone %d for contract %s', index, contractId);

    const tx = await this.contracts.serviceContracts.approveMilestone(id, index);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      contractId,
      milestoneIndex: index,
      status: 'approved',
      timestamp: Date.now(),
    };
  }

  /**
   * Reject a submitted milestone (client / arbiter).
   */
  async rejectMilestone(
    contractId: string,
    index: number,
    reason: string,
  ): Promise<MilestoneTxResult> {
    const id = this.hash(contractId);
    const reasonHash = this.hash(reason);
    this.log.info('Rejecting milestone %d for contract %s', index, contractId);

    const tx = await this.contracts.serviceContracts.rejectMilestone(id, index, reasonHash);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      contractId,
      milestoneIndex: index,
      status: 'rejected',
      timestamp: Date.now(),
    };
  }

  /**
   * Complete a contract (all milestones must be approved).
   */
  async completeContract(contractId: string): Promise<ContractTxResult> {
    const id = this.hash(contractId);
    this.log.info('Completing contract %s', contractId);

    const tx = await this.contracts.serviceContracts.completeContract(id);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      contractId,
      status: 'completed',
      timestamp: Date.now(),
    };
  }

  /**
   * Raise a dispute on an active contract.
   */
  async disputeContract(contractId: string, evidence: string): Promise<ContractTxResult> {
    const id = this.hash(contractId);
    const evidenceHash = this.hash(evidence);
    this.log.info('Disputing contract %s', contractId);

    const tx = await this.contracts.serviceContracts.disputeContract(id, evidenceHash);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      contractId,
      status: 'disputed',
      timestamp: Date.now(),
    };
  }

  /**
   * Resolve a dispute (arbiter only).
   */
  async resolveDispute(
    contractId: string,
    resolution: DisputeResolution,
  ): Promise<ContractTxResult> {
    const id = this.hash(contractId);
    this.log.info('Resolving dispute on contract %s (resolution: %d)', contractId, resolution);

    const tx = await this.contracts.serviceContracts.resolveDispute(id, resolution);
    const receipt = await tx.wait();

    const statusMap: Record<DisputeResolution, string> = {
      [DisputeResolution.FavorProvider]: 'completed',
      [DisputeResolution.FavorClient]: 'terminated',
      [DisputeResolution.Resume]: 'active',
    };

    return {
      txHash: receipt.hash,
      contractId,
      status: statusMap[resolution] ?? 'resolved',
      timestamp: Date.now(),
    };
  }

  /**
   * Terminate an active or disputed contract (refunds remaining funds).
   */
  async terminateContract(contractId: string, reason: string): Promise<ContractTxResult> {
    const id = this.hash(contractId);
    const reasonHash = this.hash(reason);
    this.log.info('Terminating contract %s', contractId);

    const tx = await this.contracts.serviceContracts.terminateContract(id, reasonHash);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      contractId,
      status: 'terminated',
      timestamp: Date.now(),
    };
  }

  /**
   * Cancel a pre-funded contract (Draft or Signed).
   */
  async cancelContract(contractId: string): Promise<ContractTxResult> {
    const id = this.hash(contractId);
    this.log.info('Cancelling contract %s', contractId);

    const tx = await this.contracts.serviceContracts.cancelContract(id);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      contractId,
      status: 'cancelled',
      timestamp: Date.now(),
    };
  }
}
