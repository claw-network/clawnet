#!/usr/bin/env bash
# ============================================================
# ClawNet Local Devnet — Fund deployer from Besu dev account
# ============================================================
# Besu `--network=dev` creates a pre-funded account. This script sends
# ETH from that account to the Hardhat default deployer so
# contract deployment works.
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/.env"

RPC="${CLAWNET_DEVNET_RPC_URL:-http://127.0.0.1:8545}"
DEPLOYER="${DEPLOYER_ADDRESS:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
CHAIN_ID="${CLAWNET_DEVNET_CHAIN_ID:-1337}"
DEV_FUNDER_PRIVATE_KEY="${DEV_FUNDER_PRIVATE_KEY:-0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3}"
DEV_FUNDER_ADDRESS="${DEV_FUNDER_ADDRESS:-0x627306090abaB3A6e1400e9345bC60c78a8BEf57}"
FUND_AMOUNT_WEI="0x56BC75E2D63100000"   # 100 ETH in wei

echo "Funding deployer $DEPLOYER with 100 ETH…"

# Get the dev account (coinbase / first account)
DEV_ACCOUNT=$(curl -s -X POST "$RPC" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_accounts","params":[],"id":1}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print((r.get('result') or [''])[0])")

if [[ -z "$DEV_ACCOUNT" ]]; then
  DEV_ACCOUNT="$DEV_FUNDER_ADDRESS"
fi

echo "Dev account: $DEV_ACCOUNT"

if [[ "$DEV_ACCOUNT" == "$DEV_FUNDER_ADDRESS" ]]; then
  echo "eth_accounts is empty; using signed raw transaction fallback."
  ETHERS_ENTRY="$(find "$REPO_ROOT/node_modules/.pnpm" -path '*node_modules/ethers/lib.esm/index.js' | head -n 1)"
  if [[ -z "$ETHERS_ENTRY" ]]; then
    echo "ERROR: Could not locate ethers in pnpm store. Run pnpm install first."
    exit 1
  fi

  TX_HASH=$(cd "$REPO_ROOT" && RPC="$RPC" CHAIN_ID="$CHAIN_ID" DEPLOYER="$DEPLOYER" FUND_AMOUNT_WEI="$FUND_AMOUNT_WEI" DEV_FUNDER_PRIVATE_KEY="$DEV_FUNDER_PRIVATE_KEY" ETHERS_ENTRY="$ETHERS_ENTRY" node --input-type=module <<'EOF'
import { pathToFileURL } from "node:url";

const { JsonRpcProvider, Wallet } = await import(pathToFileURL(process.env.ETHERS_ENTRY).href);

const provider = new JsonRpcProvider(process.env.RPC, Number(process.env.CHAIN_ID));
const wallet = new Wallet(process.env.DEV_FUNDER_PRIVATE_KEY, provider);

const tx = await wallet.sendTransaction({
  to: process.env.DEPLOYER,
  value: BigInt(process.env.FUND_AMOUNT_WEI),
  gasPrice: 0n,
});

await tx.wait();
console.log(tx.hash);
EOF
)
else
  TX_HASH=$(curl -s -X POST "$RPC" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_sendTransaction\",\"params\":[{\"from\":\"$DEV_ACCOUNT\",\"to\":\"$DEPLOYER\",\"value\":\"$FUND_AMOUNT_WEI\"}],\"id\":2}" \
    | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('result','ERROR: '+str(r.get('error',{}))))")
fi

echo "TX: $TX_HASH"

# Check balance
sleep 1
BALANCE_HEX=$(curl -s -X POST "$RPC" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$DEPLOYER\",\"latest\"],\"id\":3}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])")

BALANCE_ETH=$(python3 -c "print(int('$BALANCE_HEX', 16) / 1e18)")
echo "✓ Deployer balance: $BALANCE_ETH ETH"
