#!/usr/bin/env bash
# ============================================================
# ClawNet Local Devnet — Deploy all contracts
# ============================================================
# Prerequisites:
#   1. geth devnet running  (./start.sh -d)
#   2. deployer funded      (./fund-deployer.sh)
#   3. pnpm install done    (from repo root)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/packages/contracts"

source "$SCRIPT_DIR/.env"

# Export env vars for Hardhat
export CLAWNET_DEVNET_RPC_URL
export CLAWNET_DEVNET_CHAIN_ID
export DEPLOYER_PRIVATE_KEY
export EMERGENCY_SIGNERS

# ── Pre-flight ───────────────────────────────────────────────
echo "Deploying all contracts to local devnet…"
echo "  RPC:     $CLAWNET_DEVNET_RPC_URL"
echo "  ChainId: $CLAWNET_DEVNET_CHAIN_ID"
echo "  Deployer: $DEPLOYER_ADDRESS"
echo ""

# Check RPC is reachable
if ! curl -s -X POST "$CLAWNET_DEVNET_RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  | grep -q result; then
  echo "ERROR: Cannot reach geth at $CLAWNET_DEVNET_RPC_URL"
  echo "       Run ./start.sh -d first."
  exit 1
fi

# Clean stale OZ manifest for this chainId
rm -f "$CONTRACTS_DIR/.openzeppelin/unknown-${CLAWNET_DEVNET_CHAIN_ID}.json"

# ── Deploy ───────────────────────────────────────────────────
cd "$CONTRACTS_DIR"
npx hardhat run scripts/deploy-all.ts --network clawnetDevnet

echo ""
echo "✓ All contracts deployed to local devnet."
echo "  Deployment manifest: $CONTRACTS_DIR/deployments/"
