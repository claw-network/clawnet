/**
 * On-chain DAO API — calls ClawDAO smart contract directly.
 *
 * @example
 * ```ts
 * import { ethers } from 'ethers';
 * import { DaoOnChainApi, ProposalType } from '@claw-network/sdk';
 *
 * const provider = new ethers.JsonRpcProvider('https://rpc.clawnetd.com');
 * const signer = new ethers.Wallet(privateKey, provider);
 * const dao = new DaoOnChainApi(signer, { daoAddress: '0x...' });
 * await dao.propose(ProposalType.ParameterChange, descHash, target, callData);
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

const DAO_ABI = [
  // Lifecycle
  'function propose(uint8 pType, bytes32 descriptionHash, address target, bytes callData) returns (uint256)',
  'function vote(uint256 proposalId, uint8 support)',
  'function queue(uint256 proposalId)',
  'function execute(uint256 proposalId)',
  'function cancel(uint256 proposalId)',
  // Views
  'function getProposal(uint256 proposalId) view returns (tuple(uint256 id, address proposer, uint8 pType, uint8 status, bytes32 descriptionHash, address target, uint256 snapshotBlock, uint64 createdAt, uint64 discussionEndAt, uint64 votingEndAt, uint64 timelockEndAt, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes))',
  'function getReceipt(uint256 proposalId, address voter) view returns (tuple(bool hasVoted, uint8 support, uint256 weight))',
  'function getStatus(uint256 proposalId) view returns (uint8)',
  'function getVotingPower(address voter) view returns (uint256)',
  'function hasQuorum(uint256 proposalId) view returns (bool)',
  'function hasPassed(uint256 proposalId) view returns (bool)',
  'function proposalCount() view returns (uint256)',
  // Events (for parsing)
  'event ProposalCreated(uint256 indexed proposalId, address indexed proposer, uint8 pType, address target, bytes32 descriptionHash)',
  'event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 weight)',
  'event ProposalQueued(uint256 indexed proposalId, uint64 timelockEndAt)',
  'event ProposalExecuted(uint256 indexed proposalId)',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Proposal type enum mirroring ClawDAO.ProposalType */
export enum ProposalType {
  ParameterChange = 0,
  TreasurySpend = 1,
  ContractUpgrade = 2,
  Signal = 3,
  Emergency = 4,
}

/** Proposal status enum mirroring ClawDAO.ProposalStatus */
export enum ProposalStatus {
  Discussion = 0,
  Voting = 1,
  Passed = 2,
  Rejected = 3,
  Timelocked = 4,
  Executed = 5,
  Cancelled = 6,
  Expired = 7,
}

/** Vote support values. */
export enum VoteSupport {
  Against = 0,
  For = 1,
  Abstain = 2,
}

/** On-chain proposal view. */
export interface OnChainProposal {
  id: number;
  proposer: string;
  pType: ProposalType;
  status: ProposalStatus;
  descriptionHash: string;
  target: string;
  snapshotBlock: number;
  createdAt: number;
  discussionEndAt: number;
  votingEndAt: number;
  timelockEndAt: number;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
}

/** Vote receipt. */
export interface VoteReceipt {
  hasVoted: boolean;
  support: VoteSupport;
  weight: bigint;
}

/** Transaction result. */
export interface DaoTxResult {
  txHash: string;
  status: 'confirmed' | 'failed';
}

/** DAO address configuration. */
export interface OnChainDaoConfig {
  /** ClawDAO proxy address. */
  daoAddress: string;
}

// ---------------------------------------------------------------------------
// DaoOnChainApi
// ---------------------------------------------------------------------------

/**
 * On-chain DAO implementation that calls ClawDAO contract.
 */
export class DaoOnChainApi {
  private readonly dao: Contract;
  private readonly signer: Signer;

  constructor(signer: Signer, config: OnChainDaoConfig) {
    this.signer = signer;
    this.dao = new Contract(config.daoAddress, DAO_ABI, signer);
  }

  /**
   * Create a read-only instance (no signer needed, just a provider).
   */
  static readOnly(provider: Provider, config: OnChainDaoConfig): DaoOnChainApi {
    const api = Object.create(DaoOnChainApi.prototype) as DaoOnChainApi;
    (api as any).signer = null;
    (api as any).dao = new Contract(config.daoAddress, DAO_ABI, provider);
    return api;
  }

  // ── Write operations ─────────────────────────────────────────────

  /**
   * Create a new proposal.
   *
   * @returns The proposal ID and tx hash.
   */
  async propose(
    pType: ProposalType,
    descriptionHash: string,
    target: string,
    callData: string,
  ): Promise<DaoTxResult & { proposalId: number }> {
    const tx = await this.dao.propose(pType, descriptionHash, target, callData);
    const receipt: ContractTransactionReceipt | null = await tx.wait();

    // Extract proposalId from ProposalCreated event
    let proposalId = 0;
    if (receipt) {
      for (const log of receipt.logs) {
        try {
          const parsed = this.dao.interface.parseLog(log);
          if (parsed?.name === 'ProposalCreated') {
            proposalId = Number(parsed.args[0]);
            break;
          }
        } catch { /* skip non-matching logs */ }
      }
    }

    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
      proposalId,
    };
  }

  /**
   * Cast a vote on a proposal.
   *
   * @param proposalId Proposal ID.
   * @param support    0=Against, 1=For, 2=Abstain.
   */
  async vote(proposalId: number, support: VoteSupport): Promise<DaoTxResult> {
    const tx = await this.dao.vote(proposalId, support);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Queue a passed proposal into the timelock. */
  async queue(proposalId: number): Promise<DaoTxResult> {
    const tx = await this.dao.queue(proposalId);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Execute a timelocked proposal. */
  async execute(proposalId: number): Promise<DaoTxResult> {
    const tx = await this.dao.execute(proposalId);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  /** Cancel a proposal (only proposer during Discussion, or CANCELLER_ROLE). */
  async cancel(proposalId: number): Promise<DaoTxResult> {
    const tx = await this.dao.cancel(proposalId);
    const receipt: ContractTransactionReceipt | null = await tx.wait();
    return {
      txHash: receipt?.hash ?? tx.hash,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    };
  }

  // ── Read operations ──────────────────────────────────────────────

  /** Get full proposal details. */
  async getProposal(proposalId: number): Promise<OnChainProposal> {
    const p = await this.dao.getProposal(proposalId);
    return {
      id: Number(p.id),
      proposer: p.proposer,
      pType: Number(p.pType) as ProposalType,
      status: Number(p.status) as ProposalStatus,
      descriptionHash: p.descriptionHash,
      target: p.target,
      snapshotBlock: Number(p.snapshotBlock),
      createdAt: Number(p.createdAt),
      discussionEndAt: Number(p.discussionEndAt),
      votingEndAt: Number(p.votingEndAt),
      timelockEndAt: Number(p.timelockEndAt),
      forVotes: BigInt(p.forVotes),
      againstVotes: BigInt(p.againstVotes),
      abstainVotes: BigInt(p.abstainVotes),
    };
  }

  /** Get computed proposal status (includes auto-advance logic). */
  async getStatus(proposalId: number): Promise<ProposalStatus> {
    const status = await this.dao.getStatus(proposalId);
    return Number(status) as ProposalStatus;
  }

  /** Get vote receipt for a specific voter. */
  async getReceipt(proposalId: number, voter: string): Promise<VoteReceipt> {
    const r = await this.dao.getReceipt(proposalId, voter);
    return {
      hasVoted: r.hasVoted,
      support: Number(r.support) as VoteSupport,
      weight: BigInt(r.weight),
    };
  }

  /** Get voting power for an address (sqrt(balance) × trust × lockup). */
  async getVotingPower(address: string): Promise<bigint> {
    return BigInt(await this.dao.getVotingPower(address));
  }

  /** Check if a proposal has reached quorum. */
  async hasQuorum(proposalId: number): Promise<boolean> {
    return this.dao.hasQuorum(proposalId);
  }

  /** Check if a proposal has passed (quorum + forVotes > againstVotes). */
  async hasPassed(proposalId: number): Promise<boolean> {
    return this.dao.hasPassed(proposalId);
  }

  /** Get total number of proposals created. */
  async proposalCount(): Promise<number> {
    return Number(await this.dao.proposalCount());
  }

  /** Get the connected signer's address. */
  async getAddress(): Promise<string> {
    return this.signer.getAddress();
  }
}
