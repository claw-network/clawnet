import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import SafeArtifact from '@safe-global/safe-contracts/build/artifacts/contracts/Safe.sol/Safe.json';
import SafeProxyFactoryArtifact from '@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json';

interface SafeCoreDeploymentRecord {
  safeSingleton: string;
  safeProxyFactory: string;
}

interface SafeWalletRecord {
  label: string;
  threshold: number;
  owners: string[];
  nonce: string;
  address: string;
  txHash: string;
  createdAt: string;
}

interface SafeWalletManifest {
  network: string;
  chainId: number;
  safeSingleton: string;
  safeProxyFactory: string;
  safes: SafeWalletRecord[];
}

function normalizeAddress(value: string, name: string): string {
  try {
    return ethers.getAddress(value);
  } catch {
    throw new Error(`${name} must be a valid address: ${value}`);
  }
}

function requireEnv(name: string): string {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    throw new Error(`${name} is required`);
  }
  return raw.trim();
}

function parseOwnersCsv(value: string): string[] {
  const owners = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => normalizeAddress(s, 'SAFE_OWNERS'));
  const unique = [...new Set(owners.map((s) => s.toLowerCase()))].map((lower) =>
    owners.find((o) => o.toLowerCase() === lower)!,
  );
  if (unique.length < 3) {
    throw new Error(`SAFE_OWNERS must contain at least 3 unique owners (got ${unique.length})`);
  }
  return unique;
}

function parseThreshold(raw: string, ownersCount: number): number {
  const threshold = Number.parseInt(raw, 10);
  if (!Number.isInteger(threshold) || threshold < 2) {
    throw new Error(`SAFE_THRESHOLD must be an integer >= 2 (got ${raw})`);
  }
  if (threshold > ownersCount) {
    throw new Error(`SAFE_THRESHOLD (${threshold}) cannot exceed owners count (${ownersCount})`);
  }
  return threshold;
}

function loadSafeCoreFromFile(filePath: string): SafeCoreDeploymentRecord {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Safe core deployment file not found: ${filePath}`);
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SafeCoreDeploymentRecord;
  return {
    safeSingleton: normalizeAddress(parsed.safeSingleton, 'safeSingleton'),
    safeProxyFactory: normalizeAddress(parsed.safeProxyFactory, 'safeProxyFactory'),
  };
}

function readManifest(filePath: string, network: string, chainId: number): SafeWalletManifest {
  if (!fs.existsSync(filePath)) {
    return {
      network,
      chainId,
      safeSingleton: '',
      safeProxyFactory: '',
      safes: [],
    };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SafeWalletManifest;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === 'unknown' ? `chain-${network.chainId}` : network.name;

  const owners = parseOwnersCsv(requireEnv('SAFE_OWNERS'));
  const threshold = parseThreshold(requireEnv('SAFE_THRESHOLD'), owners.length);
  const label = process.env.SAFE_LABEL?.trim() || 'SAFE_WALLET';
  const nonce = BigInt(process.env.SAFE_NONCE ?? Date.now());

  const coreFile =
    process.env.SAFE_DEPLOYMENT_FILE ??
    path.resolve(__dirname, '..', 'deployments', `safe-core-${networkName}.json`);
  const walletsFile =
    process.env.SAFE_WALLETS_FILE ??
    path.resolve(__dirname, '..', 'deployments', `safe-wallets-${networkName}.json`);

  const coreFromFile = loadSafeCoreFromFile(coreFile);
  const safeSingleton = normalizeAddress(
    process.env.SAFE_SINGLETON_ADDRESS ?? coreFromFile.safeSingleton,
    'SAFE_SINGLETON_ADDRESS',
  );
  const safeProxyFactory = normalizeAddress(
    process.env.SAFE_PROXY_FACTORY_ADDRESS ?? coreFromFile.safeProxyFactory,
    'SAFE_PROXY_FACTORY_ADDRESS',
  );

  const singletonCode = await ethers.provider.getCode(safeSingleton);
  if (singletonCode === '0x') {
    throw new Error(`SAFE_SINGLETON_ADDRESS has no contract code: ${safeSingleton}`);
  }
  const factoryCode = await ethers.provider.getCode(safeProxyFactory);
  if (factoryCode === '0x') {
    throw new Error(`SAFE_PROXY_FACTORY_ADDRESS has no contract code: ${safeProxyFactory}`);
  }

  const safeSingletonContract = new ethers.Contract(safeSingleton, SafeArtifact.abi, deployer);
  const safeFactoryContract = new ethers.Contract(safeProxyFactory, SafeProxyFactoryArtifact.abi, deployer);

  const initializer = safeSingletonContract.interface.encodeFunctionData('setup', [
    owners,
    threshold,
    ethers.ZeroAddress,
    '0x',
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    0,
    ethers.ZeroAddress,
  ]);

  console.log('='.repeat(60));
  console.log('Safe Wallet Creation');
  console.log('='.repeat(60));
  console.log(`Network        : ${networkName} (chainId ${network.chainId})`);
  console.log(`Label          : ${label}`);
  console.log(`Owners         : ${owners.join(',')}`);
  console.log(`Threshold      : ${threshold}`);
  console.log(`Nonce          : ${nonce}`);
  console.log(`Safe Singleton : ${safeSingleton}`);
  console.log(`Proxy Factory  : ${safeProxyFactory}`);
  console.log('Predicted Safe : (resolve from ProxyCreation event)');
  console.log('-'.repeat(60));

  const tx = await safeFactoryContract.createProxyWithNonce(safeSingleton, initializer, nonce);
  const receipt = await tx.wait();

  const proxyEventFragment = safeFactoryContract.interface.getEvent('ProxyCreation');
  if (!proxyEventFragment) {
    throw new Error('ProxyCreation event ABI missing from SafeProxyFactory artifact');
  }
  const proxyTopic = proxyEventFragment.topicHash;

  const proxyLog = receipt.logs.find(
    (log: { topics: ReadonlyArray<string>; address: string }) =>
      log.address.toLowerCase() === safeProxyFactory.toLowerCase() && log.topics[0] === proxyTopic,
  );

  if (!proxyLog || proxyLog.topics.length < 2) {
    throw new Error('ProxyCreation event not found in transaction receipt logs');
  }

  const createdSafeRaw = `0x${proxyLog.topics[1].slice(26)}`;
  const createdSafe = normalizeAddress(createdSafeRaw, 'createdSafe');

  const code = await ethers.provider.getCode(createdSafe);
  if (code === '0x') {
    throw new Error(`Safe proxy creation failed: no code at ${createdSafe}`);
  }

  const manifest = readManifest(walletsFile, networkName, Number(network.chainId));
  manifest.network = networkName;
  manifest.chainId = Number(network.chainId);
  manifest.safeSingleton = safeSingleton;
  manifest.safeProxyFactory = safeProxyFactory;
  manifest.safes.push({
    label,
    threshold,
    owners,
    nonce: nonce.toString(),
    address: createdSafe,
    txHash: receipt.hash,
    createdAt: new Date().toISOString(),
  });

  fs.mkdirSync(path.dirname(walletsFile), { recursive: true });
  fs.writeFileSync(walletsFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  console.log(`Created Safe address: ${createdSafe}`);
  console.log(`Tx hash: ${receipt.hash}`);
  console.log(`Manifest updated: ${walletsFile}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
