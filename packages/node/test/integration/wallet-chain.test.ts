/**
 * Chain Integration Test — Wallet Module
 *
 * End-to-end test exercising:
 *   SDK/REST → Node WalletService → ClawToken / ClawEscrow → Indexer → Query
 *
 * Prerequisites:
 *   - Hardhat node running on localhost:8545
 *   - All contracts deployed (run `pnpm --filter @claw-network/contracts deploy:local`)
 *
 * Run with:
 *   pnpm --filter @claw-network/node test:integration
 *
 * In CI, the integration workflow starts hardhat node + deploys automatically.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startHardhatNode,
  stopHardhatNode,
  deployContracts,
  buildChainConfig,
  createTempDir,
  removeTempDir,
} from './_setup.js';

// These will be dynamically imported after env is set up
let ContractProvider: any;
let WalletService: any;
let IdentityService: any;
let IndexerStore: any;
let IndexerQuery: any;

describe('Chain Integration: Wallet', () => {
  let tempDir: string;
  let contractProvider: any;
  let walletService: any;
  let identityService: any;
  let indexerStore: any;
  let indexerQuery: any;
  let addresses: Record<string, string>;

  beforeAll(async () => {
    // 1. Start hardhat node
    await startHardhatNode();

    // 2. Deploy contracts
    addresses = deployContracts();

    // 3. Build config
    const config = buildChainConfig(addresses);

    // 4. Dynamic import (ESM)
    const services = await import('../../src/services/index.js');
    ContractProvider = services.ContractProvider;
    WalletService = services.WalletService;
    IdentityService = services.IdentityService;

    const indexerMod = await import('../../src/indexer/store.js');
    IndexerStore = indexerMod.IndexerStore;

    const queryMod = await import('../../src/indexer/query.js');
    IndexerQuery = queryMod.IndexerQuery;

    // 5. Create provider + services
    tempDir = await createTempDir();
    contractProvider = new ContractProvider(config);
    indexerStore = new IndexerStore(`${tempDir}/indexer.db`);
    indexerQuery = new IndexerQuery(indexerStore.database);
    walletService = new WalletService(contractProvider, indexerQuery);
    identityService = new IdentityService(contractProvider, indexerQuery);
  }, 120_000); // 2 min timeout for setup

  afterAll(async () => {
    if (contractProvider) await contractProvider.destroy();
    if (indexerStore) indexerStore.close();
    stopHardhatNode();
    if (tempDir) await removeTempDir(tempDir);
  });

  it('should read deployer balance (minted supply)', async () => {
    const signerAddr = contractProvider.signerAddress;
    const result = await walletService.getBalance(signerAddr);
    expect(result.balance).toBeGreaterThan(0);
    expect(typeof result.balance).toBe('number');
  });

  it('should transfer tokens and get confirmed receipt', async () => {
    // Transfer 100 Tokens to a test address
    const recipient = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'; // hardhat #2
    const signerAddr = contractProvider.signerAddress;

    const result = await walletService.transfer(signerAddr, recipient, 100, 'integration-test');
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.status).toBe('confirmed');
    expect(result.amount).toBe(100);

    // Verify recipient balance
    const recipientBalance = await walletService.getBalance(recipient);
    expect(recipientBalance.balance).toBeGreaterThanOrEqual(100);
  });

  it('should create, fund, and release an escrow', async () => {
    const beneficiary = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'; // hardhat #2

    // Create
    const createResult = await walletService.createEscrow({
      escrowId: 'integration-test-escrow-1',
      beneficiary,
      amount: 50,
      expiresAt: Math.floor(Date.now() / 1000) + 86400, // +1 day
    });
    expect(createResult.id).toBe('integration-test-escrow-1');
    expect(createResult.amount).toBe(50);
    expect(createResult.status).toBe('active');

    // Read on-chain
    const view = await walletService.getEscrow('integration-test-escrow-1');
    expect(view).not.toBeNull();
    expect(view!.amount).toBeGreaterThan(0);
    expect(view!.amount).toBeLessThanOrEqual(50);
    expect(view!.status).toBe('active');

    // Release
    const releaseResult = await walletService.releaseEscrow('integration-test-escrow-1');
    expect(releaseResult.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(releaseResult.status).toBe('released');
  });

  it('should register a DID on-chain', async () => {
    const did = 'did:claw:integration-test-alice';
    // Use a dummy 32-byte public key
    const pubKey = '0x' + 'ab'.repeat(32);

    const result = await identityService.registerDID(did, pubKey);
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.did).toBe(did);

    // Verify on-chain
    const isActive = await identityService.isActive(did);
    expect(isActive).toBe(true);
  });
});
