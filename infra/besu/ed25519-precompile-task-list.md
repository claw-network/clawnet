# Ed25519 Precompile Task List

This checklist turns the Besu `0x0100` Ed25519 precompile plan into concrete work items for implementation, image delivery, and repository-side validation.

Status markers:

```text
[ ] not started
[~] in progress
[x] completed
[!] blocked
```

## P0 — Besu Fork Implementation

### B-1. Freeze Fork Baseline

- [x] Choose the exact upstream Besu version to fork
- [x] Record the upstream tag or commit in `infra/besu/README.md`
- [x] Create the fork branch for the Ed25519 precompile work
- [x] Decide the image naming convention for local, CI, and testnet builds

Acceptance:

- Upstream version is recorded
- Fork branch exists
- Output image naming scheme is agreed and documented

Current repository baseline:

- submodule path: `infra/besu/upstream`
- pinned tag: `24.12.2`
- pinned commit: `eaa75ac`

### B-2. Register Precompile at `0x0100`

- [x] Identify the Besu precompile registration hook used by the active EVM schedule
- [x] Register `0x0100` without changing any Solidity-side address
- [x] Ensure the registration is active on the ClawNet chain configuration actually used by devnet/testnet/mainnet

Acceptance:

- `staticcall(0x0100, ...)` reaches the new backend
- No other address mapping is introduced

### B-3. Implement Input Decoder

- [x] Decode exactly 128 bytes of input
- [x] Split fields as `message[32] || signature[64] || publicKey[32]`
- [x] Reject malformed length deterministically

Acceptance:

- 128-byte input decodes successfully
- Non-128-byte input does not yield an ambiguous success result

### B-4. Integrate Ed25519 Verification Library

- [x] Select the Ed25519 library used inside the Besu fork
- [x] Document the chosen library and version
- [x] Verify the implementation is deterministic across validator nodes
- [x] Avoid writing custom curve arithmetic from scratch

Acceptance:

- Valid vector verifies successfully
- Tampered vector fails cleanly
- Implementation choice is documented for maintenance

Implementation note:

- Current fork implementation uses the JDK Ed25519 provider via `KeyFactory("Ed25519")` and `Signature("Ed25519")`.

### B-5. Define Return Semantics

- [x] Return 32-byte `true` for valid signatures
- [x] Return 32-byte `false` for invalid signatures
- [x] Fail execution for backend-unavailable or malformed execution cases

Acceptance:

- Repository-side Solidity adapter sees `true` for the valid vector
- Repository-side Solidity adapter sees `false` for the tampered vector
- Backend failure still surfaces `Ed25519VerificationUnavailable()`

## P1 — Besu Fork Test Coverage

### B-6. Add Unit Tests in the Besu Fork

- [x] Valid signature test
- [x] Invalid signature test
- [x] Wrong public key test
- [x] Wrong input length test
- [x] Empty input test
- [x] Repeated-call determinism test

Acceptance:

- All fork-side unit tests pass in CI

### B-7. Capture Fixed ClawNet Vectors

- [x] Use the fixed vectors from `infra/besu/ed25519-precompile-spec.md`
- [x] Verify the exact valid vector returns `true`
- [x] Verify the exact tampered vector returns `false`

Acceptance:

- ClawNet vectors are wired into fork-side tests unchanged

## P2 — Image Build and Delivery

### B-8. Build Local Development Image

- [x] Produce `clawnet/besu-ed25519:dev` or equivalent local tag
- [x] Start it through `infra/devnet/docker-compose.ed25519.yml`
- [x] Confirm RPC is available on `http://127.0.0.1:8545`

Acceptance:

- Local image boots successfully through the existing compose file

### B-9. Build Shared Image Artifact

- [ ] Produce a shared image tag such as `ghcr.io/claw-network/besu-ed25519:<git-sha>`
- [ ] Record the image digest in `infra/besu/README.md`
- [ ] Publish build provenance or minimal build notes

Acceptance:

- Shared image tag and digest are recorded

## P3 — Repository Integration Validation

### B-10. Run Direct Probe Script

- [x] Start the custom Besu image locally
- [x] Run `node scripts/test-ed25519-precompile.mjs`
- [x] Confirm the script reports `valid=true` and `invalid=false`

Acceptance:

- Probe script passes unchanged

### B-11. Run Focused Contract Test

- [x] Set `CLAWNET_BESU_PRECOMPILE_TEST=1`
- [x] Set `CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545`
- [x] Run `pnpm contracts:test:ed25519:besu`

Acceptance:

- The focused Besu test passes unchanged

### B-12. Re-run Fail-Closed Baseline

- [x] Run `pnpm --filter @claw-network/contracts exec hardhat test test/Ed25519Verifier.test.ts`
- [x] Confirm the local Hardhat network still reverts with `Ed25519VerificationUnavailable()` when no backend exists

Acceptance:

- Local no-backend semantics remain unchanged

## P4 — Testnet Rollout Preparation

### B-13. Wire Testnet Image Override

- [ ] Set `CLAWNET_BESU_IMAGE` to the shared custom image tag during deployment
- [x] Verify `infra/testnet/prod/deploy.sh` propagates the intended image
- [ ] Record the exact tag used for testnet

Acceptance:

- All testnet validators run the same custom image tag

### B-14. Execute Testnet Smoke Checks

- [ ] Confirm blocks continue progressing
- [ ] Confirm peer counts remain healthy
- [ ] Run the repository probe against testnet RPC if exposed internally
- [ ] Confirm no consensus divergence is observed

Acceptance:

- Testnet remains stable for the observation window

## P5 — Handover Back to Contracts / Governance

### B-15. Decide Whether to Use Main-Path Ed25519 On-Chain

- [ ] Keep `ClawIdentity` unchanged until the testnet window completes
- [ ] Write the phase-2 design for feature flagging if main-path adoption is still desired
- [ ] Define rollback behavior before any contract-side switch

Acceptance:

- There is a written go/no-go decision for main-path adoption

## Blocking Conditions

Mark the work blocked if any of the following happen:

- [ ] The Besu extension point cannot register a deterministic `0x0100` precompile on the active chain schedule
- [ ] The chosen Ed25519 library is not deterministic across environments
- [ ] The probe script and contract test require repository-side changes beyond the published interface contract
- [ ] Validator nodes return different answers for the same input

## Minimal Done Definition

The Besu precompile is ready for testnet rollout only when all items below are true:

- [x] `infra/besu/ed25519-precompile-spec.md` remains accurate
- [x] valid vector returns `true`
- [x] tampered vector returns `false`
- [x] `node scripts/test-ed25519-precompile.mjs` passes
- [x] `pnpm contracts:test:ed25519:besu` passes
- [ ] shared image tag and digest are recorded
- [x] testnet deploy path uses the custom image through `CLAWNET_BESU_IMAGE`