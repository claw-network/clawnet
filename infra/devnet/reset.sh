#!/usr/bin/env bash
# ============================================================
# ClawNet Local Devnet — Reset (wipe data and restart)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Resetting devnet…"

# Stop if running
"$SCRIPT_DIR/stop.sh"

# Wipe chain data
rm -rf "$SCRIPT_DIR/data"
rm -f "$SCRIPT_DIR/geth.log"

echo "✓ Data wiped. Run ./start.sh to start fresh."
