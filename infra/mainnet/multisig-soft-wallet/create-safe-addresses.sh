#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OWNERS_ENV="${1:-$REPO_ROOT/infra/testnet/multisig-soft-wallet/.generated/safe-owners.env}"

# Load mainnet secrets (DEPLOYER_PRIVATE_KEY, CLAWNET_RPC_URL, etc.)
SECRETS_ENV="${SECRETS_ENV:-$SCRIPT_DIR/../secrets.env}"
if [[ -f "$SECRETS_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS_ENV"
  set +a
  echo "Loaded secrets from: $SECRETS_ENV"
else
  echo "WARNING: secrets file not found: $SECRETS_ENV"
  echo "DEPLOYER_PRIVATE_KEY will fall back to hardhat default (no funds on mainnet)."
fi

if [[ ! -f "$OWNERS_ENV" ]]; then
  echo "ERROR: owners manifest not found: $OWNERS_ENV"
  echo ""
  echo "Signer wallets are network-independent. Reuse the testnet scripts:"
  echo "  bash infra/testnet/multisig-soft-wallet/create-signer-wallet.sh --name signer1"
  echo "  bash infra/testnet/multisig-soft-wallet/collect-owner-addresses.sh --input ... --input ... --input ..."
  echo ""
  echo "Or provide an existing safe-owners.env:"
  echo "  bash $0 /path/to/safe-owners.env"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERROR: pnpm is required"
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required"
  exit 1
fi

source "$OWNERS_ENV"

if [[ -z "${SAFE_OWNERS_CSV:-}" || -z "${SAFE_THRESHOLD:-}" ]]; then
  echo "ERROR: SAFE_OWNERS_CSV or SAFE_THRESHOLD missing in $OWNERS_ENV"
  exit 1
fi

echo "=== ClawNet Mainnet Safe Creation ==="
echo "Using owners env: $OWNERS_ENV"
echo "SAFE_THRESHOLD=$SAFE_THRESHOLD"
echo "SAFE_OWNERS_CSV=$SAFE_OWNERS_CSV"
echo ""

echo "Step 1/3: deploy Safe core contracts on clawnetMainnet"
pnpm --filter @claw-network/contracts run safe:deploy:mainnet

echo "Step 2/3: create liquidity safe"
pnpm --filter @claw-network/contracts exec env \
  SAFE_LABEL='SAFE_LIQUIDITY_MAINNET' \
  SAFE_OWNERS="$SAFE_OWNERS_CSV" \
  SAFE_THRESHOLD="$SAFE_THRESHOLD" \
  SAFE_NONCE="$(date +%s)" \
  npx hardhat run scripts/create-safe-wallet.ts --network clawnetMainnet

echo "Step 3/3: create reserve safe"
pnpm --filter @claw-network/contracts exec env \
  SAFE_LABEL='SAFE_RESERVE_MAINNET' \
  SAFE_OWNERS="$SAFE_OWNERS_CSV" \
  SAFE_THRESHOLD="$SAFE_THRESHOLD" \
  SAFE_NONCE="$(( $(date +%s) + 1 ))" \
  npx hardhat run scripts/create-safe-wallet.ts --network clawnetMainnet

WALLETS_FILE="$REPO_ROOT/packages/contracts/deployments/safe-wallets-clawnetMainnet.json"
if [[ ! -f "$WALLETS_FILE" ]]; then
  echo "ERROR: safe wallets manifest missing: $WALLETS_FILE"
  exit 1
fi

ADDR_OUTPUT="$(python3 - "$WALLETS_FILE" <<'PY'
import json,sys
path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)
safes = data.get('safes') or []
liq = next((s for s in reversed(safes) if s.get('label') == 'SAFE_LIQUIDITY_MAINNET'), None)
res = next((s for s in reversed(safes) if s.get('label') == 'SAFE_RESERVE_MAINNET'), None)
if not liq or not res:
    raise SystemExit('missing SAFE_LIQUIDITY_MAINNET or SAFE_RESERVE_MAINNET in manifest')
print(liq.get('address'))
print(res.get('address'))
PY
)"

LIQ_ADDR="$(echo "$ADDR_OUTPUT" | sed -n '1p')"
RES_ADDR="$(echo "$ADDR_OUTPUT" | sed -n '2p')"

echo
echo "Safe creation completed."
echo "LIQUIDITY_ADDRESS=$LIQ_ADDR"
echo "RESERVE_ADDRESS=$RES_ADDR"
echo
echo "Paste into infra/mainnet/secrets.env:"
echo "LIQUIDITY_ADDRESS=$LIQ_ADDR"
echo "RESERVE_ADDRESS=$RES_ADDR"
