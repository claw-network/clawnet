# Besu Runtime Notes

This directory tracks the Besu runtime baseline used by ClawNet chain environments.

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
- Built image tag
- Built image digest
- Change summary for custom precompiles

## Related Docs

- `infra/besu/ed25519-precompile-spec.md`: repository-side interface contract, test vectors, and acceptance commands for the `0x0100` Ed25519 precompile
- `infra/besu/ed25519-precompile-task-list.md`: detailed implementation and rollout checklist for the Besu fork workstream
- `infra/besu/testnet-rollout-checklist.md`: operator-facing checklist for testnet rollout, smoke checks, and rollback using `CLAWNET_BESU_IMAGE`
- `infra/besu/mainnet-rollout-checklist.md`: stricter promotion checklist for mainnet rollout after testnet validation
- `infra/besu/implementer-ops-handoff.md`: one-page summary for the Besu fork implementer and chain operators
- `docs/implementation/tasks/besu-ed25519-precompile-rollout.md`: rollout plan across devnet, testnet, and mainnet

## Usage

Local or remote compose invocation can override the image at runtime:

```bash
CLAWNET_BESU_IMAGE=ghcr.io/claw-network/besu-ed25519:<git-sha> \
docker compose -f docker-compose.chain.yml up -d
```

If no override is provided, ClawNet uses the pinned upstream baseline image.