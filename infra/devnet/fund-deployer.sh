#!/usr/bin/env bash
# ============================================================
# ClawNet Local Devnet — Fund deployer from geth dev account
# ============================================================
# geth --dev creates a pre-funded account. This script sends
# ETH from that account to the Hardhat default deployer so
# contract deployment works.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/.env"

RPC="${CLAWNET_DEVNET_RPC_URL:-http://127.0.0.1:8545}"
DEPLOYER="${DEPLOYER_ADDRESS:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
FUND_AMOUNT_WEI="0x56BC75E2D63100000"   # 100 ETH in wei

echo "Funding deployer $DEPLOYER with 100 ETH…"

# Get the dev account (coinbase / first account)
DEV_ACCOUNT=$(curl -s -X POST "$RPC" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":1}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['result'][0])")

if [[ -z "$DEV_ACCOUNT" ]]; then
  echo "ERROR: Could not get dev account. Is geth running?"
  exit 1
fi

echo "Dev account: $DEV_ACCOUNT"

# Send ETH from dev account to deployer
TX_HASH=$(curl -s -X POST "$RPC" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"$DEV_ACCOUNT\",\"to\":\"$DEPLOYER\",\"value\":\"$FUND_AMOUNT_WEI\"}],\"id\":2}" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('result','ERROR: '+str(r.get('error',{}))))")

echo "TX: $TX_HASH"

# Check balance
sleep 1
BALANCE_HEX=$(curl -s -X POST "$RPC" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$DEPLOYER\",\"latest\"],\"id\":3}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])")

BALANCE_ETH=$(python3 -c "print(int('$BALANCE_HEX', 16) / 1e18)")
echo "✓ Deployer balance: $BALANCE_ETH ETH"
