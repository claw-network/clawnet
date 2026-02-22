import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Unified deployment script for ALL 9 ClawNet contracts.
 *
 * Deployment order (respects dependencies):
 *   1. ClawToken        — no deps
 *   2. ParamRegistry    — no deps
 *   3. ClawEscrow       — depends on ClawToken
 *   4. ClawIdentity     — no deps
 *   5. ClawStaking      — depends on ClawToken
 *   6. ClawReputation   — no deps
 *   7. ClawDAO          — depends on ClawToken + ParamRegistry
 *   8. ClawContracts    — depends on ClawToken
 *   9. ClawRouter       — no deps (post-deploy registers all contracts)
 *
 * Post-deploy role grants:
 *   - ClawToken.MINTER_ROLE  → ClawStaking (reward minting)
 *   - ParamRegistry.GOVERNOR_ROLE → ClawDAO (DAO-driven param changes)
 *   - ClawReputation.ANCHOR_ROLE  → (optional) ANCHOR_ADDRESS
 *   - ClawContracts.ARBITER_ROLE  → (optional) ARBITER_ADDRESS
 *   - ClawRouter: registers all 8 module addresses
 *   - ClawDAO.setReputationContract → ClawReputation
 *   - ClawDAO.setStakingContract   → ClawStaking
 *
 * Environment variables (all optional — sensible defaults used):
 *   TREASURY_ADDRESS    — Escrow/Contracts fee treasury (defaults to deployer)
 *   ESCROW_BASE_RATE    — bps, default 100 (1%)
 *   ESCROW_HOLDING_RATE — bps/day, default 5 (0.05%)
 *   ESCROW_MIN_FEE      — Token, default 1
 *   MIN_STAKE           — Token, default 10000
 *   UNSTAKE_COOLDOWN    — seconds, default 604800 (7 days)
 *   REWARD_PER_EPOCH    — Token, default 1
 *   SLASH_PER_VIOLATION — Token, default 1
 *   EPOCH_DURATION      — seconds, default 86400 (24h)
 *   PROPOSAL_THRESHOLD  — Token balance to propose, default 100
 *   DISCUSSION_PERIOD   — seconds, default 172800 (2 days)
 *   VOTING_PERIOD       — seconds, default 259200 (3 days)
 *   TIMELOCK_DELAY      — seconds, default 86400 (1 day)
 *   QUORUM_BPS          — basis points, default 400 (4%)
 *   PLATFORM_FEE_BPS    — basis points, default 100 (1%)
 *   EMERGENCY_SIGNERS   — comma-separated 9 addresses (defaults to deployer×9)
 *   ANCHOR_ADDRESS      — optional: grant ANCHOR_ROLE on Reputation
 *   ARBITER_ADDRESS     — optional: grant ARBITER_ROLE on Contracts
 *
 * Usage:
 *   npx hardhat run scripts/deploy-all.ts --network clawnetTestnet
 *
 * Output:
 *   deployments/<network>.json
 */

// ── Types ────────────────────────────────────────────────────────────

interface ContractEntry {
  proxy: string;
  impl: string;
}

interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  contracts: {
    ClawToken: ContractEntry;
    ParamRegistry: ContractEntry;
    ClawEscrow: ContractEntry;
    ClawIdentity: ContractEntry;
    ClawStaking: ContractEntry;
    ClawReputation: ContractEntry;
    ClawDAO: ContractEntry;
    ClawContracts: ContractEntry;
    ClawRouter: ContractEntry;
  };
  roles: {
    minterToStaking: string;
    governorToDao: string;
    anchorAddress: string | null;
    arbiterAddress: string | null;
  };
  params: Record<string, number | string>;
}

// ── Helpers ──────────────────────────────────────────────────────────

async function deployOne(
  name: string,
  step: string,
  initArgs: unknown[],
): Promise<{ proxy: string; impl: string }> {
  console.log(`\n[${step}] Deploying ${name}...`);
  const factory = await ethers.getContractFactory(name);
  const proxyContract = await upgrades.deployProxy(factory, initArgs, {
    kind: "uups",
    initializer: "initialize",
  });
  await proxyContract.waitForDeployment();
  const proxy = await proxyContract.getAddress();
  const impl = await upgrades.erc1967.getImplementationAddress(proxy);
  console.log(`  proxy : ${proxy}`);
  console.log(`  impl  : ${impl}`);
  return { proxy, impl };
}

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  return raw ? parseInt(raw, 10) : fallback;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=".repeat(60));
  console.log("ClawNet — Full Deployment (9 Contracts)");
  console.log("=".repeat(60));
  console.log(`Network   : ${network.name} (chainId ${network.chainId})`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Timestamp : ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  // ── Parameters ──────────────────────────────────────────────────

  const treasury = env("TREASURY_ADDRESS", deployer.address);
  const escrowBaseRate = envInt("ESCROW_BASE_RATE", 100);
  const escrowHoldingRate = envInt("ESCROW_HOLDING_RATE", 5);
  const escrowMinFee = envInt("ESCROW_MIN_FEE", 1);
  const minStake = envInt("MIN_STAKE", 10_000);
  const unstakeCooldown = envInt("UNSTAKE_COOLDOWN", 604_800);
  const rewardPerEpoch = envInt("REWARD_PER_EPOCH", 1);
  const slashPerViolation = envInt("SLASH_PER_VIOLATION", 1);
  const epochDuration = envInt("EPOCH_DURATION", 86_400);
  const proposalThreshold = envInt("PROPOSAL_THRESHOLD", 100);
  const discussionPeriod = envInt("DISCUSSION_PERIOD", 172_800);
  const votingPeriod = envInt("VOTING_PERIOD", 259_200);
  const timelockDelay = envInt("TIMELOCK_DELAY", 86_400);
  const quorumBps = envInt("QUORUM_BPS", 400);
  const platformFeeBps = envInt("PLATFORM_FEE_BPS", 100);
  const anchorAddress = process.env.ANCHOR_ADDRESS ?? null;
  const arbiterAddress = process.env.ARBITER_ADDRESS ?? null;

  // Emergency signers — 9 addresses (defaults to deployer repeated)
  const signersRaw = process.env.EMERGENCY_SIGNERS ?? "";
  let signersList = signersRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (signersList.length === 0) {
    console.log("\n⚠  EMERGENCY_SIGNERS not set — using deployer address ×9 (dev only!)");
    signersList = Array(9).fill(deployer.address);
  }
  if (signersList.length !== 9) {
    throw new Error(
      `EMERGENCY_SIGNERS must have exactly 9 addresses (got ${signersList.length}).`,
    );
  }

  // ── 1. ClawToken ────────────────────────────────────────────────

  const tokenDeploy = await deployOne("ClawToken", "1/9", [
    "ClawNet Token",
    "TOKEN",
    deployer.address,
  ]);

  // ── 2. ParamRegistry ───────────────────────────────────────────

  const paramDeploy = await deployOne("ParamRegistry", "2/9", [deployer.address]);

  // ── 3. ClawEscrow ──────────────────────────────────────────────

  const escrowDeploy = await deployOne("ClawEscrow", "3/9", [
    tokenDeploy.proxy,
    treasury,
    escrowBaseRate,
    escrowHoldingRate,
    escrowMinFee,
  ]);

  // ── 4. ClawIdentity ────────────────────────────────────────────

  const identityDeploy = await deployOne("ClawIdentity", "4/9", [deployer.address]);

  // ── 5. ClawStaking ─────────────────────────────────────────────

  const stakingDeploy = await deployOne("ClawStaking", "5/9", [
    tokenDeploy.proxy,
    minStake,
    unstakeCooldown,
    rewardPerEpoch,
    slashPerViolation,
  ]);

  // ── 6. ClawReputation ──────────────────────────────────────────

  const reputationDeploy = await deployOne("ClawReputation", "6/9", [
    deployer.address,
    epochDuration,
  ]);

  // ── 7. ClawDAO ─────────────────────────────────────────────────

  const daoDeploy = await deployOne("ClawDAO", "7/9", [
    tokenDeploy.proxy,
    paramDeploy.proxy,
    proposalThreshold,
    discussionPeriod,
    votingPeriod,
    timelockDelay,
    quorumBps,
    signersList,
  ]);

  // ── 8. ClawContracts ───────────────────────────────────────────

  const contractsDeploy = await deployOne("ClawContracts", "8/9", [
    tokenDeploy.proxy,
    treasury,
    platformFeeBps,
    deployer.address,
  ]);

  // ── 9. ClawRouter ─────────────────────────────────────────────

  const routerDeploy = await deployOne("ClawRouter", "9/9", [deployer.address]);

  // ── Cross-contract Role Grants ─────────────────────────────────

  console.log("\n" + "-".repeat(60));
  console.log("[Roles] Setting up cross-contract permissions...");

  const keccak = ethers.keccak256;
  const toUtf8 = ethers.toUtf8Bytes;

  // 1. ClawToken MINTER_ROLE → ClawStaking
  const tokenContract = (await ethers.getContractFactory("ClawToken")).attach(tokenDeploy.proxy);
  const MINTER_ROLE = keccak(toUtf8("MINTER_ROLE"));
  await (await tokenContract.grantRole(MINTER_ROLE, stakingDeploy.proxy)).wait();
  console.log(`  ✓ ClawToken.MINTER_ROLE → ClawStaking`);

  // 2. ParamRegistry GOVERNOR_ROLE → ClawDAO
  const paramContract = (await ethers.getContractFactory("ParamRegistry")).attach(paramDeploy.proxy);
  const GOVERNOR_ROLE = keccak(toUtf8("GOVERNOR_ROLE"));
  await (await paramContract.grantRole(GOVERNOR_ROLE, daoDeploy.proxy)).wait();
  console.log(`  ✓ ParamRegistry.GOVERNOR_ROLE → ClawDAO`);

  // 3. ClawDAO.setReputationContract → ClawReputation
  const daoContract = (await ethers.getContractFactory("ClawDAO")).attach(daoDeploy.proxy);
  await (await daoContract.setReputationContract(reputationDeploy.proxy)).wait();
  console.log(`  ✓ ClawDAO.reputationContract → ClawReputation`);

  // 4. ClawDAO.setStakingContract → ClawStaking
  await (await daoContract.setStakingContract(stakingDeploy.proxy)).wait();
  console.log(`  ✓ ClawDAO.stakingContract → ClawStaking`);

  // 5. Optional: ANCHOR_ROLE on Reputation
  if (anchorAddress) {
    const repContract = (await ethers.getContractFactory("ClawReputation")).attach(reputationDeploy.proxy);
    const ANCHOR_ROLE = keccak(toUtf8("ANCHOR_ROLE"));
    await (await repContract.grantRole(ANCHOR_ROLE, anchorAddress)).wait();
    console.log(`  ✓ ClawReputation.ANCHOR_ROLE → ${anchorAddress}`);
  }

  // 6. Optional: ARBITER_ROLE on Contracts
  if (arbiterAddress) {
    const contractsContract = (await ethers.getContractFactory("ClawContracts")).attach(contractsDeploy.proxy);
    const ARBITER_ROLE = keccak(toUtf8("ARBITER_ROLE"));
    await (await contractsContract.grantRole(ARBITER_ROLE, arbiterAddress)).wait();
    console.log(`  ✓ ClawContracts.ARBITER_ROLE → ${arbiterAddress}`);
  }

  // ── Router Registration ────────────────────────────────────────

  console.log("\n[Router] Registering all modules...");
  const routerContract = (await ethers.getContractFactory("ClawRouter")).attach(routerDeploy.proxy);

  const moduleKeys = [
    await routerContract.MODULE_TOKEN(),
    await routerContract.MODULE_ESCROW(),
    await routerContract.MODULE_IDENTITY(),
    await routerContract.MODULE_STAKING(),
    await routerContract.MODULE_DAO(),
    await routerContract.MODULE_CONTRACTS(),
    await routerContract.MODULE_REPUTATION(),
    await routerContract.MODULE_PARAM_REGISTRY(),
  ];
  const moduleAddrs = [
    tokenDeploy.proxy,
    escrowDeploy.proxy,
    identityDeploy.proxy,
    stakingDeploy.proxy,
    daoDeploy.proxy,
    contractsDeploy.proxy,
    reputationDeploy.proxy,
    paramDeploy.proxy,
  ];

  await (await routerContract.batchRegisterModules(moduleKeys, moduleAddrs)).wait();
  console.log(`  ✓ Registered 8 modules in ClawRouter`);

  // ── Initialize Default ParamRegistry Values ────────────────────

  console.log("\n[ParamRegistry] Setting default parameters...");
  const defaultParams: [string, number][] = [
    ["ESCROW_BASE_RATE", escrowBaseRate],
    ["ESCROW_HOLDING_RATE", escrowHoldingRate],
    ["ESCROW_MIN_FEE", escrowMinFee],
    ["PLATFORM_FEE_BPS", platformFeeBps],
    ["MIN_STAKE", minStake],
    ["UNSTAKE_COOLDOWN", unstakeCooldown],
    ["REWARD_PER_EPOCH", rewardPerEpoch],
    ["SLASH_PER_VIOLATION", slashPerViolation],
    ["EPOCH_DURATION", epochDuration],
    ["PROPOSAL_THRESHOLD", proposalThreshold],
    ["DISCUSSION_PERIOD", discussionPeriod],
    ["VOTING_PERIOD", votingPeriod],
    ["TIMELOCK_DELAY", timelockDelay],
    ["QUORUM_BPS", quorumBps],
  ];

  for (const [name, value] of defaultParams) {
    const key = keccak(toUtf8(name));
    await (await paramContract.setParam(key, value)).wait();
  }
  console.log(`  ✓ Set ${defaultParams.length} default parameters`);

  // ── Write Deployment Record ────────────────────────────────────

  const record: DeploymentRecord = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      ClawToken: tokenDeploy,
      ParamRegistry: paramDeploy,
      ClawEscrow: escrowDeploy,
      ClawIdentity: identityDeploy,
      ClawStaking: stakingDeploy,
      ClawReputation: reputationDeploy,
      ClawDAO: daoDeploy,
      ClawContracts: contractsDeploy,
      ClawRouter: routerDeploy,
    },
    roles: {
      minterToStaking: `${stakingDeploy.proxy}`,
      governorToDao: `${daoDeploy.proxy}`,
      anchorAddress,
      arbiterAddress,
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
      epochDuration,
      proposalThreshold,
      discussionPeriod,
      votingPeriod,
      timelockDelay,
      quorumBps,
      platformFeeBps,
    },
  };

  const deploymentsDir = path.resolve(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const networkName =
    network.name === "unknown" ? `chain-${network.chainId}` : network.name;
  const outPath = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");

  // ── Summary ────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(60));
  console.log("Deployment complete! All 9 contracts deployed.");
  console.log("=".repeat(60));
  console.log(`Record saved to: ${outPath}`);
  console.log("\nContract addresses:");
  console.log(`  ClawToken       : ${tokenDeploy.proxy}`);
  console.log(`  ParamRegistry   : ${paramDeploy.proxy}`);
  console.log(`  ClawEscrow      : ${escrowDeploy.proxy}`);
  console.log(`  ClawIdentity    : ${identityDeploy.proxy}`);
  console.log(`  ClawStaking     : ${stakingDeploy.proxy}`);
  console.log(`  ClawReputation  : ${reputationDeploy.proxy}`);
  console.log(`  ClawDAO         : ${daoDeploy.proxy}`);
  console.log(`  ClawContracts   : ${contractsDeploy.proxy}`);
  console.log(`  ClawRouter      : ${routerDeploy.proxy}`);
  console.log("\nRole grants:");
  console.log(`  Token.MINTER  → Staking : ${stakingDeploy.proxy}`);
  console.log(`  Param.GOVERNOR → DAO    : ${daoDeploy.proxy}`);
  console.log(`  DAO.reputation           : ${reputationDeploy.proxy}`);
  console.log(`  DAO.staking              : ${stakingDeploy.proxy}`);
  if (anchorAddress) console.log(`  Rep.ANCHOR               : ${anchorAddress}`);
  if (arbiterAddress) console.log(`  Contracts.ARBITER        : ${arbiterAddress}`);
  console.log(`\nRouter: 8 modules registered`);
  console.log(`ParamRegistry: ${defaultParams.length} default params set`);

  return record;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
