/**
 * Integration test setup helpers.
 *
 * Provides utilities for spinning up a hardhat node, deploying contracts,
 * and creating a fully-wired ContractProvider for end-to-end testing.
 *
 * Usage (from integration tests):
 *   const env = await setupIntegration();
 *   // ... make REST calls ...
 *   await env.teardown();
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTRACTS_DIR = resolve(
  new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
  '../../../../packages/contracts',
);
const HARDHAT_RPC = 'http://127.0.0.1:8545';
const HARDHAT_CHAIN_ID = 31337;

// Hardhat default account #0 private key
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// ---------------------------------------------------------------------------
// Hardhat node lifecycle
// ---------------------------------------------------------------------------

let hardhatProcess: ChildProcess | null = null;

/**
 * Start a hardhat node in the background.
 * Waits until the RPC endpoint is responsive.
 */
export async function startHardhatNode(): Promise<void> {
  // Check if already running
  try {
    const res = await fetch(HARDHAT_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
    });
    if (res.ok) return; // Already running
  } catch {
    // Not running, start it
  }

  hardhatProcess = spawn('npx', ['hardhat', 'node', '--hostname', '127.0.0.1'], {
    cwd: CONTRACTS_DIR,
    stdio: 'pipe',
    shell: true,
  });

  // Wait for node to be ready (max 30s)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HARDHAT_RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      });
      if (res.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Hardhat node failed to start within 30s');
}

export function stopHardhatNode(): void {
  if (hardhatProcess) {
    hardhatProcess.kill('SIGTERM');
    hardhatProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Contract deployment
// ---------------------------------------------------------------------------

/**
 * Deploy all contracts to the running hardhat node.
 * Returns the deployment record (contract addresses).
 */
export function deployContracts(): Record<string, string> {
  const output = execSync(
    'npx hardhat run scripts/deploy-all.ts --network hardhat',
    {
      cwd: CONTRACTS_DIR,
      encoding: 'utf-8',
      timeout: 120_000,
      env: {
        ...process.env,
        DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY,
      },
    },
  );

  // Parse addresses from deploy output or read deployment file
  // Deploy script writes to deployments/<network>.json
  const deploymentPath = join(CONTRACTS_DIR, 'deployments', 'hardhat.json');
  const { readFileSync } = require('node:fs');

  try {
    const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
    const addresses: Record<string, string> = {};
    for (const [name, entry] of Object.entries(deployment.contracts as Record<string, any>)) {
      addresses[name] = entry.proxy ?? entry.address;
    }
    return addresses;
  } catch {
    throw new Error(
      `Failed to read deployment addresses from ${deploymentPath}.\n` +
      `Deploy output: ${output}`,
    );
  }
}

// ---------------------------------------------------------------------------
// ChainConfig builder
// ---------------------------------------------------------------------------

export interface IntegrationChainConfig {
  rpcUrl: string;
  chainId: number;
  contracts: {
    token: string;
    escrow: string;
    identity: string;
    reputation: string;
    contracts: string;
    dao: string;
    staking: string;
    paramRegistry: string;
  };
  signer: { type: 'env'; envVar: string };
  artifactsDir: string;
}

export function buildChainConfig(addresses: Record<string, string>): IntegrationChainConfig {
  // Set signer key in env so ContractProvider can pick it up
  process.env.INTEGRATION_TEST_SIGNER = DEPLOYER_KEY;

  return {
    rpcUrl: HARDHAT_RPC,
    chainId: HARDHAT_CHAIN_ID,
    contracts: {
      token: addresses.ClawToken,
      escrow: addresses.ClawEscrow,
      identity: addresses.ClawIdentity,
      reputation: addresses.ClawReputation,
      contracts: addresses.ClawContracts,
      dao: addresses.ClawDAO,
      staking: addresses.ClawStaking,
      paramRegistry: addresses.ParamRegistry,
    },
    signer: { type: 'env', envVar: 'INTEGRATION_TEST_SIGNER' },
    artifactsDir: join(CONTRACTS_DIR, 'artifacts'),
  };
}

// ---------------------------------------------------------------------------
// Temp dir
// ---------------------------------------------------------------------------

export async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'clawnet-integration-'));
}

export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { HARDHAT_RPC, HARDHAT_CHAIN_ID, DEPLOYER_KEY, CONTRACTS_DIR };
