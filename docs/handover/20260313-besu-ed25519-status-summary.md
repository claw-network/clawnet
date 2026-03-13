# 2026-03-13 Besu Ed25519 Work Summary and Next Plan

## Scope Summary

This workstream delivered the Besu-side Ed25519 precompile implementation, validated it locally and on ClawNet testnet, published a shared amd64 image, rolled that image into testnet, and then hardened both the testnet and mainnet deployment paths so the same rollout failures are less likely to recur.

This summary is the short operational state document for what has been finished and what should happen next.

## Completed Work

### 1. Besu Fork and Repository Integration

- Forked Besu work is based on ClawNet fork branch `clawnet/ed25519-precompile`.
- Active Besu fork commit for the Ed25519 rollout work: `494c77f440`.
- Solidity-side adapter remains fail-closed and preserves `Ed25519VerificationUnavailable()` semantics when no backend exists.
- Repository-side direct probe and focused Besu contract test paths were validated locally against the custom image.
- Local Dockerized Besu devnet validation path was fixed to use chainId `1337` and explicit deployer funding.

### 2. Shared Image Delivery

- A shared GHCR image was published for the Besu fork.
- Final testnet-suitable rollout image:
  - `ghcr.io/claw-network/besu-ed25519:24.12.2-494c77f440-amd64`
- Final digest:
  - `sha256:d382a32799010d236b709503b39356deb66119cb8fee0d96455116d8433d1725`
- A first published arm64 image existed but was not suitable for amd64 validators.

### 3. Testnet Rollout and Validation

- Testnet validators were rolled to the custom Besu image.
- Contracts were redeployed and bootstrap mint completed on testnet.
- The direct Ed25519 probe passed on testnet.
- The focused Besu contract test passed on testnet.
- All three validators were verified advancing with healthy peer counts after rollout recovery.
- All three `clawnetd` services were returned to healthy `active` state.

Reference note:

- `docs/handover/20260313-besu-ed25519-testnet-rollout.md`

### 4. Rollout Hardening Landed In Repository

- `infra/testnet/prod/deploy.sh` now pre-stashes dirty remote repos before `git pull --ff-only`.
- `infra/testnet/prod/deploy.sh` now pre-pulls the Besu image, retries GHCR login when credentials are provided, and fails early on image architecture mismatches.
- `infra/testnet/prod/deploy.sh` now auto-runs the Ed25519 probe and focused Besu contract test during rollout.
- `infra/testnet/prod/deploy.sh` now performs stronger `clawnetd` restart health checks and dumps service logs on failure.
- `infra/mainnet/prod/deploy.sh` now mirrors the same guardrails.
- Both rollout paths now share `infra/shared/deploy-guardrails.sh` as the source of truth for common deployment guardrails.
- Repository command entrypoints now include explicit testnet and mainnet Ed25519 smoke commands.

## Problems Encountered and How They Were Addressed

### Architecture Mismatch

- Problem:
  - The first shared image was built as `linux/arm64` on Apple Silicon and failed on amd64 validator hosts with `exec format error`.
- Repository response:
  - Deployment scripts now pre-pull the image on every target validator and fail early if image architecture and host architecture do not match.

### Private GHCR Pull Failures

- Problem:
  - Validators could not pull the GHCR image without registry authentication.
- Repository response:
  - Rollout scripts now support `GHCR_USERNAME` and `GHCR_TOKEN`, retrying image pull after `docker login ghcr.io` when needed.

### Dirty Remote Repositories Blocking `git pull`

- Problem:
  - Generated files on the servers caused `git pull` to fail during rollout.
- Repository response:
  - Rollout scripts now detect dirty server worktrees before deployment and auto-stash them by default before `git pull --ff-only`.

### Testnet Smoke Tests Using Wrong Defaults

- Problem:
  - Probe/test wrappers defaulted toward devnet assumptions and needed manual environment overrides during testnet validation.
- Repository response:
  - Explicit `pnpm ed25519:probe:testnet`, `pnpm ed25519:test:testnet`, `pnpm ed25519:probe:mainnet`, and `pnpm ed25519:test:mainnet` entrypoints were added.

### `clawnetd` Handoff Fragility

- Problem:
  - The deploy script exited during the application handoff phase and required manual recovery on Server B.
- Repository response:
  - Rollout scripts now perform stronger post-restart health checks and collect `systemd` logs on failure.

## Current State

### Testnet

- Besu Ed25519 testnet rollout succeeded.
- Testnet smoke validation succeeded.
- Testnet deploy scripts are hardened with the new shared guardrails.
- The observation window is still the main remaining operational gate.

### Mainnet

- Mainnet has not been rolled to the custom Besu image yet.
- Mainnet rollout scripts and docs have been updated to match the hardened testnet path.
- Mainnet remains correctly gated on successful testnet closeout and observation-window completion.

### Contract Adoption Decision

- `ClawIdentity` main path has not been switched to depend on the new precompile.
- That decision remains intentionally deferred until after the testnet window is complete.

## Recommended Next Plan

### Priority 1 — Close the Testnet Observation Window

- Observe testnet for the agreed window.
- Confirm no consensus divergence.
- Confirm no recurring Besu exits.
- Confirm `clawnetd` API and P2P remain healthy across the validator set.
- Update `infra/besu/testnet-rollout-checklist.md` when the observation window is complete.

### Priority 2 — Rotate Exposed Operational Credentials

- Rotate the GHCR token that was pasted into chat and used during image publication and validator logins.
- Confirm replacement credentials are stored only through the intended secure operator path.

### Priority 3 — Decide Mainnet Readiness

- Review testnet observation results.
- Confirm the amd64 rollout image and rollback target are still correct.
- Fill the release inputs in `infra/besu/mainnet-rollout-checklist.md`.
- Do not start mainnet rollout until testnet closeout is explicit and documented.

### Priority 4 — Mainnet Rollout Execution

- Execute mainnet rollout using the hardened `infra/mainnet/prod/deploy.sh` path.
- Use the explicit GHCR credentials path if the package is still private.
- Re-run the mainnet probe and focused contract test through the new package scripts during rollout.

### Priority 5 — Post-Rollout Product Decision

- After testnet observation and any eventual mainnet rollout, make a written go/no-go decision on whether any main-path contract should rely on the precompile.
- If main-path adoption is desired, write the phase-2 design with rollback behavior and feature gating before changing `ClawIdentity` behavior.

## Suggested Follow-Up Engineering Work

- Add a shared observation-window monitoring script so post-rollout validation is less manual.
- Consider recording rollout stash names and recovery hints in deploy output more explicitly.
- Keep testnet and mainnet deploy logic aligned through `infra/shared/deploy-guardrails.sh` rather than reintroducing copy-paste changes.