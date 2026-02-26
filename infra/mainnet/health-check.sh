#!/usr/bin/env bash
# ==============================================================================
# ClawNet Mainnet — Health Check Script (5-Node)
# ==============================================================================
# Aligned with infra/testnet/health-check.sh — same structure, mainnet config.
#
# Usage:
#   ./health-check.sh               # Check all 5 nodes remotely
#   ./health-check.sh --local       # Check local node only (127.0.0.1)
#   watch -n 60 ./health-check.sh   # Run every 60 seconds
#
# Crontab (every 5 min, alert on failure):
#   */5 * * * * /opt/clawnet/health-check.sh 2>&1 | logger -t clawnet-health
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

# Geth RPC endpoints — 5 mainnet validators
# Override via environment or .env
GETH_RPC_1="${GETH_RPC_1:-}"
GETH_RPC_2="${GETH_RPC_2:-}"
GETH_RPC_3="${GETH_RPC_3:-}"
GETH_RPC_4="${GETH_RPC_4:-}"
GETH_RPC_5="${GETH_RPC_5:-}"

# ClawNet Node REST API endpoints — port 9528
NODE_1_URL="${NODE_1_URL:-}"
NODE_2_URL="${NODE_2_URL:-}"
NODE_3_URL="${NODE_3_URL:-}"
NODE_4_URL="${NODE_4_URL:-}"
NODE_5_URL="${NODE_5_URL:-}"

ALERT_WEBHOOK="${ALERT_WEBHOOK_URL:-}"
HOSTNAME=$(hostname)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Thresholds
MAX_BLOCK_LAG=30          # Alert if block is older than N seconds
MIN_PEER_COUNT=1          # Alert if peer count below N

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
  GETH_RPC_2="" ; GETH_RPC_3="" ; GETH_RPC_4="" ; GETH_RPC_5=""
  NODE_2_URL="" ; NODE_3_URL="" ; NODE_4_URL="" ; NODE_5_URL=""
fi

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

ERRORS=()

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; ERRORS+=("WARN: $1"); }
fail() { echo -e "  ${RED}✗${NC} $1"; ERRORS+=("FAIL: $1"); }

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

  local resp
  resp=$(curl -sf --connect-timeout 10 "$url/api/v1/node/info" 2>/dev/null || echo "")

  if [ -z "$resp" ]; then
    fail "$label: Node API unreachable at $url"
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
  for i in 1 2 3 4 5; do
    rpc_var="GETH_RPC_$i"
    rpc="${!rpc_var:-}"
    if [ -n "$rpc" ]; then
      check_geth "Node-$i" "$rpc"
    fi
  done

  # Block consistency — all nodes should be within 5 blocks
  if [ ${#BLOCK_HEIGHTS[@]} -ge 2 ]; then
    MAX_B=${BLOCK_HEIGHTS[0]}; MIN_B=${BLOCK_HEIGHTS[0]}
    for b in "${BLOCK_HEIGHTS[@]}"; do
      [ "$b" -gt "$MAX_B" ] 2>/dev/null && MAX_B=$b
      [ "$b" -lt "$MIN_B" ] 2>/dev/null && MIN_B=$b
    done
    DRIFT=$(( MAX_B - MIN_B ))
    if [ "$DRIFT" -le 5 ]; then
      ok "Block drift: $DRIFT blocks across ${#BLOCK_HEIGHTS[@]} nodes"
    else
      warn "Block drift: $DRIFT blocks — possible fork!"
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
  for i in 1 2 3 4 5; do
    url_var="NODE_${i}_URL"
    url="${!url_var:-}"
    if [ -n "$url" ]; then
      check_node "Node-$i" "$url"
    fi
  done
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
if [ ${#ERRORS[@]} -eq 0 ]; then
  echo -e "${GREEN}All checks passed!${NC}"
else
  echo -e "${RED}Issues found: ${#ERRORS[@]}${NC}"
  for err in "${ERRORS[@]}"; do
    echo "  - $err"
  done

  if [ -n "$ALERT_WEBHOOK" ]; then
    ALERT_MSG="[ClawNet Mainnet Health] $HOSTNAME @ $TIMESTAMP\n"
    for err in "${ERRORS[@]}"; do
      ALERT_MSG+="• $err\n"
    done

    curl -sf -X POST "$ALERT_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$ALERT_MSG\"}}" \
      >/dev/null 2>&1 || true

    echo -e "  ${YELLOW}Alert sent to webhook${NC}"
  fi

  exit 1
fi
