#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# ClawNet — Publish release packages to npmjs.org and PyPI
#
# Usage:
#   ./scripts/publish.sh           # dry-run (default)
#   ./scripts/publish.sh --release # actual publish (npmjs + PyPI)
#
# Prerequisites:
#   npm login                          # npm authenticated (for npmjs)
#   pip install hatch                  # Python build tool
#   export HATCH_INDEX_AUTH=pypi-token # PyPI token
# ─────────────────────────────────────────────────────────────
set -euo pipefail

DRY_RUN=true

for arg in "$@"; do
  case "$arg" in
    --release) DRY_RUN=false ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: ./scripts/publish.sh [--release]" >&2
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NPM_PKGS=()
while IFS= read -r pkg_dir; do
  NPM_PKGS+=("$pkg_dir")
done < <(node scripts/lib/release-manifest.mjs npm-package-dirs)

PYTHON_PKG="$(node scripts/lib/release-manifest.mjs python-package-dir)"
HATCH_PYTHON="python3"
HATCH_AVAILABLE=0

if ! command -v "$HATCH_PYTHON" >/dev/null 2>&1; then
  HATCH_PYTHON="python"
fi

if "$HATCH_PYTHON" -m hatch --version >/dev/null 2>&1; then
  HATCH_AVAILABLE=1
fi

publish_npm_package() {
  local pkg_dir="$1"
  local registry="$2"
  local mode="$3"
  local publish_output
  local status
  local -a publish_cmd

  publish_cmd=(corepack pnpm publish --no-git-checks --registry "$registry")

  if [[ "$mode" == "dry-run" ]]; then
    publish_cmd+=(--dry-run)
  else
    publish_cmd+=(--access public)
  fi

  set +e
  publish_output="$("${publish_cmd[@]}" 2>&1)"
  status=$?
  set -e

  printf '%s\n' "$publish_output" | sed 's/^/    /'

  if [[ $status -eq 0 ]]; then
    return 0
  fi

  if printf '%s\n' "$publish_output" | grep -Eq 'previously published versions|Cannot publish over existing version'; then
    echo "    Skipping already-published version for $pkg_dir"
    return 0
  fi

  return "$status"
}

echo "╔══════════════════════════════════════════╗"
echo "║   ClawNet Package Publisher              ║"
echo "║   Mode: $(if $DRY_RUN; then echo 'DRY-RUN'; else echo 'RELEASE'; fi)                          ║"
echo "║   Targets: npmjs.org + PyPI              ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Step 1: Release-only build ──────────────────────────────
echo "▸ Building npm release packages …"
node scripts/release-check.mjs build
echo "  ✓ Release builds complete"
echo ""

# ── Step 2: Release-only tests ──────────────────────────────
echo "▸ Running npm release package tests …"
node scripts/release-check.mjs test
echo "  ✓ Release tests passed"
echo ""

# ── Step 3: Publish npm packages ────────────────────────────
NPMJS_REGISTRY="https://registry.npmjs.org"

for pkg_dir in "${NPM_PKGS[@]}"; do
  pkg_name=$(node -p "require('./$pkg_dir/package.json').name")
  pkg_version=$(node -p "require('./$pkg_dir/package.json').version")

  cd "$ROOT/$pkg_dir"

  if $DRY_RUN; then
    echo "▸ [dry-run] $pkg_name@$pkg_version …"
    publish_npm_package "$pkg_dir" "$NPMJS_REGISTRY" "dry-run"
  else
    echo "▸ Publishing $pkg_name@$pkg_version → npmjs.org …"
    publish_npm_package "$pkg_dir" "$NPMJS_REGISTRY" "release"
  fi

  cd "$ROOT"
  echo "  ✓ $pkg_name done"
  echo ""
done

# ── Step 4: Publish Python SDK to PyPI ──────────────────────
echo "▸ Building Python SDK …"
cd "$ROOT/$PYTHON_PKG"

if [[ $HATCH_AVAILABLE -eq 0 ]]; then
  if $DRY_RUN; then
    echo "  (dry-run) Hatch is not installed for $HATCH_PYTHON; skipping local PyPI artifact build."
    echo "  (dry-run) Would build and upload $PYTHON_PKG via $HATCH_PYTHON -m hatch"
  else
    echo "Hatch is required for release mode. Install it with '$HATCH_PYTHON -m pip install hatch'." >&2
    exit 1
  fi
else
  # Clean previous builds
  rm -rf dist/

  # Build sdist + wheel
  "$HATCH_PYTHON" -m hatch build 2>&1 | sed 's/^/    /'

  if $DRY_RUN; then
    echo "  (dry-run) Would upload:"
    ls -la dist/ | sed 's/^/    /'
  else
    echo "  Uploading to PyPI …"
    "$HATCH_PYTHON" -m hatch publish 2>&1 | sed 's/^/    /'
  fi
fi

cd "$ROOT"
echo "  ✓ Python SDK done"
echo ""

# ── Summary ─────────────────────────────────────────────────
echo "╔══════════════════════════════════════════╗"
echo "║   Publish Summary                        ║"
echo "╠══════════════════════════════════════════╣"
for pkg_dir in "${NPM_PKGS[@]}"; do
  name=$(node -p "require('./$pkg_dir/package.json').name")
  ver=$(node -p "require('./$pkg_dir/package.json').version")
  printf "║   %-20s  v%-14s ║\n" "$name" "$ver"
done
printf "║   %-20s  v%-14s ║\n" "clawnet-sdk (PyPI)" \
  "$({ grep -E '^version[[:space:]]*=' packages/sdk-python/pyproject.toml | head -n 1 | sed -E 's/^[^"]*"([^"]+)".*$/\1/'; } 2>/dev/null || echo '0.1.0')"
echo "╚══════════════════════════════════════════╝"

if $DRY_RUN; then
  echo ""
  echo "This was a DRY RUN. To publish for real:"
  echo "  ./scripts/publish.sh --release   # npmjs + PyPI"
fi
