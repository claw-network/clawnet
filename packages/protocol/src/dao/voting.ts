/**
 * DAO Governance — Voting Power Calculation
 *
 * Formula: totalPower = (sqrt(tokens) + sqrt(lockedTokens) * (lockupMult-1)) * reputationMult + delegatedPower
 *
 * - Token power uses square root to reduce whale dominance
 * - Reputation multiplier: 1.0 to 2.0 based on score (0..1000)
 * - Lockup multiplier: 1.0 to 3.0 based on lock duration (0..4 years)
 * - Delegation: delegated power is added directly
 */

import type { VotingPower, Delegation, ProposalType } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_REPUTATION_SCORE = 1000;
const MAX_REPUTATION_MULTIPLIER = 2.0;
const MIN_REPUTATION_MULTIPLIER = 1.0;

const MAX_LOCKUP_YEARS = 4;
const MAX_LOCKUP_MULTIPLIER = 3.0;
const MIN_LOCKUP_MULTIPLIER = 1.0;

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Voting Power Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the square-root-based token power.
 * Uses integer tokens (bigint string) and returns a floating-point number.
 */
export function tokenVotingPower(tokenBalance: string): number {
  const tokens = Number(BigInt(tokenBalance));
  if (tokens <= 0) return 0;
  return Math.sqrt(tokens);
}

/**
 * Reputation multiplier: linearly scales from 1.0 (score 0) to 2.0 (score 1000).
 */
export function reputationMultiplier(reputationScore: number): number {
  const clamped = Math.max(0, Math.min(MAX_REPUTATION_SCORE, reputationScore));
  return (
    MIN_REPUTATION_MULTIPLIER +
    (MAX_REPUTATION_MULTIPLIER - MIN_REPUTATION_MULTIPLIER) *
      (clamped / MAX_REPUTATION_SCORE)
  );
}

/**
 * Lockup multiplier: linearly scales from 1.0 (no lockup) to 3.0 (4 years).
 * @param lockupDurationMs lockup duration in milliseconds
 */
export function lockupMultiplier(lockupDurationMs: number): number {
  if (lockupDurationMs <= 0) return MIN_LOCKUP_MULTIPLIER;
  const years = Math.min(lockupDurationMs / YEAR_MS, MAX_LOCKUP_YEARS);
  return (
    MIN_LOCKUP_MULTIPLIER +
    (MAX_LOCKUP_MULTIPLIER - MIN_LOCKUP_MULTIPLIER) * (years / MAX_LOCKUP_YEARS)
  );
}

/**
 * Calculate full voting power for an agent.
 */
export function calculateVotingPower(opts: {
  tokenBalance: string;
  lockedTokens: string;
  lockupDurationMs: number;
  reputationScore: number;
  delegatedPower: number;
}): VotingPower {
  const tokenPwr = tokenVotingPower(opts.tokenBalance);
  const lockedPwr = tokenVotingPower(opts.lockedTokens);
  const lockMul = lockupMultiplier(opts.lockupDurationMs);
  const repMul = reputationMultiplier(opts.reputationScore);

  // (sqrt(tokens) + sqrt(lockedTokens) * (lockupMult - 1)) * reputationMult + delegated
  const basePower = (tokenPwr + lockedPwr * (lockMul - 1)) * repMul;
  const totalPower = basePower + opts.delegatedPower;

  return {
    tokenPower: tokenPwr,
    lockupMultiplier: lockMul,
    reputationMultiplier: repMul,
    delegatedPower: opts.delegatedPower,
    totalPower,
  };
}

// ---------------------------------------------------------------------------
// Delegation Helpers
// ---------------------------------------------------------------------------

/**
 * Whether a delegation matches a given proposal type.
 */
export function delegationMatchesScope(
  delegation: Delegation,
  proposalType: ProposalType,
): boolean {
  if (delegation.revokedAt !== undefined) return false;
  if (delegation.expiresAt !== undefined && Date.now() > delegation.expiresAt) return false;
  const scope = delegation.scope;
  if (scope.all) return true;
  if (scope.proposalTypes && scope.proposalTypes.includes(proposalType)) return true;
  // topics are not matched against proposal type directly
  return false;
}

/**
 * Calculate effective voting power considering delegations.
 */
export function calculateEffectiveVotingPower(opts: {
  ownPower: number;
  outgoingDelegations: Delegation[];
  incomingDelegations: Array<{ delegation: Delegation; delegatorPower: number }>;
  proposalType: ProposalType;
}): number {
  let delegatedOut = 0;
  for (const d of opts.outgoingDelegations) {
    if (delegationMatchesScope(d, opts.proposalType)) {
      delegatedOut += (opts.ownPower * d.percentage) / 100;
    }
  }

  let delegatedIn = 0;
  for (const { delegation, delegatorPower } of opts.incomingDelegations) {
    if (delegationMatchesScope(delegation, opts.proposalType)) {
      delegatedIn += (delegatorPower * delegation.percentage) / 100;
    }
  }

  return opts.ownPower - delegatedOut + delegatedIn;
}

/**
 * Detect circular delegation: A→B→A.
 */
export function hasCircularDelegation(
  delegator: string,
  delegate: string,
  delegations: Delegation[],
): boolean {
  const visited = new Set<string>();
  let current = delegate;
  while (current) {
    if (current === delegator) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    const next = delegations.find(
      (d) => d.delegator === current && !d.revokedAt,
    );
    if (!next) return false;
    current = next.delegate;
  }
  return false;
}
