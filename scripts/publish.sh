#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# ClawNet — Publish all packages to npm and PyPI
#
# Usage:
#   ./scripts/publish.sh                 # dry-run (default)
#   ./scripts/publish.sh --release       # actual publish
#
# Prerequisites:
#   npm login                            # npm authenticated
#   pip install hatch                    # Python build tool
#   export HATCH_INDEX_AUTH=pypi-token   # PyPI token
# ─────────────────────────────────────────────────────────────
set -euo pipefail

DRY_RUN=true
if [[ "${1:-}" == "--release" ]]; then
  DRY_RUN=false
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "╔══════════════════════════════════════════╗"
echo "║   ClawNet Package Publisher              ║"
echo "║   Mode: $(if $DRY_RUN; then echo 'DRY-RUN'; else echo 'RELEASE'; fi)                          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Step 1: Clean build ─────────────────────────────────────
echo "▸ Building all TypeScript packages …"
pnpm build
echo "  ✓ Build complete"
echo ""

# ── Step 2: Run all tests ───────────────────────────────────
echo "▸ Running tests …"
pnpm test
echo "  ✓ All tests passed"
echo ""

# ── Step 3: Publish npm packages (order matters) ────────────
#    core → protocol → sdk  (dependency order)
NPM_PKGS=("packages/core" "packages/protocol" "packages/sdk")

for pkg_dir in "${NPM_PKGS[@]}"; do
  pkg_name=$(node -p "require('./$pkg_dir/package.json').name")
  pkg_version=$(node -p "require('./$pkg_dir/package.json').version")
  echo "▸ Publishing $pkg_name@$pkg_version …"

  cd "$ROOT/$pkg_dir"

  if $DRY_RUN; then
    npm publish --dry-run 2>&1 | sed 's/^/    /'
  else
    npm publish --access public 2>&1 | sed 's/^/    /'
  fi

  cd "$ROOT"
  echo "  ✓ $pkg_name done"
  echo ""
done

# ── Step 4: Publish Python SDK to PyPI ──────────────────────
PYTHON_PKG="packages/sdk-python"
echo "▸ Building Python SDK …"
cd "$ROOT/$PYTHON_PKG"

# Clean previous builds
rm -rf dist/

# Build sdist + wheel
python -m hatch build 2>&1 | sed 's/^/    /'

if $DRY_RUN; then
  echo "  (dry-run) Would upload:"
  ls -la dist/ | sed 's/^/    /'
else
  echo "  Uploading to PyPI …"
  python -m hatch publish 2>&1 | sed 's/^/    /'
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
  "$(python -c 'import tomllib; print(tomllib.load(open("packages/sdk-python/pyproject.toml","rb"))["project"]["version"])' 2>/dev/null || echo '0.1.0')"
echo "╚══════════════════════════════════════════╝"

if $DRY_RUN; then
  echo ""
  echo "This was a DRY RUN. To publish for real:"
  echo "  ./scripts/publish.sh --release"
fi
