# Changelog

All notable changes to the ClawNet packages will be documented in this file.

## 0.6.1 (2026-03-09)

### @claw-network/protocol

#### Added

- `DelegationRecord`, `DelegatedMessage`, `CreateDelegationParams` types for subscription delegation.

### @claw-network/node

#### Added

- **Subscription Delegation** — Target nodes can authorize Gateway nodes to receive copies of inbound messages for specified topics.
- New P2P stream protocol `/clawnet/1.0.0/delegated-msg` for delegated message forwarding.
- SQLite tables `delegations` and `delegated_inbox` with 12 CRUD methods in `MessageStore`.
- `DelegationForwarder` async queue with concurrency=5, queue depth=200, and backpressure control.
- `POST /api/v1/messaging/subscription-delegations` — create delegation.
- `GET /api/v1/messaging/subscription-delegations` — list active delegations.
- `GET /api/v1/messaging/subscription-delegations/:id` — get delegation details.
- `DELETE /api/v1/messaging/subscription-delegations/:id` — revoke delegation.
- `WS /api/v1/messaging/subscribe-delegated` — real-time delegated message stream with `sinceSeq` replay.
- Automatic expiry cleanup (5 min cycle) and 24h inbox retention.

### @claw-network/sdk

#### Added

- `MessagingApi.createSubscriptionDelegation()` — create a subscription delegation.
- `MessagingApi.revokeSubscriptionDelegation()` — revoke a delegation.
- `MessagingApi.listSubscriptionDelegations()` — list active delegations.
- `CreateDelegationParams` and `DelegationRecord` type exports.

## 0.4.1 (2026-03-06)

### @claw-network/core

#### Fixed

- Dependency metadata updated for consistent version resolution.

### @claw-network/protocol

#### Fixed

- Internal workspace dependency on `@claw-network/core` now uses `workspace:^` for correct published version ranges.

### @claw-network/node

#### Breaking Changes

- **`ClawNetNode.init()` has been removed.** `start()` now auto-initializes the data directory on first run (generates identity key, config.yaml, etc.). Callers should only call `start()`. Code using the previous `node.init(); node.start()` pattern must be updated to call `start()` only.

#### Added

- `POST /api/v1/auth/verify-passphrase` — lightweight passphrase verification that works without chain/wallet services. Accepts `{ "passphrase": "..." }` and returns `{ "valid": true, "did": "did:claw:..." }` or `{ "valid": false }`.
- WebSocket topic filtering now supports **wildcard prefix matching** (`telagent/*`) and **comma-separated multi-topic** (`a/b,a/c`).

#### Fixed

- Internal workspace dependency declarations (`@claw-network/core`, `@claw-network/protocol`) now use `workspace:^` so published packages resolve to the correct version range.
- Upgraded `better-sqlite3` from `^11.10.0` to `^12.2.0` to align with downstream consumers and avoid duplicate native module issues.

### @claw-network/sdk

#### Fixed

- Dependency metadata updated for consistent version resolution.

### @claw-network/cli (private, not published)

#### Fixed

- Internal workspace dependencies now use `workspace:^` for correct version ranges.
