/**
 * DAO Governance — Event Envelopes
 *
 * Event types:
 *   dao.proposal.create     — Create a new proposal
 *   dao.proposal.advance    — Advance proposal status
 *   dao.vote.cast           — Cast a vote
 *   dao.delegate.set        — Set delegation
 *   dao.delegate.revoke     — Revoke delegation
 *   dao.timelock.queue      — Queue action in timelock
 *   dao.timelock.execute    — Execute timelocked action
 *   dao.timelock.cancel     — Cancel timelocked action
 *   dao.treasury.deposit    — Deposit into treasury
 *   dao.treasury.spend      — Spend from treasury
 */

import { multibaseEncode } from '@claw-network/core/encoding';
import { publicKeyFromDid } from '@claw-network/core/identity';
import { EventEnvelope, eventHashHex, signEvent } from '@claw-network/core/protocol';
import type { ProposalAction, ProposalType, VoteOption, DelegationScope } from './types.js';
import { isProposalType, isVoteOption } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireNonEmpty(value: string, field: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function assertValidDid(value: string, field: string): void {
  requireNonEmpty(value, field);
  try {
    publicKeyFromDid(value);
  } catch {
    throw new Error(`${field} must be a valid did:claw identifier`);
  }
}

function normalizeAmount(value: string | number | bigint, field: string): string {
  let parsed: bigint;
  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${field} must be an integer`);
    }
    parsed = BigInt(value);
  } else {
    requireNonEmpty(value, field);
    parsed = BigInt(value);
  }
  if (parsed < 0n) {
    throw new Error(`${field} must be >= 0`);
  }
  return parsed.toString();
}

function buildEnvelope(
  type: string,
  issuer: string,
  publicKey: Uint8Array,
  payload: Record<string, unknown>,
  ts: number,
  nonce: number,
  prev?: string,
): EventEnvelope {
  return {
    v: 1,
    type,
    issuer,
    ts,
    nonce,
    payload,
    prev,
    sig: '',
    pub: multibaseEncode(publicKey),
    hash: '',
  };
}

// ---------------------------------------------------------------------------
// dao.proposal.create
// ---------------------------------------------------------------------------

export interface DaoProposalCreatePayload extends Record<string, unknown> {
  proposalId: string;
  type: ProposalType;
  title: string;
  description: string;
  discussionUrl?: string;
  actions: ProposalAction[];
  discussionPeriod: number;
  votingPeriod: number;
  timelockDelay: number;
}

export interface DaoProposalCreateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  proposalId: string;
  proposalType: ProposalType;
  title: string;
  description: string;
  discussionUrl?: string;
  actions: ProposalAction[];
  discussionPeriod: number;
  votingPeriod: number;
  timelockDelay: number;
  ts: number;
  nonce: number;
  prev?: string;
}

export function parseDaoProposalCreatePayload(
  raw: Record<string, unknown>,
): DaoProposalCreatePayload {
  const proposalId = String(raw.proposalId ?? '');
  requireNonEmpty(proposalId, 'proposalId');

  const typeValue = String(raw.type ?? '');
  if (!isProposalType(typeValue)) {
    throw new Error('type must be a valid proposal type');
  }

  const title = String(raw.title ?? '');
  requireNonEmpty(title, 'title');

  const description = String(raw.description ?? '');
  requireNonEmpty(description, 'description');

  const discussionUrl =
    raw.discussionUrl !== undefined && raw.discussionUrl !== null
      ? String(raw.discussionUrl)
      : undefined;

  const actions = raw.actions as ProposalAction[];
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error('actions must be a non-empty array');
  }

  const discussionPeriod = Number(raw.discussionPeriod ?? 0);
  const votingPeriod = Number(raw.votingPeriod ?? 0);
  const timelockDelay = Number(raw.timelockDelay ?? 0);

  if (votingPeriod <= 0 && typeValue !== 'emergency' && typeValue !== 'signal') {
    throw new Error('votingPeriod must be > 0');
  }

  return {
    proposalId,
    type: typeValue,
    title,
    description,
    discussionUrl,
    actions,
    discussionPeriod,
    votingPeriod,
    timelockDelay,
  };
}

export async function createDaoProposalCreateEnvelope(
  params: DaoProposalCreateEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const publicKey = publicKeyFromDid(params.issuer);
  const payload = parseDaoProposalCreatePayload({
    proposalId: params.proposalId,
    type: params.proposalType,
    title: params.title,
    description: params.description,
    discussionUrl: params.discussionUrl,
    actions: params.actions,
    discussionPeriod: params.discussionPeriod,
    votingPeriod: params.votingPeriod,
    timelockDelay: params.timelockDelay,
  });

  const base = buildEnvelope(
    'dao.proposal.create',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(base);
  const sig = await signEvent(base, params.privateKey);
  return { ...base, hash, sig };
}

// ---------------------------------------------------------------------------
// dao.proposal.advance
// ---------------------------------------------------------------------------

export interface DaoProposalAdvancePayload extends Record<string, unknown> {
  proposalId: string;
  newStatus: string;
  resourcePrev: string;
}

export interface DaoProposalAdvanceEventParams {
  issuer: string;
  privateKey: Uint8Array;
  proposalId: string;
  newStatus: string;
  resourcePrev: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export function parseDaoProposalAdvancePayload(
  raw: Record<string, unknown>,
): DaoProposalAdvancePayload {
  const proposalId = String(raw.proposalId ?? '');
  requireNonEmpty(proposalId, 'proposalId');
  const newStatus = String(raw.newStatus ?? '');
  requireNonEmpty(newStatus, 'newStatus');
  const resourcePrev = String(raw.resourcePrev ?? '');
  requireNonEmpty(resourcePrev, 'resourcePrev');
  return { proposalId, newStatus, resourcePrev };
}

export async function createDaoProposalAdvanceEnvelope(
  params: DaoProposalAdvanceEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const publicKey = publicKeyFromDid(params.issuer);
  const payload = parseDaoProposalAdvancePayload({
    proposalId: params.proposalId,
    newStatus: params.newStatus,
    resourcePrev: params.resourcePrev,
  });
  const base = buildEnvelope(
    'dao.proposal.advance',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(base);
  const sig = await signEvent(base, params.privateKey);
  return { ...base, hash, sig };
}

// ---------------------------------------------------------------------------
// dao.vote.cast
// ---------------------------------------------------------------------------

export interface DaoVoteCastPayload extends Record<string, unknown> {
  proposalId: string;
  option: VoteOption;
  power: string;
  reason?: string;
}

export interface DaoVoteCastEventParams {
  issuer: string;
  privateKey: Uint8Array;
  proposalId: string;
  option: VoteOption;
  power: string | number | bigint;
  reason?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export function parseDaoVoteCastPayload(
  raw: Record<string, unknown>,
): DaoVoteCastPayload {
  const proposalId = String(raw.proposalId ?? '');
  requireNonEmpty(proposalId, 'proposalId');

  const optionValue = String(raw.option ?? '');
  if (!isVoteOption(optionValue)) {
    throw new Error('option must be for, against, or abstain');
  }

  const power = normalizeAmount(raw.power as string, 'power');

  const reason =
    raw.reason !== undefined && raw.reason !== null
      ? String(raw.reason).trim() || undefined
      : undefined;

  return { proposalId, option: optionValue, power, reason };
}

export async function createDaoVoteCastEnvelope(
  params: DaoVoteCastEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const publicKey = publicKeyFromDid(params.issuer);
  const payload = parseDaoVoteCastPayload({
    proposalId: params.proposalId,
    option: params.option,
    power: normalizeAmount(params.power, 'power'),
    reason: params.reason,
  });
  const base = buildEnvelope(
    'dao.vote.cast',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(base);
  const sig = await signEvent(base, params.privateKey);
  return { ...base, hash, sig };
}

// ---------------------------------------------------------------------------
// dao.delegate.set
// ---------------------------------------------------------------------------

export interface DaoDelegateSetPayload extends Record<string, unknown> {
  delegate: string;
  scope: DelegationScope;
  percentage: number;
  expiresAt?: number;
}

export interface DaoDelegateSetEventParams {
  issuer: string;
  privateKey: Uint8Array;
  delegate: string;
  scope: DelegationScope;
  percentage: number;
  expiresAt?: number;
  ts: number;
  nonce: number;
  prev?: string;
}

export function parseDaoDelegateSetPayload(
  raw: Record<string, unknown>,
): DaoDelegateSetPayload {
  const delegate = String(raw.delegate ?? '');
  assertValidDid(delegate, 'delegate');

  const scope = (raw.scope ?? { all: true }) as DelegationScope;
  const percentage = Number(raw.percentage ?? 100);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('percentage must be between 0 and 100');
  }

  const expiresAt =
    typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt)
      ? raw.expiresAt
      : undefined;

  return { delegate, scope, percentage, expiresAt };
}

export async function createDaoDelegateSetEnvelope(
  params: DaoDelegateSetEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const publicKey = publicKeyFromDid(params.issuer);
  const payload = parseDaoDelegateSetPayload({
    delegate: params.delegate,
    scope: params.scope,
    percentage: params.percentage,
    expiresAt: params.expiresAt,
  });
  const base = buildEnvelope(
    'dao.delegate.set',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(base);
  const sig = await signEvent(base, params.privateKey);
  return { ...base, hash, sig };
}

// ---------------------------------------------------------------------------
// dao.delegate.revoke
// ---------------------------------------------------------------------------

export interface DaoDelegateRevokePayload extends Record<string, unknown> {
  delegate: string;
}

export interface DaoDelegateRevokeEventParams {
  issuer: string;
  privateKey: Uint8Array;
  delegate: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export function parseDaoDelegateRevokePayload(
  raw: Record<string, unknown>,
): DaoDelegateRevokePayload {
  const delegate = String(raw.delegate ?? '');
  assertValidDid(delegate, 'delegate');
  return { delegate };
}

export async function createDaoDelegateRevokeEnvelope(
  params: DaoDelegateRevokeEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const publicKey = publicKeyFromDid(params.issuer);
  const payload = parseDaoDelegateRevokePayload({ delegate: params.delegate });
  const base = buildEnvelope(
    'dao.delegate.revoke',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(base);
  const sig = await signEvent(base, params.privateKey);
  return { ...base, hash, sig };
}

// ---------------------------------------------------------------------------
// dao.timelock.queue
// ---------------------------------------------------------------------------

export interface DaoTimelockQueuePayload extends Record<string, unknown> {
  actionId: string;
  proposalId: string;
  action: ProposalAction;
  executeAfter: number;
}

export interface DaoTimelockQueueEventParams {
  issuer: string;
  privateKey: Uint8Array;
  actionId: string;
  proposalId: string;
  action: ProposalAction;
  executeAfter: number;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createDaoTimelockQueueEnvelope(
  params: DaoTimelockQueueEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const publicKey = publicKeyFromDid(params.issuer);
  requireNonEmpty(params.actionId, 'actionId');
  requireNonEmpty(params.proposalId, 'proposalId');

  const payload: DaoTimelockQueuePayload = {
    actionId: params.actionId,
    proposalId: params.proposalId,
    action: params.action,
    executeAfter: params.executeAfter,
  };
  const base = buildEnvelope(
    'dao.timelock.queue',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(base);
  const sig = await signEvent(base, params.privateKey);
  return { ...base, hash, sig };
}

// ---------------------------------------------------------------------------
// dao.timelock.execute
// ---------------------------------------------------------------------------

export interface DaoTimelockExecutePayload extends Record<string, unknown> {
  actionId: string;
}

export interface DaoTimelockExecuteEventParams {
  issuer: string;
  privateKey: Uint8Array;
  actionId: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createDaoTimelockExecuteEnvelope(
  params: DaoTimelockExecuteEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  requireNonEmpty(params.actionId, 'actionId');
  const publicKey = publicKeyFromDid(params.issuer);
  const payload: DaoTimelockExecutePayload = { actionId: params.actionId };
  const base = buildEnvelope(
    'dao.timelock.execute',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(base);
  const sig = await signEvent(base, params.privateKey);
  return { ...base, hash, sig };
}

// ---------------------------------------------------------------------------
// dao.timelock.cancel
// ---------------------------------------------------------------------------

export interface DaoTimelockCancelPayload extends Record<string, unknown> {
  actionId: string;
  reason: string;
}

export interface DaoTimelockCancelEventParams {
  issuer: string;
  privateKey: Uint8Array;
  actionId: string;
  reason: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createDaoTimelockCancelEnvelope(
  params: DaoTimelockCancelEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  requireNonEmpty(params.actionId, 'actionId');
  requireNonEmpty(params.reason, 'reason');
  const publicKey = publicKeyFromDid(params.issuer);
  const payload: DaoTimelockCancelPayload = {
    actionId: params.actionId,
    reason: params.reason,
  };
  const base = buildEnvelope(
    'dao.timelock.cancel',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(base);
  const sig = await signEvent(base, params.privateKey);
  return { ...base, hash, sig };
}

// ---------------------------------------------------------------------------
// dao.treasury.deposit
// ---------------------------------------------------------------------------

export interface DaoTreasuryDepositPayload extends Record<string, unknown> {
  amount: string;
  source: string;
}

export interface DaoTreasuryDepositEventParams {
  issuer: string;
  privateKey: Uint8Array;
  amount: string | number | bigint;
  source: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createDaoTreasuryDepositEnvelope(
  params: DaoTreasuryDepositEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  const amount = normalizeAmount(params.amount, 'amount');
  if (BigInt(amount) <= 0n) {
    throw new Error('amount must be > 0');
  }
  requireNonEmpty(params.source, 'source');
  const publicKey = publicKeyFromDid(params.issuer);
  const payload: DaoTreasuryDepositPayload = {
    amount,
    source: params.source,
  };
  const base = buildEnvelope(
    'dao.treasury.deposit',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(base);
  const sig = await signEvent(base, params.privateKey);
  return { ...base, hash, sig };
}

// ---------------------------------------------------------------------------
// dao.treasury.spend
// ---------------------------------------------------------------------------

export interface DaoTreasurySpendPayload extends Record<string, unknown> {
  proposalId: string;
  recipient: string;
  amount: string;
  purpose: string;
}

export interface DaoTreasurySpendEventParams {
  issuer: string;
  privateKey: Uint8Array;
  proposalId: string;
  recipient: string;
  amount: string | number | bigint;
  purpose: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export async function createDaoTreasurySpendEnvelope(
  params: DaoTreasurySpendEventParams,
): Promise<EventEnvelope> {
  assertValidDid(params.issuer, 'issuer');
  requireNonEmpty(params.proposalId, 'proposalId');
  assertValidDid(params.recipient, 'recipient');
  requireNonEmpty(params.purpose, 'purpose');
  const amount = normalizeAmount(params.amount, 'amount');
  if (BigInt(amount) <= 0n) {
    throw new Error('amount must be > 0');
  }
  const publicKey = publicKeyFromDid(params.issuer);
  const payload: DaoTreasurySpendPayload = {
    proposalId: params.proposalId,
    recipient: params.recipient,
    amount,
    purpose: params.purpose,
  };
  const base = buildEnvelope(
    'dao.treasury.spend',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(base);
  const sig = await signEvent(base, params.privateKey);
  return { ...base, hash, sig };
}
