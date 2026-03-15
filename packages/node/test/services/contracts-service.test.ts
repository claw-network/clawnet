/**
 * ContractsService unit tests.
 *
 * Tests all public methods with mocked ContractProvider and IndexerQuery.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContractsService, MilestoneStatus, DisputeResolution } from '../../src/services/contracts-service.js';
import {
  createMockProvider,
  createMockIndexer,
  mockTxResponse,
  TX_HASH,
} from './_mock-contracts.js';

describe('ContractsService', () => {
  let service: ContractsService;
  let provider: ReturnType<typeof createMockProvider>;
  let indexer: ReturnType<typeof createMockIndexer>;

  const ALICE = '0x' + 'aa'.repeat(20);
  const BOB = '0x' + 'bb'.repeat(20);
  const ARBITER = '0x' + 'cc'.repeat(20);
  const CONTRACT_ID = 'contract-1';
  const TERMS_HASH = '0x' + 'dd'.repeat(32);

  /** Flat object shape matching what the Solidity struct returns via ethers */
  function mockContractStruct(overrides: Record<string, unknown> = {}) {
    return {
      client: ALICE,
      provider: BOB,
      arbiter: ARBITER,
      totalAmount: 1000n,
      fundedAmount: 500n,
      releasedAmount: 0n,
      termsHash: TERMS_HASH,
      milestoneCount: 2n,
      status: 1n,
      createdAt: 1700000000n,
      deadline: 1700100000n,
      clientSigned: true,
      providerSigned: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    provider = createMockProvider({
      token: {
        approve: vi.fn().mockResolvedValue(mockTxResponse()),
      },
      serviceContracts: {
        getAddress: vi.fn().mockResolvedValue('0x' + 'ee'.repeat(20)),
        // service calls createContract, not createServiceContract
        createContract: vi.fn().mockResolvedValue(mockTxResponse()),
        signContract: vi.fn().mockResolvedValue(mockTxResponse()),
        activateContract: vi.fn().mockResolvedValue(mockTxResponse()),
        submitMilestone: vi.fn().mockResolvedValue(mockTxResponse()),
        approveMilestone: vi.fn().mockResolvedValue(mockTxResponse()),
        rejectMilestone: vi.fn().mockResolvedValue(mockTxResponse()),
        completeContract: vi.fn().mockResolvedValue(mockTxResponse()),
        disputeContract: vi.fn().mockResolvedValue(mockTxResponse()),
        resolveDispute: vi.fn().mockResolvedValue(mockTxResponse()),
        terminateContract: vi.fn().mockResolvedValue(mockTxResponse()),
        cancelContract: vi.fn().mockResolvedValue(mockTxResponse()),
        // Returns flat object (not array)
        getContract: vi.fn().mockResolvedValue(mockContractStruct()),
        // Returns array of milestone structs
        getMilestones: vi.fn().mockResolvedValue([
          { amount: 500n, deadline: 1700050000n, status: 0n, deliverableHash: '0x' + '00'.repeat(32) },
          { amount: 500n, deadline: 1700090000n, status: 0n, deliverableHash: '0x' + '00'.repeat(32) },
        ]),
        // Returns single bigint
        calculateFee: vi.fn().mockResolvedValue(100n),
      },
    });
    indexer = createMockIndexer();
     
    service = new ContractsService(provider as any, indexer as any);
  });

  // ── READ ───────────────────────────────────────────────────────────

  describe('getContract', () => {
    it('returns service contract view from chain', async () => {
      const result = await service.getContract(CONTRACT_ID);
      expect(result).not.toBeNull();
      expect(result!.client).toBe(ALICE);
      expect(result!.provider).toBe(BOB);
      expect(result!.totalAmount).toBe(1000);
    });

    it('returns null when getContract throws', async () => {
      provider.serviceContracts.getContract.mockRejectedValue(new Error('not found'));
      const result = await service.getContract('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getMilestones', () => {
    it('returns milestones from chain', async () => {
      const milestones = await service.getMilestones(CONTRACT_ID);
      expect(milestones).toHaveLength(2);
      expect(milestones[0].amount).toBe(500);
      expect(milestones[0].status).toBe(MilestoneStatus.Pending);
    });
  });

  describe('listContracts', () => {
    it('returns null when no indexer', () => {
       
      const noIndexer = new ContractsService(provider as any);
      const result = noIndexer.listContracts();
      expect(result).toBeNull();
    });

    it('returns list from indexer', () => {
      indexer.getServiceContracts.mockReturnValue({
        items: [
          { contractId: CONTRACT_ID, client: ALICE, provider: BOB, status: 1, createdAt: 1700000000, updatedAt: 1700000000 },
        ],
        total: 1, limit: 50, offset: 0,
      });
      const result = service.listContracts();
      expect(result).not.toBeNull();
      expect(result!.contracts).toHaveLength(1);
    });
  });

  describe('calculateFee', () => {
    it('computes fee from on-chain call', async () => {
      const fee = await service.calculateFee(10000);
      expect(fee).toBe(100);
    });
  });

  // ── WRITE ──────────────────────────────────────────────────────────

  describe('createContract', () => {
    it('calls createContract on-chain', async () => {
      const result = await service.createContract({
        contractId: CONTRACT_ID,
        provider: BOB,
        arbiter: ARBITER,
        totalAmount: 1000,
        termsHash: TERMS_HASH,
        deadline: 1700100000,
        milestoneAmounts: [500, 500],
        milestoneDeadlines: [1700050000, 1700090000],
      });
      expect(provider.serviceContracts.createContract).toHaveBeenCalled();
      expect(result.contractId).toBe(CONTRACT_ID);
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('signContract', () => {
    it('calls signContract on-chain', async () => {
      const result = await service.signContract(CONTRACT_ID);
      expect(provider.serviceContracts.signContract).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('activateContract', () => {
    it('calls activateContract on-chain', async () => {
      const result = await service.activateContract(CONTRACT_ID);
      expect(provider.serviceContracts.activateContract).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('submitMilestone', () => {
    it('calls submitMilestone with index and hash', async () => {
      const hash = '0x' + 'ab'.repeat(32);
      const result = await service.submitMilestone(CONTRACT_ID, 0, hash);
      expect(provider.serviceContracts.submitMilestone).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('approveMilestone', () => {
    it('calls approveMilestone', async () => {
      const result = await service.approveMilestone(CONTRACT_ID, 0);
      expect(provider.serviceContracts.approveMilestone).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('rejectMilestone', () => {
    it('calls rejectMilestone', async () => {
      const result = await service.rejectMilestone(CONTRACT_ID, 0, 'bad work');
      expect(provider.serviceContracts.rejectMilestone).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('completeContract', () => {
    it('calls completeContract', async () => {
      const result = await service.completeContract(CONTRACT_ID);
      expect(provider.serviceContracts.completeContract).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('disputeContract', () => {
    it('calls disputeContract', async () => {
      const result = await service.disputeContract(CONTRACT_ID, 'evidence-hash');
      expect(provider.serviceContracts.disputeContract).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('resolveDispute', () => {
    it('calls resolveDispute with correct enum', async () => {
      const result = await service.resolveDispute(CONTRACT_ID, DisputeResolution.FavorProvider);
      expect(provider.serviceContracts.resolveDispute).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('terminateContract', () => {
    it('calls terminateContract', async () => {
      const result = await service.terminateContract(CONTRACT_ID, 'breach');
      expect(provider.serviceContracts.terminateContract).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('cancelContract', () => {
    it('calls cancelContract', async () => {
      const result = await service.cancelContract(CONTRACT_ID);
      expect(provider.serviceContracts.cancelContract).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });
});
