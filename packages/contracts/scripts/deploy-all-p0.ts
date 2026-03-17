import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Unified deployment script for all P0 core contracts.
 *
 * Deployment order:
 *   1. ClawToken
 *   2. ClawEscrow  (depends on ClawToken address)
 *   3. ClawIdentity
 *   4. ClawStaking (depends on ClawToken address)
 *
 * Post-deploy role grants:
 *   - Grant ClawToken MINTER_ROLE to ClawStaking (for future reward minting)
 *
 * Environment variables (all optional, sensible defaults used):
 *   TREASURY_ADDRESS   — Escrow fee treasury (defaults to deployer)
 *   ESCROW_BASE_RATE   — bps, default 100 (1%)
 *   ESCROW_HOLDING_RATE — bps/day, default 5 (0.05%)
 *   ESCROW_MIN_FEE     — Token, default 1
 *   MIN_STAKE          — Token, default 10000
 *   UNSTAKE_COOLDOWN   — seconds, default 604800 (7 days)
 *   REWARD_PER_EPOCH   — Token, default 1
 *   SLASH_PER_VIOLATION — Token, default 1
 *
 * Usage:
 *   npx hardhat run scripts/deploy-all-p0.ts --network clawnetTestnet
 *
 * Output:
 *   deployments/<network>.json with all proxy + implementation addresses
 */

interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  contracts: {
    ClawToken: { proxy: string; impl: string };
    ClawEscrow: { proxy: string; impl: string };
    ClawIdentity: { proxy: string; impl: string };
    ClawStaking: { proxy: string; impl: string };
  };
  params: {
    treasury: string;
    escrowBaseRate: number;
    escrowHoldingRate: number;
    escrowMinFee: number;
    minStake: number;
    unstakeCooldown: number;
    rewardPerEpoch: number;
    slashPerViolation: number;
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("ClawNet P0 — Unified Deployment");
  console.log("=".repeat(60));
  console.log(`Network   : ${network.name} (chainId ${network.chainId})`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Timestamp : ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  // -----------------------------------------------------------------------
  // Parameters
  // -----------------------------------------------------------------------
  const treasury = process.env.TREASURY_ADDRESS ?? deployer.address;
  const escrowBaseRate = Number(process.env.ESCROW_BASE_RATE ?? 100);
  const escrowHoldingRate = Number(process.env.ESCROW_HOLDING_RATE ?? 5);
  const escrowMinFee = Number(process.env.ESCROW_MIN_FEE ?? 1);
  const minStake = Number(process.env.MIN_STAKE ?? 10_000);
  const unstakeCooldown = Number(process.env.UNSTAKE_COOLDOWN ?? 604_800);
  const rewardPerEpoch = Number(process.env.REWARD_PER_EPOCH ?? 1);
  const slashPerViolation = Number(process.env.SLASH_PER_VIOLATION ?? 1);

  // -----------------------------------------------------------------------
  // 1. Deploy ClawToken
  // -----------------------------------------------------------------------
  console.log("\n[1/4] Deploying ClawToken...");
  const TokenFactory = await ethers.getContractFactory("ClawToken");
  const tokenProxy = await upgrades.deployProxy(
    TokenFactory,
    ["ClawNet Token", "TOKEN", deployer.address],
    { kind: "uups", initializer: "initialize" },
  );
  await tokenProxy.waitForDeployment();
  const tokenAddr = await tokenProxy.getAddress();
  const tokenImpl = await upgrades.erc1967.getImplementationAddress(tokenAddr);
  console.log(`  proxy : ${tokenAddr}`);
  console.log(`  impl  : ${tokenImpl}`);

  // -----------------------------------------------------------------------
  // 2. Deploy ClawEscrow
  // -----------------------------------------------------------------------
  console.log("\n[2/4] Deploying ClawEscrow...");
  const EscrowFactory = await ethers.getContractFactory("ClawEscrow");
  const escrowProxy = await upgrades.deployProxy(
    EscrowFactory,
    [tokenAddr, treasury, escrowBaseRate, escrowHoldingRate, escrowMinFee],
    { kind: "uups", initializer: "initialize" },
  );
  await escrowProxy.waitForDeployment();
  const escrowAddr = await escrowProxy.getAddress();
  const escrowImpl = await upgrades.erc1967.getImplementationAddress(escrowAddr);
  console.log(`  proxy : ${escrowAddr}`);
  console.log(`  impl  : ${escrowImpl}`);

  // -----------------------------------------------------------------------
  // 3. Deploy ClawIdentity
  // -----------------------------------------------------------------------
  console.log("\n[3/4] Deploying ClawIdentity...");
  const IdentityFactory = await ethers.getContractFactory("ClawIdentity");
  const identityProxy = await upgrades.deployProxy(
    IdentityFactory,
    [deployer.address],
    { kind: "uups", initializer: "initialize" },
  );
  await identityProxy.waitForDeployment();
  const identityAddr = await identityProxy.getAddress();
  const identityImpl = await upgrades.erc1967.getImplementationAddress(identityAddr);
  console.log(`  proxy : ${identityAddr}`);
  console.log(`  impl  : ${identityImpl}`);

  // -----------------------------------------------------------------------
  // 4. Deploy ClawStaking
  // -----------------------------------------------------------------------
  console.log("\n[4/4] Deploying ClawStaking...");
  const StakingFactory = await ethers.getContractFactory("ClawStaking");
  const stakingProxy = await upgrades.deployProxy(
    StakingFactory,
    [tokenAddr, minStake, unstakeCooldown, rewardPerEpoch, slashPerViolation],
    { kind: "uups", initializer: "initialize" },
  );
  await stakingProxy.waitForDeployment();
  const stakingAddr = await stakingProxy.getAddress();
  const stakingImpl = await upgrades.erc1967.getImplementationAddress(stakingAddr);
  console.log(`  proxy : ${stakingAddr}`);
  console.log(`  impl  : ${stakingImpl}`);

  // -----------------------------------------------------------------------
  // 5. Post-deploy role grants
  // -----------------------------------------------------------------------
  console.log("\n[Roles] Granting cross-contract roles...");

  // Grant MINTER_ROLE on ClawToken to ClawStaking (for future reward minting)
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const tokenContract = TokenFactory.attach(tokenAddr);
  const grantTx = await tokenContract.grantRole(MINTER_ROLE, stakingAddr);
  await grantTx.wait();
  console.log(`  ClawToken.MINTER_ROLE → ClawStaking (${stakingAddr})`);

  // -----------------------------------------------------------------------
  // 6. Write deployment record
  // -----------------------------------------------------------------------
  const record: DeploymentRecord = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      ClawToken: { proxy: tokenAddr, impl: tokenImpl },
      ClawEscrow: { proxy: escrowAddr, impl: escrowImpl },
      ClawIdentity: { proxy: identityAddr, impl: identityImpl },
      ClawStaking: { proxy: stakingAddr, impl: stakingImpl },
    },
    params: {
      treasury,
      escrowBaseRate,
      escrowHoldingRate,
      escrowMinFee,
      minStake,
      unstakeCooldown,
      rewardPerEpoch,
      slashPerViolation,
    },
  };

  const deploymentsDir = path.resolve(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const networkName = network.name === "unknown" ? `chain-${network.chainId}` : network.name;
  const outPath = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");

  console.log("\n" + "=".repeat(60));
  console.log("Deployment complete!");
  console.log("=".repeat(60));
  console.log(`Record saved to: ${outPath}`);
  console.log("\nContract addresses:");
  console.log(`  ClawToken    : ${tokenAddr}`);
  console.log(`  ClawEscrow   : ${escrowAddr}`);
  console.log(`  ClawIdentity : ${identityAddr}`);
  console.log(`  ClawStaking  : ${stakingAddr}`);
  console.log("\nNote: Users must call ClawToken.approve() for Escrow/Staking");
  console.log("      before interacting with createEscrow() or stake().");

  return record;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
