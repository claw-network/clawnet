import fs from 'node:fs/promises';
import path from 'node:path';

import { ethers, upgrades } from 'hardhat';

const UPGRADE_ABI = ['function upgradeToAndCall(address newImplementation, bytes data) external'];

async function main() {
  const proxyAddress = process.env.TELAGENT_GROUP_REGISTRY_PROXY_ADDRESS;
  const targetImplementation = process.env.TARGET_IMPLEMENTATION_ADDRESS;
  const rollbackRecordPath = process.env.ROLLBACK_RECORD_PATH;

  if (!proxyAddress || !targetImplementation) {
    throw new Error(
      'TELAGENT_GROUP_REGISTRY_PROXY_ADDRESS and TARGET_IMPLEMENTATION_ADDRESS are required',
    );
  }

  const [signer] = await ethers.getSigners();
  const currentImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  const proxyAsUups = new ethers.Contract(proxyAddress, UPGRADE_ABI, signer);
  const tx = await proxyAsUups.upgradeToAndCall(targetImplementation, '0x');
  const receipt = await tx.wait();

  const implementationAfterRollback = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const succeeded =
    implementationAfterRollback.toLowerCase() === targetImplementation.toLowerCase();

  const record = {
    contract: 'TelagentGroupRegistry',
    networkName: process.env.HARDHAT_NETWORK || 'hardhat',
    operator: signer.address,
    proxyAddress,
    implementationBeforeRollback: currentImplementation,
    targetImplementation,
    implementationAfterRollback,
    rollbackTxHash: receipt?.hash ?? tx.hash,
    succeeded,
    executedAt: new Date().toISOString(),
  };

  console.log('Rollback tx hash:', record.rollbackTxHash);
  console.log('Implementation before rollback:', currentImplementation);
  console.log('Implementation after rollback:', implementationAfterRollback);
  console.log('Rollback success:', succeeded);

  if (rollbackRecordPath) {
    await fs.mkdir(path.dirname(rollbackRecordPath), { recursive: true });
    await fs.writeFile(rollbackRecordPath, JSON.stringify(record, null, 2));
    console.log('Rollback record written:', rollbackRecordPath);
  }

  if (!succeeded) {
    throw new Error('Rollback verification failed: implementation does not match target');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
