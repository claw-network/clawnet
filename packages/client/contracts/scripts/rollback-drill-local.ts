import fs from 'node:fs/promises';
import path from 'node:path';

import { ethers, upgrades } from 'hardhat';

async function main() {
  const identityAddress = process.env.CLAW_IDENTITY_ADDRESS;
  const drillRecordPath = process.env.ROLLBACK_DRILL_RECORD_PATH;

  if (!identityAddress) {
    throw new Error('CLAW_IDENTITY_ADDRESS is required');
  }

  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContractFactory('TelagentGroupRegistry');

  const proxy = await upgrades.deployProxy(factory, [deployer.address, identityAddress], {
    kind: 'uups',
  });
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implBeforeUpgrade = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  const implAfterUpgrade = await upgrades.deployImplementation(factory, {
    kind: 'uups',
    redeployImplementation: 'always',
  });

  const upgradeTx = await proxy.upgradeToAndCall(implAfterUpgrade, '0x');
  await upgradeTx.wait();
  const implementationAfterUpgrade = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  const rollbackTx = await proxy.upgradeToAndCall(implBeforeUpgrade, '0x');
  await rollbackTx.wait();
  const implementationAfterRollback = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  const rollbackSucceeded =
    implementationAfterRollback.toLowerCase() === implBeforeUpgrade.toLowerCase();

  const record = {
    contract: 'TelagentGroupRegistry',
    networkName: process.env.HARDHAT_NETWORK || 'hardhat',
    deployer: deployer.address,
    identityAddress,
    proxyAddress,
    implBeforeUpgrade,
    implAfterUpgrade,
    upgradeTxHash: upgradeTx.hash,
    implementationAfterUpgrade,
    rollbackTxHash: rollbackTx.hash,
    implementationAfterRollback,
    rollbackSucceeded,
    executedAt: new Date().toISOString(),
  };

  console.log('Proxy:', proxyAddress);
  console.log('Implementation before upgrade:', implBeforeUpgrade);
  console.log('Implementation after upgrade:', implementationAfterUpgrade);
  console.log('Implementation after rollback:', implementationAfterRollback);
  console.log('Rollback success:', rollbackSucceeded);

  if (drillRecordPath) {
    await fs.mkdir(path.dirname(drillRecordPath), { recursive: true });
    await fs.writeFile(drillRecordPath, JSON.stringify(record, null, 2));
    console.log('Rollback drill record written:', drillRecordPath);
  }

  if (!rollbackSucceeded) {
    throw new Error('Rollback drill failed');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
