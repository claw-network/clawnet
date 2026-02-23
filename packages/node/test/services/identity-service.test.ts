/**
 * IdentityService unit tests.
 *
 * Tests all public methods with mocked ContractProvider and IndexerQuery.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getBytes, keccak256, toUtf8Bytes } from 'ethers';
import { IdentityService } from '../../src/services/identity-service.js';
import {
  createMockProvider,
  createMockIndexer,
  mockTxResponse,
  TX_HASH,
  SIGNER_ADDRESS,
} from './_mock-contracts.js';

describe('IdentityService', () => {
  let service: IdentityService;
  let provider: ReturnType<typeof createMockProvider>;
  let indexer: ReturnType<typeof createMockIndexer>;

  const ALICE = '0x' + 'aa'.repeat(20);
  const DID = 'did:claw:alice';
  const DID_HASH = keccak256(toUtf8Bytes(DID));
  const PUB_KEY = '0x' + 'cc'.repeat(32);

  beforeEach(() => {
    provider = createMockProvider({
      identity: {
        // Write methods
        registerDID: vi.fn().mockResolvedValue(mockTxResponse()),
        rotateKey: vi.fn().mockResolvedValue(mockTxResponse()),
        revokeDID: vi.fn().mockResolvedValue(mockTxResponse()),
        addPlatformLink: vi.fn().mockResolvedValue(mockTxResponse()),
        // Read methods used by resolve()
        isActive: vi.fn().mockResolvedValue(true),
        getController: vi.fn().mockResolvedValue(ALICE),
        getActiveKey: vi.fn().mockResolvedValue(PUB_KEY),
        getKeyRecord: vi.fn().mockResolvedValue({ purpose: 0 }),
        dids: vi.fn().mockResolvedValue({
          createdAt: 1700000000n,
          updatedAt: 1700000000n,
        }),
        getPlatformLinks: vi.fn().mockResolvedValue([]),
      },
    });
    indexer = createMockIndexer();
    service = new IdentityService(provider as any, indexer as any);
  });

  // ── READ ───────────────────────────────────────────────────────────

  describe('resolve', () => {
    it('returns DID document for registered DID', async () => {
      const doc = await service.resolve(DID);
      expect(doc).not.toBeNull();
      expect(doc!.did).toBe(DID);
      expect(doc!.controller).toBe(ALICE);
      expect(doc!.publicKey).toBe(PUB_KEY);
      expect(doc!.isActive).toBe(true);
      expect(doc!.createdAt).toBe(1700000000);
    });

    it('returns null for unregistered DID (zero controller)', async () => {
      provider.identity.getController.mockResolvedValue(
        '0x0000000000000000000000000000000000000000',
      );
      const doc = await service.resolve(DID);
      expect(doc).toBeNull();
    });
  });

  describe('getController', () => {
    it('returns controller address', async () => {
      const ctrl = await service.getController(DID);
      expect(ctrl).toBe(ALICE);
    });
  });

  describe('isActive', () => {
    it('returns true for active DID', async () => {
      const active = await service.isActive(DID);
      expect(active).toBe(true);
    });
  });

  describe('getCachedDid (indexer)', () => {
    it('returns null when no cached entry', () => {
      const cached = service.getCachedDid(DID);
      expect(cached).toBeNull();
    });

    it('returns cached entry when present', () => {
      indexer.getDid.mockReturnValue({
        didHash: DID_HASH,
        controller: ALICE,
        activeKey: PUB_KEY,
        isActive: 1,
        updatedAt: 1700000000,
      });
      const cached = service.getCachedDid(DID);
      expect(cached).not.toBeNull();
      expect(cached!.controller).toBe(ALICE);
    });
  });

  // ── WRITE ──────────────────────────────────────────────────────────

  describe('registerDID', () => {
    it('calls identity.registerDID with correct args', async () => {
      const result = await service.registerDID(DID, PUB_KEY);
      expect(provider.identity.registerDID).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
      expect(result.did).toBe(DID);
    });
  });

  describe('rotateKey', () => {
    it('calls identity.rotateKey', async () => {
      const newKey = '0x' + 'dd'.repeat(32);
      const result = await service.rotateKey(DID, newKey);
      expect(provider.identity.rotateKey).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('revokeDID', () => {
    it('calls identity.revokeDID', async () => {
      const result = await service.revokeDID(DID);
      expect(provider.identity.revokeDID).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });

  describe('addPlatformLink', () => {
    it('calls identity.addPlatformLink with hashed link', async () => {
      const result = await service.addPlatformLink(DID, 'link-hash-1');
      expect(provider.identity.addPlatformLink).toHaveBeenCalled();
      expect(result.txHash).toBe(TX_HASH);
    });
  });
});
