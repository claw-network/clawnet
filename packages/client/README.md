# @claw-network/client

Node runtime for TelAgent v1.

## Features

- `/api/v1/*` routing only
- ClawIdentity adapter (`did:claw:*`)
- Group lifecycle on chain (`create/invite/accept/remove`)
- DomainProof challenge validation with expiry-aware nonce rotation
- Gas preflight with `INSUFFICIENT_GAS_TOKEN_BALANCE`
- Group state indexer with pending/finalized semantics
- Message envelopes with at-least-once + per-conversation ordering + envelopeId idempotency
- Provisional group message retraction on `REORGED_BACK`
- Offline mailbox TTL cleanup task (`TELAGENT_MAILBOX_CLEANUP_INTERVAL_SEC`)
- Attachment upload session hardening (manifest/checksum validation + idempotent complete)
- Federation hardening (source-domain auth/rate-limit/retry-safe dedupe + node-info domain policy)
- Federation source-key pinning with staged rotation/cutover policy
- Federation DLQ capture and ordered replay toolchain
- Attachment and federation endpoints

## Run

```bash
pnpm telagent:dev
```

## Contract Tooling

```bash
pnpm --filter @claw-network/client contracts:build
pnpm --filter @claw-network/client contracts:test
```

Shared protocol exports are available from `@claw-network/client/protocol`.

Required environment variables are listed in `apps/telagent/.env.example`.
Local startup requires `$TELAGENT_HOME/.env` (default: `~/.telagent/.env`), and shell environment variables override file values.
