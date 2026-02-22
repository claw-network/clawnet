import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy ClawReputation (Phase 2 reputation anchoring layer).
 *
 * Deployment order:
 *   1. ClawReputation UUPS proxy
 *
 * Post-deploy role grants:
 *   - ANCHOR_ROLE to a designated anchor service address (if provided)
 *
 * Environment variables:
 *   EPOCH_DURATION   — Epoch duration in seconds, default 86400 (24h)
 *   ANCHOR_ADDRESS   — Optional: grant ANCHOR_ROLE to this address
 *
 * Usage:
 *   npx hardhat run scripts/deploy-reputation.ts --network clawnetTestnet
 */

interface ReputationDeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  contracts: {
    ClawReputation: { proxy: string; impl: string };
  };
  params: {
    epochDuration: number;
    anchorAddress: string | null;
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("ClawNet Phase 2 — ClawReputation Deployment");
  console.log("=".repeat(60));
  console.log(`Network   : ${network.name} (chainId ${network.chainId})`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log("=".repeat(60));

  // ── Parameters ──────────────────────────────────────────────────
  const epochDuration = parseInt(process.env.EPOCH_DURATION ?? "86400", 10);
  const anchorAddress = process.env.ANCHOR_ADDRESS ?? null;

  console.log(`\nEpoch duration : ${epochDuration}s (${epochDuration / 3600}h)`);
  if (anchorAddress) {
    console.log(`Anchor address : ${anchorAddress}`);
  }

  // ── Deploy ClawReputation ──────────────────────────────────────
  console.log("\n[1/1] Deploying ClawReputation (UUPS proxy)...");
  const factory = await ethers.getContractFactory("ClawReputation");
  const rep = await upgrades.deployProxy(factory, [deployer.address, epochDuration], {
    kind: "uups",
  });
  await rep.waitForDeployment();

  const proxyAddr = await rep.getAddress();
  const implAddr = await upgrades.erc1967.getImplementationAddress(proxyAddr);
  console.log(`  Proxy : ${proxyAddr}`);
  console.log(`  Impl  : ${implAddr}`);

  // ── Post-deploy: grant ANCHOR_ROLE ─────────────────────────────
  if (anchorAddress) {
    const ANCHOR_ROLE = await rep.ANCHOR_ROLE();
    const tx = await rep.grantRole(ANCHOR_ROLE, anchorAddress);
    await tx.wait();
    console.log(`\n  ✓ Granted ANCHOR_ROLE to ${anchorAddress}`);
  }

  // ── Save deployment record ─────────────────────────────────────
  const record: ReputationDeploymentRecord = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      ClawReputation: { proxy: proxyAddr, impl: implAddr },
    },
    params: {
      epochDuration,
      anchorAddress,
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `reputation-${network.name}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  console.log(`\n  Deployment record → ${outFile}`);

  console.log("\n" + "=".repeat(60));
  console.log("ClawReputation deployment complete ✓");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
