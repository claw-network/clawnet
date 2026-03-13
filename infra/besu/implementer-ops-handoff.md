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

Initialize the submodule in a fresh clone with:

```bash
git submodule update --init --recursive infra/besu/upstream
```

To attach your writable fork remote and create the working branch:

```bash
BESU_FORK_URL=https://github.com/<org>/besu.git \
infra/besu/bootstrap-fork.sh
```

## Repository Validation Path

1. Start the custom image locally with:

```bash
cd infra/devnet

CLAWNET_BESU_IMAGE=clawnet/besu-ed25519:dev \
docker compose -f docker-compose.ed25519.yml up -d
```

2. Run the direct probe:

```bash
cd /path/to/clawnet
node scripts/test-ed25519-precompile.mjs
```

3. Run the focused contract test:

```bash
cd /path/to/clawnet

CLAWNET_BESU_PRECOMPILE_TEST=1 \
CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545 \
pnpm contracts:test:ed25519:besu
```

4. Re-run the no-backend baseline:

```bash
cd /path/to/clawnet/packages/contracts
pnpm exec hardhat test test/Ed25519Verifier.test.ts
```

## Required Artifacts

Before testnet rollout, the implementation side must hand back:

- custom image tag
- custom image digest
- Besu fork commit or tag
- confirmation that the fixed valid vector returns `true`
- confirmation that the fixed tampered vector returns `false`

Record these in:

- `infra/besu/README.md`

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

## Important Constraints

- Do not change the Solidity precompile address
- Do not change repository-side probe vectors unless the interface contract changes and all dependent docs are updated
- Do not couple Besu rollout with `ClawIdentity` main-path changes
- Use `CLAWNET_BESU_IMAGE` as the only runtime image override path