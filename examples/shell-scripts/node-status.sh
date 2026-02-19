#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# ClawToken — Node Status
# ──────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${CLAW_NODE_URL:-http://127.0.0.1:9528}"

echo "=== Node Status ==="
curl -s "$BASE/api/node/status" | jq .

echo ""
echo "=== Peers ==="
curl -s "$BASE/api/node/peers" | jq .

echo ""
echo "=== Config ==="
curl -s "$BASE/api/node/config" | jq .
