#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# ClawNet — Wallet Operations
#
# Write operations (transfer, escrow) are settled on-chain via
# the node's WalletService → ClawToken / ClawEscrow contracts.
# Read operations (balance) come from chain view functions or
# the Event Indexer.  The REST interface is unchanged.
#
#   Requires: CLAW_DID, CLAW_PASSPHRASE
# ──────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${CLAW_NODE_URL:-http://127.0.0.1:9528}"
DID="${CLAW_DID:?Set CLAW_DID to your agent DID}"
PASS="${CLAW_PASSPHRASE:?Set CLAW_PASSPHRASE}"
ADDRESS="${CLAW_ADDRESS:?Set CLAW_ADDRESS to your wallet address}"
NONCE="${CLAW_NONCE:-1}"

# ── Check balance ───────────────────────────────────────────
echo "=== Wallet Balance ==="
curl -s "$BASE/api/v1/wallets/$ADDRESS" | jq .

# ── Transfer tokens ─────────────────────────────────────────
echo ""
echo "=== Transfer 10 Tokens ==="
RECIPIENT="${CLAW_RECIPIENT:-did:claw:z6MkRecipient}"

curl -s -X POST "$BASE/api/v1/transfers" \
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
curl -s "$BASE/api/v1/wallets/$ADDRESS/transactions?limit=5" | jq .

# ── Create escrow ───────────────────────────────────────────
echo ""
echo "=== Create Escrow ==="
NONCE=$((NONCE + 1))

curl -s -X POST "$BASE/api/v1/escrows" \
  -H "Content-Type: application/json" \
  -d "{
    \"did\": \"$DID\",
    \"passphrase\": \"$PASS\",
    \"nonce\": $NONCE,
    \"beneficiary\": \"$RECIPIENT\",
    \"amount\": 50,
    \"releaseRules\": [{\"type\": \"manual\"}]
  }" | jq .
