import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy ClawDAO + ParamRegistry (Phase 2 governance layer).
 *
 * Deployment order:
 *   1. ParamRegistry  (if not already deployed)
 *   2. ClawDAO        (depends on ClawToken + ParamRegistry)
 *
 * Post-deploy role grants:
 *   - Grant ParamRegistry GOVERNOR_ROLE to ClawDAO (for DAO-driven param changes)
 *
 * Environment variables (all optional):
 *   TOKEN_ADDRESS         — Existing ClawToken proxy address (required if not first deploy)
 *   PARAM_REGISTRY_ADDRESS — Existing ParamRegistry proxy (skip re-deploy)
 *   PROPOSAL_THRESHOLD    — Token balance to propose, default 100
 *   DISCUSSION_PERIOD     — seconds, default 172800 (2 days)
 *   VOTING_PERIOD         — seconds, default 259200 (3 days)
 *   TIMELOCK_DELAY        — seconds, default 86400 (1 day)
 *   QUORUM_BPS            — basis points, default 400 (4%)
 *   EMERGENCY_SIGNERS     — comma-separated 9 addresses
 *
 * Usage:
 *   npx hardhat run scripts/deploy-dao.ts --network clawnetTestnet
 */

interface DAODeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  contracts: {
    ParamRegistry: { proxy: string; impl: string };
    ClawDAO: { proxy: string; impl: string };
  };
  params: {
    tokenAddress: string;
    proposalThreshold: number;
    discussionPeriod: number;
    votingPeriod: number;
    timelockDelay: number;
    quorumBps: number;
    emergencySigners: string[];
  };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("ClawNet Phase 2 — DAO Deployment");
  console.log("=".repeat(60));
  console.log(`Network   : ${network.name} (chainId ${network.chainId})`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log("=".repeat(60));

  // ── Parameters ──────────────────────────────────────────────────

  const tokenAddress = process.env.TOKEN_ADDRESS;
  if (!tokenAddress) {
    throw new Error("TOKEN_ADDRESS env var required — point to ClawToken proxy");
  }

  const proposalThreshold = Number(process.env.PROPOSAL_THRESHOLD ?? 100);
  const discussionPeriod = Number(process.env.DISCUSSION_PERIOD ?? 172_800);
  const votingPeriod = Number(process.env.VOTING_PERIOD ?? 259_200);
  const timelockDelay = Number(process.env.TIMELOCK_DELAY ?? 86_400);
  const quorumBps = Number(process.env.QUORUM_BPS ?? 400);

  // Emergency signers — comma-separated, exactly 9
  const signersRaw = process.env.EMERGENCY_SIGNERS ?? "";
  const signersList = signersRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (signersList.length !== 9) {
    throw new Error(
      `EMERGENCY_SIGNERS must have exactly 9 addresses (got ${signersList.length}). ` +
      "Pass as comma-separated: addr1,addr2,...,addr9"
    );
  }
  const emergencySigners = signersList as unknown as [string, string, string, string, string, string, string, string, string];

  // ── 1. ParamRegistry ──────────────────────────────────────────────

  let registryAddr: string;
  let registryImpl: string;

  if (process.env.PARAM_REGISTRY_ADDRESS) {
    registryAddr = process.env.PARAM_REGISTRY_ADDRESS;
    registryImpl = await upgrades.erc1967.getImplementationAddress(registryAddr);
    console.log(`\n[1/2] Using existing ParamRegistry: ${registryAddr}`);
  } else {
    console.log("\n[1/2] Deploying ParamRegistry...");
    const RegistryFactory = await ethers.getContractFactory("ParamRegistry");
    const registryProxy = await upgrades.deployProxy(
      RegistryFactory,
      [deployer.address],
      { kind: "uups", initializer: "initialize" },
    );
    await registryProxy.waitForDeployment();
    registryAddr = await registryProxy.getAddress();
    registryImpl = await upgrades.erc1967.getImplementationAddress(registryAddr);
    console.log(`  proxy : ${registryAddr}`);
    console.log(`  impl  : ${registryImpl}`);
  }

  // ── 2. ClawDAO ────────────────────────────────────────────────────

  console.log("\n[2/2] Deploying ClawDAO...");
  const DAOFactory = await ethers.getContractFactory("ClawDAO");
  const daoProxy = await upgrades.deployProxy(
    DAOFactory,
    [
      tokenAddress,
      registryAddr,
      proposalThreshold,
      discussionPeriod,
      votingPeriod,
      timelockDelay,
      quorumBps,
      emergencySigners,
    ],
    { kind: "uups", initializer: "initialize" },
  );
  await daoProxy.waitForDeployment();
  const daoAddr = await daoProxy.getAddress();
  const daoImpl = await upgrades.erc1967.getImplementationAddress(daoAddr);
  console.log(`  proxy : ${daoAddr}`);
  console.log(`  impl  : ${daoImpl}`);

  // ── 3. Role Grants ────────────────────────────────────────────────

  console.log("\n[Roles] Granting GOVERNOR_ROLE on ParamRegistry to ClawDAO...");
  const RegistryFactory = await ethers.getContractFactory("ParamRegistry");
  const registry = RegistryFactory.attach(registryAddr);
  const GOVERNOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNOR_ROLE"));
  const grantTx = await registry.grantRole(GOVERNOR_ROLE, daoAddr);
  await grantTx.wait();
  console.log(`  ParamRegistry.GOVERNOR_ROLE → ClawDAO (${daoAddr})`);

  // ── 4. Write record ──────────────────────────────────────────────

  const record: DAODeploymentRecord = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      ParamRegistry: { proxy: registryAddr, impl: registryImpl },
      ClawDAO: { proxy: daoAddr, impl: daoImpl },
    },
    params: {
      tokenAddress,
      proposalThreshold,
      discussionPeriod,
      votingPeriod,
      timelockDelay,
      quorumBps,
      emergencySigners: signersList,
    },
  };

  const deploymentsDir = path.resolve(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const networkName = network.name === "unknown" ? `chain-${network.chainId}` : network.name;
  const outPath = path.join(deploymentsDir, `${networkName}-dao.json`);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");

  console.log("\n" + "=".repeat(60));
  console.log("DAO deployment complete!");
  console.log("=".repeat(60));
  console.log(`Record saved to: ${outPath}`);
  console.log(`  ParamRegistry : ${registryAddr}`);
  console.log(`  ClawDAO       : ${daoAddr}`);

  return record;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
