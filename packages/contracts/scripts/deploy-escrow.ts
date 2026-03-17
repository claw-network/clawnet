import { ethers, upgrades } from "hardhat";

/**
 * Deploy ClawEscrow (UUPS proxy).
 *
 * Requires:
 *   TOKEN_ADDRESS  – address of the deployed ClawToken proxy
 *   TREASURY_ADDRESS – address that collects escrow fees
 *
 * Usage:
 *   TOKEN_ADDRESS=0x... TREASURY_ADDRESS=0x... npx hardhat run scripts/deploy-escrow.ts --network clawnetTestnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying ClawEscrow with account:", deployer.address);

  const tokenAddress = process.env.TOKEN_ADDRESS;
  const treasuryAddress = process.env.TREASURY_ADDRESS ?? deployer.address;

  if (!tokenAddress) {
    throw new Error("TOKEN_ADDRESS env var is required");
  }

  // Default fee params: baseRate=100 (1%), holdingRate=5 (0.05%/day), minFee=1 Token
  const BASE_RATE = 100;
  const HOLDING_RATE = 5;
  const MIN_FEE = 1;

  const Factory = await ethers.getContractFactory("ClawEscrow");
  const proxy = await upgrades.deployProxy(
    Factory,
    [tokenAddress, treasuryAddress, BASE_RATE, HOLDING_RATE, MIN_FEE],
    { kind: "uups", initializer: "initialize" },
  );
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("ClawEscrow proxy  :", proxyAddress);
  console.log("ClawEscrow impl   :", implAddress);
  console.log("Token             :", tokenAddress);
  console.log("Treasury          :", treasuryAddress);
  console.log("Fee params        :", `baseRate=${BASE_RATE}, holdingRate=${HOLDING_RATE}, minFee=${MIN_FEE}`);

  return { proxyAddress, implAddress };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
