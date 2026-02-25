#!/usr/bin/env bash
# ============================================================
# ClawNet Local Devnet — Start geth in dev mode
# ============================================================
# Usage:  ./start.sh          (foreground, Ctrl-C to stop)
#         ./start.sh -d       (background / daemon)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/.env"

DATADIR="$SCRIPT_DIR/data"
PIDFILE="$SCRIPT_DIR/geth.pid"
LOGFILE="$SCRIPT_DIR/geth.log"

mkdir -p "$DATADIR"

# ── Pre-flight checks ───────────────────────────────────────
if ! command -v geth &>/dev/null; then
  echo "ERROR: geth not found. Install: brew install ethereum"
  exit 1
fi

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Devnet already running (PID $(cat "$PIDFILE")). Use ./stop.sh first."
  exit 1
fi

# ── Geth flags ───────────────────────────────────────────────
GETH_ARGS=(
  --dev
  --dev.period "${GETH_DEV_PERIOD:-0}"
  --dev.gaslimit "${GETH_DEV_GASLIMIT:-30000000}"
  --datadir "$DATADIR"
  --http
  --http.addr 0.0.0.0
  --http.port "${GETH_HTTP_PORT:-8545}"
  --http.api eth,net,web3,txpool,debug,admin,personal
  --http.corsdomain "*"
  --http.vhosts "*"
  --networkid "${CLAWNET_DEVNET_CHAIN_ID:-1337}"
  --verbosity 3
)

# ── Launch ───────────────────────────────────────────────────
if [[ "${1:-}" == "-d" ]]; then
  echo "Starting devnet in background…"
  nohup geth "${GETH_ARGS[@]}" > "$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  sleep 2

  if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "✓ Devnet running  PID=$(cat "$PIDFILE")  RPC=http://127.0.0.1:${GETH_HTTP_PORT:-8545}"
    echo "  Logs: $LOGFILE"
  else
    echo "ERROR: geth exited immediately. Check $LOGFILE"
    exit 1
  fi
else
  echo "Starting devnet in foreground… (Ctrl-C to stop)"
  echo "  RPC: http://127.0.0.1:${GETH_HTTP_PORT:-8545}"
  echo "  Data: $DATADIR"
  echo ""
  exec geth "${GETH_ARGS[@]}"
fi
