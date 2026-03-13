#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const env = { ...process.env };
const network =
  env.CLAWNET_BESU_TEST_NETWORK || env.CLAWNET_ED25519_NETWORK || "clawnetDevnet";

if (network === "clawnetDevnet") {
  if (env.CLAWNET_BESU_RPC_URL && !env.CLAWNET_DEVNET_RPC_URL) {
    env.CLAWNET_DEVNET_RPC_URL = env.CLAWNET_BESU_RPC_URL;
  }
  if (env.CLAWNET_BESU_CHAIN_ID && !env.CLAWNET_DEVNET_CHAIN_ID) {
    env.CLAWNET_DEVNET_CHAIN_ID = env.CLAWNET_BESU_CHAIN_ID;
  }
}

if (network === "clawnetTestnet") {
  if (env.CLAWNET_BESU_RPC_URL && !env.CLAWNET_RPC_URL) {
    env.CLAWNET_RPC_URL = env.CLAWNET_BESU_RPC_URL;
  }
}

if (network === "clawnetMainnet") {
  if (env.CLAWNET_BESU_RPC_URL && !env.CLAWNET_MAINNET_RPC_URL) {
    env.CLAWNET_MAINNET_RPC_URL = env.CLAWNET_BESU_RPC_URL;
  }
}

execFileSync(
  "pnpm",
  [
    "--filter",
    "@claw-network/contracts",
    "exec",
    "hardhat",
    "run",
    "scripts/test-ed25519-precompile.ts",
    "--network",
    network,
  ],
  {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  }
);