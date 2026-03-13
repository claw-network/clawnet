# ClawNet Besu Custom Patch Inventory

This document records the ClawNet-owned Besu patch stack that must survive regular Besu upgrades.

Do not treat the Besu submodule as a generic scratch space. Any change listed here is expected to live on the ClawNet Besu fork branch and be replayed onto newer upstream Besu releases.

## Active Patch Branch

- local branch name: `clawnet/ed25519-precompile`
- fork repository: `https://github.com/claw-network/besu.git`
- upstream Besu base: `24.12.2`
- current submodule baseline commit: `eaa75ac`

Until a writable fork remote is configured and published, this branch is only a local staging branch.

## Current Patch Set

### 1. Ed25519 Precompile Implementation

Purpose:

- expose a deterministic Ed25519 verification precompile for ClawNet at `0x0100`

Files:

- `infra/besu/upstream/evm/src/main/java/org/hyperledger/besu/evm/precompile/Ed25519VerifyPrecompiledContract.java`
- `infra/besu/upstream/evm/src/main/java/org/hyperledger/besu/evm/precompile/MainnetPrecompiledContracts.java`

External contract that must remain stable unless there is an explicit breaking decision:

- precompile address: `0x0100`
- input layout: `message[32] || signature[64] || publicKey[32]`
- output layout: 32-byte bool
- malformed input: fail-closed / exceptional halt
- fixed gas cost: `5000`

### 2. Fork-Side Validation Tests

Purpose:

- verify the ClawNet fixed test vectors and regression behavior inside the Besu fork

Files:

- `infra/besu/upstream/evm/src/test/java/org/hyperledger/besu/evm/precompile/Ed25519VerifyPrecompiledContractTest.java`
- `infra/besu/upstream/ethereum/core/src/test/java/org/hyperledger/besu/ethereum/mainnet/MainnetPrecompiledContractRegistriesTest.java`

Coverage goals:

- valid signature returns `true`
- tampered signature returns `false`
- wrong public key returns `false`
- malformed input halts
- registration remains present in the active mainnet-style registry

## Upgrade Rule

Every Besu upgrade must preserve all patch groups above.

The correct workflow is:

1. fetch the newer upstream Besu release
2. create an upgrade branch from that new release
3. replay the ClawNet patch stack
4. resolve conflicts
5. re-run focused Besu tests and repository integration tests

Use:

- `infra/besu/upgrade-fork.sh`
- `infra/besu/upgrade-workflow.md`

## Parent Repo Rule

Only after these patches are published to the writable ClawNet Besu fork should the parent repository pin a fork-only Besu submodule commit.

If the parent repository still points the submodule remote at official Besu, fresh clones cannot fetch a fork-only commit.