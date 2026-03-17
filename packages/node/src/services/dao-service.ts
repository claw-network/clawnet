/**
 * DaoService — on-chain DAO governance operations for ClawDAO + ParamRegistry.
 *
 * Handles all DAO lifecycle operations that hit the chain.  Route handlers
 * delegate to it; it calls ClawDAO.sol and ParamRegistry.sol via
 * ContractProvider and reads indexed proposal / vote data from IndexerQuery.
 *
 * Design decisions:
 * - Proposal IDs are **uint256** on-chain (auto-incrementing `proposalCount`).
 *   REST-layer string IDs are NOT used for chain proposals — the chain
 *   returns the numeric ID from `propose()`.
 * - `advanceProposal()` is an adapter that maps the REST `newStatus` string
 *   to the appropriate chain call: `queue()` or `execute()`.
 * - Vote support values: 0 = Against, 1 = For, 2 = Abstain (Solidity uint8).
 * - Delegation does NOT exist in ClawDAO.sol — delegation routes remain
 *   event-store-only (legacy fallback).
 * - Treasury balance is read via `ClawToken.balanceOf(daoAddress)`.
 * - Governance params are read via `ParamRegistry.getAllParams()`.
 * - Token amounts are **integers** (ClawToken has 0 decimals).
 */

import { keccak256, toUtf8Bytes } from 'ethers';

import { createLogger } from '../logger.js';
import type { ContractProvider } from './contract-provider.js';
import type {
  IndexerQuery,
  ProposalFilter,
  VoteFilter,
} from '../indexer/query.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Logger = ReturnType<typeof createLogger>;

// ── Enums mirroring Solidity ──────────────────────────────────────────────

export enum ProposalType {
  ParameterChange = 0,
  TreasurySpend = 1,
  ProtocolUpgrade = 2,
  Emergency = 3,
  Signal = 4,
}

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

export enum VoteSupport {
  Against = 0,
  For = 1,
  Abstain = 2,
}

// ── Response shapes ───────────────────────────────────────────────────────

export interface ProposalView {
  proposalId: number;
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
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
}

export interface VoteReceipt {
  hasVoted: boolean;
  support: VoteSupport;
  weight: string;
}

export interface VotingPowerResult {
  voter: string;
  power: string;
}

export interface ProposalCreateResult {
  txHash: string;
  proposalId: number;
  status: string;
  timestamp: number;
}

export interface ProposalTxResult {
  txHash: string;
  proposalId: number;
  status: string;
  timestamp: number;
}

export interface VoteCastResult {
  txHash: string;
  proposalId: number;
  support: VoteSupport;
  timestamp: number;
}

export interface TreasuryView {
  balance: string;
  daoAddress: string;
}

export interface TreasuryDepositResult {
  txHash: string;
  amount: number;
  timestamp: number;
}

export interface GovParam {
  key: string;
  keyHash: string;
  value: string;
}

export interface GovParamsResult {
  params: GovParam[];
  count: number;
}

export interface ProposalListResult {
  proposals: Array<{
    proposalId: number;
    proposer: string;
    pType: number;
    status: number;
    createdAt: number;
  }>;
  total: number;
  pagination: { limit: number; offset: number; hasMore: boolean };
}

export interface VoteListResult {
  votes: Array<{
    proposalId: number;
    voter: string;
    support: number;
    weight: string;
    timestamp: number;
  }>;
  total: number;
  pagination: { limit: number; offset: number; hasMore: boolean };
}

// ── Mapping helpers ───────────────────────────────────────────────────────

const PROPOSAL_TYPE_MAP: Record<string, ProposalType> = {
  parameter_change: ProposalType.ParameterChange,
  treasury_spend: ProposalType.TreasurySpend,
  protocol_upgrade: ProposalType.ProtocolUpgrade,
  emergency: ProposalType.Emergency,
  signal: ProposalType.Signal,
};

const VOTE_SUPPORT_MAP: Record<string, VoteSupport> = {
  for: VoteSupport.For,
  against: VoteSupport.Against,
  abstain: VoteSupport.Abstain,
};

/** Well-known ParamRegistry key names (matches Solidity constants). */
const PARAM_KEY_NAMES: Record<string, string> = {
  [keccak256(toUtf8Bytes('MARKET_FEE_INFO'))]: 'MARKET_FEE_INFO',
  [keccak256(toUtf8Bytes('MARKET_FEE_TASK'))]: 'MARKET_FEE_TASK',
  [keccak256(toUtf8Bytes('MARKET_FEE_CAP'))]: 'MARKET_FEE_CAP',
  [keccak256(toUtf8Bytes('MARKET_MIN_FEE'))]: 'MARKET_MIN_FEE',
  [keccak256(toUtf8Bytes('MARKET_MAX_FEE'))]: 'MARKET_MAX_FEE',
  [keccak256(toUtf8Bytes('ESCROW_BASE_RATE'))]: 'ESCROW_BASE_RATE',
  [keccak256(toUtf8Bytes('ESCROW_HOLDING_RATE'))]: 'ESCROW_HOLDING_RATE',
  [keccak256(toUtf8Bytes('ESCROW_MIN_FEE'))]: 'ESCROW_MIN_FEE',
  [keccak256(toUtf8Bytes('MIN_TRANSFER_AMOUNT'))]: 'MIN_TRANSFER_AMOUNT',
  [keccak256(toUtf8Bytes('MIN_ESCROW_AMOUNT'))]: 'MIN_ESCROW_AMOUNT',
  [keccak256(toUtf8Bytes('MIN_NODE_STAKE'))]: 'MIN_NODE_STAKE',
  [keccak256(toUtf8Bytes('UNSTAKE_COOLDOWN'))]: 'UNSTAKE_COOLDOWN',
  [keccak256(toUtf8Bytes('VALIDATOR_REWARD_RATE'))]: 'VALIDATOR_REWARD_RATE',
  [keccak256(toUtf8Bytes('SLASH_PER_VIOLATION'))]: 'SLASH_PER_VIOLATION',
  [keccak256(toUtf8Bytes('TRUST_DECAY_RATE'))]: 'TRUST_DECAY_RATE',
  [keccak256(toUtf8Bytes('EPOCH_DURATION'))]: 'EPOCH_DURATION',
  [keccak256(toUtf8Bytes('PROPOSAL_THRESHOLD'))]: 'PROPOSAL_THRESHOLD',
  [keccak256(toUtf8Bytes('VOTING_PERIOD'))]: 'VOTING_PERIOD',
  [keccak256(toUtf8Bytes('TIMELOCK_DELAY'))]: 'TIMELOCK_DELAY',
  [keccak256(toUtf8Bytes('QUORUM_BPS'))]: 'QUORUM_BPS',
};

// ---------------------------------------------------------------------------
// DaoService
// ---------------------------------------------------------------------------

export class DaoService {
  private readonly log: Logger;

  constructor(
    private readonly contracts: ContractProvider,
    private readonly indexer?: IndexerQuery,
    logger?: Logger,
  ) {
    this.log = logger ?? createLogger({ level: 'info' });
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /** Hash a string to bytes32 (description hash, etc.) */
  private hash(value: string): string {
    return keccak256(toUtf8Bytes(value));
  }

  // =====================================================================
  // READ operations
  // =====================================================================

  /**
   * Fetch a single proposal from the chain via `getProposal()`.
   */
  async getProposal(proposalId: number): Promise<ProposalView | null> {
    try {
      const p = await this.contracts.dao.getProposal(proposalId);

      return {
        proposalId: Number(p.proposalId),
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
        forVotes: p.forVotes.toString(),
        againstVotes: p.againstVotes.toString(),
        abstainVotes: p.abstainVotes.toString(),
      };
    } catch (err) {
      this.log.warn('getProposal(%d) chain error: %s', proposalId, (err as Error).message);
      return null;
    }
  }

  /**
   * List proposals from the indexer (paginated).
   */
  async listProposals(
    filter: ProposalFilter = {},
  ): Promise<ProposalListResult> {
    if (!this.indexer) {
      return { proposals: [], total: 0, pagination: { limit: 20, offset: 0, hasMore: false } };
    }
    const result = this.indexer.getProposals(filter);
    return {
      proposals: result.items,
      total: result.total,
      pagination: {
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + result.items.length < result.total,
      },
    };
  }

  /**
   * List votes from the indexer (paginated).
   */
  async listVotes(filter: VoteFilter = {}): Promise<VoteListResult> {
    if (!this.indexer) {
      return { votes: [], total: 0, pagination: { limit: 20, offset: 0, hasMore: false } };
    }
    const result = this.indexer.getVotes(filter);
    return {
      votes: result.items,
      total: result.total,
      pagination: {
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + result.items.length < result.total,
      },
    };
  }

  /**
   * Get a voter's receipt for a specific proposal from the chain.
   */
  async getReceipt(proposalId: number, voter: string): Promise<VoteReceipt> {
    const r = await this.contracts.dao.getReceipt(proposalId, voter);
    return {
      hasVoted: r.hasVoted,
      support: Number(r.support) as VoteSupport,
      weight: r.weight.toString(),
    };
  }

  /**
   * Get a voter's current voting power from the chain.
   */
  async getVotingPower(voter: string): Promise<VotingPowerResult> {
    const power = await this.contracts.dao.getVotingPower(voter);
    return { voter, power: power.toString() };
  }

  /**
   * Get the computed status of a proposal (auto-advances based on time).
   */
  async getComputedStatus(proposalId: number): Promise<ProposalStatus> {
    const s = await this.contracts.dao.getStatus(proposalId);
    return Number(s) as ProposalStatus;
  }

  /**
   * Check if a proposal has reached quorum.
   */
  async hasQuorum(proposalId: number): Promise<boolean> {
    return this.contracts.dao.hasQuorum(proposalId);
  }

  /**
   * Check if a proposal has passed (quorum + more for-votes than against).
   */
  async hasPassed(proposalId: number): Promise<boolean> {
    return this.contracts.dao.hasPassed(proposalId);
  }

  // ── Treasury reads ──────────────────────────────────────────────────

  /**
   * Get the DAO treasury balance (ClawToken balance of the DAO contract).
   */
  async getTreasuryBalance(): Promise<TreasuryView> {
    const daoAddress = (await this.contracts.dao.getAddress()) as string;
    const balance = await this.contracts.token.balanceOf(daoAddress);
    return {
      balance: balance.toString(),
      daoAddress,
    };
  }

  // ── ParamRegistry reads ─────────────────────────────────────────────

  /**
   * Fetch all governance parameters from ParamRegistry on-chain.
   */
  async getAllParams(): Promise<GovParamsResult> {
    const [keys, values]: [string[], bigint[]] =
      await this.contracts.paramRegistry.getAllParams();
    const params: GovParam[] = keys.map((keyHash: string, i: number) => ({
      key: PARAM_KEY_NAMES[keyHash] ?? keyHash,
      keyHash,
      value: values[i].toString(),
    }));
    return { params, count: params.length };
  }

  /**
   * Get a single governance parameter by name.
   */
  async getParam(name: string): Promise<{ key: string; value: string }> {
    const keyHash = this.hash(name);
    const value = await this.contracts.paramRegistry.getParam(keyHash);
    return { key: name, value: value.toString() };
  }

  // =====================================================================
  // WRITE operations
  // =====================================================================

  /**
   * Create a new proposal on-chain.
   *
   * @param pType         Proposal type string (e.g. 'parameter_change').
   * @param description   Description text (hashed to bytes32).
   * @param target        Target contract address (or zero address for signal).
   * @param callData      Encoded call data (hex string, or '0x' for signal).
   */
  async propose(
    pType: string,
    description: string,
    target: string,
    callData: string,
  ): Promise<ProposalCreateResult> {
    const typeEnum = PROPOSAL_TYPE_MAP[pType];
    if (typeEnum === undefined) {
      throw new Error(`Unknown proposal type: ${pType}`);
    }
    const descHash = this.hash(description);

    this.log.info('propose(type=%s, target=%s)', pType, target);
    const tx = await this.contracts.dao.propose(
      typeEnum,
      descHash,
      target,
      callData,
    );
    const receipt = await tx.wait();
    const txHash: string = receipt.hash;

    // Extract proposalId from ProposalCreated event.
    const createdEvent = receipt.logs?.find(
      (l: { fragment?: { name: string } }) => l.fragment?.name === 'ProposalCreated',
    );
    const proposalId = createdEvent?.args?.[0]
      ? Number(createdEvent.args[0])
      : -1;

    return {
      txHash,
      proposalId,
      status: ProposalStatus[ProposalStatus.Discussion],
      timestamp: Date.now(),
    };
  }

  /**
   * Cast a vote on-chain.
   *
   * @param proposalId  Numeric proposal ID.
   * @param option      Vote option string: 'for', 'against', 'abstain'.
   */
  async vote(proposalId: number, option: string): Promise<VoteCastResult> {
    const support = VOTE_SUPPORT_MAP[option];
    if (support === undefined) {
      throw new Error(`Unknown vote option: ${option}`);
    }

    this.log.info('vote(proposal=%d, support=%s)', proposalId, option);
    const tx = await this.contracts.dao.vote(proposalId, support);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash as string,
      proposalId,
      support,
      timestamp: Date.now(),
    };
  }

  /**
   * Queue a passed proposal for timelock.
   */
  async queue(proposalId: number): Promise<ProposalTxResult> {
    this.log.info('queue(proposal=%d)', proposalId);
    const tx = await this.contracts.dao.queue(proposalId);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash as string,
      proposalId,
      status: ProposalStatus[ProposalStatus.Timelocked],
      timestamp: Date.now(),
    };
  }

  /**
   * Execute a timelocked proposal.
   */
  async execute(proposalId: number): Promise<ProposalTxResult> {
    this.log.info('execute(proposal=%d)', proposalId);
    const tx = await this.contracts.dao.execute(proposalId);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash as string,
      proposalId,
      status: ProposalStatus[ProposalStatus.Executed],
      timestamp: Date.now(),
    };
  }

  /**
   * Cancel a proposal (must be proposer or CANCELLER_ROLE).
   */
  async cancel(proposalId: number): Promise<ProposalTxResult> {
    this.log.info('cancel(proposal=%d)', proposalId);
    const tx = await this.contracts.dao.cancel(proposalId);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash as string,
      proposalId,
      status: ProposalStatus[ProposalStatus.Cancelled],
      timestamp: Date.now(),
    };
  }

  /**
   * Advance a proposal to the next status.
   *
   * This is the REST-layer adapter: the `newStatus` string is mapped to
   * the appropriate chain call (`queue` or `execute`).
   *
   * Mapping:
   * - 'voting' → automatic (contract auto-advances after discussion period)
   * - 'timelocked' / 'queued' → queue()
   * - 'executed' → execute()
   * - 'cancelled' → cancel()
   *
   * For statuses managed by on-chain time (Discussion→Voting, Voting→Passed),
   * we call `getStatus()` which auto-advances, then return the current state.
   */
  async advanceProposal(
    proposalId: number,
    newStatus: string,
  ): Promise<ProposalTxResult> {
    const s = newStatus.toLowerCase();

    if (s === 'timelocked' || s === 'queued') {
      return this.queue(proposalId);
    }
    if (s === 'executed') {
      return this.execute(proposalId);
    }
    if (s === 'cancelled') {
      return this.cancel(proposalId);
    }

    // For time-based transitions, just read the computed status.
    const currentStatus = await this.getComputedStatus(proposalId);
    return {
      txHash: '',
      proposalId,
      status: ProposalStatus[currentStatus],
      timestamp: Date.now(),
    };
  }

  // ── Treasury writes ─────────────────────────────────────────────────

  /**
   * Deposit Tokens into the DAO treasury.
   *
   * The caller must have approved the DAO contract to spend `amount` Tokens
   * on ClawToken first.  This service calls `ClawToken.transfer(daoAddress, amount)`.
   */
  async treasuryDeposit(amount: number): Promise<TreasuryDepositResult> {
    const daoAddress = (await this.contracts.dao.getAddress()) as string;
    this.log.info('treasuryDeposit(amount=%d, to=%s)', amount, daoAddress);
    const tx = await this.contracts.token.transfer(daoAddress, amount);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash as string,
      amount,
      timestamp: Date.now(),
    };
  }
}
