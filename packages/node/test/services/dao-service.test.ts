/**
 * DaoService unit tests.
 *
 * Tests all public methods with mocked ContractProvider and IndexerQuery.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { keccak256, toUtf8Bytes } from 'ethers';
import {
  DaoService,
  ProposalStatus,
} from '../../src/services/dao-service.js';
import {
  createMockProvider,
  createMockIndexer,
  mockTxResponse,
  mockReceipt,
  TX_HASH,
  SIGNER_ADDRESS,
} from './_mock-contracts.js';

describe('DaoService', () => {
  let service: DaoService;
  let provider: ReturnType<typeof createMockProvider>;
  let indexer: ReturnType<typeof createMockIndexer>;

  const VOTER = '0x' + 'aa'.repeat(20);
  const DAO_ADDRESS = '0x' + 'dd'.repeat(20);

  beforeEach(() => {
    provider = createMockProvider({
      dao: {
        // propose returns tx with logs containing ProposalCreated event
        propose: vi.fn().mockResolvedValue({
          hash: TX_HASH,
          wait: vi.fn().mockResolvedValue({
            ...mockReceipt(),
            logs: [
              { fragment: { name: 'ProposalCreated' }, args: [1n] },
            ],
          }),
        }),
        vote: vi.fn().mockResolvedValue(mockTxResponse()),
        queue: vi.fn().mockResolvedValue(mockTxResponse()),
        execute: vi.fn().mockResolvedValue(mockTxResponse()),
        cancel: vi.fn().mockResolvedValue(mockTxResponse()),
        // getProposal returns flat object with named properties
        getProposal: vi.fn().mockResolvedValue({
          proposalId: 1n,
          proposer: SIGNER_ADDRESS,
          pType: 0n,
          status: 1n,
          descriptionHash: keccak256(toUtf8Bytes('desc')),
          target: '0x' + '00'.repeat(20),
          snapshotBlock: 42n,
          createdAt: 1700000000n,
          discussionEndAt: 1700000100n,
          votingEndAt: 1700000300n,
          timelockEndAt: 0n,
          forVotes: 100n,
          againstVotes: 50n,
          abstainVotes: 10n,
        }),
        getStatus: vi.fn().mockResolvedValue(1), // Voting
        hasQuorum: vi.fn().mockResolvedValue(true),
        hasPassed: vi.fn().mockResolvedValue(true),
        proposalCount: vi.fn().mockResolvedValue(5n),
        // getReceipt returns flat object
        getReceipt: vi.fn().mockResolvedValue({
          hasVoted: true,
          support: 1n,
          weight: 50n,
        }),
        // getVotingPower returns single bigint
        getVotingPower: vi.fn().mockResolvedValue(200n),
        // getAddress for treasury
        getAddress: vi.fn().mockResolvedValue(DAO_ADDRESS),
      },
      token: {
        balanceOf: vi.fn().mockResolvedValue(1000000n),
        transfer: vi.fn().mockResolvedValue(mockTxResponse()),
        approve: vi.fn().mockResolvedValue(mockTxResponse()),
      },
      paramRegistry: {
        getParam: vi.fn().mockResolvedValue('100'),
        getAllParams: vi.fn().mockResolvedValue([
          ['proposalThreshold', 'discussionPeriod', 'votingPeriod', 'timelockDelay', 'quorumBps'],
          ['100', '172800', '259200', '86400', '400'],
        ]),
      },
    });
    indexer = createMockIndexer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new DaoService(provider as any, indexer as any);
  });

  // ── READ — Proposals ───────────────────────────────────────────────

  describe('getProposal', () => {
    it('returns proposal view from chain', async () => {
      const proposal = await service.getProposal(1);
      expect(proposal).not.toBeNull();
      expect(proposal!.proposer).toBe(SIGNER_ADDRESS);
      expect(proposal!.forVotes).toBe('100');
      expect(proposal!.againstVotes).toBe('50');
    });
  });

  describe('listProposals', () => {
    it('returns list from indexer when available', async () => {
      indexer.getProposals.mockReturnValue({
        items: [{ proposalId: 1, proposer: SIGNER_ADDRESS, status: 1 }],
        total: 1, limit: 50, offset: 0,
      });
      const result = await service.listProposals();
      expect(result.proposals).toHaveLength(1);
    });

    it('returns empty when no indexer', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const noIndexer = new DaoService(provider as any);
      const result = await noIndexer.listProposals();
      expect(result.proposals).toEqual([]);
    });
  });

  describe('getComputedStatus', () => {
    it('returns computed status from chain', async () => {
      const status = await service.getComputedStatus(1);
      expect(status).toBe(ProposalStatus.Voting);
    });
  });

  describe('hasQuorum', () => {
    it('returns quorum status from chain', async () => {
      const result = await service.hasQuorum(1);
      expect(result).toBe(true);
    });
  });

  describe('hasPassed', () => {
    it('returns pass status from chain', async () => {
      const result = await service.hasPassed(1);
      expect(result).toBe(true);
    });
  });

  // ── READ — Votes ───────────────────────────────────────────────────

  describe('listVotes', () => {
    it('returns votes from indexer', async () => {
      indexer.getVotes.mockReturnValue({
        items: [{ proposalId: 1, voter: VOTER, support: 1, weight: 50 }],
        total: 1, limit: 50, offset: 0,
      });
      const result = await service.listVotes({ proposalId: 1 });
      expect(result.votes).toHaveLength(1);
    });
  });

  describe('getReceipt', () => {
    it('returns vote receipt from chain', async () => {
      const receipt = await service.getReceipt(1, VOTER);
      expect(receipt.hasVoted).toBe(true);
      expect(receipt.weight).toBe('50');
    });
  });

  describe('getVotingPower', () => {
    it('returns voting power as string from chain', async () => {
      const result = await service.getVotingPower(VOTER);
      expect(result.power).toBe('200');
      expect(result.voter).toBe(VOTER);
    });
  });

  // ── READ — Treasury & Params ───────────────────────────────────────

  describe('getTreasuryBalance', () => {
    it('returns token balance as string', async () => {
      const result = await service.getTreasuryBalance();
      expect(result.balance).toBe('1000000');
      expect(result.daoAddress).toBe(DAO_ADDRESS);
    });
  });

  describe('getParam', () => {
    it('returns param value from registry', async () => {
      const result = await service.getParam('proposalThreshold');
      expect(result.value).toBe('100');
    });
  });

  describe('getAllParams', () => {
    it('returns all params from registry', async () => {
      const result = await service.getAllParams();
      expect(result.params).toHaveLength(5);
    });
  });

  // ── WRITE ──────────────────────────────────────────────────────────

  describe('propose', () => {
    it('creates a proposal on-chain (lowercase type key)', async () => {
      const result = await service.propose(
        'parameter_change', 'test proposal',
        '0x' + '00'.repeat(20), '0x',
      );
      expect(provider.dao.propose).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
      expect(result.proposalId).toBe(1);
    });

    it('rejects unknown proposal type', async () => {
      await expect(
        service.propose('ParameterChange', 'bad', '0x' + '00'.repeat(20), '0x'),
      ).rejects.toThrow('Unknown proposal type');
    });
  });

  describe('vote', () => {
    it('casts a vote on-chain', async () => {
      const result = await service.vote(1, 'for');
      expect(provider.dao.vote).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('queue', () => {
    it('queues a passed proposal', async () => {
      const result = await service.queue(1);
      expect(provider.dao.queue).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('execute', () => {
    it('executes a queued proposal', async () => {
      const result = await service.execute(1);
      expect(provider.dao.execute).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('cancel', () => {
    it('cancels a proposal', async () => {
      const result = await service.cancel(1);
      expect(provider.dao.cancel).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('advanceProposal', () => {
    it('maps "timelocked" to queue()', async () => {
      const result = await service.advanceProposal(1, 'timelocked');
      expect(provider.dao.queue).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });

    it('maps "executed" to execute()', async () => {
      const result = await service.advanceProposal(1, 'executed');
      expect(provider.dao.execute).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });

    it('maps "cancelled" to cancel()', async () => {
      const result = await service.advanceProposal(1, 'cancelled');
      expect(provider.dao.cancel).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('treasuryDeposit', () => {
    it('transfers tokens to DAO', async () => {
      const result = await service.treasuryDeposit(500);
      expect(provider.token.transfer).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
      expect(result.amount).toBe(500);
    });
  });
});
