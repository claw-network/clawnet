import fs from 'node:fs/promises';
import path from 'node:path';

import { ethers, upgrades } from 'hardhat';

async function main() {
  const identityAddress = process.env.CLAW_IDENTITY_ADDRESS;
  const manifestPath = process.env.DEPLOY_MANIFEST_PATH;
  if (!identityAddress) {
    throw new Error('CLAW_IDENTITY_ADDRESS is required');
  }

  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);
  console.log('Identity:', identityAddress);

  const factory = await ethers.getContractFactory('TelagentGroupRegistry');
  const proxy = await upgrades.deployProxy(factory, [deployer.address, identityAddress], {
    kind: 'uups',
  });
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const network = await ethers.provider.getNetwork();
  const deploymentTx = proxy.deploymentTransaction();

  const manifest = {
    contract: 'TelagentGroupRegistry',
    networkName: process.env.HARDHAT_NETWORK || 'hardhat',
    chainId: Number(network.chainId),
    deployer: deployer.address,
    identityAddress,
    proxyAddress,
    implementationAddress,
    deployTxHash: deploymentTx?.hash ?? null,
    generatedAt: new Date().toISOString(),
  };

  console.log('TelagentGroupRegistry proxy:', proxyAddress);
  console.log('TelagentGroupRegistry implementation:', implementationAddress);

  if (manifestPath) {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log('Manifest written:', manifestPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
