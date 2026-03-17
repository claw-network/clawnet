#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${BOT_DIR}/lib/load-env.sh"
ROOT_DIR="${ROOT:-$(cd "${BOT_DIR}/../.." && pwd)}"

REPORT_SOURCE_LOG_DIR="${LIQUIDITY_REPORT_SOURCE_LOG_DIR:-${LIQUIDITY_BOT_LOG_DIR:-${BOT_DIR}/logs}}"
REPORT_STORE_ROOT="${LIQUIDITY_REPORT_STORE_DIR:-${BOT_DIR}/reports}"
REPORT_STORE_DIR="${LIQUIDITY_MONTHLY_REPORT_STORE_DIR:-${REPORT_STORE_ROOT}/monthly}"
REPORT_PATTERN="${LIQUIDITY_REPORT_PATTERN:-reserve-compensation}"
REPORT_INCLUDE_DRY_RUN="${LIQUIDITY_REPORT_INCLUDE_DRY_RUN:-false}"
SCHEDULER_LOG_DIR="${LIQUIDITY_REPORT_SCHEDULER_LOG_DIR:-${BOT_DIR}/logs}"

DEFAULT_ANCHOR_DATE_UTC="$(node -e "const d=new Date(); d.setUTCMonth(d.getUTCMonth()-1); console.log(d.toISOString().slice(0,10));")"
ANCHOR_DATE_UTC="${LIQUIDITY_MONTHLY_ANCHOR_DATE_UTC:-${DEFAULT_ANCHOR_DATE_UTC}}"

# Allow overriding store dir as first positional arg.
if [[ "${1:-}" != "" && "${1:0:2}" != "--" ]]; then
  REPORT_STORE_DIR="$1"
  shift
fi

mkdir -p "${REPORT_STORE_DIR}"
mkdir -p "${SCHEDULER_LOG_DIR}"

OUTPUT_BASE="${LIQUIDITY_MONTHLY_REPORT_OUTPUT_BASE:-${REPORT_STORE_DIR}/reserve-monthly-${ANCHOR_DATE_UTC}}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
RUN_LOG_FILE="${SCHEDULER_LOG_DIR}/monthly-report-${STAMP}.log"

{
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] reserve monthly report run start"
  echo "env_file: ${LOADED_ENV_FILE:-none}"
  echo "root: ${ROOT_DIR}"
  echo "source_logs: ${REPORT_SOURCE_LOG_DIR}"
  echo "store_dir: ${REPORT_STORE_DIR}"
  echo "anchor_date_utc: ${ANCHOR_DATE_UTC}"
  echo "include_dry_run: ${REPORT_INCLUDE_DRY_RUN}"
  echo "pattern: ${REPORT_PATTERN}"
  echo "output_base: ${OUTPUT_BASE}"
  echo "args: $*"
  cd "${ROOT_DIR}"
  node "${BOT_DIR}/cli/reserve-period-report.mjs" \
    --period month \
    --anchor-date "${ANCHOR_DATE_UTC}" \
    --log-dir "${REPORT_SOURCE_LOG_DIR}" \
    --pattern "${REPORT_PATTERN}" \
    --include-dry-run "${REPORT_INCLUDE_DRY_RUN}" \
    --output "${OUTPUT_BASE}" \
    "$@"
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] reserve monthly report run finish"
} >>"${RUN_LOG_FILE}" 2>&1

echo "reserve monthly report finished; log: ${RUN_LOG_FILE}"
echo "report files: ${OUTPUT_BASE}.json , ${OUTPUT_BASE}.csv"
