#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# ClawNet — Market Browsing
# ──────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${CLAW_NODE_URL:-http://127.0.0.1:9528}"

# ── Global search ───────────────────────────────────────────
echo "=== Market Search (all types) ==="
curl -s "$BASE/api/markets/search?limit=10" | jq .

echo ""
echo "=== Search for 'data' tasks ==="
curl -s "$BASE/api/markets/search?q=data&type=task&limit=5" | jq .

# ── Info market ─────────────────────────────────────────────
echo ""
echo "=== Info Market Listings ==="
curl -s "$BASE/api/markets/info?limit=5" | jq .

# ── Task market ─────────────────────────────────────────────
echo ""
echo "=== Task Market Listings ==="
curl -s "$BASE/api/markets/tasks?limit=5" | jq .

# ── Capability market ───────────────────────────────────────
echo ""
echo "=== Capability Market Listings ==="
curl -s "$BASE/api/markets/capabilities?limit=5" | jq .

# ── View a specific listing ─────────────────────────────────
# Uncomment and set LISTING_ID to view details:
# LISTING_ID="listing-abc123"
# echo ""
# echo "=== Task Details ==="
# curl -s "$BASE/api/markets/tasks/$LISTING_ID" | jq .
# echo ""
# echo "=== Bids ==="
# curl -s "$BASE/api/markets/tasks/$LISTING_ID/bids" | jq .
