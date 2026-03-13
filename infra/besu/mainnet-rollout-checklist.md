# Besu Ed25519 Mainnet Rollout Checklist

This document is the operator-facing checklist for promoting the custom Besu Ed25519 image from validated testnet status into ClawNet mainnet.

Use this only after the testnet rollout checklist has completed successfully.

Status markers:

```text
[ ] not started
[~] in progress
[x] completed
[!] blocked
```

## Scope

- Network: ClawNet mainnet
- Chain type: 5-node Besu QBFT
- Deployment entrypoint:
  - `infra/mainnet/prod/deploy.sh`
- Image injection variable:
  - `CLAWNET_BESU_IMAGE`

## Release Inputs

Fill these before rollout:

- [ ] Custom image tag:
- [ ] Custom image digest:
- [ ] Besu fork commit/tag:
- [ ] Operator:
- [ ] Maintenance window start:
- [ ] Maintenance window end:
- [ ] Rollback image tag:
- [ ] Rollback image digest:
- [ ] Testnet validation reference:

## P0 — Promotion Gate

### M-1. Confirm Testnet Completion

- [ ] `infra/besu/testnet-rollout-checklist.md` is fully satisfied
- [ ] Testnet observation window completed without consensus instability
- [ ] Probe and focused contract tests passed on testnet

Acceptance:

- Mainnet rollout is blocked unless testnet closeout is complete

### M-2. Freeze Operational State

- [ ] Announce maintenance window
- [ ] Freeze unrelated chain runtime changes during rollout
- [ ] Confirm rollback image is available and documented
- [ ] Confirm operator access to all mainnet validators

Acceptance:

- There is a clear change window and a pre-agreed rollback target

### M-3. Confirm Runtime Inputs

- [ ] `infra/mainnet/prod/deploy.sh` is current
- [ ] `infra/mainnet/docker-compose.yml` / `peer.yml` / `sync.yml` are current
- [ ] `CLAWNET_BESU_IMAGE` is the only image override path in use

Acceptance:

- Mainnet rollout path is deterministic and uses a single image override mechanism

## P1 — Mainnet Execution

### M-4. Start Mainnet Rollout With Explicit Image

Command:

```bash
cd infra/mainnet/prod

CLAWNET_BESU_IMAGE=ghcr.io/claw-network/besu-ed25519:<git-sha> \
SSH_KEY_PATH=~/.ssh/id_ed25519_clawnet \
bash deploy.sh
```

Checklist:

- [ ] `CLAWNET_BESU_IMAGE` is set explicitly
- [ ] `deploy.sh` completes all phases
- [ ] `contracts.json` is regenerated if a full redeploy occurs
- [ ] `enodes.env` is regenerated if a full redeploy occurs

Acceptance:

- All mainnet validators start on the intended image tag

### M-5. Validate Primary Validator

- [ ] `eth_blockNumber` advances on Node 1
- [ ] `admin_nodeInfo` returns an enode URL
- [ ] `net_peerCount` is healthy after peers join
- [ ] `qbft_getValidatorsByBlockNumber("latest")` returns the expected validator set

### M-6. Validate Remaining Validators

- [ ] Nodes 2-5 catch up and keep advancing
- [ ] Peer counts remain healthy
- [ ] No node appears isolated or repeatedly restarts

Acceptance:

- The 5-node validator set remains in consensus

## P2 — Post-Deploy Verification

### M-7. Chain Health Checks

- [ ] `eth_blockNumber` increases on all validators
- [ ] `net_peerCount` is stable on all validators
- [ ] `eth_gasPrice` remains `0x0`
- [ ] `baseFeePerGas` remains `0x0`

### M-8. Repository Probe Against Mainnet RPC

Run internally on the primary validator if RPC is not exposed directly.

```bash
cd /opt/clawnet

CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545 \
node scripts/test-ed25519-precompile.mjs
```

Checklist:

- [ ] Probe reports `valid: true`
- [ ] Probe reports `invalid: false`
- [ ] No backend-unavailable or revert behavior occurs

### M-9. Focused Contract Test Against Mainnet RPC

```bash
cd /opt/clawnet

CLAWNET_BESU_PRECOMPILE_TEST=1 \
CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545 \
pnpm contracts:test:ed25519:besu
```

Checklist:

- [ ] Focused Besu contract test passes unchanged
- [ ] No repository-side adapter changes were required for mainnet

## P3 — Observation Window

### M-10. Extended Observation

- [ ] Observe for at least one full release window after rollout
- [ ] Confirm no consensus divergence
- [ ] Confirm no recurring Besu exits
- [ ] Confirm clawnetd API and P2P remain healthy on all affected nodes

Suggested observation items:

- block height progression
- peer count stability
- validator set stability
- `GET /api/v1/node`
- application logs for precompile-related exceptions

Acceptance:

- No instability attributable to the custom image is observed during the window

## P4 — Rollback Procedure

Rollback immediately if any of the following happen:

- [ ] blocks stop advancing
- [ ] validators disagree on the same precompile input
- [ ] Besu exits repeatedly
- [ ] the repository probe fails after rollout

### M-11. Roll Back to Previous Stable Image

```bash
cd infra/mainnet/prod

CLAWNET_BESU_IMAGE=<previous-stable-image> \
SSH_KEY_PATH=~/.ssh/id_ed25519_clawnet \
bash deploy.sh
```

Checklist:

- [ ] Previous stable image tag is known
- [ ] Previous stable image digest is known
- [ ] All validators restart on the rollback image

### M-12. Confirm Recovery After Rollback

- [ ] `eth_blockNumber` resumes increasing
- [ ] `net_peerCount` returns to expected values
- [ ] `qbft_getValidatorsByBlockNumber("latest")` returns the expected validator set
- [ ] `GET /api/v1/node` returns healthy data on the application side

Acceptance:

- Mainnet is back to a known-good operating state

## P5 — Closeout

### M-13. Record Final Outcome

- [ ] Record the final image tag and digest used
- [ ] Record whether rollout succeeded or rolled back
- [ ] Record probe and focused-test outcomes
- [ ] Save an ops note under `docs/handover/`

## Minimal Done Definition

Mainnet rollout is complete only when all items below are true:

- [ ] Testnet validation was completed first
- [ ] All validators run the same custom image
- [ ] Probe script passes on mainnet
- [ ] Focused Besu contract test passes on mainnet
- [ ] Observation window completes without consensus instability
- [ ] Rollback image remains documented even if rollback was not needed