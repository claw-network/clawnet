# Ed25519 Precompile Spec

This document is the implementation handoff for the ClawNet Besu-side Ed25519 precompile.

It defines the external contract that the Besu fork must satisfy so the Solidity adapter and repository integration tests continue to work unchanged.

## Scope

- Runtime target: Hyperledger Besu fork used by ClawNet QBFT networks
- Precompile address: `0x0100`
- Consumer contract: `packages/contracts/contracts/libraries/Ed25519Verifier.sol`
- Current integration entrypoints:
  - `infra/devnet/docker-compose.ed25519.yml`
  - `scripts/test-ed25519-precompile.mjs`
  - `packages/contracts/test/Ed25519Verifier.besu.test.ts`

## Interface Contract

### Address

- The precompile must be registered at `0x0100`.
- Do not change the Solidity-side address.

### Input

The call data is exactly 128 bytes:

```text
message[32] || signature[64] || publicKey[32]
```

Field layout:

- Bytes `0..31`: Ed25519 message payload as raw 32-byte value
- Bytes `32..95`: Ed25519 signature
- Bytes `96..127`: Ed25519 public key

No ABI framing is used.

### Output

Return at least 32 bytes.

Repository-side Solidity semantics are:

- `output[31] == 1` -> verification success
- any other value -> verification failure

Recommended canonical return values:

- success: `0x0000000000000000000000000000000000000000000000000000000000000001`
- failure: `0x0000000000000000000000000000000000000000000000000000000000000000`

### Failure Semantics

The backend must distinguish between two classes of result:

1. Verification completed and signature is invalid:
   return the 32-byte `false` value
2. Backend unavailable or execution failed before verification completed:
   revert or otherwise fail the precompile call so Solidity surfaces `Ed25519VerificationUnavailable()`

For malformed input length, the preferred behavior is to fail execution rather than silently coerce input.

## Determinism Requirements

- Use a mature Ed25519 implementation; do not implement curve arithmetic from scratch.
- The same input must return the same output on every validator.
- Do not depend on wall-clock time, randomness, locale, or host-specific settings.
- Gas charging must be fixed and deterministic.

## Fixed Test Vectors

These vectors are already wired into the repository-side probe script.

### Valid Vector

- message:

```text
0x0303030303030303030303030303030303030303030303030303030303030303
```

- publicKey:

```text
0xea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c
```

- signature:

```text
0x47d8693b0cafc1845decc1093ea317b814c9cad0bc02329d5765c3c95d96a54b3866f1c120b04579a8f5e9c1b0ac63db51561f2b7d1f64eb3c35dda329a4b004
```

- expected return:

```text
0x0000000000000000000000000000000000000000000000000000000000000001
```

### Invalid Vector

The repository uses the same message and public key, but mutates the last byte of the signature.

- message:

```text
0x0303030303030303030303030303030303030303030303030303030303030303
```

- publicKey:

```text
0xea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c
```

- signature:

```text
0x47d8693b0cafc1845decc1093ea317b814c9cad0bc02329d5765c3c95d96a54b3866f1c120b04579a8f5e9c1b0ac63db51561f2b7d1f64eb3c35dda329a4b005
```

- expected return:

```text
0x0000000000000000000000000000000000000000000000000000000000000000
```

## Repository Verification Commands

Once a custom Besu image is built, the repository-side acceptance path is:

### Start the custom image locally

```bash
cd infra/devnet

CLAWNET_BESU_IMAGE=clawnet/besu-ed25519:dev \
docker compose -f docker-compose.ed25519.yml up -d
```

### Run the direct probe

```bash
cd /path/to/clawnet

CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545 \
node scripts/test-ed25519-precompile.mjs
```

### Run the focused contract test

```bash
cd /path/to/clawnet

CLAWNET_BESU_PRECOMPILE_TEST=1 \
CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545 \
pnpm contracts:test:ed25519:besu
```

## Acceptance Checklist

The Besu fork is acceptable for testnet rollout only if all items below are true:

- `0x0100` is registered and callable
- valid vector returns `true`
- tampered vector returns `false`
- malformed input does not produce an ambiguous success result
- repeated calls from multiple nodes return identical results
- the repository probe and contract test both pass unchanged

## Non-Goals

- This spec does not require changing `ClawIdentity` main-path behavior.
- This spec does not define the internal Besu extension point to use.
- This spec does not fix the gas cost to an exact number, only that it must be deterministic and documented.