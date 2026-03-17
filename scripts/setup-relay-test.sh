#!/usr/bin/env bash
# ============================================================
# ClawNet Relay Reward Integration Test — Setup
# ============================================================
# Deploys contracts to the Besu dev chain in docker-compose.relay-test.yml,
# generates node chain config, and restarts nodes to pick up chain config.
#
# Prerequisites:
#   1. docker compose -f docker-compose.relay-test.yml up --build -d
#   2. pnpm install && pnpm build  (from repo root)
#
# Usage:
#   ./scripts/setup-relay-test.sh
#   ./scripts/setup-relay-test.sh --skip-deploy   # reuse existing deployment
#
# After setup, run:
#   node scripts/scenario-relay-reward.mjs --verbose
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/packages/contracts"
CONFIG_DIR="$REPO_ROOT/localdev/relay-test-config"

# Besu dev chain config
RPC_URL="http://127.0.0.1:8545"
CHAIN_ID=1337

# Deployer — Hardhat default account #0 (Besu dev mode pre-funded)
DEPLOYER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
DEPLOYER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# Emergency signers — 9 deterministic valid addresses (used only for DAO init)
# Generated via: keccak256("clawnet-test-signer-N") last 20 bytes, EIP-55 checksummed
EMERGENCY_SIGNERS=""
EMERGENCY_SIGNERS="${EMERGENCY_SIGNERS}0x92B31D0F96aAD0962Ebe382Be7fe096FfA36C503,"
EMERGENCY_SIGNERS="${EMERGENCY_SIGNERS}0x77477BB95b636E87452cbE6161F4F5084732C881,"
EMERGENCY_SIGNERS="${EMERGENCY_SIGNERS}0xC141d90fd860e20391F9bF93bEfeC6d1e071bf35,"
EMERGENCY_SIGNERS="${EMERGENCY_SIGNERS}0xFf3ca0cc6E7471769d20e789eF7aFCc496Ec2163,"
EMERGENCY_SIGNERS="${EMERGENCY_SIGNERS}0x9dF84D7E29ad0C50ab73156B5A2cB314c27fda0d,"
EMERGENCY_SIGNERS="${EMERGENCY_SIGNERS}0x5DEF6d4600823b32A1DD002c35dcD45886C76B67,"
EMERGENCY_SIGNERS="${EMERGENCY_SIGNERS}0x4D864E536a079a992447139C08A53Bbaa4F38611,"
EMERGENCY_SIGNERS="${EMERGENCY_SIGNERS}0x49290EAA1Fc6B39f619b231AD75254feB0eFA36d,"
EMERGENCY_SIGNERS="${EMERGENCY_SIGNERS}0xe1e820DA4a02f734f8734Cb1f0d9d5C73983E12c"

SKIP_DEPLOY=false
if [[ "${1:-}" == "--skip-deploy" ]]; then
  SKIP_DEPLOY=true
fi

# ── Pre-flight ───────────────────────────────────────────────
echo "ClawNet Relay Reward Test Setup"
echo "==============================="
echo "  RPC:      $RPC_URL"
echo "  ChainId:  $CHAIN_ID"
echo "  Deployer: $DEPLOYER_ADDRESS"
echo ""

# Check chain is reachable
echo -n "Checking chain connectivity... "
if ! curl -sf -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  | grep -q result; then
  echo "FAIL"
  echo "ERROR: Cannot reach Besu at $RPC_URL"
  echo "       Start with: docker compose -f docker-compose.relay-test.yml up --build -d"
  exit 1
fi
echo "OK"

# ── Deploy contracts ─────────────────────────────────────────
DEPLOYMENT_FILE="$CONTRACTS_DIR/deployments/clawnetDevnet.json"

if [[ "$SKIP_DEPLOY" == "true" ]] && [[ -f "$DEPLOYMENT_FILE" ]]; then
  echo "Skipping deploy — reusing $DEPLOYMENT_FILE"
else
  echo ""
  echo "Deploying all contracts (including ClawRelayReward)..."

  # Clean stale OZ manifest
  rm -f "$CONTRACTS_DIR/.openzeppelin/unknown-${CHAIN_ID}.json"

  # Export env for Hardhat
  export CLAWNET_DEVNET_RPC_URL="$RPC_URL"
  export CLAWNET_DEVNET_CHAIN_ID="$CHAIN_ID"
  export DEPLOYER_PRIVATE_KEY
  export EMERGENCY_SIGNERS

  cd "$CONTRACTS_DIR"
  npx hardhat run scripts/deploy-all.ts --network clawnetDevnet

  echo ""
  echo "✓ Contracts deployed"
fi

# ── Verify deployment record has ClawRelayReward ──────────────
if ! grep -q "ClawRelayReward" "$DEPLOYMENT_FILE"; then
  echo "ERROR: ClawRelayReward not found in $DEPLOYMENT_FILE"
  echo "       Re-run without --skip-deploy"
  exit 1
fi

echo ""
echo "Deployment record: $DEPLOYMENT_FILE"

# ── Run bootstrap-mint (fund reward pool) ─────────────────────
echo ""
echo "Running bootstrap-mint (fund reward pool)..."
export CLAWNET_DEVNET_RPC_URL="$RPC_URL"
export CLAWNET_DEVNET_CHAIN_ID="$CHAIN_ID"
export DEPLOYER_PRIVATE_KEY
export RELAY_REWARD_POOL_AMOUNT="${RELAY_REWARD_POOL_AMOUNT:-100000}"
# Use deterministic addresses for treasury/liquidity/reserve (must all be distinct)
export TREASURY_ADDRESS="$DEPLOYER_ADDRESS"
export LIQUIDITY_ADDRESS="0x92B31D0F96aAD0962Ebe382Be7fe096FfA36C503"
export RESERVE_ADDRESS="0xC141d90fd860e20391F9bF93bEfeC6d1e071bf35"

cd "$CONTRACTS_DIR"
npx hardhat run scripts/bootstrap-mint.ts --network clawnetDevnet || {
  echo "WARNING: bootstrap-mint failed (may be OK if already run)"
}

# ── Generate config.yaml for nodes ───────────────────────────
echo ""
echo "Generating node chain config..."

mkdir -p "$CONFIG_DIR"

# Extract contract addresses from deployment JSON
DEPLOYMENT=$(cat "$DEPLOYMENT_FILE")

extract_proxy() {
  local contract_name="$1"
  echo "$DEPLOYMENT" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
    console.log(d.contracts?.${contract_name}?.proxy || '');
  "
}

TOKEN_ADDR=$(extract_proxy "ClawToken")
ESCROW_ADDR=$(extract_proxy "ClawEscrow")
IDENTITY_ADDR=$(extract_proxy "ClawIdentity")
REPUTATION_ADDR=$(extract_proxy "ClawReputation")
CONTRACTS_ADDR=$(extract_proxy "ClawContracts")
DAO_ADDR=$(extract_proxy "ClawDAO")
STAKING_ADDR=$(extract_proxy "ClawStaking")
PARAM_ADDR=$(extract_proxy "ParamRegistry")
RELAY_REWARD_ADDR=$(extract_proxy "ClawRelayReward")

# Nodes inside Docker see chain as "besu-dev:8545"
DOCKER_RPC_URL="http://besu-dev:8545"

# Write config.yaml — signer uses the deployer key for testing
cat > "$CONFIG_DIR/config.yaml" << EOF
# Auto-generated by setup-relay-test.sh — DO NOT EDIT
chain:
  rpcUrl: "${DOCKER_RPC_URL}"
  chainId: ${CHAIN_ID}
  contracts:
    token: "${TOKEN_ADDR}"
    escrow: "${ESCROW_ADDR}"
    identity: "${IDENTITY_ADDR}"
    reputation: "${REPUTATION_ADDR}"
    contracts: "${CONTRACTS_ADDR}"
    dao: "${DAO_ADDR}"
    staking: "${STAKING_ADDR}"
    paramRegistry: "${PARAM_ADDR}"
    relayReward: "${RELAY_REWARD_ADDR}"
  signer:
    type: env
    envVar: DEPLOYER_PRIVATE_KEY
  artifactsDir: /app/packages/contracts/artifacts
EOF

echo "✓ Config written to $CONFIG_DIR/config.yaml"
echo ""
cat "$CONFIG_DIR/config.yaml"

# ── Restart nodes to pick up chain config ─────────────────────
echo ""
echo "Restarting nodes to load chain config..."
cd "$REPO_ROOT"
docker compose -f docker-compose.relay-test.yml restart bootstrap peer1 peer2

# Wait for health
echo -n "Waiting for nodes..."
for i in {1..30}; do
  sleep 2
  if curl -sf http://localhost:9528/api/v1/node > /dev/null 2>&1; then
    echo " OK"
    break
  fi
  echo -n "."
done

# Quick health check
echo ""
echo "Node health check:"
for port in 9528 9530 9532; do
  STATUS=$(curl -sf "http://localhost:${port}/api/v1/node" 2>/dev/null | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
    console.log(d.data?.synced || d.synced || 'unknown');
  " 2>/dev/null || echo "unreachable")
  echo "  localhost:${port} → $STATUS"
done

echo ""
echo "============================================"
echo "Setup complete! Run the integration test:"
echo "  node scripts/scenario-relay-reward.mjs --verbose"
echo "============================================"
