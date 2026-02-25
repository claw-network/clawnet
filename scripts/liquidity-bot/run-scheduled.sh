#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

CONFIG_PATH="${LIQUIDITY_BOT_CONFIG:-${SCRIPT_DIR}/config.local.json}"
LOG_DIR="${LIQUIDITY_BOT_LOG_DIR:-${SCRIPT_DIR}/logs}"

if [[ "${1:-}" != "" && "${1:0:2}" != "--" ]]; then
  CONFIG_PATH="$1"
  shift
fi

mkdir -p "${LOG_DIR}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
LOG_FILE="${LOG_DIR}/run-${STAMP}.log"

{
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] liquidity-bot scheduled run start"
  echo "root: ${ROOT_DIR}"
  echo "config: ${CONFIG_PATH}"
  echo "args: $*"
  cd "${ROOT_DIR}"
  node "${SCRIPT_DIR}/run-once.mjs" --config "${CONFIG_PATH}" "$@"
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] liquidity-bot scheduled run finish"
} >>"${LOG_FILE}" 2>&1

echo "liquidity-bot finished; log: ${LOG_FILE}"
