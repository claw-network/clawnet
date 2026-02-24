#!/usr/bin/env bash
# ==============================================================================
# ClawNet Chain — Health Check Script
# ==============================================================================
# Usage:
#   ./health-check.sh               # Run once
#   watch -n 60 ./health-check.sh   # Run every 60 seconds
#
# Crontab (every 5 min, alert on failure):
#   */5 * * * * /opt/clawnet/health-check.sh 2>&1 | logger -t clawnet-health
#
# Requires: curl, jq
# ==============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
GETH_RPC="${GETH_RPC:-http://127.0.0.1:8545}"
ALERT_WEBHOOK="${ALERT_WEBHOOK_URL:-}"
HOSTNAME=$(hostname)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Thresholds
MAX_BLOCK_LAG=30          # Alert if block is older than N seconds
MIN_PEER_COUNT=1          # Alert if peer count below N

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

ERRORS=()

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; ERRORS+=("WARN: $1"); }
fail() { echo -e "  ${RED}✗${NC} $1"; ERRORS+=("FAIL: $1"); }

# ── Check Geth ────────────────────────────────────────────────────────────────
echo "=== Geth (EVM Chain) ==="

# 1. Geth reachable?
BLOCK_HEX=$(curl -sf -X POST "$GETH_RPC" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  | jq -r '.result // empty' 2>/dev/null || true)

if [ -z "$BLOCK_HEX" ]; then
  fail "Geth unreachable at $GETH_RPC"
else
  BLOCK_NUM=$((16#${BLOCK_HEX#0x}))
  ok "Block height: $BLOCK_NUM"

  # 2. Block freshness
  BLOCK_DATA=$(curl -sf -X POST "$GETH_RPC" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBlockByNumber\",\"params\":[\"latest\",false],\"id\":2}" \
    2>/dev/null || echo "{}")

  BLOCK_TS_HEX=$(echo "$BLOCK_DATA" | jq -r '.result.timestamp // empty' 2>/dev/null || true)
  if [ -n "$BLOCK_TS_HEX" ]; then
    BLOCK_TS=$((16#${BLOCK_TS_HEX#0x}))
    NOW_TS=$(date +%s)
    LAG=$((NOW_TS - BLOCK_TS))
    if [ "$LAG" -gt "$MAX_BLOCK_LAG" ]; then
      warn "Block is ${LAG}s old (threshold: ${MAX_BLOCK_LAG}s)"
    else
      ok "Block age: ${LAG}s"
    fi
  fi

  # 3. Peer count
  PEER_HEX=$(curl -sf -X POST "$GETH_RPC" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":3}' \
    | jq -r '.result // empty' 2>/dev/null || true)

  if [ -n "$PEER_HEX" ]; then
    PEER_COUNT=$((16#${PEER_HEX#0x}))
    if [ "$PEER_COUNT" -lt "$MIN_PEER_COUNT" ]; then
      warn "Geth peer count: $PEER_COUNT (min: $MIN_PEER_COUNT)"
    else
      ok "Geth peers: $PEER_COUNT"
    fi
  fi

  # 4. Mining status (Clique)
  MINING=$(curl -sf -X POST "$GETH_RPC" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_mining","params":[],"id":4}' \
    | jq -r '.result // empty' 2>/dev/null || true)

  if [ "$MINING" = "true" ]; then
    ok "Validator: mining"
  else
    warn "Validator: NOT mining"
  fi
fi

echo ""

# ── Check clawnetd (skip if not deployed) ────────────────────────────────────
# clawnetd P2P node is not yet deployed. Uncomment when ready.
# echo "=== clawnetd (P2P Protocol) ==="
# CLAW_API="${CLAW_API:-http://127.0.0.1:9528}"
# CLAW_STATUS=$(curl -sf "$CLAW_API/api/v1/node/info" 2>/dev/null || echo "")
# ...
echo ""

# ── Check Docker Containers ──────────────────────────────────────────────────
echo "=== Docker Containers ==="

for CONTAINER in clawnet-geth caddy; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "not found")
  if [ "$STATUS" = "running" ]; then
    UPTIME=$(docker inspect --format='{{.State.StartedAt}}' "$CONTAINER" 2>/dev/null || echo "")
    ok "$CONTAINER: running (since ${UPTIME:0:19})"
  elif [ "$STATUS" = "not found" ]; then
    # Not all containers run on all servers (e.g., Caddy only on Server A)
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

  # ── Send Alert ─────────────────────────────────────────────────────────────
  if [ -n "$ALERT_WEBHOOK" ]; then
    ALERT_MSG="[ClawNet Health] $HOSTNAME @ $TIMESTAMP\n"
    for err in "${ERRORS[@]}"; do
      ALERT_MSG+="• $err\n"
    done

    # Generic webhook (works with Feishu/DingTalk/Slack if you adjust payload)
    curl -sf -X POST "$ALERT_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$ALERT_MSG\"}}" \
      >/dev/null 2>&1 || true

    echo -e "  ${YELLOW}Alert sent to webhook${NC}"
  fi

  exit 1
fi
