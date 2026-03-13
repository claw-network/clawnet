# Besu Runtime Notes

This directory tracks the Besu runtime baseline used by ClawNet chain environments.

## Submodule Baseline

- Besu source is vendored as a git submodule at `infra/besu/upstream`
- Submodule default remote URL:
  - `https://github.com/claw-network/besu.git`
- Official upstream Besu URL:
  - `https://github.com/hyperledger/besu.git`
- Current pinned baseline:
  - tag `24.12.2`
  - commit `eaa75ac`

Initialize it in a fresh clone with:

```bash
git submodule update --init --recursive infra/besu/upstream
```

To bootstrap a writable fork branch from the pinned baseline:

```bash
BESU_FORK_URL=https://github.com/claw-network/besu.git \
infra/besu/bootstrap-fork.sh
```

To create a Besu upgrade branch and replay the ClawNet patch stack onto a newer upstream tag:

```bash
BESU_SOURCE_BRANCH=clawnet/ed25519-precompile \
infra/besu/upgrade-fork.sh 24.12.3
```

## Current Default Image Contract

- Compose files under `infra/testnet/` and `infra/mainnet/` use:
  - `${CLAWNET_BESU_IMAGE:-hyperledger/besu:24.12.2}`
- This removes drift from `hyperledger/besu:latest` while still allowing an override for custom builds.

## Intended Ed25519 Rollout Convention

- Local development override:
  - `CLAWNET_BESU_IMAGE=clawnet/besu-ed25519:dev`
- Shared CI or staged rollout override:
  - `CLAWNET_BESU_IMAGE=ghcr.io/claw-network/besu-ed25519:<git-sha>`

## Required Tracking Fields

Before testnet rollout, fill in and keep updated:

- Fork repository URL
- Fork branch or tag
- Upstream Besu base version
- Upgrade workflow branch for the current release line
- Built image tag
- Built image digest
- Change summary for custom precompiles

## Long-Term Maintenance Model

- Official Besu remains the upstream update source.
- ClawNet-specific Besu changes must live on a writable fork branch, not only in a dirty submodule working tree.
- In the steady state, the Besu submodule uses `origin` for the ClawNet fork and `upstream` for official Besu.
- Each Besu release upgrade must replay the ClawNet patch stack onto the newer upstream tag and re-run the focused validation path.
- Before the parent repo pins a fork-only Besu commit, the submodule remote in `.gitmodules` must be moved to the ClawNet fork so fresh clones can fetch that commit.
- The active ClawNet-owned Besu patch groups must be listed in `infra/besu/custom-patch-inventory.md`.

## Related Docs

- `infra/besu/ed25519-precompile-spec.md`: repository-side interface contract, test vectors, and acceptance commands for the `0x0100` Ed25519 precompile
- `infra/besu/ed25519-precompile-task-list.md`: detailed implementation and rollout checklist for the Besu fork workstream
- `infra/besu/testnet-rollout-checklist.md`: operator-facing checklist for testnet rollout, smoke checks, and rollback using `CLAWNET_BESU_IMAGE`
- `infra/besu/mainnet-rollout-checklist.md`: stricter promotion checklist for mainnet rollout after testnet validation
- `infra/besu/implementer-ops-handoff.md`: one-page summary for the Besu fork implementer and chain operators
- `infra/besu/bootstrap-fork.sh`: helper to add a writable fork remote and create the implementation branch from the pinned submodule baseline
- `infra/besu/upgrade-fork.sh`: helper to create a Besu upgrade branch and replay the ClawNet patch stack onto a newer upstream ref
- `infra/besu/upgrade-workflow.md`: durable maintenance process for regular Besu upgrades without losing ClawNet fork changes
- `infra/besu/custom-patch-inventory.md`: explicit inventory of ClawNet-owned Besu changes that must survive upgrades
- `docs/implementation/tasks/besu-ed25519-precompile-rollout.md`: rollout plan across devnet, testnet, and mainnet

## Usage

Local or remote compose invocation can override the image at runtime:

```bash
CLAWNET_BESU_IMAGE=ghcr.io/claw-network/besu-ed25519:<git-sha> \
docker compose -f docker-compose.chain.yml up -d
```

If no override is provided, ClawNet uses the pinned upstream baseline image.