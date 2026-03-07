# Skill: Publish ClawNet Packages (npm + PyPI)

## Overview

This skill covers the complete workflow for bumping versions and publishing ClawNet packages to **npm** and **PyPI**. It uses the unified bump script to keep all synced packages at the same version.

---

## Package Layout

### Synced Packages (same version, bumped together)

| Package | Registry | Directory |
|---------|----------|-----------|
| `@claw-network/core` | npm (public) | `packages/core` |
| `@claw-network/protocol` | npm (public) | `packages/protocol` |
| `@claw-network/sdk` | npm (public) | `packages/sdk` |
| `@claw-network/node` | npm (public) | `packages/node` |
| `@claw-network/cli` | npm (private) | `packages/cli` |
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
npm login                            # npm authenticated (for publish)
pip install hatch                    # Python build tool (for PyPI)
export HATCH_INDEX_AUTH=pypi-token   # PyPI token (for PyPI publish)
```

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

### Step 3: Commit the Version Bump

```bash
git add -A
git commit -m "chore: bump to v<VERSION>"
git push
```

### Step 4: Publish to npm + PyPI

```bash
# Dry-run first (preview only)
pnpm publish:dry

# Actual publish
pnpm publish:release
```

`publish:release` runs `scripts/publish.sh --release`, which:
1. Builds all TypeScript packages
2. Runs all tests
3. Publishes npm packages in dependency order: core → protocol → sdk → node
4. Builds and uploads the Python SDK to PyPI via `hatch`

---

## Publish npm Only (Quick Path)

When you only need to push updated npm packages without PyPI:

```bash
pnpm bump:patch
pnpm build && pnpm test
git add -A && git commit -m "chore: bump to v<VERSION>"
git push

# Publish each package in dependency order
cd packages/core     && pnpm publish --access public --no-git-checks && cd ../..
cd packages/protocol && pnpm publish --access public --no-git-checks && cd ../..
cd packages/sdk      && pnpm publish --access public --no-git-checks && cd ../..
cd packages/node     && pnpm publish --access public --no-git-checks && cd ../..
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
- **cli is private**: not published to npm, but its version is synced for consistency.
- **Python SDK pyproject.toml**: automatically updated by the bump script.
- **Never manually edit version fields** — always use the bump script to keep packages in sync.
- **Currency unit is Token**, not CLAW (see `CONVENTIONS.md`).
