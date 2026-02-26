#!/usr/bin/env bash
# ==============================================================================
# ClawNet Testnet — Daily Stability Monitor
# ==============================================================================
# Runs a comprehensive daily health check for T-3.9 stability observation:
#   1. Geth chain health (3 nodes: block height, freshness, peers, mining)
#   2. ClawNet Node REST API health (3 nodes)
#   3. On-chain ↔ off-chain reconciliation (4D: DID, balance, escrow, contract)
#   4. Lightweight regression (Scenario 01: Identity & Wallet)
#
# Usage:
#   ./daily-monitor.sh                          # Run once
#   ./daily-monitor.sh --skip-scenarios         # Skip scenario re-run
#   ./daily-monitor.sh --report-only            # Just generate report from last run
#
# Crontab (every day at 06:00 UTC):
#   0 6 * * * /opt/clawnet/daily-monitor.sh 2>&1 | tee -a /opt/clawnet/logs/monitor.log
#
# Environment (override via .env or export):
#   GETH_RPC_A, GETH_RPC_B, GETH_RPC_C — Geth JSON-RPC endpoints
#   NODE_A_URL, NODE_B_URL, NODE_C_URL  — ClawNet Node REST API endpoints
#   OBSERVATION_START                    — ISO date when T-3.9 started
#
# Outputs:
#   infra/testnet/reports/YYYY-MM-DD.json — structured daily report
#   stdout — human-readable summary
# ==============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPORT_DIR="$SCRIPT_DIR/reports"
DATE=$(date -u +"%Y-%m-%d")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REPORT_FILE="$REPORT_DIR/$DATE.json"

# Load .env if present
if [ -f "$SCRIPT_DIR/scenarios/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/scenarios/.env"
  set +a
fi

# Geth RPC endpoints (each server's local Geth)
GETH_RPC_A="${GETH_RPC_A:-http://173.249.46.252:8545}"
GETH_RPC_B="${GETH_RPC_B:-http://167.86.93.216:8545}"
GETH_RPC_C="${GETH_RPC_C:-http://167.86.93.223:8545}"

# ClawNet Node REST API endpoints
NODE_A_URL="${NODE_A_URL:-http://173.249.46.252:9528}"
NODE_B_URL="${NODE_B_URL:-http://167.86.93.216:9528}"
NODE_C_URL="${NODE_C_URL:-http://167.86.93.223:9528}"

# Contract addresses (from prod/contracts.json)
CONTRACTS_JSON="$SCRIPT_DIR/prod/contracts.json"

# Observation window
OBSERVATION_START="${OBSERVATION_START:-2026-02-26}"
OBSERVATION_DAYS=7

# CLI flags
SKIP_SCENARIOS=false
REPORT_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --skip-scenarios) SKIP_SCENARIOS=true ;;
    --report-only)    REPORT_ONLY=true ;;
  esac
done

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${CYAN}ℹ${NC} $1"; }

# ── Ensure report dir ─────────────────────────────────────────────────────────
mkdir -p "$REPORT_DIR"

# ── Report builder ────────────────────────────────────────────────────────────
# We construct JSON incrementally using a temp file
REPORT_TMP=$(mktemp)
cat > "$REPORT_TMP" <<EOF
{
  "date": "$DATE",
  "timestamp": "$TIMESTAMP",
  "observationDay": 0,
  "checks": {
    "geth": {},
    "nodeApi": {},
    "reconciliation": {},
    "scenarios": {}
  },
  "summary": {
    "passed": 0,
    "warned": 0,
    "failed": 0,
    "status": "unknown"
  }
}
EOF

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
ERRORS=()

record_pass() { ((PASS_COUNT++)) || true; }
record_warn() { ((WARN_COUNT++)) || true; ERRORS+=("WARN: $1"); }
record_fail() { ((FAIL_COUNT++)) || true; ERRORS+=("FAIL: $1"); }

# ── Calculate observation day ─────────────────────────────────────────────────
if command -v gdate &>/dev/null; then
  OBS_START_TS=$(gdate -d "$OBSERVATION_START" +%s)
  NOW_TS=$(gdate +%s)
else
  OBS_START_TS=$(date -j -f "%Y-%m-%d" "$OBSERVATION_START" +%s 2>/dev/null || date -d "$OBSERVATION_START" +%s 2>/dev/null || echo 0)
  NOW_TS=$(date +%s)
fi
OBS_DAY=$(( (NOW_TS - OBS_START_TS) / 86400 + 1 ))

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  ClawNet Testnet — Daily Stability Monitor              ║${NC}"
echo -e "${BOLD}║  Date: $DATE  (Observation Day $OBS_DAY/$OBSERVATION_DAYS)           ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

if $REPORT_ONLY; then
  if [ -f "$REPORT_FILE" ]; then
    cat "$REPORT_FILE"
  else
    echo "No report found for $DATE"
  fi
  rm -f "$REPORT_TMP"
  exit 0
fi

# ==============================================================================
# 1. GETH CHAIN HEALTH
# ==============================================================================
echo -e "${BOLD}=== 1. Geth Chain Health ===${NC}"

check_geth() {
  local label=$1
  local rpc=$2

  # Block number
  local block_hex
  block_hex=$(curl -sf --connect-timeout 5 -X POST "$rpc" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    2>/dev/null | jq -r '.result // empty' 2>/dev/null || true)

  if [ -z "$block_hex" ]; then
    fail "$label: Geth unreachable at $rpc"
    record_fail "$label: Geth unreachable"
    echo "\"$label\": {\"status\": \"unreachable\", \"rpc\": \"$rpc\"}"
    return
  fi

  local block_num=$(( 16#${block_hex#0x} ))

  # Block freshness
  local block_data
  block_data=$(curl -sf --connect-timeout 5 -X POST "$rpc" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["latest",false],"id":2}' \
    2>/dev/null || echo "{}")

  local block_ts_hex
  block_ts_hex=$(echo "$block_data" | jq -r '.result.timestamp // empty' 2>/dev/null || true)
  local block_age=0
  if [ -n "$block_ts_hex" ]; then
    local block_ts=$(( 16#${block_ts_hex#0x} ))
    local now_ts
    now_ts=$(date +%s)
    block_age=$(( now_ts - block_ts ))
  fi

  # Peer count
  local peer_hex
  peer_hex=$(curl -sf --connect-timeout 5 -X POST "$rpc" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":3}' \
    2>/dev/null | jq -r '.result // empty' 2>/dev/null || true)
  local peer_count=0
  if [ -n "$peer_hex" ]; then
    peer_count=$(( 16#${peer_hex#0x} ))
  fi

  # Mining
  local mining
  mining=$(curl -sf --connect-timeout 5 -X POST "$rpc" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_mining","params":[],"id":4}' \
    2>/dev/null | jq -r '.result // empty' 2>/dev/null || true)

  # Evaluate
  local status="ok"
  if [ "$block_age" -gt 30 ]; then
    warn "$label: block is ${block_age}s old (height: $block_num)"
    record_warn "$label: stale block (${block_age}s)"
    status="warn"
  else
    ok "$label: height=$block_num, age=${block_age}s, peers=$peer_count, mining=$mining"
    record_pass
  fi

  if [ "$peer_count" -lt 1 ]; then
    warn "$label: 0 peers"
    record_warn "$label: no peers"
    status="warn"
  fi

  if [ "$mining" != "true" ]; then
    warn "$label: NOT mining"
    record_warn "$label: not mining"
    status="warn"
  fi

  echo "\"$label\": {\"status\": \"$status\", \"block\": $block_num, \"blockAge\": $block_age, \"peers\": $peer_count, \"mining\": $mining}"
}

GETH_A_JSON=$(check_geth "Server-A" "$GETH_RPC_A")
GETH_B_JSON=$(check_geth "Server-B" "$GETH_RPC_B")
GETH_C_JSON=$(check_geth "Server-C" "$GETH_RPC_C")

# Check block consistency (all 3 should be within 5 blocks)
echo ""
echo -e "  ${CYAN}Block consistency:${NC}"
BLOCK_A=$(echo "$GETH_A_JSON" | grep -o '"block": [0-9]*' | grep -o '[0-9]*' || echo 0)
BLOCK_B=$(echo "$GETH_B_JSON" | grep -o '"block": [0-9]*' | grep -o '[0-9]*' || echo 0)
BLOCK_C=$(echo "$GETH_C_JSON" | grep -o '"block": [0-9]*' | grep -o '[0-9]*' || echo 0)

MAX_BLOCK=$BLOCK_A
[ "$BLOCK_B" -gt "$MAX_BLOCK" ] 2>/dev/null && MAX_BLOCK=$BLOCK_B
[ "$BLOCK_C" -gt "$MAX_BLOCK" ] 2>/dev/null && MAX_BLOCK=$BLOCK_C
MIN_BLOCK=$BLOCK_A
[ "$BLOCK_B" -lt "$MIN_BLOCK" ] 2>/dev/null && MIN_BLOCK=$BLOCK_B
[ "$BLOCK_C" -lt "$MIN_BLOCK" ] 2>/dev/null && MIN_BLOCK=$BLOCK_C
BLOCK_DRIFT=$(( MAX_BLOCK - MIN_BLOCK ))

if [ "$BLOCK_DRIFT" -le 5 ]; then
  ok "Block drift: $BLOCK_DRIFT (A=$BLOCK_A B=$BLOCK_B C=$BLOCK_C)"
  record_pass
else
  warn "Block drift: $BLOCK_DRIFT (A=$BLOCK_A B=$BLOCK_B C=$BLOCK_C) — possible fork!"
  record_warn "Block drift: $BLOCK_DRIFT"
fi

echo ""

# ==============================================================================
# 2. CLAWNET NODE REST API HEALTH
# ==============================================================================
echo -e "${BOLD}=== 2. ClawNet Node REST API ===${NC}"

check_node() {
  local label=$1
  local url=$2

  # GET /api/v1/node/info
  local resp
  resp=$(curl -sf --connect-timeout 10 "$url/api/v1/node/info" 2>/dev/null || echo "")

  if [ -z "$resp" ]; then
    fail "$label: Node API unreachable at $url"
    record_fail "$label: Node API unreachable"
    return
  fi

  local did
  did=$(echo "$resp" | jq -r '.did // .data.did // empty' 2>/dev/null || true)
  local peers
  peers=$(echo "$resp" | jq -r '.peers // .data.peers // .peerCount // 0' 2>/dev/null || echo "?")
  local version
  version=$(echo "$resp" | jq -r '.version // .data.version // "?"' 2>/dev/null || echo "?")

  ok "$label: DID=${did:0:20}... peers=$peers version=$version"
  record_pass
}

check_node "Node-A" "$NODE_A_URL"
check_node "Node-B" "$NODE_B_URL"
check_node "Node-C" "$NODE_C_URL"

echo ""

# ==============================================================================
# 3. RECONCILIATION (4D on-chain ↔ off-chain)
# ==============================================================================
echo -e "${BOLD}=== 3. Reconciliation ===${NC}"

# Try to run reconcile.ts if we can reach the hardhat project + have a DB
RECONCILE_STATUS="skipped"
RECONCILE_DISCREPANCIES=0

# Check if we can reach the contracts directory
CONTRACTS_DIR="$SCRIPT_DIR/../../packages/contracts"
if [ -d "$CONTRACTS_DIR" ] && [ -f "$CONTRACTS_JSON" ]; then
  # Extract addresses from contracts.json
  TOKEN_ADDR=$(jq -r '.contracts.ClawToken.proxy' "$CONTRACTS_JSON")
  ESCROW_ADDR=$(jq -r '.contracts.ClawEscrow.proxy' "$CONTRACTS_JSON")
  CONTRACTS_ADDR=$(jq -r '.contracts.ClawContracts.proxy' "$CONTRACTS_JSON")
  IDENTITY_ADDR=$(jq -r '.contracts.ClawIdentity.proxy' "$CONTRACTS_JSON")

  # Find indexer DB (look in common locations)
  DB_PATH=""
  for candidate in \
    "$SCRIPT_DIR/../../data/indexer.sqlite" \
    "$HOME/.clawnet/data/indexer.sqlite" \
    "/opt/clawnet/data/indexer.sqlite"; do
    if [ -f "$candidate" ]; then
      DB_PATH="$candidate"
      break
    fi
  done

  if [ -n "$DB_PATH" ]; then
    info "Running reconcile.ts (DB: $DB_PATH)"
    pushd "$CONTRACTS_DIR" > /dev/null

    RECONCILE_OUTPUT=$(TOKEN_ADDRESS="$TOKEN_ADDR" \
      ESCROW_ADDRESS="$ESCROW_ADDR" \
      CONTRACTS_ADDRESS="$CONTRACTS_ADDR" \
      IDENTITY_ADDRESS="$IDENTITY_ADDR" \
      DB_PATH="$DB_PATH" \
      OUTPUT_FILE="$REPORT_DIR/reconcile-$DATE.json" \
      npx hardhat run scripts/reconcile.ts --network clawnetTestnet 2>&1 || true)

    popd > /dev/null

    # Parse result
    if echo "$RECONCILE_OUTPUT" | grep -q "0 discrepancies"; then
      ok "Reconciliation: 0 discrepancies"
      record_pass
      RECONCILE_STATUS="passed"
    elif echo "$RECONCILE_OUTPUT" | grep -qE "[0-9]+ discrepanc"; then
      RECONCILE_DISCREPANCIES=$(echo "$RECONCILE_OUTPUT" | grep -oE "[0-9]+ discrepanc" | grep -oE "[0-9]+" || echo "?")
      fail "Reconciliation: $RECONCILE_DISCREPANCIES discrepancies found!"
      record_fail "Reconciliation: $RECONCILE_DISCREPANCIES discrepancies"
      RECONCILE_STATUS="failed"
    else
      warn "Reconciliation: could not parse output"
      record_warn "Reconciliation: unparseable output"
      RECONCILE_STATUS="unknown"
    fi
  else
    warn "Reconciliation: indexer.sqlite not found — skipping"
    record_warn "Reconciliation: no DB"
    RECONCILE_STATUS="skipped-no-db"
  fi
else
  warn "Reconciliation: packages/contracts not found — run from repo root"
  RECONCILE_STATUS="skipped-no-contracts"
fi

echo ""

# ==============================================================================
# 4. LIGHTWEIGHT SCENARIO REGRESSION
# ==============================================================================
echo -e "${BOLD}=== 4. Scenario Regression ===${NC}"

SCENARIO_STATUS="skipped"
SCENARIO_PASSED=0
SCENARIO_FAILED=0

if $SKIP_SCENARIOS; then
  info "Scenarios skipped (--skip-scenarios)"
else
  SCENARIOS_DIR="$SCRIPT_DIR/scenarios"
  if [ -f "$SCENARIOS_DIR/run-tests.mjs" ] && [ -f "$SCENARIOS_DIR/.env" ]; then
    info "Running Scenario 01 (Identity & Wallet) as lightweight regression..."

    pushd "$SCENARIOS_DIR" > /dev/null
    SCENARIO_OUTPUT=$(node run-tests.mjs --scenario 01 2>&1 || true)
    popd > /dev/null

    # Parse results
    if echo "$SCENARIO_OUTPUT" | grep -q "passed.*0 failed"; then
      SCENARIO_PASSED=$(echo "$SCENARIO_OUTPUT" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" || echo "?")
      ok "Scenario 01: $SCENARIO_PASSED passed, 0 failed"
      record_pass
      SCENARIO_STATUS="passed"
    elif echo "$SCENARIO_OUTPUT" | grep -qE "[0-9]+ failed"; then
      SCENARIO_FAILED=$(echo "$SCENARIO_OUTPUT" | grep -oE "[0-9]+ failed" | grep -oE "[0-9]+" || echo "?")
      SCENARIO_PASSED=$(echo "$SCENARIO_OUTPUT" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" || echo "0")
      fail "Scenario 01: $SCENARIO_PASSED passed, $SCENARIO_FAILED failed"
      record_fail "Scenario 01 regression: $SCENARIO_FAILED failures"
      SCENARIO_STATUS="failed"
    else
      warn "Scenario 01: could not parse output"
      record_warn "Scenario 01: unparseable"
      SCENARIO_STATUS="unknown"
    fi
  else
    warn "Scenarios: run-tests.mjs or .env not found — skipping"
    SCENARIO_STATUS="skipped-no-env"
  fi
fi

echo ""

# ==============================================================================
# SUMMARY
# ==============================================================================
echo -e "${BOLD}═══ Daily Summary (Day $OBS_DAY/$OBSERVATION_DAYS) ═══${NC}"

OVERALL="PASS"
if [ "$FAIL_COUNT" -gt 0 ]; then
  OVERALL="FAIL"
elif [ "$WARN_COUNT" -gt 0 ]; then
  OVERALL="WARN"
fi

echo ""
echo -e "  Passed:  ${GREEN}$PASS_COUNT${NC}"
echo -e "  Warned:  ${YELLOW}$WARN_COUNT${NC}"
echo -e "  Failed:  ${RED}$FAIL_COUNT${NC}"
echo -e "  Status:  $([ "$OVERALL" = "PASS" ] && echo -e "${GREEN}${OVERALL}${NC}" || ([ "$OVERALL" = "WARN" ] && echo -e "${YELLOW}${OVERALL}${NC}" || echo -e "${RED}${OVERALL}${NC}"))"
echo ""

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "  Issues:"
  for err in "${ERRORS[@]}"; do
    echo "    - $err"
  done
  echo ""
fi

# Observation progress
DAYS_REMAINING=$(( OBSERVATION_DAYS - OBS_DAY ))
if [ "$DAYS_REMAINING" -le 0 ]; then
  echo -e "  ${GREEN}🎉 Observation window complete!${NC}"
  echo "  Ready to proceed to Sprint 3-D (Mainnet Deployment)"
elif [ "$OVERALL" = "PASS" ]; then
  echo -e "  ${CYAN}$DAYS_REMAINING day(s) remaining in observation window.${NC}"
else
  echo -e "  ${YELLOW}$DAYS_REMAINING day(s) remaining. Fix issues before mainnet.${NC}"
fi

# ── Write JSON report ────────────────────────────────────────────────────────
cat > "$REPORT_FILE" <<EOF
{
  "date": "$DATE",
  "timestamp": "$TIMESTAMP",
  "observationDay": $OBS_DAY,
  "observationTotal": $OBSERVATION_DAYS,
  "checks": {
    "geth": {
      "blockHeights": {"A": $BLOCK_A, "B": $BLOCK_B, "C": $BLOCK_C},
      "blockDrift": $BLOCK_DRIFT,
      "maxAcceptableDrift": 5
    },
    "nodeApi": {
      "A": "$(curl -sf --connect-timeout 5 "$NODE_A_URL/api/v1/node/info" > /dev/null 2>&1 && echo "ok" || echo "unreachable")",
      "B": "$(curl -sf --connect-timeout 5 "$NODE_B_URL/api/v1/node/info" > /dev/null 2>&1 && echo "ok" || echo "unreachable")",
      "C": "$(curl -sf --connect-timeout 5 "$NODE_C_URL/api/v1/node/info" > /dev/null 2>&1 && echo "ok" || echo "unreachable")"
    },
    "reconciliation": {
      "status": "$RECONCILE_STATUS",
      "discrepancies": $RECONCILE_DISCREPANCIES
    },
    "scenarios": {
      "status": "$SCENARIO_STATUS",
      "passed": $SCENARIO_PASSED,
      "failed": $SCENARIO_FAILED
    }
  },
  "summary": {
    "passed": $PASS_COUNT,
    "warned": $WARN_COUNT,
    "failed": $FAIL_COUNT,
    "status": "$OVERALL"
  }
}
EOF

echo ""
echo -e "  Report saved: ${CYAN}$REPORT_FILE${NC}"
echo ""

rm -f "$REPORT_TMP"

# Exit code: 0 = PASS, 1 = FAIL, 2 = WARN
case "$OVERALL" in
  PASS) exit 0 ;;
  WARN) exit 0 ;;  # warnings are non-fatal
  FAIL) exit 1 ;;
esac
