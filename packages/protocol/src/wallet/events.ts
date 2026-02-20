import { EventEnvelope, eventHashHex, signEvent } from '@claw-network/core/protocol';
import { multibaseEncode } from '@claw-network/core/encoding';
import { addressFromDid, publicKeyFromAddress, publicKeyFromDid } from '@claw-network/core/identity';

export type AmountLike = string | number | bigint;

const MIN_TRANSFER_AMOUNT = 1n;
const MIN_ESCROW_AMOUNT = 1n;
const MIN_FEE = 1n;

export interface WalletTransferPayload extends Record<string, unknown> {
  from: string;
  to: string;
  amount: string;
  fee: string;
  memo?: string;
}

export interface WalletMintPayload extends Record<string, unknown> {
  to: string;
  amount: string;
  reason?: string;
}

export interface WalletEscrowCreatePayload extends Record<string, unknown> {
  escrowId: string;
  depositor: string;
  beneficiary: string;
  amount: string;
  releaseRules: Record<string, unknown>[];
  resourcePrev?: string | null;
  arbiter?: string;
  refundRules?: Record<string, unknown>[];
  expiresAt?: number;
}

export interface WalletEscrowFundPayload extends Record<string, unknown> {
  escrowId: string;
  resourcePrev: string;
  amount: string;
}

export interface WalletEscrowReleasePayload extends Record<string, unknown> {
  escrowId: string;
  resourcePrev: string;
  amount: string;
  ruleId: string;
}

export interface WalletEscrowRefundPayload extends Record<string, unknown> {
  escrowId: string;
  resourcePrev: string;
  amount: string;
  reason: string;
  evidence?: Record<string, unknown>[];
}

export interface WalletMintEventParams {
  issuer: string;
  privateKey: Uint8Array;
  to: string;
  amount: AmountLike;
  reason?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface WalletTransferEventParams {
  issuer: string;
  privateKey: Uint8Array;
  from: string;
  to: string;
  amount: AmountLike;
  fee: AmountLike;
  memo?: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface WalletEscrowCreateEventParams {
  issuer: string;
  privateKey: Uint8Array;
  escrowId: string;
  depositor: string;
  beneficiary: string;
  amount: AmountLike;
  releaseRules: Record<string, unknown>[];
  resourcePrev?: string | null;
  arbiter?: string;
  refundRules?: Record<string, unknown>[];
  expiresAt?: number;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface WalletEscrowFundEventParams {
  issuer: string;
  privateKey: Uint8Array;
  escrowId: string;
  resourcePrev: string;
  amount: AmountLike;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface WalletEscrowReleaseEventParams {
  issuer: string;
  privateKey: Uint8Array;
  escrowId: string;
  resourcePrev: string;
  amount: AmountLike;
  ruleId: string;
  ts: number;
  nonce: number;
  prev?: string;
}

export interface WalletEscrowRefundEventParams {
  issuer: string;
  privateKey: Uint8Array;
  escrowId: string;
  resourcePrev: string;
  amount: AmountLike;
  reason: string;
  evidence?: Record<string, unknown>[];
  ts: number;
  nonce: number;
  prev?: string;
}

function requireNonEmpty(value: string, field: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function assertValidAddress(value: string, field: string): void {
  requireNonEmpty(value, field);
  try {
    publicKeyFromAddress(value);
  } catch {
    throw new Error(`${field} must be a valid claw address`);
  }
}

function normalizeAmount(value: AmountLike, field: string): string {
  let parsed: bigint;
  if (typeof value === 'bigint') {
    parsed = value;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${field} must be an integer`);
    }
    parsed = BigInt(value);
  } else {
    if (value.trim().length === 0) {
      throw new Error(`${field} is required`);
    }
    parsed = BigInt(value);
  }
  if (parsed < 0n) {
    throw new Error(`${field} must be >= 0`);
  }
  return parsed.toString();
}

function assertMinAmount(value: AmountLike, min: bigint, field: string): string {
  const normalized = normalizeAmount(value, field);
  if (BigInt(normalized) < min) {
    throw new Error(`${field} must be >= ${min}`);
  }
  return normalized;
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

export async function createWalletMintEnvelope(
  params: WalletMintEventParams,
): Promise<EventEnvelope> {
  assertValidAddress(params.to, 'to');
  const amount = assertMinAmount(params.amount, 1n, 'amount');
  const payload: WalletMintPayload = {
    to: params.to,
    amount,
    reason: params.reason,
  };
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'wallet.mint',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createWalletTransferEnvelope(
  params: WalletTransferEventParams,
): Promise<EventEnvelope> {
  assertValidAddress(params.from, 'from');
  assertValidAddress(params.to, 'to');
  const derived = addressFromDid(params.issuer);
  if (derived !== params.from) {
    throw new Error('issuer must control from address');
  }
  const amount = assertMinAmount(params.amount, MIN_TRANSFER_AMOUNT, 'amount');
  const fee = assertMinAmount(params.fee, MIN_FEE, 'fee');
  const payload: WalletTransferPayload = {
    from: params.from,
    to: params.to,
    amount,
    fee,
    memo: params.memo,
  };
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'wallet.transfer',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createWalletEscrowCreateEnvelope(
  params: WalletEscrowCreateEventParams,
): Promise<EventEnvelope> {
  requireNonEmpty(params.escrowId, 'escrowId');
  assertValidAddress(params.depositor, 'depositor');
  assertValidAddress(params.beneficiary, 'beneficiary');
  const amount = assertMinAmount(params.amount, MIN_ESCROW_AMOUNT, 'amount');
  if (!params.releaseRules?.length) {
    throw new Error('releaseRules is required');
  }
  const payload: WalletEscrowCreatePayload = {
    escrowId: params.escrowId,
    depositor: params.depositor,
    beneficiary: params.beneficiary,
    amount,
    releaseRules: params.releaseRules,
    resourcePrev: params.resourcePrev,
    arbiter: params.arbiter,
    refundRules: params.refundRules,
    expiresAt: params.expiresAt,
  };
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'wallet.escrow.create',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createWalletEscrowFundEnvelope(
  params: WalletEscrowFundEventParams,
): Promise<EventEnvelope> {
  requireNonEmpty(params.escrowId, 'escrowId');
  requireNonEmpty(params.resourcePrev, 'resourcePrev');
  const amount = assertMinAmount(params.amount, MIN_ESCROW_AMOUNT, 'amount');
  const payload: WalletEscrowFundPayload = {
    escrowId: params.escrowId,
    resourcePrev: params.resourcePrev,
    amount,
  };
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'wallet.escrow.fund',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createWalletEscrowReleaseEnvelope(
  params: WalletEscrowReleaseEventParams,
): Promise<EventEnvelope> {
  requireNonEmpty(params.escrowId, 'escrowId');
  requireNonEmpty(params.resourcePrev, 'resourcePrev');
  requireNonEmpty(params.ruleId, 'ruleId');
  const amount = assertMinAmount(params.amount, MIN_ESCROW_AMOUNT, 'amount');
  const payload: WalletEscrowReleasePayload = {
    escrowId: params.escrowId,
    resourcePrev: params.resourcePrev,
    amount,
    ruleId: params.ruleId,
  };
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'wallet.escrow.release',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}

export async function createWalletEscrowRefundEnvelope(
  params: WalletEscrowRefundEventParams,
): Promise<EventEnvelope> {
  requireNonEmpty(params.escrowId, 'escrowId');
  requireNonEmpty(params.resourcePrev, 'resourcePrev');
  requireNonEmpty(params.reason, 'reason');
  const amount = assertMinAmount(params.amount, MIN_ESCROW_AMOUNT, 'amount');
  const payload: WalletEscrowRefundPayload = {
    escrowId: params.escrowId,
    resourcePrev: params.resourcePrev,
    amount,
    reason: params.reason,
    evidence: params.evidence,
  };
  const publicKey = publicKeyFromDid(params.issuer);
  const baseEnvelope = buildEnvelope(
    'wallet.escrow.refund',
    params.issuer,
    publicKey,
    payload,
    params.ts,
    params.nonce,
    params.prev,
  );
  const hash = eventHashHex(baseEnvelope);
  const sig = await signEvent(baseEnvelope, params.privateKey);
  return { ...baseEnvelope, hash, sig };
}
