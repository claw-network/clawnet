import { EventEnvelope, eventHashHex } from '@clawnet/core/protocol';
import type {
  WalletEscrowCreatePayload,
  WalletEscrowFundPayload,
  WalletEscrowRefundPayload,
  WalletEscrowReleasePayload,
  WalletMintPayload,
  WalletTransferPayload,
} from './events.js';

export interface WalletBalance {
  available: string;
  pending: string;
  locked: {
    escrow: string;
    governance: string;
  };
}

export interface EscrowState {
  escrowId: string;
  depositor: string;
  beneficiary: string;
  balance: string;
  status: 'pending' | 'funded' | 'releasing' | 'released' | 'refunded' | 'disputed';
  expiresAt?: number;
}

export interface WalletHistoryEntry {
  hash: string;
  type: string;
  ts: number;
  payload: Record<string, unknown>;
}

export interface WalletState {
  balances: Record<string, WalletBalance>;
  escrows: Record<string, EscrowState>;
  history: WalletHistoryEntry[];
}

export function createWalletState(): WalletState {
  return {
    balances: {},
    escrows: {},
    history: [],
  };
}

export function getWalletBalance(state: WalletState, address: string): WalletBalance {
  return state.balances[address] ?? createEmptyBalance();
}

export function applyWalletEvent(state: WalletState, envelope: EventEnvelope): WalletState {
  const next: WalletState = {
    balances: { ...state.balances },
    escrows: { ...state.escrows },
    history: [...state.history],
  };

  const type = String(envelope.type ?? '');
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
  const hash =
    typeof envelope.hash === 'string' && envelope.hash.length
      ? envelope.hash
      : eventHashHex(envelope);

  switch (type) {
    case 'wallet.mint': {
      applyMint(next, payload as unknown as WalletMintPayload);
      break;
    }
    case 'wallet.transfer': {
      applyTransfer(next, payload as unknown as WalletTransferPayload);
      break;
    }
    case 'wallet.escrow.create': {
      applyEscrowCreate(next, payload as unknown as WalletEscrowCreatePayload);
      break;
    }
    case 'wallet.escrow.fund': {
      applyEscrowFund(next, payload as unknown as WalletEscrowFundPayload);
      break;
    }
    case 'wallet.escrow.release': {
      applyEscrowRelease(next, payload as unknown as WalletEscrowReleasePayload);
      break;
    }
    case 'wallet.escrow.refund': {
      applyEscrowRefund(next, payload as unknown as WalletEscrowRefundPayload);
      break;
    }
    default: {
      return next;
    }
  }

  next.history.push({
    hash,
    type,
    ts,
    payload,
  });

  return next;
}

function createEmptyBalance(): WalletBalance {
  return {
    available: '0',
    pending: '0',
    locked: {
      escrow: '0',
      governance: '0',
    },
  };
}

function ensureBalance(state: WalletState, address: string): WalletBalance {
  const current = state.balances[address] ?? createEmptyBalance();
  const clone: WalletBalance = {
    available: current.available,
    pending: current.pending,
    locked: {
      escrow: current.locked.escrow,
      governance: current.locked.governance,
    },
  };
  state.balances[address] = clone;
  return clone;
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

function applyMint(state: WalletState, payload: WalletMintPayload): void {
  const amount = parseAmount(payload.amount, 'amount');
  const toBalance = ensureBalance(state, payload.to);
  toBalance.available = addAmount(toBalance.available, amount, 'available');
}

function applyTransfer(state: WalletState, payload: WalletTransferPayload): void {
  const amount = parseAmount(payload.amount, 'amount');
  const fee = parseAmount(payload.fee, 'fee');
  const total = amount + fee;
  const fromBalance = ensureBalance(state, payload.from);
  fromBalance.available = addAmount(fromBalance.available, -total, 'available');

  const toBalance = ensureBalance(state, payload.to);
  toBalance.available = addAmount(toBalance.available, amount, 'available');
}

function applyEscrowCreate(state: WalletState, payload: WalletEscrowCreatePayload): void {
  if (!state.escrows[payload.escrowId]) {
    const expiresAt =
      typeof payload.expiresAt === 'number' && Number.isFinite(payload.expiresAt)
        ? payload.expiresAt
        : undefined;
    state.escrows[payload.escrowId] = {
      escrowId: payload.escrowId,
      depositor: payload.depositor,
      beneficiary: payload.beneficiary,
      balance: '0',
      status: 'pending',
      expiresAt,
    };
  }
}

function applyEscrowFund(state: WalletState, payload: WalletEscrowFundPayload): void {
  const escrow = state.escrows[payload.escrowId];
  if (!escrow) {
    throw new Error('escrow not found');
  }
  const amount = parseAmount(payload.amount, 'amount');
  escrow.balance = addAmount(escrow.balance, amount, 'escrow balance');
  escrow.status = 'funded';

  const depositor = ensureBalance(state, escrow.depositor);
  depositor.available = addAmount(depositor.available, -amount, 'available');
  depositor.locked.escrow = addAmount(depositor.locked.escrow, amount, 'locked escrow');
}

function applyEscrowRelease(state: WalletState, payload: WalletEscrowReleasePayload): void {
  const escrow = state.escrows[payload.escrowId];
  if (!escrow) {
    throw new Error('escrow not found');
  }
  const amount = parseAmount(payload.amount, 'amount');
  escrow.balance = addAmount(escrow.balance, -amount, 'escrow balance');
  escrow.status = escrow.balance === '0' ? 'released' : 'releasing';

  const depositor = ensureBalance(state, escrow.depositor);
  depositor.locked.escrow = addAmount(depositor.locked.escrow, -amount, 'locked escrow');

  const beneficiary = ensureBalance(state, escrow.beneficiary);
  beneficiary.available = addAmount(beneficiary.available, amount, 'available');
}

function applyEscrowRefund(state: WalletState, payload: WalletEscrowRefundPayload): void {
  const escrow = state.escrows[payload.escrowId];
  if (!escrow) {
    throw new Error('escrow not found');
  }
  const amount = parseAmount(payload.amount, 'amount');
  escrow.balance = addAmount(escrow.balance, -amount, 'escrow balance');
  escrow.status = escrow.balance === '0' ? 'refunded' : escrow.status;

  const depositor = ensureBalance(state, escrow.depositor);
  depositor.locked.escrow = addAmount(depositor.locked.escrow, -amount, 'locked escrow');
  depositor.available = addAmount(depositor.available, amount, 'available');
}
