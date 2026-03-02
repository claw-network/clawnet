#!/usr/bin/env bash
# ==============================================================================
# ClawNet Testnet — Full Redeployment Script
# ==============================================================================
# This script performs a complete testnet redeployment on all 3 servers:
#   1. Stop existing Geth on all servers
#   2. Wipe chain data
#   3. Upload genesis.json and re-initialize
#   4. Import validator keys
#   5. Start Server A (mining), wait for blocks
#   6. Start Server B & C (sync then mine)
#   7. Deploy contracts
#   8. Run bootstrap mint
#
# Prerequisites:
#   - sshpass installed (brew install hudochenkov/sshpass/sshpass)
#   - secrets.env and genesis.json in same directory as this script
#
# Usage:
#   cd infra/testnet/prod
#   bash deploy.sh
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SECRETS_FILE="$SCRIPT_DIR/secrets.env"
GENESIS_FILE="$SCRIPT_DIR/genesis.json"

# Load secrets
if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "ERROR: $SECRETS_FILE not found. Run gen-testnet-keys.mjs first."
  exit 1
fi
source "$SECRETS_FILE"

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "ERROR: required variable '$name' is missing in $SECRETS_FILE"
    exit 1
  fi
}

require_address() {
  local name="$1"
  local value="${!name:-}"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "ERROR: '$name' must be a valid 0x-prefixed EVM address: $value"
    exit 1
  fi
}

require_env TREASURY_ADDRESS
require_env LIQUIDITY_ADDRESS
require_env RESERVE_ADDRESS
require_env DEPLOYER_PRIVATE_KEY
require_env VALIDATOR_1_PRIVATE_KEY
require_env VALIDATOR_2_PRIVATE_KEY
require_env VALIDATOR_3_PRIVATE_KEY
require_env VALIDATOR_1_ADDRESS
require_env VALIDATOR_2_ADDRESS
require_env VALIDATOR_3_ADDRESS
require_env DEPLOYER_ADDRESS
require_env VALIDATOR_PASSWORD
require_env CLAW_PASSPHRASE
require_env CLAW_API_KEY

require_address TREASURY_ADDRESS
require_address LIQUIDITY_ADDRESS
require_address RESERVE_ADDRESS
require_address VALIDATOR_1_ADDRESS
require_address VALIDATOR_2_ADDRESS
require_address VALIDATOR_3_ADDRESS
require_address DEPLOYER_ADDRESS

require_private_key() {
  local name="$1"
  local value="${!name:-}"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    echo "ERROR: '$name' must be a valid 0x-prefixed private key"
    exit 1
  fi
}

require_private_key DEPLOYER_PRIVATE_KEY
require_private_key VALIDATOR_1_PRIVATE_KEY
require_private_key VALIDATOR_2_PRIVATE_KEY
require_private_key VALIDATOR_3_PRIVATE_KEY

if [[ "$LIQUIDITY_ADDRESS" == "$TREASURY_ADDRESS" ]]; then
  echo "ERROR: LIQUIDITY_ADDRESS must be distinct from TREASURY_ADDRESS"
  exit 1
fi
if [[ "$RESERVE_ADDRESS" == "$TREASURY_ADDRESS" ]]; then
  echo "ERROR: RESERVE_ADDRESS must be distinct from TREASURY_ADDRESS"
  exit 1
fi
if [[ "$LIQUIDITY_ADDRESS" == "$RESERVE_ADDRESS" ]]; then
  echo "ERROR: LIQUIDITY_ADDRESS must be distinct from RESERVE_ADDRESS"
  exit 1
fi

# Server config
SERVER_A="${SERVER_A:-173.249.46.252}"
SERVER_B="${SERVER_B:-167.86.93.216}"
SERVER_C="${SERVER_C:-167.86.93.223}"
SSH_PASS="${SSH_PASSWORD:-G66tdTcmvBz*k1sf}"
SSH_CMD="sshpass -p '$SSH_PASS' ssh -o StrictHostKeyChecking=no"
SERVER_A_CLAWNET_PEER_ID="${SERVER_A_CLAWNET_PEER_ID:-12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM}"

require_local_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: missing required local command: $cmd"
    exit 1
  fi
}

# Helper: run command on a remote server
run_remote() {
  local host="$1"
  shift
  sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "root@$host" "$@"
}

# Helper: copy file to remote server
scp_to() {
  local file="$1"
  local host="$2"
  local dest="$3"
  sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no "$file" "root@$host:$dest"
}

rpc_block_number() {
  local host="$1"
  run_remote "$host" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(int(json.load(sys.stdin)[\"result\"],16))"'
}

rpc_peer_count() {
  local host="$1"
  run_remote "$host" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"net_peerCount\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(int(json.load(sys.stdin)[\"result\"],16))"'
}

install_peer_clawnetd_service() {
  local host="$1"
  shift  # remaining args are bootstrap multiaddrs

  echo "  [$host] Writing /opt/clawnet/node-data/config.yaml..."
  run_remote "$host" "mkdir -p /opt/clawnet/node-data"

  # Build bootstrap list from all supplied multiaddrs
  local bootstrap_yaml=""
  for addr in "$@"; do
    bootstrap_yaml="${bootstrap_yaml}    - ${addr}\n"
  done

  run_remote "$host" "cat > /opt/clawnet/node-data/config.yaml << CFGEOF
v: 1
network: testnet

p2p:
  listen:
    - /ip4/0.0.0.0/tcp/9527
  bootstrap:
$(echo -e "$bootstrap_yaml")
logging:
  level: info

storage: {}
CFGEOF"

  echo "  [$host] Writing /opt/clawnet/node.env..."
  run_remote "$host" "cat > /opt/clawnet/node.env << ENVEOF
NODE_ENV=production
CLAW_PASSPHRASE=$CLAW_PASSPHRASE
CLAW_API_KEY=$CLAW_API_KEY
ENVEOF
chmod 600 /opt/clawnet/node.env"

  echo "  [$host] Installing clawnetd.service..."
  run_remote "$host" "cat > /etc/systemd/system/clawnetd.service << 'SVCEOF'
[Unit]
Description=ClawNet Node (clawnetd)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clawnet
EnvironmentFile=/opt/clawnet/node.env
ExecStartPre=/usr/bin/test -f /opt/clawnet/node-data/config.yaml
ExecStart=/usr/bin/node /opt/clawnet/packages/node/dist/daemon.js --api-host 0.0.0.0 --api-port 9528 --data-dir /opt/clawnet/node-data
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SVCEOF"

  echo "  [$host] Building node package..."
  run_remote "$host" "cd /opt/clawnet && pnpm install && pnpm --filter @claw-network/node build"

  echo "  [$host] Switching to systemd-managed daemon..."
  run_remote "$host" "systemctl stop clawnetd 2>/dev/null || true
pkill -f '/opt/clawnet/packages/node/dist/daemon.js' 2>/dev/null || true
systemctl daemon-reload
systemctl enable clawnetd
systemctl restart clawnetd"

  run_remote "$host" "sleep 3
systemctl is-active clawnetd >/dev/null
curl -sf http://127.0.0.1:9528/api/v1/node >/dev/null"
  echo "  [$host] clawnetd active."
}

echo ">>> Phase 0: Preflight checks..."
require_local_command sshpass
require_local_command ssh
require_local_command scp
require_local_command python3

if [[ ! -f "$GENESIS_FILE" ]]; then
  echo "ERROR: genesis file not found: $GENESIS_FILE"
  exit 1
fi
if grep -q 'shanghaiTime' "$GENESIS_FILE"; then
  echo "ERROR: genesis.json must not contain shanghaiTime (Clique incompatible)"
  exit 1
fi

if [[ "$(uname)" != "Darwin" ]]; then
  chmod 600 "$SECRETS_FILE" 2>/dev/null || true
fi

for HOST in $SERVER_A $SERVER_B $SERVER_C; do
  echo "  [preflight] SSH check: $HOST"
  run_remote "$HOST" 'echo ok >/dev/null'
  echo "  [preflight] Runtime check on $HOST"
  run_remote "$HOST" 'test -d /opt/clawnet && command -v docker >/dev/null && command -v git >/dev/null && command -v python3 >/dev/null'
done

echo "  [preflight] Local bootstrap script syntax"
bash -n "$0"
echo "  Preflight checks passed."
echo ""

echo "============================================================"
echo "ClawNet Testnet — Full Redeployment"
echo "============================================================"
echo "Timestamp : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Server A  : $SERVER_A (Validator 1 — $VALIDATOR_1_ADDRESS)"
echo "Server B  : $SERVER_B (Validator 2 — $VALIDATOR_2_ADDRESS)"
echo "Server C  : $SERVER_C (Validator 3 — $VALIDATOR_3_ADDRESS)"
echo "Deployer  : $DEPLOYER_ADDRESS"
echo "Treasury  : $TREASURY_ADDRESS"
echo "Liquidity : $LIQUIDITY_ADDRESS"
echo "Reserve   : $RESERVE_ADDRESS"
echo "============================================================"
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 1: Stop all Geth instances
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 1: Stopping Geth on all servers..."
for HOST in $SERVER_A $SERVER_B $SERVER_C; do
  echo "  Stopping Geth on $HOST..."
  run_remote "$HOST" 'cd /opt/clawnet && docker compose -f docker-compose.chain.yml down 2>/dev/null; docker stop clawnet-geth 2>/dev/null; docker rm clawnet-geth 2>/dev/null; echo "done"' || true
done
echo "  All Geth instances stopped."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 2: Wipe chain data and re-initialize on all servers
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 2: Wiping chain data and re-initializing..."

for HOST in $SERVER_A $SERVER_B $SERVER_C; do
  echo "  [$HOST] Wiping chain data..."
  run_remote "$HOST" 'rm -rf /opt/clawnet/chain-data/*'

  echo "  [$HOST] Uploading genesis.json..."
  run_remote "$HOST" 'mkdir -p /opt/clawnet/config'
  scp_to "$GENESIS_FILE" "$HOST" "/opt/clawnet/config/genesis.json"

  echo "  [$HOST] Creating password.txt..."
  run_remote "$HOST" "echo '$VALIDATOR_PASSWORD' > /opt/clawnet/config/password.txt && chmod 600 /opt/clawnet/config/password.txt"

  echo "  [$HOST] Initializing Geth..."
  run_remote "$HOST" 'docker run --rm \
    -v /opt/clawnet/chain-data:/data \
    -v /opt/clawnet/config:/config:ro \
    ethereum/client-go:v1.13.15 \
    init --datadir /data /config/genesis.json'

  echo "  [$HOST] Geth initialized."
  echo ""
done

# ══════════════════════════════════════════════════════════════════
# Phase 3: Import validator keys
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 3: Importing validator keys..."

import_validator_key() {
  local host="$1"
  local privkey="$2"  # with 0x prefix
  local label="$3"

  # Strip 0x prefix for the key file
  local raw_key="${privkey#0x}"

  echo "  [$host] Importing $label key..."
  run_remote "$host" "echo '$raw_key' > /tmp/val.key && \
    docker run --rm \
      -v /opt/clawnet/chain-data:/data \
      -v /opt/clawnet/config:/config:ro \
      -v /tmp/val.key:/tmp/val.key:ro \
      ethereum/client-go:v1.13.15 \
      account import --datadir /data --password /config/password.txt /tmp/val.key && \
    rm -f /tmp/val.key"
  echo "  [$host] $label key imported."
}

import_validator_key "$SERVER_A" "$VALIDATOR_1_PRIVATE_KEY" "Validator 1"
import_validator_key "$SERVER_B" "$VALIDATOR_2_PRIVATE_KEY" "Validator 2"
import_validator_key "$SERVER_C" "$VALIDATOR_3_PRIVATE_KEY" "Validator 3"
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 4: Update code on all servers
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 4: Updating code on all servers..."
for HOST in $SERVER_A $SERVER_B $SERVER_C; do
  echo "  [$HOST] git pull..."
  run_remote "$HOST" 'cd /opt/clawnet && git pull' || true
done
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 5: Create .env on each server
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 5: Creating .env files..."

run_remote "$SERVER_A" "cat > /opt/clawnet/.env << 'ENVEOF'
VALIDATOR_ADDRESS=$VALIDATOR_1_ADDRESS
ENVEOF"

run_remote "$SERVER_B" "cat > /opt/clawnet/.env << 'ENVEOF'
VALIDATOR_ADDRESS=$VALIDATOR_2_ADDRESS
ENVEOF"

run_remote "$SERVER_C" "cat > /opt/clawnet/.env << 'ENVEOF'
VALIDATOR_ADDRESS=$VALIDATOR_3_ADDRESS
ENVEOF"

echo "  .env files created."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 6: Start Server A (mining)
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 6: Starting Geth on Server A (mining mode)..."
run_remote "$SERVER_A" 'cd /opt/clawnet && cp infra/testnet/docker-compose.yml docker-compose.chain.yml && docker compose -f docker-compose.chain.yml up -d'

echo "  Waiting 10s for Server A to start mining..."
sleep 10

# Get block number
BLOCK_NUM=$(run_remote "$SERVER_A" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(int(json.load(sys.stdin)[\"result\"],16))"')
echo "  Server A block number: $BLOCK_NUM"

# Get enode URL
ENODE_RAW=$(run_remote "$SERVER_A" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"admin_nodeInfo\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(json.load(sys.stdin)[\"result\"][\"enode\"])"')
# Replace 127.0.0.1 with Server A's public IP
ENODE_A=$(echo "$ENODE_RAW" | sed "s/127.0.0.1/$SERVER_A/")
echo "  Server A enode: $ENODE_A"
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 7: Start Server B (sync-first-then-mine)
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 7: Starting Geth on Server B (sync → mine)..."

# Create a sync compose with the correct enode
run_remote "$SERVER_B" "cd /opt/clawnet && cp infra/testnet/docker-compose.sync.yml docker-compose.sync.yml && \
  sed -i 's|enode://.*@66.94.125.242:30303|${ENODE_A}|g' docker-compose.sync.yml && \
  sed -i 's|<SERVER_A_ENODE_PUBKEY>@66.94.125.242:30303|${ENODE_A#enode://}|g' docker-compose.sync.yml && \
  docker compose -f docker-compose.sync.yml up -d"

echo "  Waiting 15s for Server B to sync..."
sleep 15

B_BLOCK=$(run_remote "$SERVER_B" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(int(json.load(sys.stdin)[\"result\"],16))"')
echo "  Server B block number: $B_BLOCK"

# Switch to mining mode
echo "  Switching Server B to mining mode..."
run_remote "$SERVER_B" "cd /opt/clawnet && docker compose -f docker-compose.sync.yml down && \
  cp infra/testnet/docker-compose.peer.yml docker-compose.chain.yml && \
  sed -i 's|enode://.*@66.94.125.242:30303|${ENODE_A}|g' docker-compose.chain.yml && \
  sed -i 's|<SERVER_A_ENODE_PUBKEY>@66.94.125.242:30303|${ENODE_A#enode://}|g' docker-compose.chain.yml && \
  docker compose -f docker-compose.chain.yml up -d"

sleep 5
echo "  Server B mining."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 8: Start Server C (sync-first-then-mine)
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 8: Starting Geth on Server C (sync → mine)..."

# Get enode for Server B
ENODE_B_RAW=$(run_remote "$SERVER_B" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"admin_nodeInfo\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(json.load(sys.stdin)[\"result\"][\"enode\"])"')
ENODE_B=$(echo "$ENODE_B_RAW" | sed "s/127.0.0.1/$SERVER_B/")

BOOTNODES_C="${ENODE_A},${ENODE_B}"

run_remote "$SERVER_C" "cd /opt/clawnet && cp infra/testnet/docker-compose.sync.yml docker-compose.sync.yml && \
  sed -i 's|enode://.*@66.94.125.242:30303|${BOOTNODES_C}|g' docker-compose.sync.yml && \
  sed -i 's|<SERVER_A_ENODE_PUBKEY>@66.94.125.242:30303|${BOOTNODES_C#enode://}|g' docker-compose.sync.yml && \
  docker compose -f docker-compose.sync.yml up -d"

echo "  Waiting 15s for Server C to sync..."
sleep 15

C_BLOCK=$(run_remote "$SERVER_C" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(int(json.load(sys.stdin)[\"result\"],16))"')
echo "  Server C block number: $C_BLOCK"

echo "  Switching Server C to mining mode..."
run_remote "$SERVER_C" "cd /opt/clawnet && docker compose -f docker-compose.sync.yml down && \
  cp infra/testnet/docker-compose.peer.yml docker-compose.chain.yml && \
  sed -i 's|enode://.*@66.94.125.242:30303|${BOOTNODES_C}|g' docker-compose.chain.yml && \
  sed -i 's|<SERVER_A_ENODE_PUBKEY>@66.94.125.242:30303|${BOOTNODES_C#enode://}|g' docker-compose.chain.yml && \
  docker compose -f docker-compose.chain.yml up -d"

sleep 5
echo "  Server C mining."

# Get enode for Server C
ENODE_C_RAW=$(run_remote "$SERVER_C" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"admin_nodeInfo\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(json.load(sys.stdin)[\"result\"][\"enode\"])"')
ENODE_C=$(echo "$ENODE_C_RAW" | sed "s/127.0.0.1/$SERVER_C/")
echo "  Server C enode: $ENODE_C"
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 9: Deploy contracts
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 9: Deploying smart contracts..."

# Clear stale OpenZeppelin deployment manifest from previous chain
run_remote "$SERVER_A" "rm -f /opt/clawnet/packages/contracts/.openzeppelin/unknown-7625.json"
echo "  Cleared stale OpenZeppelin manifest."

run_remote "$SERVER_A" "cd /opt/clawnet && \
  pnpm install --filter @claw-network/contracts... && \
  cd packages/contracts && \
  npx hardhat compile && \
  DEPLOYER_PRIVATE_KEY='$DEPLOYER_PRIVATE_KEY' \
  TREASURY_ADDRESS='$TREASURY_ADDRESS' \
  CLAWNET_RPC_URL='http://127.0.0.1:8545' \
  EMERGENCY_SIGNERS='$VALIDATOR_1_ADDRESS,$VALIDATOR_2_ADDRESS,$VALIDATOR_3_ADDRESS,$DEPLOYER_ADDRESS,$TREASURY_ADDRESS,0x717DfB0b62b5695a6B0746Abe950d0Cb3244fDC5,0x52Ee82a9d639C42b55aED9415ffcb03746E34743,0xBcaF5AFdE9A8353AB5c4eBc80ce6226Fa0FdDAa3,0x80e71822B8d68fABD515F3d416C65Cea8aA6e974' \
  npx hardhat run scripts/deploy-all.ts --network clawnetTestnet"

echo "  Contracts deployed."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 10: Bootstrap mint
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 10: Running bootstrap Token mint..."

run_remote "$SERVER_A" "cd /opt/clawnet/packages/contracts && \
  DEPLOYER_PRIVATE_KEY='$DEPLOYER_PRIVATE_KEY' \
  TREASURY_ADDRESS='$TREASURY_ADDRESS' \
  LIQUIDITY_ADDRESS='$LIQUIDITY_ADDRESS' \
  RESERVE_ADDRESS='$RESERVE_ADDRESS' \
  CLAWNET_RPC_URL='http://127.0.0.1:8545' \
  FAUCET_ADDRESS='$DEPLOYER_ADDRESS' \
  NODE_ADDRESSES='$VALIDATOR_1_ADDRESS,$VALIDATOR_2_ADDRESS,$VALIDATOR_3_ADDRESS' \
  BOOTSTRAP_TOTAL_SUPPLY=1000000 \
  npx hardhat run scripts/bootstrap-mint.ts --network clawnetTestnet"

echo "  Bootstrap mint complete."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 11: Save deployment record locally
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 11: Saving deployment record..."

# Copy contracts deployment record from Server A
sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
  "root@$SERVER_A:/opt/clawnet/packages/contracts/deployments/clawnetTestnet.json" \
  "$SCRIPT_DIR/contracts.json"

if [[ ! -s "$SCRIPT_DIR/contracts.json" ]]; then
  echo "ERROR: contracts.json was not copied or is empty"
  exit 1
fi

python3 - "$SCRIPT_DIR/contracts.json" <<'PY'
import json,sys
p = sys.argv[1]
with open(p, "r", encoding="utf-8") as f:
    data = json.load(f)
token = (((data.get("contracts") or {}).get("ClawToken") or {}).get("proxy"))
if not token:
    raise SystemExit("ERROR: contracts.json missing contracts.ClawToken.proxy")
print(f"  contracts.json verified: ClawToken proxy = {token}")
PY

# Save enode URLs
cat > "$SCRIPT_DIR/enodes.env" << EOF
# ClawNet Testnet — Enode URLs (generated $(date -u +%Y-%m-%dT%H:%M:%SZ))
ENODE_A=$ENODE_A
ENODE_B=$ENODE_B
ENODE_C=$ENODE_C
EOF

echo "  Saved: contracts.json, enodes.env"
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 12: Verify cluster
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 12: Verifying cluster health..."

A_BLOCK_FINAL=$(rpc_block_number "$SERVER_A")
A_PEERS_FINAL=$(rpc_peer_count "$SERVER_A")
B_BLOCK_FINAL=$(rpc_block_number "$SERVER_B")
B_PEERS_FINAL=$(rpc_peer_count "$SERVER_B")
C_BLOCK_FINAL=$(rpc_block_number "$SERVER_C")
C_PEERS_FINAL=$(rpc_peer_count "$SERVER_C")

echo "  Server A: block=$A_BLOCK_FINAL peers=$A_PEERS_FINAL"
echo "  Server B: block=$B_BLOCK_FINAL peers=$B_PEERS_FINAL"
echo "  Server C: block=$C_BLOCK_FINAL peers=$C_PEERS_FINAL"

if [[ "$A_BLOCK_FINAL" -le 0 || "$B_BLOCK_FINAL" -le 0 || "$C_BLOCK_FINAL" -le 0 ]]; then
  echo "ERROR: one or more nodes report block number <= 0"
  exit 1
fi
if [[ "$A_PEERS_FINAL" -lt 1 || "$B_PEERS_FINAL" -lt 1 || "$C_PEERS_FINAL" -lt 1 ]]; then
  echo "ERROR: one or more nodes have peerCount < 1"
  exit 1
fi

if [[ ! -s "$SCRIPT_DIR/enodes.env" ]]; then
  echo "ERROR: enodes.env missing after deployment"
  exit 1
fi

echo "  Cluster health checks passed."

# ══════════════════════════════════════════════════════════════════
# Phase 13: Deploy clawnetd on Server B/C via systemd + node.env
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 13: Setting up clawnetd on Server B/C..."

A_NODE_PEER_ID=$(run_remote "$SERVER_A" "curl -sf http://127.0.0.1:9528/api/v1/node | python3 -c 'import json,sys; print((json.load(sys.stdin).get(\"data\") or {}).get(\"peerId\", \"\"))'" 2>/dev/null || true)
if [[ -n "$A_NODE_PEER_ID" ]]; then
  SERVER_A_CLAWNET_PEER_ID="$A_NODE_PEER_ID"
else
  echo "  WARN: Server A clawnetd API not reachable; fallback peerId will be used: $SERVER_A_CLAWNET_PEER_ID"
fi

A_BOOTSTRAP_MULTIADDR="/ip4/$SERVER_A/tcp/9527/p2p/$SERVER_A_CLAWNET_PEER_ID"
echo "  Server A bootstrap addr: $A_BOOTSTRAP_MULTIADDR"

# Install clawnetd on B first (bootstrap: A only, C not yet running)
install_peer_clawnetd_service "$SERVER_B" "$A_BOOTSTRAP_MULTIADDR"

# Wait for B to start and discover its peerId
echo "  Waiting 6s for Server B clawnetd to start..."
sleep 6
SERVER_B_CLAWNET_PEER_ID=$(run_remote "$SERVER_B" "curl -sf http://127.0.0.1:9528/api/v1/node | python3 -c 'import json,sys; print((json.load(sys.stdin).get(\"data\") or {}).get(\"peerId\", \"\"))'" 2>/dev/null || true)
B_BOOTSTRAP_MULTIADDR="/ip4/$SERVER_B/tcp/9527/p2p/$SERVER_B_CLAWNET_PEER_ID"
echo "  Server B bootstrap addr: $B_BOOTSTRAP_MULTIADDR"

# Install clawnetd on C with full-mesh bootstrap (A + B)
install_peer_clawnetd_service "$SERVER_C" "$A_BOOTSTRAP_MULTIADDR" "$B_BOOTSTRAP_MULTIADDR"

# Update B's config to also include C once C is up
echo "  Waiting 6s for Server C clawnetd to start..."
sleep 6
SERVER_C_CLAWNET_PEER_ID=$(run_remote "$SERVER_C" "curl -sf http://127.0.0.1:9528/api/v1/node | python3 -c 'import json,sys; print((json.load(sys.stdin).get(\"data\") or {}).get(\"peerId\", \"\"))'" 2>/dev/null || true)
C_BOOTSTRAP_MULTIADDR="/ip4/$SERVER_C/tcp/9527/p2p/$SERVER_C_CLAWNET_PEER_ID"
echo "  Server C bootstrap addr: $C_BOOTSTRAP_MULTIADDR"

# Re-install B with full-mesh bootstrap (A + C)
install_peer_clawnetd_service "$SERVER_B" "$A_BOOTSTRAP_MULTIADDR" "$C_BOOTSTRAP_MULTIADDR"

echo "  Waiting 8s for mesh convergence..."
sleep 8

B_NODE_PEERS=$(run_remote "$SERVER_B" "curl -sf http://127.0.0.1:9528/api/v1/node | python3 -c 'import json,sys; print(int((json.load(sys.stdin).get(\"data\") or {}).get(\"peers\", 0)))'")
C_NODE_PEERS=$(run_remote "$SERVER_C" "curl -sf http://127.0.0.1:9528/api/v1/node | python3 -c 'import json,sys; print(int((json.load(sys.stdin).get(\"data\") or {}).get(\"peers\", 0)))'")
echo "  Server B/C clawnetd peers: B=$B_NODE_PEERS C=$C_NODE_PEERS"

if [[ "$B_NODE_PEERS" -lt 1 || "$C_NODE_PEERS" -lt 1 ]]; then
  echo "ERROR: clawnetd peer mesh not healthy on B/C (expected peers >= 1)"
  run_remote "$SERVER_B" "systemctl status clawnetd --no-pager -n 80 || true"
  run_remote "$SERVER_C" "systemctl status clawnetd --no-pager -n 80 || true"
  exit 1
fi

echo "  Server B/C clawnetd deployed and managed by systemd."

echo ""
echo "============================================================"
echo "Redeployment complete!"
echo "============================================================"
echo "Files saved in: $SCRIPT_DIR"
echo "  - secrets.env    (private keys, API keys)"
echo "  - genesis.json   (chain genesis block)"
echo "  - contracts.json (deployed contract addresses)"
echo "  - enodes.env     (node enode URLs)"
echo "============================================================"
