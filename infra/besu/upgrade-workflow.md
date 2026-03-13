# Besu Upgrade Workflow

This document defines how ClawNet keeps its Besu customizations while still upgrading Besu regularly.

The core rule is simple:

- official Besu remains the upstream source of truth
- ClawNet keeps its custom changes as a small patch stack on a writable fork branch
- each Besu upgrade replays that patch stack onto a newer upstream tag or commit

If we only edit the vendored submodule working tree and never publish those changes to a fork branch, the changes are temporary and will be lost the next time the submodule baseline moves.

## Steady-State Model

ClawNet maintains three layers:

1. Official upstream Besu
   - remote: upstream Besu repository
   - purpose: source of new releases and security updates
2. ClawNet Besu fork
   - remote: writable fork repository
   - purpose: durable home for the ClawNet patch stack
3. ClawNet parent repo
   - purpose: pins the Besu source baseline, documents the active fork commit, and records the image actually deployed

Remote convention used by ClawNet:

- `origin` -> `https://github.com/claw-network/besu.git`
- `upstream` -> `https://github.com/hyperledger/besu.git`

## Required Branching Model

Use a small, linear patch stack rather than a long-lived branch with unrelated merge commits.

Recommended branch names:

- implementation branch:
  - `clawnet/ed25519-precompile`
- upgrade branch for a new Besu release:
  - `clawnet/upgrade-besu-<version>`

The implementation branch should contain only ClawNet-owned Besu commits. Avoid mixing unrelated experiments into this branch.

## Important Submodule Rule

The current submodule URL in `.gitmodules` may point at official Besu while you are still bootstrapping the work.

That is acceptable only as a temporary baseline.

Before the parent repo starts pinning a custom Besu commit, move the submodule URL to the writable ClawNet fork so collaborators can fetch the exact commit referenced by the parent repo.

Without that step, the parent repo cannot safely pin a fork-only commit because fresh clones would not be able to fetch it from the official upstream remote.

## First-Time Setup

1. Initialize the Besu submodule.

```bash
git submodule update --init --recursive infra/besu/upstream
```

2. Attach the writable fork remote and create the implementation branch.

```bash
BESU_FORK_URL=https://github.com/claw-network/besu.git \
infra/besu/bootstrap-fork.sh
```

3. Make and commit ClawNet changes on the fork branch.

4. Push the branch to the writable fork.

5. Record the fork URL, branch, Besu base tag, built image tag, and image digest in `infra/besu/README.md`.

## Upgrade Procedure

When a new Besu version is released, do not re-edit the new source tree by hand first.

Instead:

1. Fetch the new Besu release.
2. Create an upgrade branch from the new upstream tag.
3. Replay the existing ClawNet patch stack onto that tag.
4. Resolve conflicts if they occur.
5. Re-run the focused Besu tests.
6. Build and validate the new custom image.
7. Update the parent repo metadata and submodule pointer.

### Helper Script

The repository provides a helper:

```bash
BESU_SOURCE_BRANCH=clawnet/ed25519-precompile \
infra/besu/upgrade-fork.sh 24.12.3
```

What it does:

- fetches upstream tags
- resolves the new target ref
- derives the old base tag from the current patch branch unless overridden
- creates `clawnet/upgrade-besu-<version>` from the new upstream ref
- cherry-picks the ClawNet patch stack in order

Useful overrides:

- `BESU_SOURCE_BRANCH`: source patch branch to replay
- `BESU_OLD_BASE_REF`: explicit old upstream base if auto-detection is not enough
- `BESU_UPGRADE_BRANCH`: custom name for the new upgrade branch
- `BESU_UPSTREAM_REMOTE`: upstream remote name, default `upstream`
- `BESU_FORK_REMOTE`: fork remote name, default `origin`

## Conflict Policy

Conflicts during replay are expected after some Besu upgrades.

When they happen:

1. resolve the conflict on the upgrade branch only
2. keep the external contract unchanged unless there is a deliberate breaking decision
3. prefer adapting internal Besu glue code over changing ClawNet contract-side expectations
4. re-run all focused tests before updating any deployed image

For the Ed25519 precompile, the external contract that should remain stable is defined in:

- `infra/besu/ed25519-precompile-spec.md`

That means these should not change casually:

- address `0x0100`
- input layout `message[32] || signature[64] || publicKey[32]`
- 32-byte bool output semantics
- malformed-input fail-closed behavior

## Validation Checklist After Each Upgrade

Run these before accepting a new upgraded fork:

1. Focused Besu fork tests under Java 21
2. Local custom-image boot
3. `node scripts/test-ed25519-precompile.mjs`
4. `pnpm contracts:test:ed25519:besu`
5. Baseline local Hardhat fail-closed test

## Parent Repo Update Rule

Only after the upgraded Besu fork commit is published and fetchable should the parent repo update:

- the submodule pointer
- `infra/besu/README.md`
- any image tag or digest references used by deploy workflows

## Minimal Done Definition For An Upgrade

An upgraded Besu version is accepted only when all of the following are true:

- the ClawNet patch stack has been replayed onto the new Besu version
- focused Besu tests pass
- repository-side probe and contract integration tests pass unchanged
- a new custom image tag and digest are recorded
- the parent repo can fetch the pinned Besu commit from the configured submodule remote