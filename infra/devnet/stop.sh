#!/usr/bin/env bash
# ============================================================
# ClawNet Local Devnet — Stop Besu
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$SCRIPT_DIR/besu.pid"

if [[ ! -f "$PIDFILE" ]]; then
  echo "No PID file found. Devnet may not be running."
  # Try to kill by process name as fallback
  pkill -f "besu.*--data-path=$SCRIPT_DIR/data" 2>/dev/null && echo "Killed Besu by pattern." || echo "Nothing to stop."
  exit 0
fi

PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
  echo "Stopping devnet (PID $PID)…"
  kill "$PID"
  # Wait up to 10s for graceful shutdown
  for i in $(seq 1 10); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "Force killing…"
    kill -9 "$PID"
  fi
  echo "✓ Devnet stopped."
else
  echo "Process $PID not running."
fi

rm -f "$PIDFILE"
