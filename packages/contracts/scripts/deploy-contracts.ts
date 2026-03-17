import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy ClawContracts (Phase 2 service contracts layer).
 *
 * Deployment order:
 *   1. ClawContracts (depends on ClawToken for fund management)
 *
 * Post-deploy role grants:
 *   - Global ARBITER_ROLE to a designated arbiter address (if provided)
 *
 * Environment variables:
 *   TOKEN_ADDRESS     — Existing ClawToken proxy address (required)
 *   TREASURY_ADDRESS  — Fee recipient address (required)
 *   PLATFORM_FEE_BPS  — Platform fee in basis points, default 100 (1%)
 *   ARBITER_ADDRESS   — Optional: grant global ARBITER_ROLE to this address
 *
 * Usage:
 *   TOKEN_ADDRESS=0x... TREASURY_ADDRESS=0x... npx hardhat run scripts/deploy-contracts.ts --network clawnetTestnet
 */

interface ContractsDeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  contracts: {
    ClawContracts: { proxy: string; impl: string };
  };
  params: {
    tokenAddress: string;
    treasuryAddress: string;
    platformFeeBps: number;
    arbiterAddress: string | null;
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("ClawNet Phase 2 — ClawContracts Deployment");
  console.log("=".repeat(60));
  console.log(`Network   : ${network.name} (chainId ${network.chainId})`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log("=".repeat(60));

  // ── Parameters ──────────────────────────────────────────────────

  const tokenAddress = process.env.TOKEN_ADDRESS;
  if (!tokenAddress) {
    throw new Error("TOKEN_ADDRESS env var is required");
  }
  const treasuryAddress = process.env.TREASURY_ADDRESS;
  if (!treasuryAddress) {
    throw new Error("TREASURY_ADDRESS env var is required");
  }

  const platformFeeBps = parseInt(process.env.PLATFORM_FEE_BPS || "100", 10);
  const arbiterAddress = process.env.ARBITER_ADDRESS || null;

  console.log(`Token     : ${tokenAddress}`);
  console.log(`Treasury  : ${treasuryAddress}`);
  console.log(`Fee BPS   : ${platformFeeBps} (${platformFeeBps / 100}%)`);
  if (arbiterAddress) {
    console.log(`Arbiter   : ${arbiterAddress}`);
  }
  console.log("-".repeat(60));

  // ── Deploy ClawContracts ────────────────────────────────────────

  console.log("\n1. Deploying ClawContracts (UUPS proxy)...");
  const ContractsFactory = await ethers.getContractFactory("ClawContracts");
  const contractsProxy = await upgrades.deployProxy(
    ContractsFactory,
    [tokenAddress, treasuryAddress, platformFeeBps, deployer.address],
    { kind: "uups" }
  );
  await contractsProxy.waitForDeployment();

  const contractsProxyAddr = await contractsProxy.getAddress();
  const contractsImplAddr = await upgrades.erc1967.getImplementationAddress(
    contractsProxyAddr
  );

  console.log(`   Proxy : ${contractsProxyAddr}`);
  console.log(`   Impl  : ${contractsImplAddr}`);

  // ── Role Grants ─────────────────────────────────────────────────

  if (arbiterAddress) {
    console.log(
      `\n2. Granting ARBITER_ROLE to ${arbiterAddress}...`
    );
    const ARBITER_ROLE = await contractsProxy.ARBITER_ROLE();
    const tx = await contractsProxy.grantRole(ARBITER_ROLE, arbiterAddress);
    await tx.wait();
    console.log("   Done.");
  }

  // ── Save Deployment Record ──────────────────────────────────────

  const record: ContractsDeploymentRecord = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      ClawContracts: {
        proxy: contractsProxyAddr,
        impl: contractsImplAddr,
      },
    },
    params: {
      tokenAddress,
      treasuryAddress,
      platformFeeBps,
      arbiterAddress,
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const outFile = path.join(
    deploymentsDir,
    `contracts-${network.name}-${Date.now()}.json`
  );
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log("Deployment complete!");
  console.log(`Record saved: ${outFile}`);
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
