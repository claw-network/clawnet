#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_ROOT="$SCRIPT_DIR/.generated"
THRESHOLD=2
INPUT_FILES=()

usage() {
  cat <<'EOF'
Usage:
  bash infra/testnet/multisig-soft-wallet/collect-owner-addresses.sh \
    --input <public-info.txt> --input <public-info.txt> --input <public-info.txt> [--threshold 2]

Example:
  bash infra/testnet/multisig-soft-wallet/collect-owner-addresses.sh \
    --input infra/testnet/multisig-soft-wallet/.generated/signer1/public-info.txt \
    --input infra/testnet/multisig-soft-wallet/.generated/signer2/public-info.txt \
    --input infra/testnet/multisig-soft-wallet/.generated/signer3/public-info.txt \
    --threshold 2
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input)
      INPUT_FILES+=("${2:-}")
      shift 2
      ;;
    --threshold)
      THRESHOLD="${2:-}"
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

if [[ ${#INPUT_FILES[@]} -lt 3 ]]; then
  echo "ERROR: at least 3 --input files are required"
  exit 1
fi

if [[ ! "$THRESHOLD" =~ ^[0-9]+$ ]] || [[ "$THRESHOLD" -lt 2 ]]; then
  echo "ERROR: --threshold must be an integer >= 2"
  exit 1
fi

mkdir -p "$OUT_ROOT"

ADDRESSES=()
for f in "${INPUT_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: file not found: $f" >&2
    exit 1
  fi
  addr="$(grep '^SIGNER_ADDRESS=' "$f" | sed 's/^SIGNER_ADDRESS=//' | tr -d '[:space:]')"
  if [[ -z "$addr" ]]; then
    echo "ERROR: SIGNER_ADDRESS missing in: $f" >&2
    exit 1
  fi
  ADDRESSES+=("$addr")
done

for addr in "${ADDRESSES[@]}"; do
  if [[ ! "$addr" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    echo "ERROR: invalid address format: $addr"
    exit 1
  fi
done

UNIQUE_ADDRESSES=()
while IFS= read -r line; do
  [[ -n "$line" ]] && UNIQUE_ADDRESSES+=("$line")
done < <(printf '%s\n' "${ADDRESSES[@]}" | awk '!seen[tolower($0)]++')
if [[ ${#UNIQUE_ADDRESSES[@]} -ne ${#ADDRESSES[@]} ]]; then
  echo "ERROR: duplicate signer addresses detected"
  printf 'Input addresses:\n'
  printf '  %s\n' "${ADDRESSES[@]}"
  exit 1
fi

if [[ "$THRESHOLD" -gt ${#UNIQUE_ADDRESSES[@]} ]]; then
  echo "ERROR: threshold ($THRESHOLD) cannot exceed owners count (${#UNIQUE_ADDRESSES[@]})"
  exit 1
fi

OUT_FILE="$OUT_ROOT/safe-owners.env"
{
  echo "# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "SAFE_THRESHOLD=$THRESHOLD"
  idx=1
  for addr in "${UNIQUE_ADDRESSES[@]}"; do
    echo "SAFE_OWNER_${idx}_ADDRESS=$addr"
    idx=$((idx + 1))
  done
  csv="$(IFS=, ; echo "${UNIQUE_ADDRESSES[*]}")"
  echo "SAFE_OWNERS_CSV=$csv"
} > "$OUT_FILE"

echo "Safe owner manifest generated: $OUT_FILE"
echo "Owners: ${#UNIQUE_ADDRESSES[@]}, Threshold: $THRESHOLD"
