#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# ClawNet — Publish all packages to npm, GitHub Packages, and PyPI
#
# Usage:
#   ./scripts/publish.sh                 # dry-run (default)
#   ./scripts/publish.sh --release       # actual publish (npmjs + GPR + PyPI)
#   ./scripts/publish.sh --npm           # publish to npmjs.org only
#   ./scripts/publish.sh --gpr           # publish to GitHub Packages only
#
# Prerequisites:
#   npm login                            # npm authenticated (for npmjs)
#   ~/.npmrc with GPR token              # GitHub Packages auth
#   pip install hatch                    # Python build tool
#   export HATCH_INDEX_AUTH=pypi-token   # PyPI token
# ─────────────────────────────────────────────────────────────
set -euo pipefail

DRY_RUN=true
PUBLISH_NPM=true
PUBLISH_GPR=true

for arg in "$@"; do
  case "$arg" in
    --release) DRY_RUN=false ;;
    --npm)     DRY_RUN=false; PUBLISH_GPR=false ;;
    --gpr)     DRY_RUN=false; PUBLISH_NPM=false ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "╔══════════════════════════════════════════╗"
echo "║   ClawNet Package Publisher              ║"
echo "║   Mode: $(if $DRY_RUN; then echo 'DRY-RUN'; else echo 'RELEASE'; fi)                          ║"
echo "║   npm:  $(if $PUBLISH_NPM; then echo 'yes'; else echo 'skip'; fi)    GPR: $(if $PUBLISH_GPR; then echo 'yes'; else echo 'skip'; fi)                   ║"
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
#    core → protocol → sdk → node (dependency order)
NPM_PKGS=("packages/core" "packages/protocol" "packages/sdk" "packages/node")

NPMJS_REGISTRY="https://registry.npmjs.org"
GPR_REGISTRY="https://npm.pkg.github.com"

for pkg_dir in "${NPM_PKGS[@]}"; do
  pkg_name=$(node -p "require('./$pkg_dir/package.json').name")
  pkg_version=$(node -p "require('./$pkg_dir/package.json').version")

  cd "$ROOT/$pkg_dir"

  if $DRY_RUN; then
    echo "▸ [dry-run] $pkg_name@$pkg_version …"
    pnpm publish --dry-run --no-git-checks 2>&1 | sed 's/^/    /'
  else
    if $PUBLISH_NPM; then
      echo "▸ Publishing $pkg_name@$pkg_version → npmjs.org …"
      pnpm publish --access public --no-git-checks --registry "$NPMJS_REGISTRY" 2>&1 | sed 's/^/    /' || true
    fi
    if $PUBLISH_GPR; then
      echo "▸ Publishing $pkg_name@$pkg_version → GitHub Packages …"
      pnpm publish --access public --no-git-checks --registry "$GPR_REGISTRY" 2>&1 | sed 's/^/    /' || true
    fi
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
  echo "  ./scripts/publish.sh --release   # npmjs + GitHub Packages + PyPI"
  echo "  ./scripts/publish.sh --npm       # npmjs + PyPI only"
  echo "  ./scripts/publish.sh --gpr       # GitHub Packages only"
fi
