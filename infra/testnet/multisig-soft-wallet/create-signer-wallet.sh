#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_ROOT="$SCRIPT_DIR/.generated"
SIGNER_NAME=""

usage() {
  cat <<'EOF'
Usage:
  bash infra/testnet/multisig-soft-wallet/create-signer-wallet.sh --name <signer-name> [--out <dir>]

Example:
  bash infra/testnet/multisig-soft-wallet/create-signer-wallet.sh --name signer1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      SIGNER_NAME="${2:-}"
      shift 2
      ;;
    --out)
      OUT_ROOT="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$SIGNER_NAME" ]]; then
  echo "ERROR: --name is required"
  usage
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required"
  exit 1
fi

SIGNER_DIR="$OUT_ROOT/$SIGNER_NAME"
KEYSTORE_DIR="$SIGNER_DIR/keystore"
PUBLIC_INFO_FILE="$SIGNER_DIR/public-info.txt"

mkdir -p "$KEYSTORE_DIR"

echo "Creating signer wallet for: $SIGNER_NAME"
echo "Output directory: $SIGNER_DIR"

read -r -s -p "Enter wallet passphrase: " PASS_1
echo
read -r -s -p "Confirm wallet passphrase: " PASS_2
echo

if [[ -z "$PASS_1" ]]; then
  echo "ERROR: passphrase cannot be empty"
  exit 1
fi
if [[ "$PASS_1" != "$PASS_2" ]]; then
  echo "ERROR: passphrases do not match"
  exit 1
fi

PASS_FILE="$(mktemp)"
trap 'rm -f "$PASS_FILE"' EXIT
printf '%s' "$PASS_1" > "$PASS_FILE"

docker run --rm \
  -v "$KEYSTORE_DIR:/wallet" \
  -v "$PASS_FILE:/password.txt:ro" \
  ethereum/client-go:v1.13.15 \
  account new --datadir /wallet --password /password.txt >/dev/null

KEYFILE_PATH="$(ls -1 "$KEYSTORE_DIR/keystore" | head -n1 || true)"
if [[ -z "$KEYFILE_PATH" ]]; then
  echo "ERROR: failed to create keystore file"
  exit 1
fi

ADDRESS_HEX="${KEYFILE_PATH##*--}"
ADDRESS="0x$ADDRESS_HEX"

if [[ ! "$ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "ERROR: invalid address extracted from keystore file: $ADDRESS"
  exit 1
fi

cat > "$PUBLIC_INFO_FILE" <<EOF
SIGNER_NAME=$SIGNER_NAME
SIGNER_ADDRESS=$ADDRESS
CREATED_AT_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo
echo "Wallet created successfully."
echo "Signer address: $ADDRESS"
echo "Public info file: $PUBLIC_INFO_FILE"
echo "Keystore file: $KEYSTORE_DIR/keystore/$KEYFILE_PATH"
echo
echo "Share only public-info.txt with coordinator."
echo "Do NOT share keystore file or passphrase."
