#!/usr/bin/env bash
# ==============================================================================
# ClawNet Mainnet — Health Check Script (5-Node)
# ==============================================================================
# Topology (IPs TBD — set in .env or prod/secrets.env):
#   Node 1  — Validator 1 (RPC public + Caddy at clawnet.io)
#   Node 2-5 — Validators 2-5 (RPC localhost only)
#
# Remote mode checks Node 1's Geth directly, then verifies Node 2-5 are
# alive via Node 1's peer count (≥ 4 means all peers connected).
# For per-node checks, run on each server with: ./health-check.sh --local
#
# Usage:
#   ./health-check.sh               # Remote: check via Node 1 RPC
#   ./health-check.sh --local       # On-server: check localhost only
#   watch -n 60 ./health-check.sh   # Run every 60 seconds
#
# Requires: curl, jq
# ==============================================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/.env"
  set +a
fi

# ── Server IPs (set in .env or prod/secrets.env before first run) ────────────
# Node 1 exposes RPC publicly (0.0.0.0:8545) + Caddy (rpc.clawnet.io).
# Node 2-5 bind RPC to 127.0.0.1 only — not reachable remotely.
NODE_1_IP="${NODE_1_IP:-}"

# Geth RPC — only Node 1 is reachable remotely
GETH_RPC_1="${GETH_RPC_1:-}"
if [ -z "$GETH_RPC_1" ] && [ -n "$NODE_1_IP" ]; then
  GETH_RPC_1="http://${NODE_1_IP}:8545"
fi

# ClawNet Node REST API — only Node 1 has Caddy (api.clawnet.io → :9528)
NODE_1_URL="${NODE_1_URL:-https://api.clawnet.io}"

ALERT_WEBHOOK="${ALERT_WEBHOOK_URL:-}"
HOSTNAME=$(hostname)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Thresholds
MAX_BLOCK_LAG=30          # Alert if block is older than N seconds
MIN_PEER_COUNT=4          # Alert if peer count below N (expect 4 for 5-node cluster)

# CLI flags
LOCAL_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --local) LOCAL_ONLY=true ;;
  esac
done

# In local mode, only check localhost
if $LOCAL_ONLY; then
  GETH_RPC_1="${GETH_RPC:-http://127.0.0.1:8545}"
  NODE_1_URL="${CLAW_API:-http://127.0.0.1:9528}"
  MIN_PEER_COUNT=1
fi

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

ERRORS=()
WARNINGS=()

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; WARNINGS+=("$1"); }
fail() { echo -e "  ${RED}✗${NC} $1"; ERRORS+=("$1"); }

# ── Geth check function ──────────────────────────────────────────────────────
BLOCK_HEIGHTS=()

check_geth() {
  local label=$1
  local rpc=$2

  local block_hex
  block_hex=$(curl -sf --connect-timeout 5 -X POST "$rpc" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    2>/dev/null | jq -r '.result // empty' 2>/dev/null || true)

  if [ -z "$block_hex" ]; then
    fail "$label: Geth unreachable at $rpc"
    BLOCK_HEIGHTS+=(0)
    return
  fi

  local block_num=$(( 16#${block_hex#0x} ))
  BLOCK_HEIGHTS+=("$block_num")

  local block_data
  block_data=$(curl -sf --connect-timeout 5 -X POST "$rpc" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["latest",false],"id":2}' \
    2>/dev/null || echo "{}")

  local block_ts_hex
  block_ts_hex=$(echo "$block_data" | jq -r '.result.timestamp // empty' 2>/dev/null || true)
  local block_age="?"
  if [ -n "$block_ts_hex" ]; then
    local block_ts=$(( 16#${block_ts_hex#0x} ))
    local now_ts
    now_ts=$(date +%s)
    block_age=$(( now_ts - block_ts ))
    if [ "$block_age" -gt "$MAX_BLOCK_LAG" ]; then
      warn "$label: block is ${block_age}s old (threshold: ${MAX_BLOCK_LAG}s)"
    fi
  fi

  local peer_hex
  peer_hex=$(curl -sf --connect-timeout 5 -X POST "$rpc" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":3}' \
    2>/dev/null | jq -r '.result // empty' 2>/dev/null || true)
  local peer_count=0
  if [ -n "$peer_hex" ]; then
    peer_count=$(( 16#${peer_hex#0x} ))
    if [ "$peer_count" -lt "$MIN_PEER_COUNT" ]; then
      warn "$label: peer count $peer_count (min: $MIN_PEER_COUNT)"
    fi
  fi

  local mining
  mining=$(curl -sf --connect-timeout 5 -X POST "$rpc" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_mining","params":[],"id":4}' \
    2>/dev/null | jq -r '.result // empty' 2>/dev/null || true)

  if [ "$mining" != "true" ]; then
    warn "$label: NOT mining"
  fi

  ok "$label: height=$block_num age=${block_age}s peers=$peer_count mining=$mining"
}

# ── ClawNet Node check function ──────────────────────────────────────────────
check_node() {
  local label=$1
  local url=$2

  # Skip if URL is empty (node has no external REST API endpoint)
  if [ -z "$url" ]; then
    echo -e "  ${YELLOW}-${NC} $label: no REST API endpoint configured (OK if clawnetd not deployed)"
    return
  fi

  local resp
  resp=$(curl -sf --connect-timeout 10 "$url/api/v1/node/info" 2>/dev/null || echo "")

  if [ -z "$resp" ]; then
    warn "$label: Node API unreachable at $url (clawnetd may not be running)"
    return
  fi

  local did
  did=$(echo "$resp" | jq -r '.did // .data.did // empty' 2>/dev/null || true)
  local peers
  peers=$(echo "$resp" | jq -r '.peers // .data.peers // .peerCount // 0' 2>/dev/null || echo "?")
  local version
  version=$(echo "$resp" | jq -r '.version // .data.version // "?"' 2>/dev/null || echo "?")

  ok "$label: DID=${did:0:20}... peers=$peers version=$version"
}

# ==============================================================================
# 1. GETH CHAIN HEALTH
# ==============================================================================
echo "=== Geth (EVM Chain — chainId 7626) ==="

if $LOCAL_ONLY; then
  check_geth "Local" "$GETH_RPC_1"
else
  if [ -z "$GETH_RPC_1" ]; then
    warn "GETH_RPC_1 not configured — set NODE_1_IP or GETH_RPC_1 in .env"
  else
    # Only Node 1 RPC is reachable remotely.
    # Node 2-5 bind 127.0.0.1:8545 — verify they are alive via peer count.
    check_geth "Node-1 ($NODE_1_IP)" "$GETH_RPC_1"

    if [ ${#BLOCK_HEIGHTS[@]} -ge 1 ] && [ "${BLOCK_HEIGHTS[0]}" -gt 0 ]; then
      # Node 2-5 liveness: Node 1's peer count should be ≥ 4
      echo ""
      echo -e "  ${CYAN}Node 2-5 RPC is localhost-only — verifying via Node 1 peer count:${NC}"
      remote_peer_count=0
      peer_hex=$(curl -sf --connect-timeout 5 -X POST "$GETH_RPC_1" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":99}' \
        2>/dev/null | jq -r '.result // empty' 2>/dev/null || true)
      if [ -n "$peer_hex" ]; then
        remote_peer_count=$(( 16#${peer_hex#0x} ))
      fi

      if [ "$remote_peer_count" -ge 4 ]; then
        ok "All 4 peer nodes connected (peer count $remote_peer_count ≥ 4)"
      elif [ "$remote_peer_count" -ge 1 ]; then
        warn "Only $remote_peer_count of 4 expected peers connected — some nodes may be down"
      else
        fail "No peers connected — Node 2-5 may all be down"
      fi
    fi
  fi
fi

echo ""

# ==============================================================================
# 2. CLAWNET NODE REST API (:9528)
# ==============================================================================
echo "=== ClawNet Node (REST API) ==="

if $LOCAL_ONLY; then
  check_node "Local" "$NODE_1_URL"
else
  check_node "Node-1" "$NODE_1_URL"
fi

echo ""

# ── Check Docker Containers (local only — runs on each server) ───────────────
echo "=== Docker Containers ==="

for CONTAINER in clawnet-geth caddy; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "not found")
  if [ "$STATUS" = "running" ]; then
    UPTIME=$(docker inspect --format='{{.State.StartedAt}}' "$CONTAINER" 2>/dev/null || echo "")
    ok "$CONTAINER: running (since ${UPTIME:0:19})"
  elif [ "$STATUS" = "not found" ]; then
    echo -e "  ${YELLOW}-${NC} $CONTAINER: not present (OK if not expected)"
  else
    fail "$CONTAINER: $STATUS"
  fi
done

echo ""

# ── Check Disk Space ─────────────────────────────────────────────────────────
echo "=== Disk Space ==="

DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 90 ]; then
  fail "Disk usage: ${DISK_USAGE}% (CRITICAL)"
elif [ "$DISK_USAGE" -gt 80 ]; then
  warn "Disk usage: ${DISK_USAGE}% (WARNING)"
else
  ok "Disk usage: ${DISK_USAGE}%"
fi

DATA_DIR="/opt/clawnet/chain-data"
if [ -d "$DATA_DIR" ]; then
  DATA_USAGE=$(du -sh "$DATA_DIR" 2>/dev/null | awk '{print $1}')
  ok "Chain data size: $DATA_USAGE"
fi

echo ""

# ── Summary ──────────────────────────────────────────────────────────────────
echo "=== Summary ==="

WARN_COUNT=${#WARNINGS[@]}
ERR_COUNT=${#ERRORS[@]}

if [ "$WARN_COUNT" -gt 0 ]; then
  echo -e "${YELLOW}Warnings: ${WARN_COUNT}${NC}"
  for w in "${WARNINGS[@]}"; do
    echo "  - ⚠ $w"
  done
fi

if [ "$ERR_COUNT" -eq 0 ]; then
  echo -e "${GREEN}All critical checks passed!${NC}"
else
  echo -e "${RED}Failures: ${ERR_COUNT}${NC}"
  for err in "${ERRORS[@]}"; do
    echo "  - ✗ $err"
  done

  if [ -n "$ALERT_WEBHOOK" ]; then
    ALERT_MSG="[ClawNet Mainnet Health] $HOSTNAME @ $TIMESTAMP\n"
    for err in "${ERRORS[@]}"; do
      ALERT_MSG+="• $err\n"
    done
    if [ "$WARN_COUNT" -gt 0 ]; then
      for w in "${WARNINGS[@]}"; do
        ALERT_MSG+="• ⚠ $w\n"
      done
    fi

    curl -sf -X POST "$ALERT_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$ALERT_MSG\"}}" \
      >/dev/null 2>&1 || true

    echo -e "  ${YELLOW}Alert sent to webhook${NC}"
  fi

  exit 1
fi
