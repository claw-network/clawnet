import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@openzeppelin/hardhat-upgrades';

const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const config: HardhatUserConfig = {
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
    clawnetTestnet: {
      url: process.env.CLAWNET_RPC_URL || 'https://rpc.clawnetd.com',
      chainId: 7625,
      accounts: [DEPLOYER_PRIVATE_KEY],
      gasPrice: 7,
      timeout: 120_000,
    },
    clawnetMainnet: {
      url: process.env.CLAWNET_MAINNET_RPC_URL || 'https://rpc.clawnet.io',
      chainId: 7626,
      accounts: [DEPLOYER_PRIVATE_KEY],
      timeout: 120_000,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
};

export default config;
