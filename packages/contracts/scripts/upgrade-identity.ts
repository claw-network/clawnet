import { ethers } from "hardhat";

/**
 * Upgrade ClawIdentity UUPS proxy to the latest implementation.
 *
 * This script bypasses the OZ upgrades manifest (which may be out of sync)
 * and deploys the new implementation directly, then calls upgradeToAndCall
 * on the existing proxy.
 *
 * Environment variables:
 *   IDENTITY_PROXY — Existing ClawIdentity proxy address (required)
 *
 * Usage:
 *   IDENTITY_PROXY=0x... npx hardhat run scripts/upgrade-identity.ts --network clawnetTestnet
 */

async function main() {
  const proxyAddress = process.env.IDENTITY_PROXY;
  if (!proxyAddress) {
    throw new Error("IDENTITY_PROXY env var is required");
  }

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("ClawIdentity — UUPS Implementation Upgrade");
  console.log("=".repeat(60));
  console.log(`Network    : chainId ${network.chainId}`);
  console.log(`Deployer   : ${deployer.address}`);
  console.log(`Proxy      : ${proxyAddress}`);
  console.log("=".repeat(60));

  // 1. Deploy new implementation
  console.log("\n1. Deploying new ClawIdentity implementation...");
  const Factory = await ethers.getContractFactory("ClawIdentity");
  const impl = await Factory.deploy();
  await impl.waitForDeployment();
  const implAddress = await impl.getAddress();
  console.log(`   New impl : ${implAddress}`);

  // 2. Verify the new implementation has the expected selector
  const code = await ethers.provider.getCode(implAddress);
  const hasNewSelector = code.includes("eccf4570");
  const hasOldSelector = code.includes("0293ce52");
  console.log(`   Has H-01 selector (eccf4570): ${hasNewSelector}`);
  console.log(`   Has old selector (0293ce52) : ${hasOldSelector}`);
  if (!hasNewSelector) {
    throw new Error("New implementation does NOT have the H-01 registerDID selector!");
  }

  // 3. Call upgradeToAndCall on the proxy
  console.log("\n2. Calling upgradeToAndCall on proxy...");
  const proxy = Factory.attach(proxyAddress);
  const tx = await proxy.upgradeToAndCall(implAddress, "0x");
  console.log(`   tx hash  : ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`   status   : ${receipt!.status === 1 ? "SUCCESS" : "FAILED"}`);
  console.log(`   gas used : ${receipt!.gasUsed.toString()}`);

  // 4. Verify upgrade
  console.log("\n3. Verifying upgrade...");
  const ERC1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const implSlot = await ethers.provider.getStorage(proxyAddress, ERC1967_IMPL_SLOT);
  const currentImpl = "0x" + implSlot.slice(26).toLowerCase();
  console.log(`   Impl slot: ${currentImpl}`);
  console.log(`   Expected : ${implAddress.toLowerCase()}`);
  console.log(`   Match    : ${currentImpl === implAddress.toLowerCase()}`);

  console.log("\n" + "=".repeat(60));
  console.log("Upgrade complete!");
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
