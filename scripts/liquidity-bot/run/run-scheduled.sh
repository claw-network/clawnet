#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${BOT_DIR}/lib/load-env.sh"
ROOT_DIR="${ROOT:-$(cd "${BOT_DIR}/../.." && pwd)}"

CONFIG_PATH="${LIQUIDITY_BOT_CONFIG:-${BOT_DIR}/config.local.json}"
LOG_DIR="${LIQUIDITY_BOT_LOG_DIR:-${BOT_DIR}/logs}"

if [[ "${1:-}" != "" && "${1:0:2}" != "--" ]]; then
  CONFIG_PATH="$1"
  shift
fi

mkdir -p "${LOG_DIR}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
LOG_FILE="${LOG_DIR}/run-${STAMP}.log"

{
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] liquidity-bot scheduled run start"
  echo "env_file: ${LOADED_ENV_FILE:-none}"
  echo "root: ${ROOT_DIR}"
  echo "config: ${CONFIG_PATH}"
  echo "args: $*"
  cd "${ROOT_DIR}"
  node "${BOT_DIR}/cli/run-once.mjs" --config "${CONFIG_PATH}" "$@"
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] liquidity-bot scheduled run finish"
} >>"${LOG_FILE}" 2>&1

echo "liquidity-bot finished; log: ${LOG_FILE}"
