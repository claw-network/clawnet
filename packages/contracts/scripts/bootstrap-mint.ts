import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Bootstrap Token Distribution — Genesis Mint
 *
 * Mints initial Token supply and distributes to operational wallets.
 * Must be run by the Deployer (who holds MINTER_ROLE on ClawToken).
 *
 * This script solves the cold-start paradox: without initial distribution,
 * no one has Tokens to stake, propose, vote, or operate the faucet.
 *
 * Allocation follows value-anchor-monetary-policy-v0.1.md Section 13.2:
 *   - Treasury (DAO):      50%
 *   - Ecosystem / Nodes:   20%
 *   - Faucet:              15%
 *   - Liquidity:           10%
 *   - Risk Reserve:         5%
 *
 * Environment variables:
 *   TOKEN_ADDRESS           — ClawToken proxy address (required, or reads from deployments/)
 *   DAO_ADDRESS             — ClawDAO proxy address (required, or reads from deployments/)
 *   BOOTSTRAP_TOTAL_SUPPLY  — Total tokens to mint (default: 1000000)
 *   NODE_ADDRESSES          — Comma-separated node wallet addresses for ecosystem allocation
 *   FAUCET_ADDRESS          — Faucet vault address (defaults to deployer)
 *   LIQUIDITY_ADDRESS       — Liquidity wallet address (required)
 *   RESERVE_ADDRESS         — Risk reserve address (required)
 *   RELAY_REWARD_POOL_AMOUNT — Token to seed in ClawRelayReward pool (default: 100000, 0 to skip)
 *
 * Usage:
 *   npx hardhat run scripts/bootstrap-mint.ts --network clawnetTestnet
 *
 *   # With custom parameters:
 *   BOOTSTRAP_TOTAL_SUPPLY=2000000 \
 *   NODE_ADDRESSES=0xABC...,0xDEF...,0x123... \
 *   npx hardhat run scripts/bootstrap-mint.ts --network clawnetTestnet
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MintAllocation {
  label: string;
  address: string;
  amount: number;
}

function parseAddress(value: string, envName: string): string {
  try {
    return ethers.getAddress(value);
  } catch {
    throw new Error(`${envName} must be a valid EVM address: ${value}`);
  }
}

function requireEnvAddress(envName: string): string {
  const raw = process.env[envName];
  if (!raw || !raw.trim()) {
    throw new Error(
      `${envName} is required and must be explicitly configured (no fallback to treasury).`,
    );
  }
  return parseAddress(raw.trim(), envName);
}

function loadDeployment(networkName: string): Record<string, unknown> | null {
  try {
    const filePath = path.resolve(__dirname, '..', 'deployments', `${networkName}.json`);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === 'unknown' ? `chain-${network.chainId}` : network.name;

  console.log('='.repeat(60));
  console.log('ClawNet — Bootstrap Token Distribution (Genesis Mint)');
  console.log('='.repeat(60));
  console.log(`Network   : ${networkName} (chainId ${network.chainId})`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Timestamp : ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  // ── Resolve addresses ─────────────────────────────────────────

  const deployment = loadDeployment(networkName);
  const contracts = (deployment?.contracts ?? {}) as Record<string, { proxy: string }>;
  const deploymentParams = (deployment?.params ?? {}) as Record<string, string>;

  const tokenAddress = process.env.TOKEN_ADDRESS ?? contracts.ClawToken?.proxy;
  const daoAddress = process.env.DAO_ADDRESS ?? contracts.ClawDAO?.proxy;
  const relayRewardAddress = process.env.RELAY_REWARD_ADDRESS ?? contracts.ClawRelayReward?.proxy;
  const treasuryAddress = parseAddress(
    process.env.TREASURY_ADDRESS ?? deploymentParams.treasury ?? deployer.address,
    'TREASURY_ADDRESS',
  );

  if (!tokenAddress) {
    throw new Error(
      'TOKEN_ADDRESS not set and no deployment record found. Run deploy-all.ts first.',
    );
  }
  if (!daoAddress) {
    throw new Error('DAO_ADDRESS not set and no deployment record found. Run deploy-all.ts first.');
  }

  // ── Parameters ────────────────────────────────────────────────

  const totalSupply = Number(process.env.BOOTSTRAP_TOTAL_SUPPLY || 1_000_000);

  // Allocation ratios (from value-anchor-monetary-policy-v0.1.md §13.2)
  const treasuryRatio = 0.5;
  const ecosystemRatio = 0.2;
  const faucetRatio = 0.15;
  const liquidityRatio = 0.1;
  const reserveRatio = 0.05;

  // Node addresses for ecosystem allocation
  const nodeAddressesRaw = process.env.NODE_ADDRESSES ?? '';
  const nodeAddresses = nodeAddressesRaw
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  const faucetAddress = parseAddress(
    process.env.FAUCET_ADDRESS ?? deployer.address,
    'FAUCET_ADDRESS',
  );
  const liquidityAddress = requireEnvAddress('LIQUIDITY_ADDRESS');
  const reserveAddress = requireEnvAddress('RESERVE_ADDRESS');

  if (liquidityAddress === treasuryAddress) {
    throw new Error('LIQUIDITY_ADDRESS must be distinct from TREASURY_ADDRESS');
  }
  if (reserveAddress === treasuryAddress) {
    throw new Error('RESERVE_ADDRESS must be distinct from TREASURY_ADDRESS');
  }
  if (liquidityAddress === reserveAddress) {
    throw new Error('LIQUIDITY_ADDRESS must be distinct from RESERVE_ADDRESS');
  }

  // ── Calculate allocations ─────────────────────────────────────

  const treasuryAmount = Math.floor(totalSupply * treasuryRatio);
  const ecosystemAmount = Math.floor(totalSupply * ecosystemRatio);
  const faucetAmount = Math.floor(totalSupply * faucetRatio);
  const liquidityAmount = Math.floor(totalSupply * liquidityRatio);
  const reserveAmount = Math.floor(totalSupply * reserveRatio);

  // Split ecosystem allocation across nodes (equal share)
  const perNodeAmount =
    nodeAddresses.length > 0 ? Math.floor(ecosystemAmount / nodeAddresses.length) : 0;
  const ecosystemRemainder =
    nodeAddresses.length > 0
      ? ecosystemAmount - perNodeAmount * nodeAddresses.length
      : ecosystemAmount;

  // Build allocation list
  const allocations: MintAllocation[] = [];

  // Treasury (DAO contract)
  allocations.push({
    label: 'Treasury (DAO)',
    address: daoAddress,
    amount: treasuryAmount,
  });

  // Node wallets
  for (const addr of nodeAddresses) {
    allocations.push({
      label: `Node Wallet`,
      address: addr,
      amount: perNodeAmount,
    });
  }

  // If no node addresses provided or there's remainder, send ecosystem portion to deployer
  if (ecosystemRemainder > 0 || nodeAddresses.length === 0) {
    const remainderTarget = nodeAddresses.length > 0 ? nodeAddresses[0] : deployer.address;
    const remainderLabel =
      nodeAddresses.length > 0 ? 'Node Wallet (remainder)' : 'Ecosystem (deployer)';
    allocations.push({
      label: remainderLabel,
      address: remainderTarget,
      amount: nodeAddresses.length > 0 ? ecosystemRemainder : ecosystemAmount,
    });
  }

  // Faucet
  allocations.push({
    label: 'Faucet Vault',
    address: faucetAddress,
    amount: faucetAmount,
  });

  // Liquidity
  allocations.push({
    label: 'Liquidity',
    address: liquidityAddress,
    amount: liquidityAmount,
  });

  // Risk Reserve
  allocations.push({
    label: 'Risk Reserve',
    address: reserveAddress,
    amount: reserveAmount,
  });

  // Verify total
  const allocatedTotal = allocations.reduce((sum, a) => sum + a.amount, 0);
  if (allocatedTotal !== totalSupply) {
    throw new Error(`Allocation mismatch: ${allocatedTotal} != ${totalSupply} (rounding error)`);
  }

  // ── Pre-flight checks ─────────────────────────────────────────

  const token = await ethers.getContractAt('ClawToken', tokenAddress);

  const currentSupply = await token.totalSupply();
  console.log(`\nCurrent totalSupply: ${currentSupply}`);

  // Check deployer has MINTER_ROLE
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('MINTER_ROLE'));
  const hasMinter = await token.hasRole(MINTER_ROLE, deployer.address);
  if (!hasMinter) {
    throw new Error(
      `Deployer ${deployer.address} does not have MINTER_ROLE on ClawToken. Cannot mint.`,
    );
  }
  console.log('✓ Deployer has MINTER_ROLE');

  // ── Print plan ────────────────────────────────────────────────

  console.log('\n' + '-'.repeat(60));
  console.log('Mint Plan:');
  console.log('-'.repeat(60));
  console.log(`Total Supply to Mint: ${totalSupply.toLocaleString()} Token`);
  console.log('');

  for (const alloc of allocations) {
    const pct = ((alloc.amount / totalSupply) * 100).toFixed(1);
    console.log(
      `  ${alloc.label.padEnd(28)} ${alloc.amount.toLocaleString().padStart(12)} Token  (${pct.padStart(5)}%)  → ${alloc.address}`,
    );
  }
  console.log('-'.repeat(60));

  // ── Execute mints ─────────────────────────────────────────────

  console.log('\nExecuting mints...\n');

  for (const alloc of allocations) {
    if (alloc.amount === 0) {
      console.log(`  ⏭  ${alloc.label}: 0 Token (skipped)`);
      continue;
    }
    const tx = await token.mint(alloc.address, alloc.amount);
    const receipt = await tx.wait();
    console.log(
      `  ✓ ${alloc.label}: ${alloc.amount.toLocaleString()} Token → ${alloc.address} (tx: ${receipt.hash.slice(0, 18)}...)`,
    );
  }

  // ── Verify ────────────────────────────────────────────────────

  const newSupply = await token.totalSupply();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Bootstrap mint complete!`);
  console.log(`  Previous totalSupply : ${currentSupply}`);
  console.log(`  Minted               : ${totalSupply.toLocaleString()}`);
  console.log(`  New totalSupply      : ${newSupply}`);
  console.log('='.repeat(60));

  // ── Relay Reward Pool ─────────────────────────────────────────

  const relayRewardPoolAmount = Number(process.env.RELAY_REWARD_POOL_AMOUNT ?? 100_000);
  if (relayRewardPoolAmount > 0 && relayRewardAddress) {
    console.log(`\n[RelayReward] Minting ${relayRewardPoolAmount.toLocaleString()} Token to relay incentive pool...`);
    const rrTx = await token.mint(relayRewardAddress, relayRewardPoolAmount);
    const rrReceipt = await rrTx.wait();
    console.log(
      `  ✓ Relay Reward Pool: ${relayRewardPoolAmount.toLocaleString()} Token → ${relayRewardAddress} (tx: ${rrReceipt.hash.slice(0, 18)}...)`,
    );
    const rrBalance = await token.balanceOf(relayRewardAddress);
    console.log(`  Pool balance: ${rrBalance} Token`);
  } else if (relayRewardPoolAmount > 0) {
    console.log('\n⚠  ClawRelayReward address not found — skipping relay pool mint.');
    console.log('   Set RELAY_REWARD_ADDRESS or deploy ClawRelayReward first.');
  }

  // ── Verify balances for key addresses ─────────────────────────

  console.log('\nBalance verification:');
  const checked = new Set<string>();
  for (const alloc of allocations) {
    if (checked.has(alloc.address)) continue;
    checked.add(alloc.address);
    const bal = await token.balanceOf(alloc.address);
    console.log(`  ${alloc.address}: ${bal} Token`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
