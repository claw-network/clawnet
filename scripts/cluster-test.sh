#!/usr/bin/env bash
set -euo pipefail
#
# scripts/cluster-test.sh — Spin up 3-node testnet, run all cluster tests, tear down
#
# Automatically starts the Docker runtime (Colima on Intel Mac, OrbStack on
# Apple Silicon), builds the 3-node testnet, runs integration & partition tests,
# then tears everything down to save resources.
#
# Usage:
#   ./scripts/cluster-test.sh                 # run all cluster tests
#   ./scripts/cluster-test.sh integration     # integration tests only
#   ./scripts/cluster-test.sh partition       # partition tests only
#   ./scripts/cluster-test.sh --keep          # don't stop runtime after tests
#   ./scripts/cluster-test.sh --verbose       # verbose test output
#

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.testnet.yml"

# ── colours ─────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD="\033[1m" DIM="\033[2m" RED="\033[31m" GREEN="\033[32m"
  YELLOW="\033[33m" CYAN="\033[36m" RESET="\033[0m"
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi

info()  { echo -e "${CYAN}ℹ${RESET}  $*"; }
ok()    { echo -e "${GREEN}✔${RESET}  $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET}  $*"; }
fail()  { echo -e "${RED}✗${RESET}  $*"; exit 1; }

# ── parse args ──────────────────────────────────────────────────
SUITE="all"
KEEP=false
VERBOSE=""
for arg in "$@"; do
  case "$arg" in
    integration) SUITE="integration" ;;
    partition)   SUITE="partition" ;;
    all)         SUITE="all" ;;
    --keep)      KEEP=true ;;
    --verbose|-v) VERBOSE="--verbose" ;;
    --help|-h)
      echo "Usage: $0 [integration|partition|all] [--keep] [--verbose]"
      echo ""
      echo "  integration   Run integration tests only"
      echo "  partition     Run partition/BFT tests only"
      echo "  all           Run both (default)"
      echo "  --keep        Don't stop Docker runtime after tests"
      echo "  --verbose     Verbose test output"
      exit 0
      ;;
    *) fail "Unknown argument: $arg" ;;
  esac
done

# ── detect compose command ──────────────────────────────────────
detect_compose() {
  if docker compose version &>/dev/null; then
    echo "docker compose"
  elif command -v docker-compose &>/dev/null; then
    echo "docker-compose"
  else
    fail "Neither 'docker compose' nor 'docker-compose' found. Install docker-compose."
  fi
}

# ── detect & start Docker runtime ───────────────────────────────
RUNTIME=""
RUNTIME_STARTED=false

start_runtime() {
  # Already running?
  if docker info &>/dev/null; then
    ok "Docker daemon already running"
    # Detect which runtime
    local ctx
    ctx=$(docker context show 2>/dev/null || true)
    if [[ "$ctx" == colima* ]]; then
      RUNTIME="colima"
    elif [ -d "/Applications/OrbStack.app" ]; then
      RUNTIME="orbstack"
    else
      RUNTIME="unknown"
    fi
    return 0
  fi

  local arch
  arch=$(uname -m)

  # Try OrbStack on Apple Silicon
  if [[ "$arch" == "arm64" ]] && [ -d "/Applications/OrbStack.app" ]; then
    RUNTIME="orbstack"
    info "Starting OrbStack..."
    open -a OrbStack
    echo -n "   Waiting for Docker daemon"
    local retries=0
    while ! docker info &>/dev/null; do
      echo -n "."
      sleep 2
      retries=$((retries + 1))
      [[ $retries -lt 30 ]] || { echo ""; fail "Timed out waiting for OrbStack Docker daemon."; }
    done
    echo ""
    RUNTIME_STARTED=true
    ok "OrbStack Docker daemon ready"
    return 0
  fi

  # Try Colima (Intel Mac or fallback)
  if command -v colima &>/dev/null; then
    RUNTIME="colima"
    info "Starting Colima..."
    colima start --cpu 4 --memory 8 --disk 60
    RUNTIME_STARTED=true
    ok "Colima Docker daemon ready"
    return 0
  fi

  fail "No Docker runtime found. Run: ./scripts/setup-ci-local.sh"
}

stop_runtime() {
  if [[ "$KEEP" == true ]]; then
    info "Keeping Docker runtime running (--keep)"
    return 0
  fi
  if [[ "$RUNTIME_STARTED" == false ]]; then
    info "Docker runtime was already running before tests — leaving it up"
    return 0
  fi

  info "Stopping Docker runtime to save resources..."
  case "$RUNTIME" in
    colima)
      colima stop
      ok "Colima stopped"
      ;;
    orbstack)
      osascript -e 'quit app "OrbStack"' 2>/dev/null || true
      ok "OrbStack stopped"
      ;;
    *)
      info "Unknown runtime — skipping shutdown"
      ;;
  esac
}

# ── testnet lifecycle ───────────────────────────────────────────
COMPOSE_CMD=""

start_testnet() {
  COMPOSE_CMD=$(detect_compose)
  info "Building & starting 3-node testnet..."
  $COMPOSE_CMD -f "$COMPOSE_FILE" up --build -d

  info "Waiting for all nodes to become healthy..."
  local retries=0
  while true; do
    local healthy
    healthy=$($COMPOSE_CMD -f "$COMPOSE_FILE" ps 2>/dev/null | grep -c "(healthy)" || echo 0)
    if [[ "$healthy" -ge 3 ]]; then
      break
    fi
    retries=$((retries + 1))
    if [[ $retries -ge 60 ]]; then
      warn "Timed out waiting for nodes. Continuing anyway..."
      break
    fi
    sleep 3
  done
  ok "Testnet is up (3 nodes)"
}

stop_testnet() {
  if [[ -n "$COMPOSE_CMD" ]]; then
    info "Tearing down testnet..."
    $COMPOSE_CMD -f "$COMPOSE_FILE" down -v 2>/dev/null || true
    ok "Testnet stopped"
  fi
}

# ── run tests ───────────────────────────────────────────────────
EXIT_CODE=0

run_integration() {
  echo ""
  echo -e "${BOLD}━━━ Integration Tests ━━━${RESET}"
  echo ""
  if node "$REPO_ROOT/scripts/integration-test.mjs" $VERBOSE; then
    ok "Integration tests passed"
  else
    warn "Integration tests had failures"
    EXIT_CODE=1
  fi
}

run_partition() {
  echo ""
  echo -e "${BOLD}━━━ Network Partition / BFT Tests ━━━${RESET}"
  echo ""
  if node "$REPO_ROOT/scripts/partition-test.mjs" $VERBOSE; then
    ok "Partition tests passed"
  else
    warn "Partition tests had failures"
    EXIT_CODE=1
  fi
}

# ── main ────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${BOLD}ClawNet — Cluster Test Runner${RESET}"
  echo -e "${DIM}$(uname -m) / macOS $(sw_vers -productVersion 2>/dev/null || echo '?')${RESET}"
  echo ""

  # Phase 1: Start runtime
  start_runtime

  # Phase 2: Start testnet
  # (use trap to ensure cleanup on any exit)
  trap 'stop_testnet; stop_runtime' EXIT
  start_testnet

  # Phase 3: Run tests
  case "$SUITE" in
    integration) run_integration ;;
    partition)   run_partition ;;
    all)
      run_integration
      run_partition
      ;;
  esac

  # Phase 4: Cleanup (handled by trap)
  echo ""
  if [[ $EXIT_CODE -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}All tests passed!${RESET}"
  else
    echo -e "${RED}${BOLD}Some tests failed.${RESET}"
  fi

  exit $EXIT_CODE
}

main
