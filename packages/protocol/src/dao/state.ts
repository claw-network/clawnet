/**
 * DAO Governance — State & Reducer
 *
 * Pure, deterministic state transitions for DAO events.
 */

import { EventEnvelope, eventHashHex } from '@clawtoken/core/protocol';
import type {
  Proposal,
  ProposalStatus,
  ProposalType,
  ProposalVotes,
  Vote,
  Delegation,
  TimelockEntry,
  Treasury,
  ProposalAction,
} from './types.js';
import { isProposalStatus, PROPOSAL_THRESHOLDS } from './types.js';
import type {
  DaoProposalCreatePayload,
  DaoProposalAdvancePayload,
  DaoVoteCastPayload,
  DaoDelegateSetPayload,
  DaoDelegateRevokePayload,
  DaoTimelockQueuePayload,
  DaoTimelockExecutePayload,
  DaoTimelockCancelPayload,
  DaoTreasuryDepositPayload,
  DaoTreasurySpendPayload,
} from './events.js';

// ---------------------------------------------------------------------------
// DAO State
// ---------------------------------------------------------------------------

export interface DaoHistoryEntry {
  hash: string;
  type: string;
  ts: number;
  payload: Record<string, unknown>;
}

export interface DaoState {
  proposals: Record<string, Proposal>;
  proposalEvents: Record<string, string>; // proposalId → last event hash
  votes: Record<string, Vote[]>; // proposalId → votes
  voterIndex: Record<string, Set<string>>; // proposalId → set of voter DIDs
  delegations: Delegation[];
  delegationsByDelegator: Record<string, Delegation[]>;
  delegationsByDelegate: Record<string, Delegation[]>;
  timelock: Record<string, TimelockEntry>;
  treasury: Treasury;
  history: DaoHistoryEntry[];
}

export function createDaoState(): DaoState {
  return {
    proposals: {},
    proposalEvents: {},
    votes: {},
    voterIndex: {},
    delegations: [],
    delegationsByDelegator: {},
    delegationsByDelegate: {},
    timelock: {},
    treasury: {
      balance: '0',
      allocationPolicy: {
        development: 0.4,
        nodeRewards: 0.3,
        ecosystem: 0.2,
        reserve: 0.1,
      },
      spendingLimits: {
        perProposal: '1000000',
        perQuarter: '5000000',
        requireMultisig: '10000000',
      },
      totalSpent: '0',
      spentThisQuarter: '0',
      quarterStart: 0,
    },
    history: [],
  };
}

// ---------------------------------------------------------------------------
// Clone helpers
// ---------------------------------------------------------------------------

function cloneState(state: DaoState): DaoState {
  return {
    proposals: { ...state.proposals },
    proposalEvents: { ...state.proposalEvents },
    votes: { ...state.votes },
    voterIndex: { ...state.voterIndex },
    delegations: [...state.delegations],
    delegationsByDelegator: { ...state.delegationsByDelegator },
    delegationsByDelegate: { ...state.delegationsByDelegate },
    timelock: { ...state.timelock },
    treasury: { ...state.treasury },
    history: [...state.history],
  };
}

function parseAmount(value: string, field: string): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new Error(`${field} must be >= 0`);
    }
    return parsed;
  } catch {
    throw new Error(`${field} must be a valid integer string`);
  }
}

function addAmount(current: string, delta: bigint, field: string): string {
  const base = parseAmount(current, field);
  const next = base + delta;
  if (next < 0n) {
    throw new Error(`${field} would be negative`);
  }
  return next.toString();
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function applyDaoEvent(
  state: DaoState,
  envelope: EventEnvelope,
): DaoState {
  const type = String(envelope.type ?? '');
  if (!type.startsWith('dao.')) {
    return state;
  }

  const next = cloneState(state);
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
  const issuer = typeof envelope.issuer === 'string' ? envelope.issuer : '';
  const hash =
    typeof envelope.hash === 'string' && envelope.hash.length
      ? envelope.hash
      : eventHashHex(envelope);

  switch (type) {
    case 'dao.proposal.create':
      applyProposalCreate(next, payload as unknown as DaoProposalCreatePayload, issuer, ts, hash);
      break;
    case 'dao.proposal.advance':
      applyProposalAdvance(next, payload as unknown as DaoProposalAdvancePayload, hash);
      break;
    case 'dao.vote.cast':
      applyVoteCast(next, payload as unknown as DaoVoteCastPayload, issuer, ts, hash);
      break;
    case 'dao.delegate.set':
      applyDelegateSet(next, payload as unknown as DaoDelegateSetPayload, issuer, ts);
      break;
    case 'dao.delegate.revoke':
      applyDelegateRevoke(next, payload as unknown as DaoDelegateRevokePayload, issuer, ts);
      break;
    case 'dao.timelock.queue':
      applyTimelockQueue(next, payload as unknown as DaoTimelockQueuePayload, ts);
      break;
    case 'dao.timelock.execute':
      applyTimelockExecute(next, payload as unknown as DaoTimelockExecutePayload);
      break;
    case 'dao.timelock.cancel':
      applyTimelockCancel(next, payload as unknown as DaoTimelockCancelPayload);
      break;
    case 'dao.treasury.deposit':
      applyTreasuryDeposit(next, payload as unknown as DaoTreasuryDepositPayload);
      break;
    case 'dao.treasury.spend':
      applyTreasurySpend(next, payload as unknown as DaoTreasurySpendPayload);
      break;
    default:
      return next;
  }

  next.history.push({ hash, type, ts, payload });
  return next;
}

// ---------------------------------------------------------------------------
// Apply functions
// ---------------------------------------------------------------------------

function applyProposalCreate(
  state: DaoState,
  payload: DaoProposalCreatePayload,
  issuer: string,
  ts: number,
  hash: string,
): void {
  if (state.proposals[payload.proposalId]) {
    throw new Error('proposal already exists');
  }

  const thresholds = PROPOSAL_THRESHOLDS[payload.type];
  const discussionPeriod = payload.discussionPeriod || thresholds.discussionPeriod;
  const votingPeriod = payload.votingPeriod || thresholds.votingPeriod;
  const timelockDelay = payload.timelockDelay || thresholds.timelockDelay;

  const discussionEndsAt = ts + discussionPeriod;
  const votingStartsAt = discussionEndsAt;
  const votingEndsAt = votingStartsAt + votingPeriod;
  const expiresAt = votingEndsAt + timelockDelay + 30 * 24 * 60 * 60 * 1000; // 30 day grace

  const proposal: Proposal = {
    id: payload.proposalId,
    proposer: issuer,
    type: payload.type,
    title: payload.title,
    description: payload.description,
    discussionUrl: payload.discussionUrl,
    actions: payload.actions,
    timeline: {
      createdAt: ts,
      discussionEndsAt,
      votingStartsAt,
      votingEndsAt,
      executionDelay: timelockDelay,
      expiresAt,
    },
    votes: { for: '0', against: '0', abstain: '0' },
    status: discussionPeriod > 0 ? 'discussion' : 'voting',
  };

  state.proposals[payload.proposalId] = proposal;
  state.proposalEvents[payload.proposalId] = hash;
  state.votes[payload.proposalId] = [];
  state.voterIndex[payload.proposalId] = new Set();
}

function applyProposalAdvance(
  state: DaoState,
  payload: DaoProposalAdvancePayload,
  hash: string,
): void {
  const proposal = state.proposals[payload.proposalId];
  if (!proposal) {
    throw new Error('proposal not found');
  }

  const newStatus = payload.newStatus;
  if (!isProposalStatus(newStatus)) {
    throw new Error('invalid proposal status');
  }

  // Validate status transitions
  const validTransitions: Record<string, ProposalStatus[]> = {
    draft: ['discussion', 'voting'],
    discussion: ['voting'],
    voting: ['passed', 'rejected'],
    passed: ['queued', 'executed'],
    queued: ['executed', 'vetoed'],
    rejected: [],
    executed: [],
    expired: [],
    vetoed: [],
  };

  const allowed = validTransitions[proposal.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `cannot transition from ${proposal.status} to ${newStatus}`,
    );
  }

  state.proposals[payload.proposalId] = { ...proposal, status: newStatus };
  state.proposalEvents[payload.proposalId] = hash;
}

function applyVoteCast(
  state: DaoState,
  payload: DaoVoteCastPayload,
  issuer: string,
  ts: number,
  hash: string,
): void {
  const proposal = state.proposals[payload.proposalId];
  if (!proposal) {
    throw new Error('proposal not found');
  }
  if (proposal.status !== 'voting') {
    throw new Error('proposal is not in voting phase');
  }

  // Check duplicate vote
  const voterSet = state.voterIndex[payload.proposalId];
  if (voterSet && voterSet.has(issuer)) {
    throw new Error('already voted');
  }

  const vote: Vote = {
    voter: issuer,
    proposalId: payload.proposalId,
    option: payload.option,
    power: payload.power,
    reason: payload.reason,
    ts,
    hash,
  };

  // Record vote
  const currentVotes = state.votes[payload.proposalId] ?? [];
  state.votes[payload.proposalId] = [...currentVotes, vote];

  const voterIndex = state.voterIndex[payload.proposalId] ?? new Set();
  const newVoterIndex = new Set(voterIndex);
  newVoterIndex.add(issuer);
  state.voterIndex[payload.proposalId] = newVoterIndex;

  // Update tally
  const power = parseAmount(payload.power, 'power');
  const updatedVotes: ProposalVotes = { ...proposal.votes };
  updatedVotes[payload.option] = addAmount(
    updatedVotes[payload.option],
    power,
    payload.option,
  );

  state.proposals[payload.proposalId] = { ...proposal, votes: updatedVotes };
}

function applyDelegateSet(
  state: DaoState,
  payload: DaoDelegateSetPayload,
  issuer: string,
  ts: number,
): void {
  // Remove any existing delegation from this delegator to this delegate
  state.delegations = state.delegations.filter(
    (d) => !(d.delegator === issuer && d.delegate === payload.delegate && !d.revokedAt),
  );

  const delegation: Delegation = {
    delegator: issuer,
    delegate: payload.delegate,
    scope: payload.scope,
    percentage: payload.percentage,
    expiresAt: payload.expiresAt,
    revokedAt: undefined,
    createdAt: ts,
  };

  state.delegations.push(delegation);

  // Update indices
  const byDelegator = (state.delegationsByDelegator[issuer] ?? []).filter(
    (d) => !(d.delegate === payload.delegate && !d.revokedAt),
  );
  byDelegator.push(delegation);
  state.delegationsByDelegator[issuer] = byDelegator;

  const byDelegate = (state.delegationsByDelegate[payload.delegate] ?? []).filter(
    (d) => !(d.delegator === issuer && !d.revokedAt),
  );
  byDelegate.push(delegation);
  state.delegationsByDelegate[payload.delegate] = byDelegate;
}

function applyDelegateRevoke(
  state: DaoState,
  payload: DaoDelegateRevokePayload,
  issuer: string,
  ts: number,
): void {
  for (const d of state.delegations) {
    if (d.delegator === issuer && d.delegate === payload.delegate && !d.revokedAt) {
      d.revokedAt = ts;
    }
  }
  // Update indices to mark revoked
  const byDelegator = state.delegationsByDelegator[issuer] ?? [];
  for (const d of byDelegator) {
    if (d.delegate === payload.delegate && !d.revokedAt) {
      d.revokedAt = ts;
    }
  }
  const byDelegate = state.delegationsByDelegate[payload.delegate] ?? [];
  for (const d of byDelegate) {
    if (d.delegator === issuer && !d.revokedAt) {
      d.revokedAt = ts;
    }
  }
}

function applyTimelockQueue(
  state: DaoState,
  payload: DaoTimelockQueuePayload,
  ts: number,
): void {
  if (state.timelock[payload.actionId]) {
    throw new Error('action already queued');
  }
  state.timelock[payload.actionId] = {
    actionId: payload.actionId,
    proposalId: payload.proposalId,
    action: payload.action as ProposalAction,
    queuedAt: ts,
    executeAfter: payload.executeAfter,
    status: 'queued',
  };
}

function applyTimelockExecute(
  state: DaoState,
  payload: DaoTimelockExecutePayload,
): void {
  const entry = state.timelock[payload.actionId];
  if (!entry) {
    throw new Error('action not found');
  }
  if (entry.status !== 'queued') {
    throw new Error('action is not queued');
  }
  state.timelock[payload.actionId] = { ...entry, status: 'executed' };
}

function applyTimelockCancel(
  state: DaoState,
  payload: DaoTimelockCancelPayload,
): void {
  const entry = state.timelock[payload.actionId];
  if (!entry) {
    throw new Error('action not found');
  }
  if (entry.status !== 'queued') {
    throw new Error('action is not queued');
  }
  state.timelock[payload.actionId] = { ...entry, status: 'cancelled' };
}

function applyTreasuryDeposit(
  state: DaoState,
  payload: DaoTreasuryDepositPayload,
): void {
  const amount = parseAmount(payload.amount, 'amount');
  state.treasury = {
    ...state.treasury,
    balance: addAmount(state.treasury.balance, amount, 'balance'),
  };
}

function applyTreasurySpend(
  state: DaoState,
  payload: DaoTreasurySpendPayload,
): void {
  const amount = parseAmount(payload.amount, 'amount');
  state.treasury = {
    ...state.treasury,
    balance: addAmount(state.treasury.balance, -amount, 'balance'),
    totalSpent: addAmount(state.treasury.totalSpent, amount, 'totalSpent'),
    spentThisQuarter: addAmount(state.treasury.spentThisQuarter, amount, 'spentThisQuarter'),
  };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function getProposal(state: DaoState, proposalId: string): Proposal | undefined {
  return state.proposals[proposalId];
}

export function listProposals(state: DaoState, status?: ProposalStatus): Proposal[] {
  const all = Object.values(state.proposals);
  if (!status) return all;
  return all.filter((p) => p.status === status);
}

export function getProposalVotes(state: DaoState, proposalId: string): Vote[] {
  return state.votes[proposalId] ?? [];
}

export function getDelegationsFrom(state: DaoState, delegator: string): Delegation[] {
  return (state.delegationsByDelegator[delegator] ?? []).filter((d) => !d.revokedAt);
}

export function getDelegationsTo(state: DaoState, delegate: string): Delegation[] {
  return (state.delegationsByDelegate[delegate] ?? []).filter((d) => !d.revokedAt);
}

export function getTimelockEntry(state: DaoState, actionId: string): TimelockEntry | undefined {
  return state.timelock[actionId];
}

export function listTimelockEntries(state: DaoState): TimelockEntry[] {
  return Object.values(state.timelock);
}

export function getTreasury(state: DaoState): Treasury {
  return state.treasury;
}

/**
 * Check if a proposal has passed (based on votes vs thresholds).
 */
export function checkProposalResult(
  state: DaoState,
  proposalId: string,
  totalSupply: string,
): { passed: boolean; forPct: number; quorumMet: boolean } {
  const proposal = state.proposals[proposalId];
  if (!proposal) {
    return { passed: false, forPct: 0, quorumMet: false };
  }
  const thresholds = PROPOSAL_THRESHOLDS[proposal.type];
  const forVotes = BigInt(proposal.votes.for);
  const againstVotes = BigInt(proposal.votes.against);
  const abstainVotes = BigInt(proposal.votes.abstain);
  const totalVoted = forVotes + againstVotes + abstainVotes;
  const supply = BigInt(totalSupply);

  const quorumMet = supply > 0n
    ? Number(totalVoted * 10000n / supply) / 10000 >= thresholds.quorum
    : false;

  const forPlusAgainst = forVotes + againstVotes;
  const forPct = forPlusAgainst > 0n
    ? Number(forVotes * 10000n / forPlusAgainst) / 10000
    : 0;

  const passed = quorumMet && forPct >= thresholds.passThreshold;
  return { passed, forPct, quorumMet };
}
