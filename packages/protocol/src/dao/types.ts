/**
 * DAO Governance Module — Domain Types
 *
 * Implements token-weighted voting with sqrt, reputation multiplier,
 * lockup multiplier, and delegation as specified in docs/DAO.md.
 */

// ---------------------------------------------------------------------------
// Proposal Types
// ---------------------------------------------------------------------------

export const PROPOSAL_TYPES = [
  'parameter_change',
  'treasury_spend',
  'protocol_upgrade',
  'emergency',
  'signal',
] as const;

export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export function isProposalType(value: string): value is ProposalType {
  return (PROPOSAL_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Proposal Status
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUSES = [
  'draft',
  'discussion',
  'voting',
  'passed',
  'rejected',
  'queued',
  'executed',
  'expired',
  'vetoed',
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export function isProposalStatus(value: string): value is ProposalStatus {
  return (PROPOSAL_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Proposal Actions
// ---------------------------------------------------------------------------

export interface ParameterChangeAction {
  type: 'parameter_change';
  target: string;
  currentValue: unknown;
  newValue: unknown;
}

export interface TreasurySpendAction {
  type: 'treasury_spend';
  recipient: string;
  amount: string;
  token: string;
  purpose: string;
  vestingSchedule?: {
    cliff: number;
    duration: number;
    interval: number;
  };
}

export interface ContractUpgradeAction {
  type: 'contract_upgrade';
  contract: string;
  newImplementation: string;
  migrationData?: string;
}

export interface EmergencyAction {
  type: 'emergency';
  action: 'pause' | 'unpause' | 'upgrade';
  target: string;
  reason: string;
}

export type ProposalAction =
  | ParameterChangeAction
  | TreasurySpendAction
  | ContractUpgradeAction
  | EmergencyAction;

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

export const VOTE_OPTIONS = ['for', 'against', 'abstain'] as const;

export type VoteOption = (typeof VOTE_OPTIONS)[number];

export function isVoteOption(value: string): value is VoteOption {
  return (VOTE_OPTIONS as readonly string[]).includes(value);
}

export interface Vote {
  voter: string;
  proposalId: string;
  option: VoteOption;
  power: string; // bigint as string
  reason?: string;
  ts: number;
  hash: string;
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

export interface ProposalTimeline {
  createdAt: number;
  discussionEndsAt: number;
  votingStartsAt: number;
  votingEndsAt: number;
  executionDelay: number;
  expiresAt: number;
}

export interface ProposalVotes {
  for: string; // bigint as string
  against: string;
  abstain: string;
}

export interface Proposal {
  id: string;
  proposer: string;
  type: ProposalType;
  title: string;
  description: string;
  discussionUrl?: string;
  actions: ProposalAction[];
  timeline: ProposalTimeline;
  votes: ProposalVotes;
  status: ProposalStatus;
  resourcePrev?: string | null;
}

// ---------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------

export interface DelegationScope {
  proposalTypes?: ProposalType[];
  topics?: string[];
  all?: boolean;
}

export interface Delegation {
  delegator: string;
  delegate: string;
  scope: DelegationScope;
  percentage: number; // 0-100
  expiresAt?: number;
  revokedAt?: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------

export interface TreasuryAllocationPolicy {
  development: number;
  nodeRewards: number;
  ecosystem: number;
  reserve: number;
}

export interface TreasurySpendingLimits {
  perProposal: string; // bigint as string
  perQuarter: string;
  requireMultisig: string;
}

export interface Treasury {
  balance: string; // bigint as string
  allocationPolicy: TreasuryAllocationPolicy;
  spendingLimits: TreasurySpendingLimits;
  totalSpent: string;
  spentThisQuarter: string;
  quarterStart: number;
}

// ---------------------------------------------------------------------------
// Timelock Queue
// ---------------------------------------------------------------------------

export type TimelockStatus = 'queued' | 'executed' | 'cancelled';

export interface TimelockEntry {
  actionId: string;
  proposalId: string;
  action: ProposalAction;
  queuedAt: number;
  executeAfter: number;
  status: TimelockStatus;
}

// ---------------------------------------------------------------------------
// Voting Power
// ---------------------------------------------------------------------------

export interface VotingPower {
  tokenPower: number;
  lockupMultiplier: number;
  reputationMultiplier: number;
  delegatedPower: number;
  totalPower: number;
}

// ---------------------------------------------------------------------------
// Proposal Thresholds (from DAO.md table)
// ---------------------------------------------------------------------------

export interface ProposalThreshold {
  createThreshold: number; // fraction of total voting power needed to create
  passThreshold: number; // fraction of for/(for+against) needed
  quorum: number; // fraction of total supply participating
  discussionPeriod: number; // ms
  votingPeriod: number; // ms
  timelockDelay: number; // ms
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const PROPOSAL_THRESHOLDS: Record<ProposalType, ProposalThreshold> = {
  parameter_change: {
    createThreshold: 0.001,
    passThreshold: 0.5,
    quorum: 0.04,
    discussionPeriod: 2 * DAY_MS,
    votingPeriod: 3 * DAY_MS,
    timelockDelay: 1 * DAY_MS,
  },
  treasury_spend: {
    createThreshold: 0.005,
    passThreshold: 0.5,
    quorum: 0.04,
    discussionPeriod: 2 * DAY_MS,
    votingPeriod: 3 * DAY_MS,
    timelockDelay: 1 * DAY_MS,
  },
  protocol_upgrade: {
    createThreshold: 0.02,
    passThreshold: 0.66,
    quorum: 0.15,
    discussionPeriod: 7 * DAY_MS,
    votingPeriod: 7 * DAY_MS,
    timelockDelay: 14 * DAY_MS,
  },
  emergency: {
    createThreshold: 0,
    passThreshold: 0,
    quorum: 0,
    discussionPeriod: 0,
    votingPeriod: 0,
    timelockDelay: 0,
  },
  signal: {
    createThreshold: 0.0001,
    passThreshold: 0,
    quorum: 0.01,
    discussionPeriod: 1 * DAY_MS,
    votingPeriod: 3 * DAY_MS,
    timelockDelay: 0,
  },
};

// ---------------------------------------------------------------------------
// Governance Parameters (DAO-adjustable)
// ---------------------------------------------------------------------------

export interface GovernanceParams {
  proposalThreshold: number;
  quorum: number;
  votingDelay: number;
  votingPeriod: number;
  timelockDelay: number;
  passThreshold: number;
}

export const DEFAULT_GOVERNANCE_PARAMS: GovernanceParams = {
  proposalThreshold: 0.001,
  quorum: 0.04,
  votingDelay: 2 * DAY_MS,
  votingPeriod: 3 * DAY_MS,
  timelockDelay: 1 * DAY_MS,
  passThreshold: 0.5,
};
