# Skill: Publish ClawNet Packages (npm + GitHub Packages + PyPI)

## Overview

This skill covers the complete workflow for bumping versions and publishing ClawNet packages to **npmjs.org**, **GitHub Packages (GPR)**, and **PyPI**. It uses the unified bump script to keep all synced packages at the same version.

Packages are published to dual npm registries:
- **npmjs.org** — primary public registry, zero-config install for external users
- **GitHub Packages** — mirror registry, accessible within the GitHub org ecosystem

---

## Package Layout

### Synced Packages (same version, bumped together)

| Package | Registry | Directory |
|---------|----------|-----------|
| `@claw-network/core` | npm + GPR (public) | `packages/core` |
| `@claw-network/protocol` | npm + GPR (public) | `packages/protocol` |
| `@claw-network/sdk` | npm + GPR (public) | `packages/sdk` |
| `@claw-network/node` | npm + GPR (public) | `packages/node` |
| `@claw-network/cli` | — (private) | `packages/cli` |
| `clawnet-sdk` | PyPI (public) | `packages/sdk-python` |

### Independent-Version Packages (NOT bumped by the script)

| Package | Directory | Notes |
|---------|-----------|-------|
| `@claw-network/contracts` | `packages/contracts` | Solidity, Hardhat |
| `@claw-network/docs` | `packages/docs` | Docs website |
| `@claw-network/homepage` | `packages/homepage` | Homepage SPA |
| `@claw-network/wallet` | `packages/wallet` | Wallet SPA |

---

## Prerequisites

```bash
npm login                            # npm authenticated (for npmjs.org publish)
pip install hatch                    # Python build tool (for PyPI)
export HATCH_INDEX_AUTH=pypi-token   # PyPI token (for PyPI publish)
```

### GitHub Packages (GPR) auth (for local publish only)

Add to `~/.npmrc`:

```
//npm.pkg.github.com/:_authToken=ghp_YOUR_PERSONAL_ACCESS_TOKEN
```

PAT needs `write:packages` scope. **Not needed for CI** — CI uses `GITHUB_TOKEN` automatically.

### CI secrets (GitHub Actions)

| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | npmjs.org publish token |
| `PYPI_TOKEN` | PyPI API token |
| *(automatic)* `GITHUB_TOKEN` | GitHub Packages publish |

---

## Full Publish Workflow

### Step 1: Bump Version

Use the unified bump script. It reads the current version from `packages/core/package.json` and applies the new version to all synced packages (including Python SDK's `pyproject.toml`).

```bash
# Preview what will change (no files modified)
pnpm bump:dry

# Bump patch: 0.5.1 → 0.5.2
pnpm bump:patch

# Bump minor: 0.5.1 → 0.6.0
pnpm bump:minor

# Bump major: 0.5.1 → 1.0.0
pnpm bump:major

# Or set an explicit version
node scripts/bump-version.mjs 1.2.3
```

**Always run `pnpm bump:dry` first** to preview version changes before applying.

### Step 2: Build & Test

```bash
pnpm build && pnpm test
```

All 217+ tests must pass before publishing.

### Step 3: Commit & Tag

```bash
git add -A
git commit -m "chore: bump to v<VERSION>"
git tag v<VERSION>
git push --no-verify
git push origin v<VERSION> --no-verify
```

Pushing a `v*` tag triggers the **`publish-packages`** CI workflow automatically.

### Step 4: Publish (two options)

#### Option A: CI Auto-Publish (Recommended)

Pushing the `v*` tag in Step 3 triggers `.github/workflows/publish-packages.yml`, which:
1. Publishes npm packages to **npmjs.org** (core → protocol → sdk → node)
2. Publishes npm packages to **GitHub Packages**
3. Builds and uploads the Python SDK to **PyPI** via hatch

No manual action needed — just wait for CI to complete.

#### Option B: Local Publish via Script

```bash
# Dry-run first (preview only)
pnpm publish:dry

# Publish to both npmjs.org + GitHub Packages + PyPI
pnpm publish:release

# Publish to npmjs.org only (+ PyPI)
./scripts/publish.sh --npm

# Publish to GitHub Packages only
./scripts/publish.sh --gpr
```

`publish:release` runs `scripts/publish.sh --release`, which:
1. Builds all TypeScript packages
2. Runs all tests
3. Publishes npm packages to **both registries** in dependency order: core → protocol → sdk → node
4. Builds and uploads the Python SDK to PyPI via `hatch`

---

## Publish npm Only (Quick Path)

When you only need to push updated npm packages without PyPI:

```bash
pnpm bump:patch
pnpm build && pnpm test
git add -A && git commit -m "chore: bump to v<VERSION>"

# Publish to npmjs.org
for pkg in packages/core packages/protocol packages/sdk packages/node; do
  cd "$pkg" && pnpm publish --access public --no-git-checks --registry https://registry.npmjs.org && cd ../..
done

# Publish to GitHub Packages
for pkg in packages/core packages/protocol packages/sdk packages/node; do
  cd "$pkg" && pnpm publish --access public --no-git-checks --registry https://npm.pkg.github.com && cd ../..
done

git tag v<VERSION> && git push --no-verify && git push origin v<VERSION> --no-verify
```

---

## Publish PyPI Only (Quick Path)

When you only need to push an updated Python SDK:

```bash
pnpm bump:patch                      # bumps pyproject.toml too
cd packages/sdk-python
rm -rf dist/
python -m hatch build
python -m hatch publish
cd ../..
git add -A && git commit -m "chore: bump to v<VERSION>"
git push
```

---

## Common Scenarios

### Scenario A: Bug fix in node package only

1. Fix the bug in `packages/node/src/...`
2. `pnpm bump:patch`
3. `pnpm build && pnpm test`
4. `git add -A && git commit -m "fix: <description>"`
5. `pnpm publish:release` (or npm-only quick path)
6. `git push`

### Scenario B: New feature across core + protocol + SDK

1. Implement changes across packages
2. `pnpm bump:minor`
3. `pnpm build && pnpm test`
4. `git add -A && git commit -m "feat: <description>"`
5. `pnpm publish:release`
6. `git push`

### Scenario C: Deploy updated node to server after publish

After publishing, deploy to production server:

```bash
ssh root@66.94.125.242 "cd /opt/clawnet && git pull origin main && pnpm install && pnpm build && systemctl restart clawnetd"
```

See `skills/upgrade-clawnetd-server.md` for full server deployment details.

---

## Important Notes

- **Version source of truth**: `packages/core/package.json` — the bump script reads from here.
- **npm publish order matters**: core → protocol → sdk → node (dependency chain).
- **Dual registry**: always use `--registry` flag when publishing locally to specify the target. Without it, the default npm registry is used.
- **CI is the recommended publish path**: push a `v*` tag and let `publish-packages` workflow handle everything.
- **cli is private**: not published to any registry, but its version is synced for consistency.
- **Python SDK pyproject.toml**: automatically updated by the bump script.
- **Never manually edit version fields** — always use the bump script to keep packages in sync.
- **Currency unit is Token**, not CLAW (see `CONVENTIONS.md`).

---

## Install Published Packages

### npm (for external users)

```bash
npm install @claw-network/sdk
```

### GitHub Packages

```bash
# Add to ~/.npmrc first:
#   @claw-network:registry=https://npm.pkg.github.com
#   //npm.pkg.github.com/:_authToken=YOUR_TOKEN

npm install @claw-network/sdk
```

### PyPI

```bash
pip install clawnet-sdk
```
