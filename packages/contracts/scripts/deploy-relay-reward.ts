import { ethers, upgrades } from "hardhat";

/**
 * Deploy ClawRelayReward (UUPS proxy).
 *
 * Requires:
 *   TOKEN_ADDRESS – address of the deployed ClawToken proxy
 *
 * Usage:
 *   TOKEN_ADDRESS=0x... npx hardhat run scripts/deploy-relay-reward.ts --network clawnetTestnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying ClawRelayReward with account:", deployer.address);

  const tokenAddress = process.env.TOKEN_ADDRESS;
  if (!tokenAddress) {
    throw new Error("TOKEN_ADDRESS env var is required");
  }

  // Default reward params
  const BASE_RATE = 100;                // 100 Token per period
  const MAX_REWARD_PER_PERIOD = 1000;   // 10× base rate cap
  const MIN_BYTES_THRESHOLD = 1_048_576; // 1 MB minimum
  const MIN_PEERS_THRESHOLD = 1;         // At least 1 confirmed peer
  const ATTACHMENT_WEIGHT_BPS = 3000;    // 0.3× (3000 / 10000)

  const Factory = await ethers.getContractFactory("ClawRelayReward");
  const proxy = await upgrades.deployProxy(
    Factory,
    [
      tokenAddress,
      BASE_RATE,
      MAX_REWARD_PER_PERIOD,
      MIN_BYTES_THRESHOLD,
      MIN_PEERS_THRESHOLD,
      ATTACHMENT_WEIGHT_BPS,
    ],
    { kind: "uups", initializer: "initialize" },
  );
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("ClawRelayReward proxy :", proxyAddress);
  console.log("ClawRelayReward impl  :", implAddress);
  console.log("Token                 :", tokenAddress);
  console.log("Reward params         :",
    `baseRate=${BASE_RATE}, maxPerPeriod=${MAX_REWARD_PER_PERIOD},`,
    `minBytes=${MIN_BYTES_THRESHOLD}, minPeers=${MIN_PEERS_THRESHOLD},`,
    `attachmentWeight=${ATTACHMENT_WEIGHT_BPS}bps`);

  return { proxyAddress, implAddress };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
