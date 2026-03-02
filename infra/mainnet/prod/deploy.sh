#!/usr/bin/env bash
# ==============================================================================
# ClawNet Mainnet — Full Deployment Script
# ==============================================================================
# This script performs a complete mainnet deployment on all 5 servers:
#   1. Stop existing Geth on all servers
#   2. Wipe chain data
#   3. Upload genesis.json and re-initialize
#   4. Import validator keys
#   5. Create .env files + security hardening
#   6. Start Node 1 (mining), wait for blocks
#   7. Start Node 2-5 (sync then mine)
#   8. Deploy contracts
#   9. Run bootstrap mint
#
# Prerequisites:
#   - SSH key auth (recommended), default key: ~/.ssh/id_ed25519_clawnet
#   - If key auth is unavailable, set SSH_PASSWORD and install sshpass
#   - secrets.env and genesis.json in same directory as this script
#
# Usage:
#   cd infra/mainnet/prod
#   bash deploy.sh
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SECRETS_FILE="$SCRIPT_DIR/secrets.env"
GENESIS_FILE="$SCRIPT_DIR/genesis.json"

# Load secrets
if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "ERROR: $SECRETS_FILE not found."
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

require_private_key() {
  local name="$1"
  local value="${!name:-}"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    echo "ERROR: '$name' must be a valid 0x-prefixed private key"
    exit 1
  fi
}

# ── Validate required env vars ───────────────────────────────────────────────
require_env TREASURY_ADDRESS
require_env LIQUIDITY_ADDRESS
require_env RESERVE_ADDRESS
require_env DEPLOYER_PRIVATE_KEY
require_env DEPLOYER_ADDRESS
require_env VALIDATOR_PASSWORD
require_env CLAW_PASSPHRASE
require_env CLAW_API_KEY

for i in 1 2 3 4 5; do
  require_env "VALIDATOR_${i}_PRIVATE_KEY"
  require_env "VALIDATOR_${i}_ADDRESS"
  require_address "VALIDATOR_${i}_ADDRESS"
  require_private_key "VALIDATOR_${i}_PRIVATE_KEY"
done

require_address TREASURY_ADDRESS
require_address LIQUIDITY_ADDRESS
require_address RESERVE_ADDRESS
require_address DEPLOYER_ADDRESS
require_private_key DEPLOYER_PRIVATE_KEY

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

# ── Server config (fill in real IPs before first run) ────────────────────────
SERVER_1="${SERVER_1:?ERROR: SERVER_1 IP not set in secrets.env}"
SERVER_2="${SERVER_2:?ERROR: SERVER_2 IP not set in secrets.env}"
SERVER_3="${SERVER_3:?ERROR: SERVER_3 IP not set in secrets.env}"
SERVER_4="${SERVER_4:?ERROR: SERVER_4 IP not set in secrets.env}"
SERVER_5="${SERVER_5:?ERROR: SERVER_5 IP not set in secrets.env}"

ALL_SERVERS="$SERVER_1 $SERVER_2 $SERVER_3 $SERVER_4 $SERVER_5"

SSH_USER="${SSH_USER:-root}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/id_ed25519_clawnet}"
SSH_PASS="${SSH_PASSWORD:-}"
if [[ -f "$SSH_KEY_PATH" ]]; then
  USE_SSH_KEY=true
else
  USE_SSH_KEY=false
  if [[ -z "$SSH_PASS" ]]; then
    echo "ERROR: neither SSH key nor SSH_PASSWORD is available."
    echo "       Checked key path: $SSH_KEY_PATH"
    echo "       Provide SSH_PASSWORD in secrets.env or set SSH_KEY_PATH to an existing private key."
    exit 1
  fi
fi

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
  if [[ "$USE_SSH_KEY" == "true" ]]; then
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "${SSH_USER}@$host" "$@"
  else
    sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "${SSH_USER}@$host" "$@"
  fi
}

# Helper: copy file to remote server
scp_to() {
  local file="$1"
  local host="$2"
  local dest="$3"
  if [[ "$USE_SSH_KEY" == "true" ]]; then
    scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "$file" "${SSH_USER}@$host:$dest"
  else
    sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no "$file" "${SSH_USER}@$host:$dest"
  fi
}

scp_from() {
  local host="$1"
  local src="$2"
  local dest="$3"
  if [[ "$USE_SSH_KEY" == "true" ]]; then
    scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "${SSH_USER}@$host:$src" "$dest"
  else
    sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no "${SSH_USER}@$host:$src" "$dest"
  fi
}

rpc_block_number() {
  local host="$1"
  run_remote "$host" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(int(json.load(sys.stdin)[\"result\"],16))"'
}

rpc_peer_count() {
  local host="$1"
  run_remote "$host" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"net_peerCount\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(int(json.load(sys.stdin)[\"result\"],16))"'
}

rpc_enode() {
  local host="$1"
  local raw
  raw=$(run_remote "$host" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"admin_nodeInfo\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(json.load(sys.stdin)[\"result\"][\"enode\"])"')
  echo "$raw" | sed "s/127.0.0.1/$host/"
}

# Deploy docs site (Next.js + Fumadocs) as a systemd service on the primary server
install_docs_service() {
  local host="$1"
  local docs_domain="$2"

  echo "  [$host] Building docs site..."
  run_remote "$host" "cd /opt/clawnet && pnpm --filter docs build"

  echo "  [$host] Installing clawnet-docs.service..."
  run_remote "$host" "cat > /etc/systemd/system/clawnet-docs.service << 'SVCEOF'
[Unit]
Description=ClawNet Documentation Site (Next.js)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clawnet/packages/docs
ExecStart=/usr/bin/npx next start -p 3001
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable clawnet-docs
systemctl restart clawnet-docs"

  echo "  [$host] Waiting for docs service..."
  run_remote "$host" "sleep 3 && curl -sf -o /dev/null http://localhost:3001"
  echo "  [$host] clawnet-docs active on port 3001."

  # Add docs reverse proxy block to Caddyfile if not already present
  local HAS_DOCS_BLOCK
  HAS_DOCS_BLOCK=$(run_remote "$host" "grep -c '$docs_domain' /etc/caddy/Caddyfile 2>/dev/null || echo 0")
  if [[ "$HAS_DOCS_BLOCK" == "0" ]]; then
    echo "  [$host] Adding $docs_domain to Caddyfile..."
    run_remote "$host" "cat >> /etc/caddy/Caddyfile << 'CADDYEOF'

# ── Documentation Site ───────────────────────────────────────────────────────
$docs_domain {
    reverse_proxy localhost:3001 {
        transport http {
            read_timeout  30s
            write_timeout 30s
        }
    }

    header {
        Strict-Transport-Security \"max-age=63072000; includeSubDomains\"
        X-Content-Type-Options    nosniff
        X-Frame-Options           SAMEORIGIN
        Referrer-Policy           strict-origin-when-cross-origin
        -Server
    }

    log {
        output file /var/log/caddy/docs-access.log {
            roll_size 50mb
            roll_keep 5
        }
    }
}
CADDYEOF"
  else
    echo "  [$host] Caddyfile already contains $docs_domain, skipping."
  fi

  # Ensure log file has correct ownership
  run_remote "$host" "touch /var/log/caddy/docs-access.log && chown caddy:caddy /var/log/caddy/docs-access.log"

  echo "  [$host] Reloading Caddy..."
  run_remote "$host" "systemctl reload caddy || systemctl restart caddy"
  echo "  [$host] Docs deployment complete ($docs_domain → localhost:3001)."
}

install_peer_clawnetd_service() {
  local host="$1"
  local bootstrap_multiaddr="$2"

  echo "  [$host] Writing /opt/clawnet/node-data/config.yaml..."
  run_remote "$host" "mkdir -p /opt/clawnet/node-data"
  run_remote "$host" "cat > /opt/clawnet/node-data/config.yaml << CFGEOF
v: 1
network: mainnet

p2p:
  listen:
    - /ip4/0.0.0.0/tcp/9527
  bootstrap:
    - $bootstrap_multiaddr

logging:
  level: info

storage: {}
CFGEOF"

  echo "  [$host] Writing /opt/clawnet/node.env..."
  run_remote "$host" "cat > /opt/clawnet/node.env << ENVEOF
NODE_ENV=production
CLAW_NETWORK=mainnet
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
ExecStart=/usr/bin/node /opt/clawnet/packages/node/dist/daemon.js --api-host 0.0.0.0 --api-port 9528 --data-dir /opt/clawnet/node-data --passphrase \${CLAW_PASSPHRASE}
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

# ══════════════════════════════════════════════════════════════════
# Phase 0: Preflight checks
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 0: Preflight checks..."
require_local_command ssh
require_local_command scp
require_local_command python3
if [[ "$USE_SSH_KEY" != "true" ]]; then
  require_local_command sshpass
fi
if [[ "$USE_SSH_KEY" == "true" ]]; then
  echo "  [preflight] SSH auth: key ($SSH_KEY_PATH)"
else
  echo "  [preflight] SSH auth: password (sshpass)"
fi

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

for HOST in $ALL_SERVERS; do
  echo "  [preflight] SSH check: $HOST"
  run_remote "$HOST" 'echo ok >/dev/null'
  echo "  [preflight] Runtime check on $HOST"
  run_remote "$HOST" 'test -d /opt/clawnet && command -v docker >/dev/null && command -v git >/dev/null && command -v python3 >/dev/null'
done

echo "  [preflight] Local bootstrap script syntax"
bash -n "$SCRIPT_DIR/deploy.sh"
echo "  Preflight checks passed."
echo ""

echo "============================================================"
echo "ClawNet Mainnet — Full Deployment"
echo "============================================================"
echo "Timestamp  : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Node 1     : $SERVER_1 (Validator 1 — $VALIDATOR_1_ADDRESS)"
echo "Node 2     : $SERVER_2 (Validator 2 — $VALIDATOR_2_ADDRESS)"
echo "Node 3     : $SERVER_3 (Validator 3 — $VALIDATOR_3_ADDRESS)"
echo "Node 4     : $SERVER_4 (Validator 4 — $VALIDATOR_4_ADDRESS)"
echo "Node 5     : $SERVER_5 (Validator 5 — $VALIDATOR_5_ADDRESS)"
echo "Deployer   : $DEPLOYER_ADDRESS"
echo "Treasury   : $TREASURY_ADDRESS"
echo "Liquidity  : $LIQUIDITY_ADDRESS"
echo "Reserve    : $RESERVE_ADDRESS"
echo "============================================================"
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 1: Stop all Geth instances
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 1: Stopping Geth on all servers..."
for HOST in $ALL_SERVERS; do
  echo "  Stopping Geth on $HOST..."
  run_remote "$HOST" 'cd /opt/clawnet && docker compose -f docker-compose.chain.yml down 2>/dev/null; docker stop clawnet-geth 2>/dev/null; docker rm clawnet-geth 2>/dev/null; echo "done"' || true
done
echo "  All Geth instances stopped."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 2: Wipe chain data and re-initialize on all servers
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 2: Wiping chain data and re-initializing..."

for HOST in $ALL_SERVERS; do
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

import_validator_key "$SERVER_1" "$VALIDATOR_1_PRIVATE_KEY" "Validator 1"
import_validator_key "$SERVER_2" "$VALIDATOR_2_PRIVATE_KEY" "Validator 2"
import_validator_key "$SERVER_3" "$VALIDATOR_3_PRIVATE_KEY" "Validator 3"
import_validator_key "$SERVER_4" "$VALIDATOR_4_PRIVATE_KEY" "Validator 4"
import_validator_key "$SERVER_5" "$VALIDATOR_5_PRIVATE_KEY" "Validator 5"
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 4: Update code on all servers
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 4: Updating code on all servers..."
for HOST in $ALL_SERVERS; do
  echo "  [$HOST] git pull..."
  run_remote "$HOST" 'cd /opt/clawnet && git pull' || true
done
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 5: Create .env on each server
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 5: Creating .env files..."

SERVERS=($SERVER_1 $SERVER_2 $SERVER_3 $SERVER_4 $SERVER_5)
ADDRESSES=($VALIDATOR_1_ADDRESS $VALIDATOR_2_ADDRESS $VALIDATOR_3_ADDRESS $VALIDATOR_4_ADDRESS $VALIDATOR_5_ADDRESS)

for i in "${!SERVERS[@]}"; do
  run_remote "${SERVERS[$i]}" "cat > /opt/clawnet/.env << 'ENVEOF'
VALIDATOR_ADDRESS=${ADDRESSES[$i]}
ENVEOF"
done

echo "  .env files created."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 5b: Security hardening on all servers
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 5b: Applying security hardening..."

SECURITY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HARDEN_SCRIPT="$SECURITY_DIR/harden-server.sh"
AUDIT_SCRIPT="$SECURITY_DIR/security-audit.sh"
SYSCTL_CONF="$SECURITY_DIR/configs/sysctl-hardening.conf"

for f in "$HARDEN_SCRIPT" "$AUDIT_SCRIPT" "$SYSCTL_CONF"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: security file not found: $f"
    exit 1
  fi
done

for HOST in $ALL_SERVERS; do
  echo "  [$HOST] Uploading security files..."
  scp_to "$HARDEN_SCRIPT" "$HOST" "/tmp/harden-server.sh"
  scp_to "$AUDIT_SCRIPT"  "$HOST" "/opt/clawnet/security-audit.sh"
  scp_to "$SYSCTL_CONF"   "$HOST" "/etc/sysctl.d/99-clawnet-hardening.conf"
  run_remote "$HOST" "chmod +x /opt/clawnet/security-audit.sh && bash /tmp/harden-server.sh && rm /tmp/harden-server.sh"

  # Inject SMTP credentials for security-audit email reports
  run_remote "$HOST" "cat > /opt/clawnet/.smtp-env << 'SMTPEOF'
export CLAWNET_SMTP_USER=${CLAWNET_SMTP_USER:-security-audit@clawnetd.com}
export CLAWNET_SMTP_PASS=${CLAWNET_SMTP_PASS}
SMTPEOF
chmod 600 /opt/clawnet/.smtp-env"
  echo "  [$HOST] Hardened."
done

echo "  Security hardening applied to all servers."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 6: Start Node 1 (mining)
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 6: Starting Geth on Node 1 (mining mode)..."
run_remote "$SERVER_1" 'cd /opt/clawnet && cp infra/mainnet/docker-compose.yml docker-compose.chain.yml && docker compose -f docker-compose.chain.yml up -d'

echo "  Waiting 10s for Node 1 to start mining..."
sleep 10

BLOCK_NUM=$(rpc_block_number "$SERVER_1")
echo "  Node 1 block number: $BLOCK_NUM"

ENODE_1=$(rpc_enode "$SERVER_1")
echo "  Node 1 enode: $ENODE_1"
echo ""

# Accumulate bootnodes
BOOTNODES="$ENODE_1"

# ══════════════════════════════════════════════════════════════════
# Phase 7: Start Nodes 2-5 (sync-first-then-mine)
# ══════════════════════════════════════════════════════════════════
PEER_SERVERS=($SERVER_2 $SERVER_3 $SERVER_4 $SERVER_5)
ENODES=("$ENODE_1")

for idx in "${!PEER_SERVERS[@]}"; do
  NODE_NUM=$((idx + 2))
  HOST="${PEER_SERVERS[$idx]}"

  echo ">>> Phase 7.$NODE_NUM: Starting Geth on Node $NODE_NUM (sync → mine)..."

  # Sync phase
  run_remote "$HOST" "cd /opt/clawnet && \
    BOOTNODES='$BOOTNODES' docker compose -f infra/mainnet/docker-compose.sync.yml up -d"

  echo "  Waiting 15s for Node $NODE_NUM to sync..."
  sleep 15

  N_BLOCK=$(rpc_block_number "$HOST")
  echo "  Node $NODE_NUM block number: $N_BLOCK"

  # Switch to mining mode
  echo "  Switching Node $NODE_NUM to mining mode..."
  run_remote "$HOST" "cd /opt/clawnet && \
    docker compose -f infra/mainnet/docker-compose.sync.yml down && \
    cp infra/mainnet/docker-compose.peer.yml docker-compose.chain.yml && \
    echo 'BOOTNODES=$BOOTNODES' >> /opt/clawnet/.env && \
    docker compose -f docker-compose.chain.yml up -d"

  sleep 5

  # Get enode and add to bootnodes
  ENODE_N=$(rpc_enode "$HOST")
  ENODES+=("$ENODE_N")
  BOOTNODES="${BOOTNODES},${ENODE_N}"
  echo "  Node $NODE_NUM enode: $ENODE_N"
  echo "  Node $NODE_NUM mining."
  echo ""
done

# ══════════════════════════════════════════════════════════════════
# Phase 8: Deploy contracts
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 8: Deploying smart contracts..."

# Clear stale OpenZeppelin deployment manifest from previous chain
run_remote "$SERVER_1" "rm -f /opt/clawnet/packages/contracts/.openzeppelin/unknown-7626.json"
echo "  Cleared stale OpenZeppelin manifest."

run_remote "$SERVER_1" "cd /opt/clawnet && \
  pnpm install --filter @claw-network/contracts... && \
  cd packages/contracts && \
  npx hardhat compile && \
  DEPLOYER_PRIVATE_KEY='$DEPLOYER_PRIVATE_KEY' \
  TREASURY_ADDRESS='$TREASURY_ADDRESS' \
  CLAWNET_RPC_URL='http://127.0.0.1:8545' \
  EMERGENCY_SIGNERS='$VALIDATOR_1_ADDRESS,$VALIDATOR_2_ADDRESS,$VALIDATOR_3_ADDRESS,$VALIDATOR_4_ADDRESS,$VALIDATOR_5_ADDRESS,$DEPLOYER_ADDRESS,$TREASURY_ADDRESS,$LIQUIDITY_ADDRESS,$RESERVE_ADDRESS' \
  npx hardhat run scripts/deploy-all.ts --network clawnetMainnet"

echo "  Contracts deployed."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 9: Bootstrap mint
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 9: Running bootstrap Token mint..."

run_remote "$SERVER_1" "cd /opt/clawnet/packages/contracts && \
  DEPLOYER_PRIVATE_KEY='$DEPLOYER_PRIVATE_KEY' \
  TREASURY_ADDRESS='$TREASURY_ADDRESS' \
  LIQUIDITY_ADDRESS='$LIQUIDITY_ADDRESS' \
  RESERVE_ADDRESS='$RESERVE_ADDRESS' \
  CLAWNET_RPC_URL='http://127.0.0.1:8545' \
  FAUCET_ADDRESS='$DEPLOYER_ADDRESS' \
  NODE_ADDRESSES='$VALIDATOR_1_ADDRESS,$VALIDATOR_2_ADDRESS,$VALIDATOR_3_ADDRESS,$VALIDATOR_4_ADDRESS,$VALIDATOR_5_ADDRESS' \
  BOOTSTRAP_TOTAL_SUPPLY=1000000 \
  npx hardhat run scripts/bootstrap-mint.ts --network clawnetMainnet"

echo "  Bootstrap mint complete."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 10: Save deployment record locally
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 10: Saving deployment record..."

# Copy contracts deployment record from Node 1
scp_from "$SERVER_1" \
  "/opt/clawnet/packages/contracts/deployments/clawnetMainnet.json" \
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
{
  echo "# ClawNet Mainnet — Enode URLs (generated $(date -u +%Y-%m-%dT%H:%M:%SZ))"
  echo "ENODE_1=${ENODES[0]}"
  echo "ENODE_2=${ENODES[1]}"
  echo "ENODE_3=${ENODES[2]}"
  echo "ENODE_4=${ENODES[3]}"
  echo "ENODE_5=${ENODES[4]}"
} > "$SCRIPT_DIR/enodes.env"

echo "  Saved: contracts.json, enodes.env"
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 11: Verify cluster
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 11: Verifying cluster health..."

ALL_HEALTHY=true
for i in "${!SERVERS[@]}"; do
  NODE_NUM=$((i + 1))
  BLOCK=$(rpc_block_number "${SERVERS[$i]}")
  PEERS=$(rpc_peer_count "${SERVERS[$i]}")
  echo "  Node $NODE_NUM (${SERVERS[$i]}): block=$BLOCK peers=$PEERS"

  if [[ "$BLOCK" -le 0 ]]; then
    echo "  ERROR: Node $NODE_NUM reports block number <= 0"
    ALL_HEALTHY=false
  fi
  if [[ "$PEERS" -lt 1 ]]; then
    echo "  ERROR: Node $NODE_NUM has peerCount < 1"
    ALL_HEALTHY=false
  fi
done

if [[ "$ALL_HEALTHY" != "true" ]]; then
  echo "ERROR: Cluster health check failed"
  exit 1
fi

if [[ ! -s "$SCRIPT_DIR/enodes.env" ]]; then
  echo "ERROR: enodes.env missing after deployment"
  exit 1
fi

echo "  Cluster health checks passed."

echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 12: Deploy clawnetd (ClawNet Node) on Node 1
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 12: Setting up clawnetd on Node 1..."

CLAWNETD_PRIVATE_KEY="${CLAW_PRIVATE_KEY:-$DEPLOYER_PRIVATE_KEY}"
CLAWNETD_DATA_DIR="/opt/clawnet/clawnetd-data"

# Extract contract addresses from contracts.json
CONTRACTS_JSON_LOCAL="$SCRIPT_DIR/contracts.json"
TOKEN_ADDR=$(python3 -c "import json; d=json.load(open('$CONTRACTS_JSON_LOCAL')); print(d['contracts']['ClawToken']['proxy'])")
ESCROW_ADDR=$(python3 -c "import json; d=json.load(open('$CONTRACTS_JSON_LOCAL')); print(d['contracts']['ClawEscrow']['proxy'])")
IDENTITY_ADDR=$(python3 -c "import json; d=json.load(open('$CONTRACTS_JSON_LOCAL')); print(d['contracts']['ClawIdentity']['proxy'])")
REPUTATION_ADDR=$(python3 -c "import json; d=json.load(open('$CONTRACTS_JSON_LOCAL')); print(d['contracts']['ClawReputation']['proxy'])")
CONTRACTS_ADDR=$(python3 -c "import json; d=json.load(open('$CONTRACTS_JSON_LOCAL')); print(d['contracts']['ClawContracts']['proxy'])")
DAO_ADDR=$(python3 -c "import json; d=json.load(open('$CONTRACTS_JSON_LOCAL')); print(d['contracts']['ClawDAO']['proxy'])")
STAKING_ADDR=$(python3 -c "import json; d=json.load(open('$CONTRACTS_JSON_LOCAL')); print(d['contracts']['ClawStaking']['proxy'])")
PARAM_REGISTRY_ADDR=$(python3 -c "import json; d=json.load(open('$CONTRACTS_JSON_LOCAL')); print(d['contracts']['ParamRegistry']['proxy'])")

echo "  Contract addresses extracted from contracts.json"

# 12a. Build node package locally and upload
echo "  [Node 1] Building and uploading clawnetd..."
run_remote "$SERVER_1" "mkdir -p $CLAWNETD_DATA_DIR"

# 12b. Write config.yaml with chain section
echo "  [Node 1] Writing config.yaml with chain configuration..."
run_remote "$SERVER_1" "cat > $CLAWNETD_DATA_DIR/config.yaml << 'CFGEOF'
v: 1
network: mainnet

p2p:
  listen:
    - /ip4/0.0.0.0/tcp/9527
  bootstrap: []

logging:
  level: info

storage: {}

chain:
  rpcUrl: http://127.0.0.1:8545
  chainId: 7626
  contracts:
    token: '$TOKEN_ADDR'
    escrow: '$ESCROW_ADDR'
    identity: '$IDENTITY_ADDR'
    reputation: '$REPUTATION_ADDR'
    contracts: '$CONTRACTS_ADDR'
    dao: '$DAO_ADDR'
    staking: '$STAKING_ADDR'
    paramRegistry: '$PARAM_REGISTRY_ADDR'
  signer:
    type: env
    envVar: CLAW_PRIVATE_KEY
  artifactsDir: /opt/clawnet/packages/contracts/artifacts
CFGEOF"
echo "  config.yaml written."

# 12b.1 Validate config.yaml contains mandatory on-chain fields
echo "  [Node 1] Validating config.yaml..."
run_remote "$SERVER_1" "grep -q '^chain:' $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q '^  chainId: 7626$' $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q '^network: mainnet$' $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"token: '$TOKEN_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"escrow: '$ESCROW_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"identity: '$IDENTITY_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"reputation: '$REPUTATION_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"contracts: '$CONTRACTS_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"dao: '$DAO_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"staking: '$STAKING_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"paramRegistry: '$PARAM_REGISTRY_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml"
echo "  config.yaml validation passed."

# 12c. Install clawnetd systemd service
echo "  [Node 1] Installing clawnetd systemd service..."
run_remote "$SERVER_1" "cat > /opt/clawnet/node.env << ENVEOF
NODE_ENV=production
CLAW_DATA_DIR=$CLAWNETD_DATA_DIR
CLAW_NETWORK=mainnet
CLAW_PASSPHRASE=$CLAW_PASSPHRASE
CLAW_API_KEY=$CLAW_API_KEY
CLAW_PRIVATE_KEY=$CLAWNETD_PRIVATE_KEY
ENVEOF
chmod 600 /opt/clawnet/node.env"

run_remote "$SERVER_1" "cat > /etc/systemd/system/clawnetd.service << 'SVCEOF'
[Unit]
Description=ClawNet Node (clawnetd)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clawnet/packages/node
EnvironmentFile=/opt/clawnet/node.env
ExecStartPre=/usr/bin/test -f $CLAWNETD_DATA_DIR/config.yaml
ExecStartPre=/usr/bin/grep -q '^chain:' $CLAWNETD_DATA_DIR/config.yaml
ExecStart=/usr/bin/node dist/daemon.js --data-dir $CLAWNETD_DATA_DIR --api-host 127.0.0.1 --api-port 9528 --listen /ip4/0.0.0.0/tcp/9527 --passphrase \${CLAW_PASSPHRASE}
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable clawnetd"
echo "  clawnetd systemd service installed."

# 12d. Build and deploy node package
echo "  [Node 1] Pulling latest code and building..."
run_remote "$SERVER_1" "cd /opt/clawnet && git pull && pnpm install && pnpm build"

# 12e. Start clawnetd and verify EventIndexer
echo "  [Node 1] Starting clawnetd..."
run_remote "$SERVER_1" "systemctl restart clawnetd"

echo "  Waiting 10s for EventIndexer to start..."
sleep 10

INDEXER_CHECK=$(run_remote "$SERVER_1" "test -f $CLAWNETD_DATA_DIR/indexer.sqlite && echo 'OK' || echo 'MISSING'")
if [[ "$INDEXER_CHECK" == "OK" ]]; then
  LAST_BLOCK=$(run_remote "$SERVER_1" "sqlite3 $CLAWNETD_DATA_DIR/indexer.sqlite 'SELECT value FROM indexer_meta WHERE key=\"last_indexed_block\";' 2>/dev/null || echo '0'")
  EVENT_COUNT=$(run_remote "$SERVER_1" "sqlite3 $CLAWNETD_DATA_DIR/indexer.sqlite 'SELECT COUNT(*) FROM events;' 2>/dev/null || echo '0'")
  echo "  EventIndexer running: last_block=$LAST_BLOCK events=$EVENT_COUNT"
else
  echo "  ERROR: indexer.sqlite not found — EventIndexer failed to start"
  echo "  Debug logs:"
  run_remote "$SERVER_1" "journalctl -u clawnetd -n 80 --no-pager"
  exit 1
fi

echo "  clawnetd deployed on Node 1."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 13: Deploy clawnetd on Nodes 2-5 via systemd + node.env
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 13: Setting up clawnetd on Nodes 2-5..."

NODE_1_PEER_ID=$(run_remote "$SERVER_1" "curl -sf http://127.0.0.1:9528/api/v1/node | python3 -c 'import json,sys; print((json.load(sys.stdin).get(\"data\") or {}).get(\"peerId\", \"\"))'")
if [[ -z "$NODE_1_PEER_ID" ]]; then
  echo "ERROR: failed to read Node 1 peerId from clawnetd API"
  exit 1
fi
NODE_1_BOOTSTRAP_MULTIADDR="/ip4/$SERVER_1/tcp/9527/p2p/$NODE_1_PEER_ID"
echo "  Node 1 bootstrap addr: $NODE_1_BOOTSTRAP_MULTIADDR"

for HOST in $SERVER_2 $SERVER_3 $SERVER_4 $SERVER_5; do
  install_peer_clawnetd_service "$HOST" "$NODE_1_BOOTSTRAP_MULTIADDR"
done

echo "  Waiting 10s for mesh convergence..."
sleep 10

NODE_1_CLAWNET_PEERS=$(run_remote "$SERVER_1" "curl -sf http://127.0.0.1:9528/api/v1/node | python3 -c 'import json,sys; print(int((json.load(sys.stdin).get(\"data\") or {}).get(\"peers\", 0)))'")
NODE_1_CLAWNET_CONNECTIONS=$(run_remote "$SERVER_1" "curl -sf http://127.0.0.1:9528/api/v1/node | python3 -c 'import json,sys; print(int((json.load(sys.stdin).get(\"data\") or {}).get(\"connections\", 0)))'")
echo "  Node 1 clawnetd mesh: peers=$NODE_1_CLAWNET_PEERS connections=$NODE_1_CLAWNET_CONNECTIONS"

if [[ "$NODE_1_CLAWNET_PEERS" -lt 4 || "$NODE_1_CLAWNET_CONNECTIONS" -lt 4 ]]; then
  echo "ERROR: clawnetd mesh not converged on Node 1 (expected peers/connections >= 4)"
  run_remote "$SERVER_1" "systemctl status clawnetd --no-pager -n 80 || true"
  for HOST in $SERVER_2 $SERVER_3 $SERVER_4 $SERVER_5; do
    run_remote "$HOST" "systemctl status clawnetd --no-pager -n 80 || true"
  done
  exit 1
fi

echo "  Nodes 2-5 clawnetd deployed and managed by systemd."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 14: Deploy documentation site on Node 1
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 14: Deploying documentation site on Node 1..."
install_docs_service "$SERVER_1" "docs.clawnet.io"
echo "  Documentation site deployed."
echo ""

echo "============================================================"
echo "Deployment complete!"
echo "============================================================"
echo "Files saved in: $SCRIPT_DIR"
echo "  - secrets.env    (private keys, server IPs)"
echo "  - genesis.json   (chain genesis block)"
echo "  - contracts.json (deployed contract addresses)"
echo "  - enodes.env     (node enode URLs)"
echo "============================================================"
