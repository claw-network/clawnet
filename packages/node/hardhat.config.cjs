const { existsSync } = require('node:fs');
const { homedir } = require('node:os');
const { resolve } = require('node:path');

require('ts-node/register/transpile-only');
require('@nomicfoundation/hardhat-toolbox');
require('@openzeppelin/hardhat-upgrades');
require('hardhat-gas-reporter');
require('solidity-coverage');

function resolveClawnetEnvFile() {
  const clawnetHome = process.env.CLAWNET_HOME || resolve(homedir(), '.clawnet');
  return resolve(clawnetHome, '.env');
}

const clawnetEnvFile = resolveClawnetEnvFile();
if (existsSync(clawnetEnvFile)) {
  require('dotenv').config({ path: clawnetEnvFile });
}

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const hardhatCommand = process.argv[2];
const isLocalOnlyCommand =
  hardhatCommand === 'clean' ||
  hardhatCommand === 'compile' ||
  hardhatCommand === 'node' ||
  hardhatCommand === 'test' ||
  hardhatCommand === 'coverage';

if (!DEPLOYER_PRIVATE_KEY && !isLocalOnlyCommand) {
  throw new Error(
    'DEPLOYER_PRIVATE_KEY environment variable is not set. ' +
      'Cannot deploy contracts without a valid private key.',
  );
}

/** @type {import('hardhat/config').HardhatUserConfig} */
const config = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: 'london',
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    clawnetDevnet: {
      url: process.env.CLAWNET_DEVNET_RPC_URL || 'http://127.0.0.1:8545',
      chainId: Number(process.env.CLAWNET_DEVNET_CHAIN_ID || 1337),
      ...(DEPLOYER_PRIVATE_KEY ? { accounts: [DEPLOYER_PRIVATE_KEY] } : {}),
    },
    clawnetTestnet: {
      url: process.env.CLAWNET_RPC_URL || 'https://rpc.clawnetd.com',
      chainId: 7625,
      ...(DEPLOYER_PRIVATE_KEY ? { accounts: [DEPLOYER_PRIVATE_KEY] } : {}),
      timeout: 120_000,
    },
    clawnetMainnet: {
      url: process.env.CLAWNET_MAINNET_RPC_URL || 'https://rpc.clawnet.io',
      chainId: Number(process.env.CLAWNET_MAINNET_CHAIN_ID || 7626),
      ...(DEPLOYER_PRIVATE_KEY ? { accounts: [DEPLOYER_PRIVATE_KEY] } : {}),
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    outputFile: 'gas-report.txt',
    noColors: true,
    currency: 'USD',
  },
  paths: {
    sources: './contracts',
    tests: './test/contracts',
    cache: './cache',
    artifacts: './artifacts',
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
};

module.exports = config;
