#!/usr/bin/env bash
set -euo pipefail
#
# scripts/ci-local.sh — Run GitHub Actions workflows locally via `act` + Docker.
#
# Usage:
#   ./scripts/ci-local.sh              # run the main CI workflow (ci.yml)
#   ./scripts/ci-local.sh contracts    # run just the contracts workflow
#   ./scripts/ci-local.sh test         # run the weekly test workflow
#   ./scripts/ci-local.sh all          # run ci + contracts
#   ./scripts/ci-local.sh --list       # list available workflows
#
# Requirements:
#   - Docker (OrbStack / Docker Desktop / Colima)
#   - act  (brew install act)
#

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW_DIR="$REPO_ROOT/.github/workflows"

# ── colours ─────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD="\033[1m" DIM="\033[2m" RED="\033[31m" GREEN="\033[32m"
  YELLOW="\033[33m" CYAN="\033[36m" RESET="\033[0m"
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" CYAN="" RESET=""
fi

# ── preflight checks ───────────────────────────────────────────
check_prereqs() {
  local missing=0
  if ! command -v docker &>/dev/null; then
    echo -e "${RED}✗ docker not found.${RESET} Install OrbStack or Docker Desktop."
    missing=1
  elif ! docker info >/dev/null 2>&1; then
    echo -e "${RED}✗ Docker daemon not running.${RESET} Start OrbStack / Docker Desktop."
    missing=1
  fi
  if ! command -v act &>/dev/null; then
    echo -e "${RED}✗ act not found.${RESET} Install with: brew install act"
    missing=1
  fi
  if [ $missing -eq 1 ]; then
    exit 1
  fi
}

# ── run one workflow ────────────────────────────────────────────
run_workflow() {
  local name="$1"
  local file="$WORKFLOW_DIR/${name}.yml"

  if [ ! -f "$file" ]; then
    echo -e "${RED}✗ Workflow not found: ${file}${RESET}"
    return 1
  fi

  echo ""
  echo -e "${BOLD}${CYAN}▶ Running workflow: ${name}${RESET}"
  echo -e "${DIM}  File: .github/workflows/${name}.yml${RESET}"
  echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

  local start_time
  start_time=$(date +%s)

  # Run act with push event; pass through to terminal for live output
  if act push \
    -W "$file" \
    --artifact-server-path /tmp/act-artifacts \
    2>&1 | while IFS= read -r line; do
      # Highlight step markers for readability
      if [[ "$line" == *"⭐ Run"* ]] || [[ "$line" == *"✅ "* ]]; then
        echo -e "  ${GREEN}${line}${RESET}"
      elif [[ "$line" == *"❌ "* ]] || [[ "$line" == *"::error"* ]]; then
        echo -e "  ${RED}${line}${RESET}"
      else
        echo "  $line"
      fi
    done; then
    local end_time elapsed
    end_time=$(date +%s)
    elapsed=$((end_time - start_time))
    echo -e "${GREEN}${BOLD}✅ ${name} passed${RESET} ${DIM}(${elapsed}s)${RESET}"
    return 0
  else
    local end_time elapsed
    end_time=$(date +%s)
    elapsed=$((end_time - start_time))
    echo -e "${RED}${BOLD}❌ ${name} FAILED${RESET} ${DIM}(${elapsed}s)${RESET}"
    return 1
  fi
}

# ── list available workflows ────────────────────────────────────
list_workflows() {
  echo -e "${BOLD}Available workflows:${RESET}"
  for f in "$WORKFLOW_DIR"/*.yml; do
    local base
    base=$(basename "$f" .yml)
    local wf_name
    wf_name=$(head -5 "$f" | grep '^name:' | sed 's/^name: *//')
    echo -e "  ${CYAN}${base}${RESET}  →  ${wf_name}"
  done
  echo ""
  echo -e "Usage: ${DIM}./scripts/ci-local.sh <workflow-name>${RESET}"
  echo -e "       ${DIM}./scripts/ci-local.sh all${RESET}  (runs ci + contracts)"
}

# ── main ────────────────────────────────────────────────────────
main() {
  check_prereqs

  local target="${1:-ci}"

  case "$target" in
    --list|-l|list)
      list_workflows
      exit 0
      ;;
    --help|-h|help)
      echo "Usage: $0 [ci|contracts|test|release|all|--list]"
      exit 0
      ;;
    all)
      local failed=0
      for wf in ci contracts; do
        run_workflow "$wf" || failed=$((failed + 1))
      done
      echo ""
      if [ $failed -gt 0 ]; then
        echo -e "${RED}${BOLD}$failed workflow(s) failed.${RESET}"
        exit 1
      else
        echo -e "${GREEN}${BOLD}All workflows passed!${RESET}"
        exit 0
      fi
      ;;
    *)
      run_workflow "$target"
      ;;
  esac
}

main "$@"
