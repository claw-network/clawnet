/**
 * Shared types and helper functions for route modules.
 */

import type { EventStore } from '@claw-network/core';
import type {
  ContractStore,
  MarketSearchStore,
  InfoContentStore,
  ReputationStore,
  SearchQuery,
  SearchResult,
  DaoStore,
  WalletState,
  ServiceContract,
} from '@claw-network/protocol';

import type { WalletService } from '../services/wallet-service.js';
import type { IdentityService } from '../services/identity-service.js';
import type { ReputationService } from '../services/reputation-service.js';
import type { ContractsService } from '../services/contracts-service.js';
import type { DaoService } from '../services/dao-service.js';
import type { ApiKeyStore } from './api-key-store.js';

export {
  addressFromDid,
  base64ToBytes,
  bytesToHex,
  bytesToUtf8,
  didFromPublicKey,
  decryptKeyRecord,
  eventHashHex,
  hexToBytes,
  keyIdFromPublicKey,
  listKeyRecords,
  loadKeyRecord,
  multibaseDecode,
  publicKeyFromDid,
  resolveStoragePaths,
  utf8ToBytes,
  verifyCapabilityCredential,
} from '@claw-network/core';

// ─── Runtime Context ────────────────────────────────────────────

export interface ApiServerConfig {
  host: string;
  port: number;
  dataDir?: string;
}

export interface RuntimeContext {
  config: ApiServerConfig;
  publishEvent: (envelope: Record<string, unknown>) => Promise<string>;
  eventStore?: EventStore;
  contractStore?: ContractStore;
  reputationStore?: ReputationStore;
  daoStore?: DaoStore;
  marketStore?: MarketSearchStore;
  infoContentStore?: InfoContentStore;
  walletService?: WalletService;
  identityService?: IdentityService;
  reputationService?: ReputationService;
  contractsService?: ContractsService;
  daoService?: DaoService;
  searchMarkets?: (query: SearchQuery) => SearchResult;
  getNodeStatus?: () => Promise<Record<string, unknown>>;
  getNodePeers?: () => Promise<{ peers: Record<string, unknown>[]; total: number }>;
  getNodeConfig?: () => Promise<Record<string, unknown>>;
  apiKeyStore?: ApiKeyStore;
}

// ─── Address & DID Helpers ──────────────────────────────────────

import {
  addressFromDid as _addressFromDid,
  publicKeyFromDid as _publicKeyFromDid,
  keyIdFromPublicKey as _keyIdFromPublicKey,
  resolveStoragePaths as _resolveStoragePaths,
  loadKeyRecord as _loadKeyRecord,
  decryptKeyRecord as _decryptKeyRecord,
} from '@claw-network/core';

export function isValidDid(value: string): boolean {
  if (!value) return false;
  try {
    _publicKeyFromDid(value);
    return true;
  } catch {
    return false;
  }
}

export function resolveAddress(input: string): string | null {
  if (!input) return null;
  if (input.startsWith('did:claw:')) {
    try {
      return _addressFromDid(input);
    } catch {
      return null;
    }
  }
  return input;
}

export async function resolvePrivateKey(
  dataDir: string | undefined,
  did: string,
  passphrase: string,
): Promise<Uint8Array | null> {
  try {
    const publicKey = _publicKeyFromDid(did);
    const keyId = _keyIdFromPublicKey(publicKey);
    const paths = _resolveStoragePaths(dataDir);
    const record = await _loadKeyRecord(paths, keyId);
    return await _decryptKeyRecord(record, passphrase);
  } catch {
    return null;
  }
}

// ─── Escrow Status Mapping ──────────────────────────────────────

export function mapEscrowStatus(
  status: string,
): 'active' | 'released' | 'refunded' | 'disputed' {
  switch (status) {
    case 'released':
      return 'released';
    case 'refunded':
      return 'refunded';
    case 'disputed':
      return 'disputed';
    default:
      return 'active';
  }
}

// ─── Amount Parsing ─────────────────────────────────────────────

export function parseBigInt(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function parseAmountLike(value: unknown): bigint | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }
  if (typeof value === 'bigint') return value;
  return null;
}

// ─── Contract View Builder ──────────────────────────────────────

export function buildContractView(contract: ServiceContract): Record<string, unknown> {
  const clientDid = contract.parties.client.did;
  const providerDid = contract.parties.provider.did;
  const clientSignedAt = contract.signatures.find((sig) => sig.signer === clientDid)?.signedAt;
  const providerSignedAt = contract.signatures.find((sig) => sig.signer === providerDid)?.signedAt;
  const signedAt =
    clientSignedAt && providerSignedAt ? Math.max(clientSignedAt, providerSignedAt) : undefined;
  return {
    ...contract,
    client: clientDid,
    provider: providerDid,
    signedAt,
  };
}

// ─── Escrow View Builder ────────────────────────────────────────

export function buildEscrowView(
  state: WalletState,
  escrow: WalletState['escrows'][string],
): {
  amount: number;
  released: number;
  remaining: number;
  status: 'active' | 'released' | 'refunded' | 'disputed';
  releaseConditions: Record<string, unknown>[];
  createdAt: number;
  expiresAt?: number;
  expired: boolean;
} {
  let createdAt = Date.now();
  let totalAmount: bigint | null = null;
  let releaseConditions: Record<string, unknown>[] = [];
  let expiresAt =
    typeof escrow.expiresAt === 'number' && Number.isFinite(escrow.expiresAt)
      ? escrow.expiresAt
      : undefined;

  for (const entry of state.history) {
    if (entry.type !== 'wallet.escrow.create') continue;
    const payload = entry.payload as Record<string, unknown>;
    if (payload.escrowId !== escrow.escrowId) continue;
    createdAt = entry.ts;
    totalAmount = parseBigInt(payload.amount as string | undefined);
    const rules = payload.releaseRules as Record<string, unknown>[] | undefined;
    if (Array.isArray(rules)) releaseConditions = rules;
    if (expiresAt === undefined && typeof payload.expiresAt === 'number') expiresAt = payload.expiresAt;
    break;
  }

  const remaining = parseBigInt(escrow.balance);
  const total = totalAmount ?? remaining;
  const released = total - remaining >= 0n ? total - remaining : 0n;
  const expired = expiresAt !== undefined ? Date.now() > expiresAt : false;

  return {
    amount: Number(total),
    released: Number(released),
    remaining: Number(remaining),
    status: mapEscrowStatus(escrow.status),
    releaseConditions,
    createdAt,
    expiresAt,
    expired,
  };
}

// ─── Wallet State Builder ───────────────────────────────────────

import {
  createWalletState,
  applyWalletEvent,
  getWalletBalance,
} from '@claw-network/protocol';

import type { EventEnvelope } from '@claw-network/core';

export async function buildWalletState(eventStore: EventStore): Promise<WalletState> {
  const state = createWalletState();
  let cursor: string | null = null;
  for (;;) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) break;
    for (const raw of events) {
      let envelope: EventEnvelope;
      if (raw instanceof Uint8Array) {
        envelope = JSON.parse(new TextDecoder().decode(raw)) as EventEnvelope;
      } else if (typeof raw === 'string') {
        envelope = JSON.parse(raw) as EventEnvelope;
      } else {
        envelope = raw as EventEnvelope;
      }
      if ((envelope.type as string)?.startsWith('wallet.')) {
        applyWalletEvent(state, envelope);
      }
    }
    if (!next) break;
    cursor = next;
  }
  return state;
}

export { getWalletBalance };

// ─── CSV / Boolean Parsing ──────────────────────────────────────

export function parseCsv(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map((e) => e.trim()).filter((e) => e.length > 0);
  return items.length ? items : undefined;
}

export function parseBoolean(value: string | null): boolean | undefined {
  if (!value) return undefined;
  const n = value.trim().toLowerCase();
  if (n === 'true' || n === '1' || n === 'yes') return true;
  if (n === 'false' || n === '0' || n === 'no') return false;
  return undefined;
}

export function parseInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}
