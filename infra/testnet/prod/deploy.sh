#!/usr/bin/env bash
# ==============================================================================
# ClawNet Testnet — Full Redeployment Script (Hyperledger Besu / QBFT)
# ==============================================================================
# This script performs a complete testnet redeployment on all 3 servers:
#   1. Stop existing Besu on all servers
#   2. Wipe chain data, upload genesis + validator key files
#   3. Update code on all servers (git pull)
#   4. Security hardening
#   5. Start Server A, wait for blocks, get enode URL
#   6. Start Server B & C with bootnodes
#   7. Deploy contracts
#   8. Run bootstrap mint, save deployment record
#   9. Verify cluster health
#  10. Deploy clawnetd (3 nodes) + docs site
#
# Prerequisites:
#   - sshpass installed (brew install hudochenkov/sshpass/sshpass)
#   - secrets.env and genesis.json in same directory as this script
#
# Usage:
#   cd infra/testnet/prod
#   SSH_KEY_PATH=~/.ssh/id_ed25519_clawnet bash deploy.sh
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
SERVER_A="${SERVER_A:-66.94.125.242}"
SERVER_B="${SERVER_B:-85.239.236.49}"
SERVER_C="${SERVER_C:-85.239.235.67}"
SSH_KEY_PATH="${SSH_KEY_PATH:-}"
SSH_PASS="${SSH_PASSWORD:-G66tdTcmvBz*k1sf}"
CLAW_PASSPHRASE="${CLAW_PASSPHRASE:-$(openssl rand -hex 32)}"
CLAW_API_KEY="${CLAW_API_KEY:-$(openssl rand -hex 32)}"

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
  if [[ -n "$SSH_KEY_PATH" ]]; then
    ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "root@$host" "$@"
  else
    sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "root@$host" "$@"
  fi
}

# Helper: copy file to remote server
scp_to() {
  local file="$1"
  local host="$2"
  local dest="$3"
  if [[ -n "$SSH_KEY_PATH" ]]; then
    scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no "$file" "root@$host:$dest"
  else
    sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no "$file" "root@$host:$dest"
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

install_peer_clawnetd_service() {
  local host="$1"
  local bootstrap_multiaddr="$2"

  echo "  [$host] Writing /opt/clawnet/node-data/config.yaml..."
  run_remote "$host" "mkdir -p /opt/clawnet/node-data"
  run_remote "$host" "cat > /opt/clawnet/node-data/config.yaml << CFGEOF
v: 1
network: testnet

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

echo ">>> Phase 0: Preflight checks..."
if [[ -n "$SSH_KEY_PATH" ]]; then
  echo "  Using SSH key: $SSH_KEY_PATH"
else
  require_local_command sshpass
fi
require_local_command ssh
require_local_command scp
require_local_command python3

if [[ ! -f "$GENESIS_FILE" ]]; then
  echo "ERROR: genesis file not found: $GENESIS_FILE"
  exit 1
fi
if ! grep -q '"qbft"' "$GENESIS_FILE"; then
  echo "ERROR: genesis.json must contain QBFT consensus config"
  exit 1
fi
if ! grep -q '"zeroBaseFee"' "$GENESIS_FILE"; then
  echo "ERROR: genesis.json must contain zeroBaseFee for zero-gas network"
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
bash -n "$SCRIPT_DIR/deploy.sh"
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
# Phase 1: Stop all Besu instances
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 1: Stopping Besu on all servers..."
for HOST in $SERVER_A $SERVER_B $SERVER_C; do
  echo "  Stopping Besu on $HOST..."
  run_remote "$HOST" 'cd /opt/clawnet && docker compose -f docker-compose.chain.yml down 2>/dev/null; docker stop clawnet-besu 2>/dev/null; docker rm clawnet-besu 2>/dev/null; echo "done"' || true
done
echo "  All Besu instances stopped."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 2: Wipe chain data and upload genesis + key files
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 2: Wiping chain data and uploading config..."

write_validator_key() {
  local host="$1"
  local privkey="$2"  # with 0x prefix
  local label="$3"

  # Strip 0x prefix — Besu expects raw hex in key file
  local raw_key="${privkey#0x}"

  echo "  [$host] Writing $label key file..."
  run_remote "$host" "echo '$raw_key' > /opt/clawnet/config/key && chmod 600 /opt/clawnet/config/key"
  echo "  [$host] $label key file written."
}

for HOST in $SERVER_A $SERVER_B $SERVER_C; do
  echo "  [$HOST] Wiping chain data..."
  run_remote "$HOST" 'rm -rf /opt/clawnet/chain-data/*'

  echo "  [$HOST] Uploading genesis.json..."
  run_remote "$HOST" 'mkdir -p /opt/clawnet/config'
  scp_to "$GENESIS_FILE" "$HOST" "/opt/clawnet/config/genesis.json"
  echo ""
done

# Write validator key files (Besu reads private key directly, no keystore)
write_validator_key "$SERVER_A" "$VALIDATOR_1_PRIVATE_KEY" "Validator 1"
write_validator_key "$SERVER_B" "$VALIDATOR_2_PRIVATE_KEY" "Validator 2"
write_validator_key "$SERVER_C" "$VALIDATOR_3_PRIVATE_KEY" "Validator 3"
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
# Phase 5: (Reserved — Besu derives validator address from key file)
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 5: Skipped (Besu uses --node-private-key-file, no .env needed)."
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

for HOST in $SERVER_A $SERVER_B $SERVER_C; do
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
# Phase 6: Start Server A (QBFT validator)
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 6: Starting Besu on Server A..."
run_remote "$SERVER_A" 'cd /opt/clawnet && cp infra/testnet/docker-compose.yml docker-compose.chain.yml && docker compose -f docker-compose.chain.yml up -d'

echo "  Waiting 15s for Server A to start producing blocks..."
sleep 15

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
# Phase 7: Start Server B (QBFT validator with bootnode)
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 7: Starting Besu on Server B..."

# Copy peer compose and inject Server A enode
run_remote "$SERVER_B" "cd /opt/clawnet && cp infra/testnet/docker-compose.peer.yml docker-compose.chain.yml && \
  sed -i 's|enode://.*@66.94.125.242:30303|${ENODE_A}|g' docker-compose.chain.yml && \
  sed -i 's|<SERVER_A_ENODE_PUBKEY>@66.94.125.242:30303|${ENODE_A#enode://}|g' docker-compose.chain.yml && \
  docker compose -f docker-compose.chain.yml up -d"

echo "  Waiting 10s for Server B to join consensus..."
sleep 10

B_BLOCK=$(run_remote "$SERVER_B" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(int(json.load(sys.stdin)[\"result\"],16))"')
echo "  Server B block number: $B_BLOCK"
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 8: Start Server C (QBFT validator with bootnodes)
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 8: Starting Besu on Server C..."

# Get enode for Server B
ENODE_B_RAW=$(run_remote "$SERVER_B" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"admin_nodeInfo\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(json.load(sys.stdin)[\"result\"][\"enode\"])"')
ENODE_B=$(echo "$ENODE_B_RAW" | sed "s/127.0.0.1/$SERVER_B/")

BOOTNODES_C="${ENODE_A},${ENODE_B}"

run_remote "$SERVER_C" "cd /opt/clawnet && cp infra/testnet/docker-compose.peer.yml docker-compose.chain.yml && \
  sed -i 's|enode://.*@66.94.125.242:30303|${BOOTNODES_C}|g' docker-compose.chain.yml && \
  sed -i 's|<SERVER_A_ENODE_PUBKEY>@66.94.125.242:30303|${BOOTNODES_C#enode://}|g' docker-compose.chain.yml && \
  docker compose -f docker-compose.chain.yml up -d"

echo "  Waiting 10s for Server C to join consensus..."
sleep 10

C_BLOCK=$(run_remote "$SERVER_C" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(int(json.load(sys.stdin)[\"result\"],16))"')
echo "  Server C block number: $C_BLOCK"

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
if [[ -n "$SSH_KEY_PATH" ]]; then
  scp -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no \
    "root@$SERVER_A:/opt/clawnet/packages/contracts/deployments/clawnetTestnet.json" \
    "$SCRIPT_DIR/contracts.json"
else
  sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no \
    "root@$SERVER_A:/opt/clawnet/packages/contracts/deployments/clawnetTestnet.json" \
    "$SCRIPT_DIR/contracts.json"
fi

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

# Verify QBFT validators
QBFT_VALIDATORS=$(run_remote "$SERVER_A" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"qbft_getValidatorsByBlockNumber\",\"params\":[\"latest\"],\"id\":1}" | python3 -c "import sys,json; v=json.load(sys.stdin)[\"result\"]; print(len(v))"')
echo "  QBFT validators: $QBFT_VALIDATORS"
if [[ "$QBFT_VALIDATORS" -ne 3 ]]; then
  echo "ERROR: expected 3 QBFT validators, got $QBFT_VALIDATORS"
  exit 1
fi

# Verify zero gas price
GAS_PRICE=$(run_remote "$SERVER_A" 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_gasPrice\",\"params\":[],\"id\":1}" | python3 -c "import sys,json; print(json.load(sys.stdin)[\"result\"])"')
echo "  eth_gasPrice: $GAS_PRICE"
if [[ "$GAS_PRICE" != "0x0" ]]; then
  echo "ERROR: expected eth_gasPrice=0x0, got $GAS_PRICE"
  exit 1
fi

echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 13: Deploy clawnetd (ClawNet Node) on Server A
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 13: Setting up clawnetd on Server A..."

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

# 13a. Create data directory
run_remote "$SERVER_A" "mkdir -p $CLAWNETD_DATA_DIR"

# 13b. Write config.yaml with chain section
echo "  [Server A] Writing config.yaml with chain configuration..."
run_remote "$SERVER_A" "cat > $CLAWNETD_DATA_DIR/config.yaml << 'CFGEOF'
v: 1
network: testnet

p2p:
  listen:
    - /ip4/0.0.0.0/tcp/9527
  bootstrap: []

logging:
  level: info

storage: {}

chain:
  rpcUrl: http://127.0.0.1:8545
  chainId: 7625
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

# 13b.1 Validate config.yaml contains mandatory on-chain fields
echo "  [Server A] Validating config.yaml..."
run_remote "$SERVER_A" "grep -q '^chain:' $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q '^  chainId: 7625$' $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q '^network: testnet$' $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"token: '$TOKEN_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"escrow: '$ESCROW_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"identity: '$IDENTITY_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"reputation: '$REPUTATION_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"contracts: '$CONTRACTS_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"dao: '$DAO_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"staking: '$STAKING_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml && \
  grep -q \"paramRegistry: '$PARAM_REGISTRY_ADDR'\" $CLAWNETD_DATA_DIR/config.yaml"
echo "  config.yaml validation passed."

# 13c. Install clawnetd systemd service
echo "  [Server A] Installing clawnetd systemd service..."

run_remote "$SERVER_A" "cat > /etc/systemd/system/clawnetd.service << 'SVCEOF'
[Unit]
Description=ClawNet Node (clawnetd)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clawnet/packages/node
ExecStartPre=/usr/bin/test -f $CLAWNETD_DATA_DIR/config.yaml
ExecStartPre=/usr/bin/grep -q '^chain:' $CLAWNETD_DATA_DIR/config.yaml
ExecStart=/usr/bin/node dist/daemon.js --data-dir $CLAWNETD_DATA_DIR --api-host 127.0.0.1 --api-port 9528 --listen /ip4/0.0.0.0/tcp/9527 --passphrase \${CLAW_PASSPHRASE}
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=CLAW_DATA_DIR=$CLAWNETD_DATA_DIR
Environment=CLAW_NETWORK=testnet
Environment=CLAW_PASSPHRASE=$CLAW_PASSPHRASE
Environment=CLAW_API_KEY=$CLAW_API_KEY
Environment=CLAW_PRIVATE_KEY=$CLAWNETD_PRIVATE_KEY
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable clawnetd"
echo "  clawnetd systemd service installed."

# 13d. Build node package
echo "  [Server A] Building clawnetd..."
run_remote "$SERVER_A" "cd /opt/clawnet && pnpm install && pnpm build"

# 13e. Create yaml symlink if needed
run_remote "$SERVER_A" "[ -d /opt/clawnet/packages/node/node_modules/yaml ] || \
  ln -sf /opt/clawnet/node_modules/.pnpm/yaml@*/node_modules/yaml \
         /opt/clawnet/packages/node/node_modules/yaml 2>/dev/null || true"

# 13f. Start clawnetd and verify EventIndexer
echo "  [Server A] Starting clawnetd..."
run_remote "$SERVER_A" "systemctl restart clawnetd"

echo "  Waiting 10s for EventIndexer to start..."
sleep 10

INDEXER_CHECK=$(run_remote "$SERVER_A" "test -f $CLAWNETD_DATA_DIR/indexer.sqlite && echo 'OK' || echo 'MISSING'")
if [[ "$INDEXER_CHECK" == "OK" ]]; then
  LAST_BLOCK=$(run_remote "$SERVER_A" "sqlite3 $CLAWNETD_DATA_DIR/indexer.sqlite 'SELECT value FROM indexer_meta WHERE key=\"last_indexed_block\";' 2>/dev/null || echo '0'")
  EVENT_COUNT=$(run_remote "$SERVER_A" "sqlite3 $CLAWNETD_DATA_DIR/indexer.sqlite 'SELECT COUNT(*) FROM events;' 2>/dev/null || echo '0'")
  echo "  EventIndexer running: last_block=$LAST_BLOCK events=$EVENT_COUNT"
else
  echo "  ERROR: indexer.sqlite not found — EventIndexer failed to start"
  echo "  Debug logs:"
  run_remote "$SERVER_A" "journalctl -u clawnetd -n 80 --no-pager"
  exit 1
fi

echo "  clawnetd deployed on Server A."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 14: Deploy clawnetd on Server B/C via systemd + node.env
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 14: Setting up clawnetd on Server B/C..."

A_NODE_PEER_ID=$(run_remote "$SERVER_A" "curl -sf http://127.0.0.1:9528/api/v1/node | python3 -c 'import json,sys; print((json.load(sys.stdin).get(\"data\") or {}).get(\"peerId\", \"\"))'")
if [[ -z "$A_NODE_PEER_ID" ]]; then
  echo "ERROR: failed to read Server A peerId from clawnetd API"
  exit 1
fi

A_BOOTSTRAP_MULTIADDR="/ip4/$SERVER_A/tcp/9527/p2p/$A_NODE_PEER_ID"
echo "  Server A bootstrap addr: $A_BOOTSTRAP_MULTIADDR"

install_peer_clawnetd_service "$SERVER_B" "$A_BOOTSTRAP_MULTIADDR"
install_peer_clawnetd_service "$SERVER_C" "$A_BOOTSTRAP_MULTIADDR"

echo "  Waiting 8s for mesh convergence..."
sleep 8

A_NODE_PEERS=$(run_remote "$SERVER_A" "curl -sf http://127.0.0.1:9528/api/v1/node | python3 -c 'import json,sys; print(int((json.load(sys.stdin).get(\"data\") or {}).get(\"peers\", 0)))'")
A_NODE_CONNECTIONS=$(run_remote "$SERVER_A" "curl -sf http://127.0.0.1:9528/api/v1/node | python3 -c 'import json,sys; print(int((json.load(sys.stdin).get(\"data\") or {}).get(\"connections\", 0)))'")
echo "  Server A clawnetd mesh: peers=$A_NODE_PEERS connections=$A_NODE_CONNECTIONS"

if [[ "$A_NODE_PEERS" -lt 2 || "$A_NODE_CONNECTIONS" -lt 2 ]]; then
  echo "ERROR: clawnetd mesh not converged on Server A (expected peers/connections >= 2)"
  echo "Debug: Server A/B/C clawnetd status"
  run_remote "$SERVER_A" "systemctl status clawnetd --no-pager -n 80 || true"
  run_remote "$SERVER_B" "systemctl status clawnetd --no-pager -n 80 || true"
  run_remote "$SERVER_C" "systemctl status clawnetd --no-pager -n 80 || true"
  exit 1
fi

echo "  Server B/C clawnetd deployed and managed by systemd."
echo ""

# ══════════════════════════════════════════════════════════════════
# Phase 15: Deploy documentation site on Server A
# ══════════════════════════════════════════════════════════════════
echo ">>> Phase 15: Deploying documentation site on Server A..."
install_docs_service "$SERVER_A" "docs.clawnetd.com"
echo "  Documentation site deployed."
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
