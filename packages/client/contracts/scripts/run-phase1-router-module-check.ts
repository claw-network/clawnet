import fs from 'node:fs/promises';
import path from 'node:path';

import { ethers, network } from 'hardhat';

interface RouterModuleCheckReport {
  taskId: 'TA-P1-010';
  generatedAt: string;
  network: string;
  routerAddress: string;
  groupRegistryAddress: string;
  moduleKey: string;
  firstRun: {
    previousModule: string;
    registeredModule: string;
    alreadyRegistered: boolean;
    txHash: string | null;
  };
  secondRun: {
    previousModule: string;
    registeredModule: string;
    alreadyRegistered: boolean;
    txHash: string | null;
  };
  decision: 'PASS' | 'FAIL';
}

const ROUTER_ABI = [
  'function registerModule(bytes32 key, address addr) external',
  'function getModuleOrZero(bytes32 key) view returns (address)',
];

async function registerModule(
  routerAddress: string,
  groupRegistryAddress: string,
) {
  const [signer] = await ethers.getSigners();
  const router = new ethers.Contract(routerAddress, ROUTER_ABI, signer);
  const moduleKey = ethers.keccak256(ethers.toUtf8Bytes('TELAGENT_GROUP'));
  const target = ethers.getAddress(groupRegistryAddress);
  const previousModule = await router.getModuleOrZero(moduleKey) as string;
  const normalizedPreviousModule = previousModule === ethers.ZeroAddress
    ? previousModule
    : ethers.getAddress(previousModule);
  let txHash: string | null = null;
  let alreadyRegistered = false;

  if (normalizedPreviousModule.toLowerCase() === target.toLowerCase()) {
    alreadyRegistered = true;
  } else {
    const tx = await router.registerModule(moduleKey, target);
    const receipt = await tx.wait();
    txHash = receipt?.hash ?? tx.hash;
  }

  const registeredModule = await router.getModuleOrZero(moduleKey) as string;
  const normalizedRegisteredModule = registeredModule === ethers.ZeroAddress
    ? registeredModule
    : ethers.getAddress(registeredModule);

  if (normalizedRegisteredModule.toLowerCase() !== target.toLowerCase()) {
    throw new Error(
      `router registration mismatch: expected ${target} got ${normalizedRegisteredModule}`,
    );
  }

  return {
    moduleKey,
    previousModule: normalizedPreviousModule,
    registeredModule: normalizedRegisteredModule,
    alreadyRegistered,
    txHash,
  };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const outputPath = process.env.P1_ROUTER_MODULE_CHECK_OUTPUT_PATH
    ?? path.resolve(repoRoot, 'docs/implementation/phase-1/manifests/2026-03-03-p1-router-module-check.json');

  const [deployer] = await ethers.getSigners();
  const routerFactory = await ethers.getContractFactory('MockClawRouter');
  const router = await routerFactory.connect(deployer).deploy();
  await router.waitForDeployment();

  const routerAddress = await router.getAddress();
  const groupRegistryAddress = ethers.getAddress(
    process.env.TELAGENT_GROUP_REGISTRY_ADDRESS ?? deployer.address,
  );

  const firstRun = await registerModule(routerAddress, groupRegistryAddress);
  const secondRun = await registerModule(routerAddress, groupRegistryAddress);

  const decision: 'PASS' | 'FAIL' = firstRun.registeredModule.toLowerCase() === groupRegistryAddress.toLowerCase()
    && secondRun.registeredModule.toLowerCase() === groupRegistryAddress.toLowerCase()
    && !firstRun.alreadyRegistered
    && secondRun.alreadyRegistered
    ? 'PASS'
    : 'FAIL';

  const report: RouterModuleCheckReport = {
    taskId: 'TA-P1-010',
    generatedAt: new Date().toISOString(),
    network: network.name,
    routerAddress,
    groupRegistryAddress,
    moduleKey: firstRun.moduleKey,
    firstRun: {
      previousModule: firstRun.previousModule,
      registeredModule: firstRun.registeredModule,
      alreadyRegistered: firstRun.alreadyRegistered,
      txHash: firstRun.txHash,
    },
    secondRun: {
      previousModule: secondRun.previousModule,
      registeredModule: secondRun.registeredModule,
      alreadyRegistered: secondRun.alreadyRegistered,
      txHash: secondRun.txHash,
    },
    decision,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[TA-P1-010] routerAddress=${routerAddress}`);
  console.log(`[TA-P1-010] groupRegistryAddress=${groupRegistryAddress}`);
  console.log(`[TA-P1-010] firstRunAlreadyRegistered=${firstRun.alreadyRegistered}`);
  console.log(`[TA-P1-010] secondRunAlreadyRegistered=${secondRun.alreadyRegistered}`);
  console.log(`[TA-P1-010] decision=${decision}`);
  console.log(`[TA-P1-010] output=${outputPath}`);

  if (decision !== 'PASS') {
    throw new Error('Phase 1 router module check failed');
  }
}

main().catch((error) => {
  console.error('[TA-P1-010] execution failed');
  console.error(error);
  process.exitCode = 1;
});
