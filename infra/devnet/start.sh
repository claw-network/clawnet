#!/usr/bin/env bash
# ============================================================
# ClawNet Local Devnet — Start Besu in dev mode
# ============================================================
# Usage:  ./start.sh          (foreground, Ctrl-C to stop)
#         ./start.sh -d       (background / daemon)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/.env"

DATADIR="$SCRIPT_DIR/data"
PIDFILE="$SCRIPT_DIR/besu.pid"
LOGFILE="$SCRIPT_DIR/besu.log"

mkdir -p "$DATADIR"

# ── Pre-flight checks ───────────────────────────────────────
if ! command -v besu &>/dev/null; then
  echo "ERROR: besu not found. Install: brew install hyperledger/besu/besu"
  exit 1
fi

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Devnet already running (PID $(cat "$PIDFILE")). Use ./stop.sh first."
  exit 1
fi

# ── Besu flags ───────────────────────────────────────────────
HTTP_PORT="${BESU_HTTP_PORT:-${GETH_HTTP_PORT:-8545}}"

BESU_ARGS=(
  --network=dev
  --data-path="$DATADIR"
  --rpc-http-enabled
  --rpc-http-host=0.0.0.0
  --rpc-http-port="$HTTP_PORT"
  --rpc-http-api=ETH,NET,WEB3,TXPOOL,DEBUG,ADMIN,QBFT
  --rpc-http-cors-origins="*"
  --host-allowlist="*"
  --min-gas-price=0
  --miner-enabled
  --miner-coinbase=0x0000000000000000000000000000000000000000
)

# ── Launch ───────────────────────────────────────────────────
if [[ "${1:-}" == "-d" ]]; then
  echo "Starting devnet in background…"
  nohup besu "${BESU_ARGS[@]}" > "$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  sleep 4

  if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "✓ Devnet running  PID=$(cat "$PIDFILE")  RPC=http://127.0.0.1:${HTTP_PORT}"
    echo "  Logs: $LOGFILE"
  else
    echo "ERROR: besu exited immediately. Check $LOGFILE"
    exit 1
  fi
else
  echo "Starting devnet in foreground… (Ctrl-C to stop)"
  echo "  RPC: http://127.0.0.1:${HTTP_PORT}"
  echo "  Data: $DATADIR"
  echo ""
  exec besu "${BESU_ARGS[@]}"
fi
