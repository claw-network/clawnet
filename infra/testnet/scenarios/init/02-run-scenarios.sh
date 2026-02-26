#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SCENARIO_DIR="${REPO_ROOT}/infra/testnet/scenarios"

cp "${SCRIPT_DIR}/scenarios.env" "${SCENARIO_DIR}/.env"

cd "${SCENARIO_DIR}"
node run-tests.mjs --verbose
