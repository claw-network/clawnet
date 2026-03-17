import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import SafeArtifact from '@safe-global/safe-contracts/build/artifacts/contracts/Safe.sol/Safe.json';
import SafeProxyFactoryArtifact from '@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json';

interface ContractArtifact {
  abi: unknown;
  bytecode: string;
}

interface SafeCoreDeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  safeSingleton: string;
  safeProxyFactory: string;
}

function normalizeAddress(value: string, name: string): string {
  try {
    return ethers.getAddress(value);
  } catch {
    throw new Error(`${name} must be a valid address: ${value}`);
  }
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function deployFromArtifact(
  label: string,
  artifact: ContractArtifact,
  signer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
): Promise<string> {
  const factory = new ethers.ContractFactory(artifact.abi as never, artifact.bytecode, signer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  ${label}: ${address}`);
  return address;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === 'unknown' ? `chain-${network.chainId}` : network.name;

  const outputFile =
    process.env.SAFE_DEPLOYMENT_FILE ??
    path.resolve(__dirname, '..', 'deployments', `safe-core-${networkName}.json`);

  console.log('='.repeat(60));
  console.log('Safe Core Deployment');
  console.log('='.repeat(60));
  console.log(`Network  : ${networkName} (chainId ${network.chainId})`);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Output   : ${outputFile}`);
  console.log('-'.repeat(60));

  const singletonFromEnv = process.env.SAFE_SINGLETON_ADDRESS;
  const factoryFromEnv = process.env.SAFE_PROXY_FACTORY_ADDRESS;

  const safeSingletonArtifact = SafeArtifact as ContractArtifact;
  const safeProxyFactoryArtifact = SafeProxyFactoryArtifact as ContractArtifact;

  const safeSingleton = singletonFromEnv
    ? normalizeAddress(singletonFromEnv, 'SAFE_SINGLETON_ADDRESS')
    : await deployFromArtifact('Safe Singleton', safeSingletonArtifact, deployer);

  const safeProxyFactory = factoryFromEnv
    ? normalizeAddress(factoryFromEnv, 'SAFE_PROXY_FACTORY_ADDRESS')
    : await deployFromArtifact('Safe ProxyFactory', safeProxyFactoryArtifact, deployer);

  const record: SafeCoreDeploymentRecord = {
    network: networkName,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    safeSingleton,
    safeProxyFactory,
  };

  ensureDir(outputFile);
  fs.writeFileSync(outputFile, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');

  console.log('-'.repeat(60));
  console.log('Safe core ready.');
  console.log(`SAFE_SINGLETON_ADDRESS=${safeSingleton}`);
  console.log(`SAFE_PROXY_FACTORY_ADDRESS=${safeProxyFactory}`);
  console.log(`Deployment record written: ${outputFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
