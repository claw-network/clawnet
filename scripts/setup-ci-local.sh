#!/usr/bin/env bash
set -euo pipefail
#
# scripts/setup-ci-local.sh — Install local CI prerequisites (act + Docker runtime)
#
# Usage:
#   ./scripts/setup-ci-local.sh              # auto-detect best runtime
#   ./scripts/setup-ci-local.sh orbstack     # force OrbStack (Apple Silicon / macOS 13+)
#   ./scripts/setup-ci-local.sh colima       # force Colima   (Intel Mac / macOS 10.15+)
#
# After setup, run:
#   ./scripts/ci-local.sh          # execute GitHub Actions locally
#

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

# ── preflight ───────────────────────────────────────────────────
[[ "$(uname)" == "Darwin" ]] || fail "This script is for macOS only."
command -v brew &>/dev/null || fail "Homebrew not found. Install from https://brew.sh"

# ── detect environment ──────────────────────────────────────────
ARCH=$(uname -m)                       # arm64 or x86_64
MACOS_VER=$(sw_vers -productVersion)   # e.g. 15.3.1
MACOS_MAJOR=${MACOS_VER%%.*}           # e.g. 15

detect_runtime() {
  if [[ "$ARCH" == "arm64" && "$MACOS_MAJOR" -ge 13 ]]; then
    echo "orbstack"
  else
    echo "colima"
  fi
}

# ── install act ─────────────────────────────────────────────────
install_act() {
  if command -v act &>/dev/null; then
    ok "act already installed ($(act --version))"
  else
    info "Installing act..."
    brew install act
    ok "act installed ($(act --version))"
  fi
}

# ── fix Docker credential helper ────────────────────────────────
# Docker Desktop installs "credsStore": "desktop" in ~/.docker/config.json.
# When using Colima (no Docker Desktop), docker-credential-desktop is missing,
# causing `act` (and docker pull) to fail. Remove the stale credsStore entry.
fix_docker_creds_store() {
  local cfg="$HOME/.docker/config.json"
  if [[ ! -f "$cfg" ]]; then
    return 0
  fi

  local creds_store
  creds_store=$(python3 -c "import json; c=json.load(open('$cfg')); print(c.get('credsStore',''))" 2>/dev/null || true)

  if [[ "$creds_store" == "desktop" ]]; then
    if ! command -v docker-credential-desktop &>/dev/null; then
      info "Removing stale \"credsStore\": \"desktop\" from ~/.docker/config.json ..."
      python3 -c "
import json, os
cfg_path = os.path.expanduser('~/.docker/config.json')
with open(cfg_path) as f:
    cfg = json.load(f)
del cfg['credsStore']
with open(cfg_path, 'w') as f:
    json.dump(cfg, f, indent='\t')
    f.write('\n')
"
      ok "Removed stale credsStore entry"
    fi
  fi
}

# ── OrbStack setup ──────────────────────────────────────────────
setup_orbstack() {
  echo ""
  echo -e "${BOLD}━━━ OrbStack Setup (Apple Silicon / macOS 13+) ━━━${RESET}"
  echo ""

  # Check compatibility
  if [[ "$MACOS_MAJOR" -lt 13 ]]; then
    fail "OrbStack requires macOS 13 (Ventura) or later. Your version: ${MACOS_VER}
    Use Colima instead:  ./scripts/setup-ci-local.sh colima"
  fi

  # Install OrbStack
  if [ -d "/Applications/OrbStack.app" ]; then
    ok "OrbStack already installed"
  else
    info "Installing OrbStack..."
    brew install --cask orbstack
    ok "OrbStack installed"
  fi

  # Launch & wait for Docker daemon
  info "Starting OrbStack..."
  open -a OrbStack
  echo -n "   Waiting for Docker daemon"
  local retries=0
  while ! docker info >/dev/null 2>&1; do
    echo -n "."
    sleep 2
    retries=$((retries + 1))
    if [[ $retries -ge 30 ]]; then
      echo ""
      fail "Timed out waiting for Docker. Open OrbStack manually and complete the setup."
    fi
  done
  echo ""
  ok "Docker daemon ready ($(docker --version))"

  # Install act
  install_act

  echo ""
  echo -e "${GREEN}${BOLD}✅ OrbStack setup complete!${RESET}"
  print_next_steps
}

# ── Colima setup ────────────────────────────────────────────────
setup_colima() {
  echo ""
  echo -e "${BOLD}━━━ Colima Setup (Intel Mac / macOS 10.15+) ━━━${RESET}"
  echo ""

  # Install Docker CLI (without Docker Desktop)
  if command -v docker &>/dev/null; then
    ok "Docker CLI already installed ($(docker --version))"
  else
    info "Installing Docker CLI..."
    brew install docker
    ok "Docker CLI installed"
  fi

  # Install Colima
  if command -v colima &>/dev/null; then
    ok "Colima already installed ($(colima version | head -1))"
  else
    info "Installing Colima..."
    brew install colima
    ok "Colima installed"
  fi

  # Start Colima VM
  if colima status 2>/dev/null | grep -q "Running"; then
    ok "Colima VM already running"
  else
    info "Starting Colima VM (first time may take a minute to download)..."
    colima start --cpu 4 --memory 8 --disk 60
    ok "Colima VM started"
  fi

  # Verify Docker
  if docker info >/dev/null 2>&1; then
    ok "Docker daemon ready ($(docker --version))"
  else
    fail "Docker daemon not responding. Try: colima stop && colima start"
  fi

  # Fix Docker credential helper (leftover from Docker Desktop)
  fix_docker_creds_store

  # Install act
  install_act

  echo ""
  echo -e "${GREEN}${BOLD}✅ Colima setup complete!${RESET}"
  echo ""
  echo -e "${DIM}Colima tips:${RESET}"
  echo -e "  ${DIM}colima start       # start VM (needed after reboot)${RESET}"
  echo -e "  ${DIM}colima stop        # stop VM to free resources${RESET}"
  echo -e "  ${DIM}colima status      # check VM status${RESET}"
  print_next_steps
}

# ── next steps ──────────────────────────────────────────────────
print_next_steps() {
  echo ""
  echo -e "${BOLD}Next steps:${RESET}"
  echo -e "  ./scripts/ci-local.sh            ${DIM}# run main CI workflow locally${RESET}"
  echo -e "  ./scripts/ci-local.sh contracts   ${DIM}# run contracts workflow${RESET}"
  echo -e "  ./scripts/ci-local.sh all         ${DIM}# run all workflows${RESET}"
  echo -e "  ./scripts/ci-local.sh --list      ${DIM}# list available workflows${RESET}"
  echo ""
}

# ── main ────────────────────────────────────────────────────────
main() {
  local runtime="${1:-auto}"

  echo ""
  echo -e "${BOLD}ClawNet — Local CI Setup${RESET}"
  echo -e "${DIM}macOS ${MACOS_VER} (${ARCH})${RESET}"

  case "$runtime" in
    orbstack|orb)
      setup_orbstack
      ;;
    colima|col)
      setup_colima
      ;;
    auto)
      local detected
      detected=$(detect_runtime)
      info "Auto-detected best runtime: ${BOLD}${detected}${RESET}"
      case "$detected" in
        orbstack) setup_orbstack ;;
        colima)   setup_colima   ;;
      esac
      ;;
    --help|-h|help)
      echo ""
      echo "Usage: $0 [orbstack|colima|auto]"
      echo ""
      echo "  orbstack   OrbStack — Apple Silicon, macOS 13+ (lightest, fastest)"
      echo "  colima     Colima + Docker CLI — Intel Mac, macOS 10.15+ (open source)"
      echo "  auto       Auto-detect best option for this machine (default)"
      echo ""
      ;;
    *)
      fail "Unknown runtime: $runtime. Use 'orbstack', 'colima', or 'auto'."
      ;;
  esac
}

main "$@"
