/**
 * Shared mock helpers for Node service layer unit tests.
 *
 * Provides mock ContractProvider and IndexerQuery that return
 * deterministic values, allowing each service to be tested in isolation
 * without an actual EVM node.
 */

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Receipt & Tx helpers
// ---------------------------------------------------------------------------

const TX_HASH = '0x' + 'ab'.repeat(32);

export function mockReceipt(overrides: Record<string, unknown> = {}) {
  return {
    hash: TX_HASH,
    blockNumber: 42,
    status: 1,
    logs: [],
    ...overrides,
  };
}

/** Mimics an ethers ContractTransactionResponse. */
export function mockTxResponse(receiptOverrides: Record<string, unknown> = {}) {
  const receipt = mockReceipt(receiptOverrides);
  return {
    hash: receipt.hash,
    wait: vi.fn().mockResolvedValue(receipt),
  };
}

// ---------------------------------------------------------------------------
// Mock contract factory — auto-creates vi.fn() for every accessed method
// ---------------------------------------------------------------------------

export function mockContract(
  stubs: Record<string, unknown> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contract: any = new Proxy(stubs, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      // Auto-create a vi.fn stub the first time a method is accessed.
      target[prop] = vi.fn();
      return target[prop];
    },
  });
  return contract;
}

// ---------------------------------------------------------------------------
// Mock ContractProvider
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockContract = Record<string, any>;

export interface MockProviderContracts {
  token: MockContract;
  escrow: MockContract;
  identity: MockContract;
  reputation: MockContract;
  serviceContracts: MockContract;
  dao: MockContract;
  staking: MockContract;
  paramRegistry: MockContract;
}

const SIGNER_ADDRESS = '0x' + '11'.repeat(20);

/**
 * Build a lightweight mock ContractProvider.
 *
 * Each contract is a Proxy that auto-stubs any accessed method as a
 * `vi.fn()`.  Override specific methods via the `overrides` argument.
 */
export function createMockProvider(
  overrides: Partial<Record<keyof MockProviderContracts, Record<string, unknown>>> = {},
) {
  const contracts: MockProviderContracts = {
    token: mockContract(overrides.token ?? {}),
    escrow: mockContract(overrides.escrow ?? {}),
    identity: mockContract(overrides.identity ?? {}),
    reputation: mockContract(overrides.reputation ?? {}),
    serviceContracts: mockContract(overrides.serviceContracts ?? {}),
    dao: mockContract(overrides.dao ?? {}),
    staking: mockContract(overrides.staking ?? {}),
    paramRegistry: mockContract(overrides.paramRegistry ?? {}),
  };

  return {
    ...contracts,
    get: vi.fn((key: string) => (contracts as Record<string, MockContract>)[key]),
    signerAddress: SIGNER_ADDRESS,
    getBlockNumber: vi.fn().mockResolvedValue(100),
    destroy: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Mock IndexerQuery
// ---------------------------------------------------------------------------

function emptyPage() {
  return { items: [], total: 0, limit: 50, offset: 0 };
}

export function createMockIndexer(
  overrides: Record<string, unknown> = {},
) {
  return {
    getTransfers: vi.fn().mockReturnValue(emptyPage()),
    getEscrows: vi.fn().mockReturnValue(emptyPage()),
    getServiceContracts: vi.fn().mockReturnValue(emptyPage()),
    getProposals: vi.fn().mockReturnValue(emptyPage()),
    getVotes: vi.fn().mockReturnValue(emptyPage()),
    getReviews: vi.fn().mockReturnValue(emptyPage()),
    getDid: vi.fn().mockReturnValue(null),
    getEvents: vi.fn().mockReturnValue(emptyPage()),
    ...overrides,
  };
}

// Re-export constants
export { TX_HASH, SIGNER_ADDRESS };
