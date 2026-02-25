#!/usr/bin/env bash
set -euo pipefail

IMAGE="ethereum/client-go:v1.13.15"
MODE=""
ASSUME_YES=0

usage() {
  cat <<'EOF'
Usage:
  bash infra/testnet/multisig-soft-wallet/init-env.sh [--mode geth|docker] [--yes]

What this script does:
  - mode=geth   : install local geth toolchain
  - mode=docker : install docker (if missing) and pull ethereum/client-go:v1.13.15

If --mode is omitted, an interactive menu is shown.
--yes skips confirmation prompts where possible.
EOF
}

confirm() {
  local prompt="$1"
  local ans=""
  local lower=""
  if [[ "$ASSUME_YES" -eq 1 ]]; then
    return 0
  fi
  read -r -p "$prompt [y/N]: " ans
  lower="$(printf '%s' "$ans" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == "y" || "$lower" == "yes" ]]
}

run_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

install_geth_macos() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "ERROR: Homebrew not found. Install Homebrew first: https://brew.sh"
    exit 1
  fi
  brew tap ethereum/ethereum
  brew install ethereum
}

install_geth_linux_apt() {
  run_root apt-get update
  run_root apt-get install -y software-properties-common
  run_root add-apt-repository -y ppa:ethereum/ethereum
  run_root apt-get update
  run_root apt-get install -y ethereum
}

install_geth() {
  if command -v geth >/dev/null 2>&1; then
    echo "geth already installed: $(geth version | head -n1)"
    return
  fi

  local os
  os="$(uname -s)"
  case "$os" in
    Darwin)
      install_geth_macos
      ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        install_geth_linux_apt
      else
        echo "ERROR: automatic geth install is currently supported for apt-based Linux only."
        echo "Please install geth manually, or rerun this script with --mode docker."
        exit 1
      fi
      ;;
    *)
      echo "ERROR: unsupported OS for automatic geth install: $os"
      exit 1
      ;;
  esac

  echo "geth installed successfully: $(geth version | head -n1)"
}

install_docker_macos() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "ERROR: Homebrew not found. Install Homebrew first: https://brew.sh"
    exit 1
  fi
  brew install --cask docker
  echo "Docker Desktop installed. Please open Docker Desktop once to start the daemon, then rerun if needed."
}

install_docker_linux() {
  run_root sh -c 'curl -fsSL https://get.docker.com | sh'
  if command -v systemctl >/dev/null 2>&1; then
    run_root systemctl enable docker || true
    run_root systemctl start docker || true
  fi
}

install_docker_and_pull_image() {
  if ! command -v docker >/dev/null 2>&1; then
    local os
    os="$(uname -s)"
    case "$os" in
      Darwin)
        install_docker_macos
        ;;
      Linux)
        install_docker_linux
        ;;
      *)
        echo "ERROR: unsupported OS for automatic docker install: $os"
        exit 1
        ;;
    esac
  else
    echo "docker already installed: $(docker --version)"
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "ERROR: docker daemon is not running or not accessible."
    echo "Start Docker, then rerun this script."
    exit 1
  fi

  docker pull "$IMAGE"
  echo "Docker image ready: $IMAGE"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --yes)
      ASSUME_YES=1
      shift
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

if [[ -z "$MODE" ]]; then
  echo "Select initialization mode:"
  echo "  1) geth   (install local geth)"
  echo "  2) docker (install docker + pull $IMAGE)"
  read -r -p "Enter 1 or 2: " choice
  case "$choice" in
    1) MODE="geth" ;;
    2) MODE="docker" ;;
    *)
      echo "Invalid choice: $choice"
      exit 1
      ;;
  esac
fi

if [[ "$MODE" != "geth" && "$MODE" != "docker" ]]; then
  echo "ERROR: --mode must be geth or docker"
  exit 1
fi

echo "Mode: $MODE"
if ! confirm "Proceed with environment initialization?"; then
  echo "Cancelled."
  exit 0
fi

if [[ "$MODE" == "geth" ]]; then
  install_geth
else
  install_docker_and_pull_image
fi

echo "Initialization complete."
