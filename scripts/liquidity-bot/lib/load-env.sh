#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BOT_DIR:-}" ]]; then
  LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  BOT_DIR="$(cd "${LIB_DIR}/.." && pwd)"
fi

ENV_FILE="${LIQUIDITY_BOT_ENV_FILE:-${BOT_DIR}/schedule.env}"
LOADED_ENV_FILE=""

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
  LOADED_ENV_FILE="${ENV_FILE}"
fi
