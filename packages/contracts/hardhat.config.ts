import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-gas-reporter";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

const DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // hardhat default #0

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    clawnetDevnet: {
      url: process.env.CLAWNET_DEVNET_RPC_URL || "http://127.0.0.1:8545",
      chainId: Number(process.env.CLAWNET_DEVNET_CHAIN_ID || 7625),
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    clawnetTestnet: {
      url: process.env.CLAWNET_RPC_URL || "https://rpc.clawnetd.com",
      chainId: 7625,
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
    clawnetMainnet: {
      url: process.env.CLAWNET_MAINNET_RPC_URL || "https://rpc.clawnet.io",
      chainId: Number(process.env.CLAWNET_MAINNET_CHAIN_ID || 7626),
      accounts: [DEPLOYER_PRIVATE_KEY],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    outputFile: "gas-report.txt",
    noColors: true,
    currency: "USD",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
