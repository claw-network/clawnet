#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# ClawToken — Wallet Operations
#
#   Requires: CLAW_DID, CLAW_PASSPHRASE
# ──────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${CLAW_NODE_URL:-http://127.0.0.1:9528}"
DID="${CLAW_DID:?Set CLAW_DID to your agent DID}"
PASS="${CLAW_PASSPHRASE:?Set CLAW_PASSPHRASE}"
NONCE="${CLAW_NONCE:-1}"

# ── Check balance ───────────────────────────────────────────
echo "=== Wallet Balance ==="
curl -s "$BASE/api/wallet/balance" | jq .

# ── Transfer tokens ─────────────────────────────────────────
echo ""
echo "=== Transfer 10 CLAW ==="
RECIPIENT="${CLAW_RECIPIENT:-did:claw:z6MkRecipient}"

curl -s -X POST "$BASE/api/wallet/transfer" \
  -H "Content-Type: application/json" \
  -d "{
    \"did\": \"$DID\",
    \"passphrase\": \"$PASS\",
    \"nonce\": $NONCE,
    \"to\": \"$RECIPIENT\",
    \"amount\": 10,
    \"memo\": \"Shell script transfer\"
  }" | jq .

# ── Transaction history ─────────────────────────────────────
echo ""
echo "=== Recent Transactions ==="
curl -s "$BASE/api/wallet/history?limit=5" | jq .

# ── Create escrow ───────────────────────────────────────────
echo ""
echo "=== Create Escrow ==="
NONCE=$((NONCE + 1))

curl -s -X POST "$BASE/api/wallet/escrow" \
  -H "Content-Type: application/json" \
  -d "{
    \"did\": \"$DID\",
    \"passphrase\": \"$PASS\",
    \"nonce\": $NONCE,
    \"beneficiary\": \"$RECIPIENT\",
    \"amount\": 50,
    \"releaseRules\": [{\"type\": \"manual\"}]
  }" | jq .
