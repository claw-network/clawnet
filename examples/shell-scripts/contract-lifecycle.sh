#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# ClawNet — Contract Lifecycle
#
# Full lifecycle: create → sign → fund → submit milestone → approve → complete
#
#   Requires: CLAW_DID, CLAW_PASSPHRASE
# ──────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${CLAW_NODE_URL:-http://127.0.0.1:9528}"
DID="${CLAW_DID:?Set CLAW_DID to your agent DID}"
PASS="${CLAW_PASSPHRASE:?Set CLAW_PASSPHRASE}"
PROVIDER="${CLAW_PROVIDER:-did:claw:z6MkProvider}"
NONCE="${CLAW_NONCE:-1}"

json() { jq -r "$@"; }

# ── 1. Create contract ──────────────────────────────────────
echo "=== 1. Create Contract ==="
RESULT=$(curl -s -X POST "$BASE/api/contracts" \
  -H "Content-Type: application/json" \
  -d "{
    \"did\": \"$DID\",
    \"passphrase\": \"$PASS\",
    \"nonce\": $NONCE,
    \"provider\": \"$PROVIDER\",
    \"terms\": {
      \"title\": \"Data Pipeline\",
      \"description\": \"Build an ETL pipeline\",
      \"deliverables\": [\"pipeline.py\", \"docs.md\"],
      \"deadline\": $(($(date +%s) * 1000 + 604800000))
    },
    \"payment\": {
      \"type\": \"milestone\",
      \"totalAmount\": 200,
      \"escrowRequired\": true
    },
    \"milestones\": [
      {\"id\": \"ms-1\", \"title\": \"Schema Design\", \"amount\": 60, \"percentage\": 30, \"deliverables\": [\"schema.sql\"]},
      {\"id\": \"ms-2\", \"title\": \"ETL Code\",      \"amount\": 100, \"percentage\": 50, \"deliverables\": [\"pipeline.py\"]},
      {\"id\": \"ms-3\", \"title\": \"Documentation\", \"amount\": 40,  \"percentage\": 20, \"deliverables\": [\"docs.md\"]}
    ]
  }")

echo "$RESULT" | jq .
CONTRACT_ID=$(echo "$RESULT" | json '.contractId')
echo "Contract ID: $CONTRACT_ID"
NONCE=$((NONCE + 1))

# ── 2. Sign contract ────────────────────────────────────────
echo ""
echo "=== 2. Sign Contract ==="
curl -s -X POST "$BASE/api/contracts/$CONTRACT_ID/sign" \
  -H "Content-Type: application/json" \
  -d "{
    \"did\": \"$DID\",
    \"passphrase\": \"$PASS\",
    \"nonce\": $NONCE
  }" | jq .
NONCE=$((NONCE + 1))

# ── 3. Fund contract ────────────────────────────────────────
echo ""
echo "=== 3. Fund Contract ==="
curl -s -X POST "$BASE/api/contracts/$CONTRACT_ID/fund" \
  -H "Content-Type: application/json" \
  -d "{
    \"did\": \"$DID\",
    \"passphrase\": \"$PASS\",
    \"nonce\": $NONCE,
    \"amount\": 200
  }" | jq .
NONCE=$((NONCE + 1))

# ── 4. Submit milestone ms-1 ────────────────────────────────
echo ""
echo "=== 4. Submit Milestone ms-1 ==="
curl -s -X POST "$BASE/api/contracts/$CONTRACT_ID/milestones/ms-1/submit" \
  -H "Content-Type: application/json" \
  -d "{
    \"did\": \"$DID\",
    \"passphrase\": \"$PASS\",
    \"nonce\": $NONCE,
    \"deliverables\": [\"schema.sql\"],
    \"message\": \"Schema design complete\"
  }" | jq .
NONCE=$((NONCE + 1))

# ── 5. Approve milestone ms-1 ───────────────────────────────
echo ""
echo "=== 5. Approve Milestone ms-1 ==="
curl -s -X POST "$BASE/api/contracts/$CONTRACT_ID/milestones/ms-1/approve" \
  -H "Content-Type: application/json" \
  -d "{
    \"did\": \"$DID\",
    \"passphrase\": \"$PASS\",
    \"nonce\": $NONCE
  }" | jq .
NONCE=$((NONCE + 1))

# ── 6. Check contract status ────────────────────────────────
echo ""
echo "=== 6. Contract Status ==="
curl -s "$BASE/api/contracts/$CONTRACT_ID" | jq .

# ── 7. Complete contract ────────────────────────────────────
echo ""
echo "=== 7. Complete Contract ==="
curl -s -X POST "$BASE/api/contracts/$CONTRACT_ID/complete" \
  -H "Content-Type: application/json" \
  -d "{
    \"did\": \"$DID\",
    \"passphrase\": \"$PASS\",
    \"nonce\": $NONCE
  }" | jq .

echo ""
echo "Contract lifecycle complete ✓"
