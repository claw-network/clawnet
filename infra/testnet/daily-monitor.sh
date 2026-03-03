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

# ── Server IPs (from prod/secrets.env) ────────────────────────────────────────
# Server A exposes RPC publicly (0.0.0.0:8545) + Caddy.
# Server B/C bind RPC to 127.0.0.1 only — not reachable remotely.
# B/C liveness is verified via Server A's peer count (≥ 2).
SERVER_A="66.94.125.242"
GETH_RPC_A="${GETH_RPC_A:-http://${SERVER_A}:8545}"

# ClawNet Node REST API — only Server A has Caddy (api.clawnetd.com → :9528)
NODE_A_URL="${NODE_A_URL:-https://api.clawnetd.com}"

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
BLOCK_A=$(echo "$GETH_A_JSON" | grep -o '"block": [0-9]*' | grep -o '[0-9]*' || echo 0)

# Verify Server B/C liveness via Server A peer count
echo ""
echo -e "  ${CYAN}Cluster peers (B/C via Server A peer count):${NC}"
PEER_HEX=$(curl -sf --connect-timeout 5 -X POST "$GETH_RPC_A" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":99}' \
  2>/dev/null | jq -r '.result // empty' 2>/dev/null || true)
CLUSTER_PEERS=0
if [ -n "$PEER_HEX" ]; then
  CLUSTER_PEERS=$(( 16#${PEER_HEX#0x} ))
fi

if [ "$CLUSTER_PEERS" -ge 2 ]; then
  ok "All 3 validators connected (peer count = $CLUSTER_PEERS)"
  record_pass
elif [ "$CLUSTER_PEERS" -eq 1 ]; then
  warn "Only 1 peer — one of Server B/C may be down"
  record_warn "Cluster: only 1 peer connected"
else
  fail "No peers — Server B and C may both be down"
  record_fail "Cluster: 0 peers"
fi

echo ""

# ==============================================================================
# 2. CLAWNET NODE REST API HEALTH
# ==============================================================================
echo -e "${BOLD}=== 2. ClawNet Node REST API ===${NC}"

NODE_A_LIBP2P_PEERS=0
NODE_A_LIBP2P_CONNECTIONS=0

check_node() {
  local label=$1
  local url=$2

  # Skip if URL is empty (node has no external REST API endpoint)
  if [ -z "$url" ]; then
    echo -e "  ${YELLOW}-${NC} $label: no REST API endpoint (port 9528 not exposed)"
    record_pass  # not a failure — by design
    return
  fi

  # GET /api/v1/node
  local resp
  resp=$(curl -sf --connect-timeout 10 "$url/api/v1/node" 2>/dev/null || echo "")

  if [ -z "$resp" ]; then
    warn "$label: Node API unreachable at $url (clawnetd may not be running)"
    record_fail "$label: Node API unreachable"
    return
  fi

  local did
  did=$(echo "$resp" | jq -r '.did // .data.did // empty' 2>/dev/null || true)
  local peers
  peers=$(echo "$resp" | jq -r '.peers // .data.peers // .peerCount // 0' 2>/dev/null || echo "0")
  local connections
  connections=$(echo "$resp" | jq -r '.connections // .data.connections // 0' 2>/dev/null || echo "0")
  local version
  version=$(echo "$resp" | jq -r '.version // .data.version // "?"' 2>/dev/null || echo "?")

  # Export to outer scope for JSON report
  NODE_A_LIBP2P_PEERS=$peers
  NODE_A_LIBP2P_CONNECTIONS=$connections

  ok "$label: DID=${did:0:20}... peers=$peers connections=$connections version=$version"
  record_pass

  # Validate libp2p peers against Geth cluster peers.
  # Geth clusterPeers tells us how many validators are connected at L1.
  # The ClawNet Node (libp2p) should see at least the same number of peers.
  if [ "$CLUSTER_PEERS" -gt 0 ] && [ "$peers" -lt "$CLUSTER_PEERS" ]; then
    warn "$label: libp2p peers ($peers) < Geth clusterPeers ($CLUSTER_PEERS) — a ClawNet Node on B/C may be down"
    record_warn "$label: libp2p peers degraded ($peers < $CLUSTER_PEERS)"
  fi
}

check_node "Node-A" "$NODE_A_URL"

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

  CLAWNETD_CONFIG="/opt/clawnet/clawnetd-data/config.yaml"
  EXPECT_CHAIN_INDEXER=false
  if [ -f "$CLAWNETD_CONFIG" ] && grep -q '^chain:' "$CLAWNETD_CONFIG"; then
    EXPECT_CHAIN_INDEXER=true
  fi

  # Find indexer DB (look in common locations)
  DB_PATH=""
  for candidate in \
    "/opt/clawnet/clawnetd-data/indexer.sqlite" \
    "$SCRIPT_DIR/../../data/indexer.sqlite" \
    "$HOME/.clawnet/data/indexer.sqlite" \
    "/opt/clawnet/data/indexer.sqlite"; do
    if [ -f "$candidate" ]; then
      DB_PATH="$candidate"
      break
    fi
  done

  if [ -f "$CLAWNETD_CONFIG" ] && ! grep -q '^chain:' "$CLAWNETD_CONFIG"; then
    fail "Reconciliation: missing chain config in $CLAWNETD_CONFIG"
    record_fail "Reconciliation: chain config missing"
    RECONCILE_STATUS="failed-no-chain-config"
  elif [ -n "$DB_PATH" ]; then
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
    if $EXPECT_CHAIN_INDEXER; then
      fail "Reconciliation: indexer.sqlite missing while chain config is enabled ($CLAWNETD_CONFIG)"
      record_fail "Reconciliation: indexer.sqlite missing (chain config enabled)"
      RECONCILE_STATUS="failed-no-db"
    else
      info "Reconciliation: indexer.sqlite not found — skipping (only available on server)"
      RECONCILE_STATUS="skipped-no-db"
    fi
  fi
else
  info "Reconciliation: packages/contracts not found — run from repo root or on server"
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
    # Auto-detect single-node: scenarios require 3 distinct nodes.
    # If NODE_A/B/C all resolve to the same URL, skip with explanation.
    _env_file="$SCENARIOS_DIR/.env"
    _node_a=$(grep -E '^NODE_A_URL=' "$_env_file" 2>/dev/null | head -1 | cut -d= -f2-)
    _node_b=$(grep -E '^NODE_B_URL=' "$_env_file" 2>/dev/null | head -1 | cut -d= -f2-)
    _node_c=$(grep -E '^NODE_C_URL=' "$_env_file" 2>/dev/null | head -1 | cut -d= -f2-)

    if [ -z "$_node_a" ] || [ -z "$_node_b" ] || [ -z "$_node_c" ]; then
      info "Scenarios skipped — NODE_A/B/C_URL not all configured in .env"
      SCENARIO_STATUS="skipped-no-urls"
    else
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
      "blockHeight": $BLOCK_A,
      "clusterPeers": $CLUSTER_PEERS,
      "expectedPeers": 2
    },
    "nodeApi": {
      "A": "$(curl -sf --connect-timeout 5 "$NODE_A_URL/api/v1/node" > /dev/null 2>&1 && echo "ok" || echo "unreachable")",
      "libp2pPeers": $NODE_A_LIBP2P_PEERS,
      "libp2pConnections": $NODE_A_LIBP2P_CONNECTIONS
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
