# Besu Ed25519 Testnet Rollout Checklist

This document is the operator-facing checklist for rolling a custom Besu Ed25519 image into the ClawNet testnet.

It assumes the repository-side probe and contract checks already pass locally.

Status markers:

```text
[ ] not started
[~] in progress
[x] completed
[!] blocked
```

## Scope

- Network: ClawNet testnet
- Chain type: 3-node Besu QBFT
- Servers:
  - Server A: `66.94.125.242`
  - Server B: `85.239.236.49`
  - Server C: `85.239.235.67`
- Deployment entrypoint:
  - `infra/testnet/prod/deploy.sh`
- Image injection variable:
  - `CLAWNET_BESU_IMAGE`

## Release Inputs

Fill these before rollout:

- [ ] Custom image tag:
- [ ] Custom image digest:
- [ ] Besu fork commit/tag:
- [ ] Operator:
- [ ] Rollout start time:
- [ ] Rollback image tag:
- [ ] Rollback image digest:

## P0 — Pre-Rollout Gate

### T-1. Confirm Build Artifact

- [ ] The custom image exists in the registry or on the target hosts
- [ ] The tag and digest are recorded in `infra/besu/README.md`
- [ ] The image corresponds to the intended Besu fork commit

Acceptance:

- Tag, digest, and fork reference are all recorded before touching testnet

### T-2. Confirm Repository-Side Validation

- [ ] `node scripts/test-ed25519-precompile.mjs` passes against the custom image locally
- [ ] `pnpm contracts:test:ed25519:besu` passes against the custom image locally
- [ ] `pnpm --filter @claw-network/contracts exec hardhat test test/Ed25519Verifier.test.ts` still passes on the no-backend path

Acceptance:

- Local custom-image checks pass unchanged
- Local fail-closed baseline remains unchanged

### T-3. Confirm Testnet Deploy Path

- [ ] `infra/testnet/prod/deploy.sh` is up to date
- [ ] `infra/testnet/docker-compose.yml` / `peer.yml` / `sync.yml` are up to date
- [ ] All operators agree to use `CLAWNET_BESU_IMAGE` as the only image override

Acceptance:

- There is one agreed testnet image override path

## P1 — Testnet Rollout Execution

### T-4. Start Rollout With Explicit Image

Run from the repository root or `infra/testnet/prod/` with an explicit image override.

Command:

```bash
cd infra/testnet/prod

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

- All 3 validators start on the intended image tag

### T-5. Validate Server A

- [ ] `eth_blockNumber` advances on Server A
- [ ] `admin_nodeInfo` returns an enode URL
- [ ] `net_peerCount` is healthy after peers join
- [ ] `qbft_getValidatorsByBlockNumber("latest")` returns the expected validator set

Useful command:

```bash
curl -s http://127.0.0.1:8545 \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}'
```

### T-6. Validate Server B and Server C

- [ ] Server B catches up and continues advancing blocks
- [ ] Server C catches up and continues advancing blocks
- [ ] Each node reports the expected peer count
- [ ] No node appears stuck or isolated

Acceptance:

- All validators remain in consensus and keep advancing

## P2 — Post-Deploy Smoke Checks

### T-7. Run Chain Health Checks

- [ ] `eth_blockNumber` increases on all three servers
- [ ] `net_peerCount` is stable on all three servers
- [ ] `eth_gasPrice` remains `0x0`
- [ ] `baseFeePerGas` remains `0x0`

### T-8. Run Repository-Side Probe Against Testnet RPC

If RPC is only reachable internally, run this on Server A or through SSH.

Command:

```bash
cd /opt/clawnet

CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545 \
node scripts/test-ed25519-precompile.mjs
```

Checklist:

- [ ] Probe script prints `valid: true`
- [ ] Probe script prints `invalid: false`
- [ ] No revert or backend-unavailable error occurs

### T-9. Run Focused Contract Test Against Testnet RPC

Command:

```bash
cd /opt/clawnet

CLAWNET_BESU_PRECOMPILE_TEST=1 \
CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545 \
pnpm contracts:test:ed25519:besu
```

Checklist:

- [ ] Focused Besu contract test passes unchanged
- [ ] No contract-side adapter changes were needed for the custom image

## P3 — Observation Window

### T-10. Observe for Stability

- [ ] Observe for at least 24 hours
- [ ] Confirm no consensus divergence
- [ ] Confirm no recurring Besu process exits
- [ ] Confirm clawnetd REST and P2P remain healthy on top of the custom chain runtime

Suggested observation items:

- block height progression
- peer count stability
- validator set stability
- `clawnetd` health endpoint
- application logs for unexpected precompile-related exceptions

Acceptance:

- No runtime instability attributable to the custom image is observed during the window

## P4 — Rollback Procedure

Rollback immediately if any of the following happen:

- [ ] blocks stop advancing
- [ ] validator nodes disagree on the same precompile input
- [ ] Besu exits repeatedly
- [ ] the repository probe fails on testnet after rollout

### T-11. Roll Back to Previous Stable Image

Use the same deployment path, but inject the previous stable image.

Command:

```bash
cd infra/testnet/prod

CLAWNET_BESU_IMAGE=<previous-stable-image> \
SSH_KEY_PATH=~/.ssh/id_ed25519_clawnet \
bash deploy.sh
```

Checklist:

- [ ] Previous stable image tag is known
- [ ] Previous stable image digest is known
- [ ] All three validators restart on the rollback image

### T-12. Confirm Recovery After Rollback

- [ ] `eth_blockNumber` resumes increasing
- [ ] `net_peerCount` returns to expected values
- [ ] `qbft_getValidatorsByBlockNumber("latest")` returns the expected validator set
- [ ] `GET /api/v1/node` returns healthy data on the application side

Acceptance:

- Testnet is back to a known-good operating state

## P5 — Closeout

### T-13. Record Outcome

- [ ] Record the final image tag and digest used
- [ ] Record whether rollout succeeded or rolled back
- [ ] Record probe/contract-test outcomes
- [ ] Save notes in `docs/handover/` or an equivalent ops note

## Minimal Done Definition

The testnet rollout is complete only when all items below are true:

- [ ] Custom image tag and digest are recorded
- [ ] All 3 validators run the same custom image
- [ ] Probe script passes on testnet
- [ ] Focused Besu contract test passes on testnet
- [ ] Observation window completes without consensus instability
- [ ] Rollback image is documented even if rollback was not needed