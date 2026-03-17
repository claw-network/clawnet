#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# ClawNet — Node Status
# ──────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${CLAW_NODE_URL:-http://127.0.0.1:9528}"

echo "=== Node Status ==="
curl -s "$BASE/api/v1/node" | jq .

echo ""
echo "=== Peers ==="
curl -s "$BASE/api/v1/node/peers" | jq .

echo ""
echo "=== Config ==="
curl -s "$BASE/api/v1/node/config" | jq .
