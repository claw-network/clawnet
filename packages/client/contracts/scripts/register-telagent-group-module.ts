import fs from 'node:fs/promises';
import path from 'node:path';

import { ethers, network } from 'hardhat';

const ROUTER_ABI = [
  'function registerModule(bytes32 key, address addr) external',
  'function getModuleOrZero(bytes32 key) view returns (address)',
];

export interface RegisterTelagentGroupModuleInput {
  routerAddress: string;
  groupRegistryAddress: string;
}

export interface RegisterTelagentGroupModuleResult {
  moduleKey: string;
  previousModule: string;
  registeredModule: string;
  alreadyRegistered: boolean;
  txHash: string | null;
}

export async function registerTelagentGroupModule(
  input: RegisterTelagentGroupModuleInput,
): Promise<RegisterTelagentGroupModuleResult> {
  const [signer] = await ethers.getSigners();
  const router = new ethers.Contract(input.routerAddress, ROUTER_ABI, signer);
  const moduleKey = ethers.keccak256(ethers.toUtf8Bytes('TELAGENT_GROUP'));
  const target = ethers.getAddress(input.groupRegistryAddress);
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
  const routerAddress = process.env.CLAW_ROUTER_ADDRESS;
  const groupRegistryAddress = process.env.TELAGENT_GROUP_REGISTRY_ADDRESS;

  if (!routerAddress || !groupRegistryAddress) {
    throw new Error('CLAW_ROUTER_ADDRESS and TELAGENT_GROUP_REGISTRY_ADDRESS are required');
  }

  const repoRoot = path.resolve(__dirname, '../../..');
  const outputPath = process.env.TELAGENT_ROUTER_REGISTER_OUTPUT_PATH
    ?? path.resolve(repoRoot, 'docs/implementation/phase-1/manifests/2026-03-03-p1-router-module-register.json');

  const result = await registerTelagentGroupModule({
    routerAddress,
    groupRegistryAddress,
  });

  const report = {
    taskId: 'TA-P1-010',
    generatedAt: new Date().toISOString(),
    network: network.name,
    routerAddress: ethers.getAddress(routerAddress),
    groupRegistryAddress: ethers.getAddress(groupRegistryAddress),
    ...result,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[TA-P1-010] moduleKey=${result.moduleKey}`);
  console.log(`[TA-P1-010] previousModule=${result.previousModule}`);
  console.log(`[TA-P1-010] registeredModule=${result.registeredModule}`);
  console.log(`[TA-P1-010] alreadyRegistered=${result.alreadyRegistered}`);
  if (result.txHash) {
    console.log(`[TA-P1-010] txHash=${result.txHash}`);
  }
  console.log(`[TA-P1-010] output=${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[TA-P1-010] execution failed');
    console.error(error);
    process.exitCode = 1;
  });
}
