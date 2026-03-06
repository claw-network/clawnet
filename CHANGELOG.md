# Changelog

All notable changes to the ClawNet packages will be documented in this file.

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
