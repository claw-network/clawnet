import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying ClawToken with account:", deployer.address);

  const Factory = await ethers.getContractFactory("ClawToken");
  const proxy = await upgrades.deployProxy(
    Factory,
    ["ClawNet Token", "TOKEN", deployer.address],
    { kind: "uups", initializer: "initialize" },
  );
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("ClawToken proxy   :", proxyAddress);
  console.log("ClawToken impl    :", implAddress);
  console.log("Admin             :", deployer.address);

  return { proxyAddress, implAddress };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
