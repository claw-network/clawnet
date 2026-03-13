#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUBMODULE_DIR="$SCRIPT_DIR/upstream"

if [[ ! -d "$SUBMODULE_DIR/.git" && ! -f "$SUBMODULE_DIR/.git" ]]; then
  echo "ERROR: Besu submodule is not initialized."
  echo "Run: git submodule update --init --recursive infra/besu/upstream"
  exit 1
fi

FORK_URL="${BESU_FORK_URL:-}"
BRANCH_NAME="${BESU_FORK_BRANCH:-clawnet/ed25519-precompile}"

if [[ -z "$FORK_URL" ]]; then
  echo "ERROR: BESU_FORK_URL is required."
  echo "Example: BESU_FORK_URL=https://github.com/<org>/besu.git $0"
  exit 1
fi

git -C "$SUBMODULE_DIR" remote remove fork >/dev/null 2>&1 || true
git -C "$SUBMODULE_DIR" remote add fork "$FORK_URL"
git -C "$SUBMODULE_DIR" fetch fork
git -C "$SUBMODULE_DIR" switch -C "$BRANCH_NAME"

echo "Besu fork bootstrap complete."
echo "  submodule: $SUBMODULE_DIR"
echo "  upstream:  $(git -C "$SUBMODULE_DIR" remote get-url origin)"
echo "  fork:      $(git -C "$SUBMODULE_DIR" remote get-url fork)"
echo "  branch:    $(git -C "$SUBMODULE_DIR" branch --show-current)"