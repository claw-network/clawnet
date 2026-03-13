# Besu Ed25519 Implementer + Ops Handoff

This is the shortest possible handoff for the people responsible for the Besu fork implementation and the chain rollout.

## Objective

Deliver a Besu custom image that exposes an Ed25519 verification precompile at `0x0100`, then validate it in the ClawNet repository and roll it out through testnet before any mainnet use.

## Runtime Contract

- Address: `0x0100`
- Input: `message[32] || signature[64] || publicKey[32]`
- Output: 32-byte bool
  - success -> `...01`
  - invalid signature -> `...00`
- Backend failure must still surface as `Ed25519VerificationUnavailable()` through the Solidity adapter

Authoritative interface doc:

- `infra/besu/ed25519-precompile-spec.md`

## Source Baseline

- Besu source lives in the repository as a git submodule at `infra/besu/upstream`
- Current pinned baseline: tag `24.12.2` at commit `eaa75ac`
- ClawNet fork URL: `https://github.com/claw-network/besu.git`
- Remote convention:
  - `origin` -> ClawNet fork
  - `upstream` -> official Besu

Initialize the submodule in a fresh clone with:

```bash
git submodule update --init --recursive infra/besu/upstream
```

To attach your writable fork remote and create the working branch:

```bash
BESU_FORK_URL=https://github.com/claw-network/besu.git \
infra/besu/bootstrap-fork.sh
```

To move the ClawNet patch stack onto a newer Besu release:

```bash
BESU_SOURCE_BRANCH=clawnet/ed25519-precompile \
infra/besu/upgrade-fork.sh 24.12.3
```

The durable maintenance workflow is documented in:

- `infra/besu/upgrade-workflow.md`
- `infra/besu/custom-patch-inventory.md`

## Repository Validation Path

1. Start the custom image locally with:

```bash
cd infra/devnet

CLAWNET_BESU_IMAGE=clawnet/besu-ed25519:dev \
docker compose -f docker-compose.ed25519.yml up -d
```

2. Fund the local deployer account:

```bash
cd /path/to/clawnet/infra/devnet
./fund-deployer.sh
```

3. Run the direct probe:

```bash
cd /path/to/clawnet
CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545 \
node scripts/test-ed25519-precompile.mjs
```

4. Run the focused contract test:

```bash
cd /path/to/clawnet

CLAWNET_BESU_PRECOMPILE_TEST=1 \
CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545 \
pnpm contracts:test:ed25519:besu
```

5. Re-run the no-backend baseline:

```bash
cd /path/to/clawnet/packages/contracts
pnpm exec hardhat test test/Ed25519Verifier.test.ts
```

## Required Artifacts

Before testnet rollout, the implementation side must hand back:

- custom image tag
- custom image digest
- Besu fork commit or tag
- Besu upgrade branch name for the active release line
- confirmation that the fixed valid vector returns `true`
- confirmation that the fixed tampered vector returns `false`

Record these in:

- `infra/besu/README.md`

## Explicit Testnet Smoke Commands

For a remote testnet smoke run on a validator host, set:

```bash
DEPLOYER_PRIVATE_KEY=<testnet-deployer-private-key> \
CLAWNET_RPC_URL=http://127.0.0.1:8545
```

Then use:

```bash
pnpm ed25519:probe:testnet
pnpm ed25519:test:testnet
```

## Rollout Order

1. Local custom image validation
2. Testnet rollout
3. Testnet observation window
4. Mainnet rollout
5. Separate decision on whether `ClawIdentity` main path should ever consume the precompile

## Operator Checklists

- Testnet rollout:
  - `infra/besu/testnet-rollout-checklist.md`
- Mainnet rollout:
  - `infra/besu/mainnet-rollout-checklist.md`

## Rollout Guardrails Captured In Repository

- `infra/shared/deploy-guardrails.sh` is the shared source of truth for deploy guardrails used by both testnet and mainnet rollout scripts.
- `infra/testnet/prod/deploy.sh` now pre-stashes dirty remote repositories before `git pull --ff-only`.
- `infra/testnet/prod/deploy.sh` pre-pulls the Besu image on every validator, retries with GHCR login when needed, and fails early on architecture mismatches.
- `infra/testnet/prod/deploy.sh` now runs the Ed25519 probe and focused Besu contract test automatically on Server A during rollout.
- `infra/testnet/prod/deploy.sh` performs stronger `clawnetd` restart health checks and dumps service logs on failure.

## Important Constraints

- Do not change the Solidity precompile address
- Do not change repository-side probe vectors unless the interface contract changes and all dependent docs are updated
- Do not couple Besu rollout with `ClawIdentity` main-path changes
- Use `CLAWNET_BESU_IMAGE` as the only runtime image override path
- Do not rely on unpublished submodule working-tree edits as the long-term home of the Besu customization