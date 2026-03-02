/**
 * WalletService unit tests.
 *
 * Tests each public method of WalletService using a mocked ContractProvider
 * and IndexerQuery.  No real EVM node required.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { keccak256, toUtf8Bytes } from 'ethers';
import { WalletService } from '../../src/services/wallet-service.js';
import {
  createMockProvider,
  createMockIndexer,
  mockTxResponse,
  TX_HASH,
  SIGNER_ADDRESS,
} from './_mock-contracts.js';

describe('WalletService', () => {
  let service: WalletService;
  let provider: ReturnType<typeof createMockProvider>;
  let indexer: ReturnType<typeof createMockIndexer>;

  const ALICE = '0x' + 'aa'.repeat(20);
  const BOB = '0x' + 'bb'.repeat(20);

  beforeEach(() => {
    provider = createMockProvider({
      token: {
        balanceOf: vi.fn().mockResolvedValue(1000n),
        transfer: vi.fn().mockResolvedValue(mockTxResponse()),
        approve: vi.fn().mockResolvedValue(mockTxResponse()),
      },
      escrow: {
        getAddress: vi.fn().mockResolvedValue('0x' + 'ee'.repeat(20)),
        createEscrow: vi.fn().mockResolvedValue(mockTxResponse()),
        fund: vi.fn().mockResolvedValue(mockTxResponse()),
        release: vi.fn().mockResolvedValue(mockTxResponse()),
        refund: vi.fn().mockResolvedValue(mockTxResponse()),
        expire: vi.fn().mockResolvedValue(mockTxResponse()),
        dispute: vi.fn().mockResolvedValue(mockTxResponse()),
        resolve: vi.fn().mockResolvedValue(mockTxResponse()),
        getEscrow: vi.fn().mockResolvedValue([
          ALICE, BOB, SIGNER_ADDRESS, 100n, 1700000000n, 0n, 0n,
        ]),
      },
      identity: {
        getController: vi.fn().mockResolvedValue(ALICE),
      },
    });
    indexer = createMockIndexer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new WalletService(provider as any, indexer as any);
  });

  // ── READ ───────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('returns on-chain balance with zero locked when no active escrows', async () => {
      indexer.getEscrows.mockReturnValue({ items: [], total: 0, limit: 50, offset: 0 });
      const result = await service.getBalance(ALICE);
      expect(result.balance).toBe('1000');
      expect(result.available).toBe('1000');
      expect(result.locked).toBe('0');
      expect(provider.token.balanceOf).toHaveBeenCalledWith(ALICE);
    });

    it('subtracts locked escrow amounts from available', async () => {
      indexer.getEscrows.mockReturnValue({
        items: [{ amount: 200 }, { amount: 300 }],
        total: 2,
        limit: 200,
        offset: 0,
      });
      const result = await service.getBalance(ALICE);
      expect(result.balance).toBe('1000');
      expect(result.locked).toBe('500');
      expect(result.available).toBe('500');
    });
  });

  describe('resolveDidToAddress', () => {
    it('returns controller address for a registered DID', async () => {
      const addr = await service.resolveDidToAddress('did:claw:alice');
      expect(addr).toBe(ALICE);
    });

    it('returns null for zero-address controller', async () => {
      provider.identity.getController.mockResolvedValue(
        '0x0000000000000000000000000000000000000000',
      );
      const addr = await service.resolveDidToAddress('did:claw:unknown');
      expect(addr).toBeNull();
    });

    it('returns null when getController throws', async () => {
      provider.identity.getController.mockRejectedValue(new Error('not found'));
      const addr = await service.resolveDidToAddress('did:claw:bad');
      expect(addr).toBeNull();
    });
  });

  describe('getHistory', () => {
    it('returns empty when no indexer', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const noIndexer = new WalletService(provider as any);
      const result = noIndexer.getHistory(ALICE);
      expect(result.transactions).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('maps indexer rows to TransferRow format', () => {
      indexer.getTransfers.mockReturnValue({
        items: [
          { txHash: '0x1', fromAddr: ALICE, toAddr: BOB, amount: 50, timestamp: 1700000000 },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });
      const result = service.getHistory(ALICE);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].type).toBe('sent');
      expect(result.total).toBe(1);
    });
  });

  describe('getEscrow', () => {
    it('returns escrow view from on-chain', async () => {
      const view = await service.getEscrow('test-escrow');
      expect(view).not.toBeNull();
      expect(view!.depositor).toBe(ALICE);
      expect(view!.beneficiary).toBe(BOB);
      expect(view!.amount).toBe('100');
      expect(view!.status).toBe('active');
    });

    it('returns null for zero depositor', async () => {
      provider.escrow.getEscrow.mockResolvedValue([
        '0x0000000000000000000000000000000000000000', BOB, SIGNER_ADDRESS, 0n, 0n, 0n, 0n,
      ]);
      const view = await service.getEscrow('nonexistent');
      expect(view).toBeNull();
    });
  });

  // ── WRITE ──────────────────────────────────────────────────────────

  describe('transfer', () => {
    it('uses burn+mint for non-signer from address', async () => {
      provider.token.burn = vi.fn().mockResolvedValue(mockTxResponse());
      provider.token.mint = vi.fn().mockResolvedValue(mockTxResponse());
      const result = await service.transfer(ALICE, BOB, 100);
      expect(provider.token.burn).toHaveBeenCalledWith(ALICE, 100);
      expect(provider.token.mint).toHaveBeenCalledWith(BOB, 100);
      expect(result.txHash).toBe(TX_HASH);
      expect(result.status).toBe('confirmed');
      expect(result.amount).toBe('100');
    });

    it('uses direct transfer for signer address', async () => {
      const result = await service.transfer(SIGNER_ADDRESS, BOB, 100);
      expect(provider.token.transfer).toHaveBeenCalledWith(BOB, 100);
      expect(result.txHash).toBe(TX_HASH);
      expect(result.status).toBe('confirmed');
    });

    it('uses direct transfer for faucet special from', async () => {
      const result = await service.transfer('faucet', BOB, 100);
      expect(provider.token.transfer).toHaveBeenCalledWith(BOB, 100);
      expect(result.status).toBe('confirmed');
    });

    it('returns failed status when receipt status is 0', async () => {
      provider.token.burn = vi.fn().mockResolvedValue(mockTxResponse());
      provider.token.mint = vi.fn().mockResolvedValue(
        mockTxResponse({ status: 0 }),
      );
      const result = await service.transfer(ALICE, BOB, 50);
      expect(result.status).toBe('failed');
    });
  });

  describe('createEscrow', () => {
    it('approves then creates escrow on-chain', async () => {
      const result = await service.createEscrow({
        escrowId: 'esc-1',
        beneficiary: BOB,
        amount: 100,
      });
      expect(provider.token.approve).toHaveBeenCalled();
      expect(provider.escrow.createEscrow).toHaveBeenCalled();
      expect(result.id).toBe('esc-1');
      expect(result.amount).toBe('100');
      expect(result.status).toBe('active');
    });

    it('throws when createEscrow tx fails', async () => {
      provider.escrow.createEscrow.mockResolvedValue(
        mockTxResponse({ status: 0 }),
      );
      await expect(
        service.createEscrow({ escrowId: 'esc-2', beneficiary: BOB, amount: 50 }),
      ).rejects.toThrow('createEscrow tx failed');
    });
  });

  describe('fundEscrow', () => {
    it('approves and funds escrow', async () => {
      const result = await service.fundEscrow('esc-1', 200);
      expect(provider.token.approve).toHaveBeenCalled();
      expect(provider.escrow.fund).toHaveBeenCalled();
      expect(result.status).toBe('funded');
    });
  });

  describe('releaseEscrow', () => {
    it('releases escrow and reads amount', async () => {
      const result = await service.releaseEscrow('esc-1');
      expect(provider.escrow.release).toHaveBeenCalled();
      expect(result.amount).toBe('100'); // from getEscrow mock
      expect(result.status).toBe('released');
    });
  });

  describe('refundEscrow', () => {
    it('refunds escrow', async () => {
      const result = await service.refundEscrow('esc-1');
      expect(provider.escrow.refund).toHaveBeenCalled();
      expect(result.status).toBe('refunded');
    });
  });

  describe('disputeEscrow', () => {
    it('disputes escrow', async () => {
      const result = await service.disputeEscrow('esc-1');
      expect(provider.escrow.dispute).toHaveBeenCalled();
      expect(result.status).toBe('disputed');
    });
  });

  describe('resolveEscrow', () => {
    it('resolves in favor of beneficiary', async () => {
      const result = await service.resolveEscrow('esc-1', true);
      expect(provider.escrow.resolve).toHaveBeenCalledWith(
        keccak256(toUtf8Bytes('esc-1')),
        true,
      );
      expect(result.status).toBe('released');
    });

    it('resolves in favor of depositor', async () => {
      const result = await service.resolveEscrow('esc-1', false);
      expect(result.status).toBe('refunded');
    });
  });
});
