# ClawNet Copilot Instructions

## Architecture Overview

pnpm monorepo (`pnpm-workspace.yaml`) with layered packages:

```
packages/core       — Crypto (Ed25519, @noble), storage (LevelDB), encoding, P2P primitives
packages/protocol   — Event-sourced reducers: identity, wallet, markets, contracts, reputation, DAO
packages/node       — Daemon: HTTP API (node:http custom router), services (ethers.js ↔ chain), P2P (libp2p), indexer (SQLite)
packages/cli        — CLI binary (`clawnet`)
packages/sdk        — TypeScript SDK (`ClawNetClient`) — REST only, NO ethers.js
packages/sdk-python — Python SDK (httpx)
packages/contracts  — Solidity (Hardhat + OZ UUPS upgradeable proxies), chainId 7625
packages/wallet     — Wallet webapp
```

**Data flow**: Agent/User → SDK/CLI → REST API (:9528) → Node service layer → Smart contracts (Geth PoA) + SQLite indexer.

All chain interaction is encapsulated in `packages/node/src/services/`. The SDK and CLI never touch ethers.js directly.

### Key Internal Patterns

- **Custom HTTP router** (`packages/node/src/api/router.ts`): lightweight path-matching on `node:http`, NOT Express/Fastify. Route handlers in `api/routes/*.ts`.
- **Response envelope**: All 2xx → `{ data, meta?, links? }`. Errors → RFC 7807 Problem Details. See `api/response.ts` helpers: `ok()`, `paginated()`, `badRequest()`, `notFound()`, etc.
- **RuntimeContext** (`api/types.ts`): injected into all route modules; carries stores, services, config.
- **ContractProvider** (`services/contract-provider.ts`): loads ABIs from Hardhat artifacts, manages ethers `JsonRpcProvider` + `NonceManager` signer, exposes typed contract instances.
- **Per-DID EVM addresses**: `deriveAddressForDid(did)` in `identity-service.ts` — `keccak256("clawnet:did-address:" + did)` last 20 bytes. Transfers use burn/mint via node signer (MINTER_ROLE + BURNER_ROLE). **Never change this derivation** without a migration.
- **Indexer** (`node/src/indexer/`): polls chain via `eth_getLogs`, writes to `better-sqlite3`. Tables: `events`, `transfers`, `escrows`, `proposals`, etc.
- **Auth**: API key via `X-Api-Key` header or `Authorization: Bearer`. GET `/api/v1/node` is always public.

## Critical Naming Conventions

### Currency Unit: **Token** (NOT "CLAW")

The native currency unit is **Token** (plural: **Tokens**). Token amounts are integers (0 decimals).

- ✅ "转账 100 Token", "balance: 500 Tokens", "fee: 1 Token"
- ❌ "转账 100 CLAW", "balance: 500 CLAW"

"CLAW" only appears as prefix: ClawNet, ClawToken.sol, @claw-network/*, CLAW_PASSPHRASE, did:claw:, clawnetd.com.

### Fixed Ports

| Port | Purpose |
|------|---------|
| 9527 | P2P libp2p TCP |
| 9528 | HTTP REST API |

### DID Format

`did:claw:` + multibase(base58btc(Ed25519 public key))

### Class & File Naming (No "OnChain" / "Chain" markers)

SDK = REST client only. Chain logic lives in Node services. SDK has NO ethers.js dependency.

| Role | Pattern | Example | Package |
|------|---------|---------|---------|
| REST client | `*Api` | `WalletApi` | `packages/sdk` |
| Node service | `*Service` | `WalletService` | `packages/node` |
| Config | `*Config` | `WalletConfig` | various |
| Data types | natural names | `ServiceContract`, `Milestone` | various |

- ❌ Never: `WalletOnChainApi`, `WalletChainConfig`, `wallet-onchain.ts`, `wallet.chain.test.ts`
- ✅ Merge chain tests into existing test files: `wallet-service.test.ts`

CLI: `clawnet wallet balance` (NOT `clawnet onchain wallet balance`)

## Developer Workflows

```bash
pnpm install && pnpm build          # Full build (tsc -b across packages)
pnpm test                            # All tests (vitest across packages)
pnpm --filter @claw-network/node test           # Single package
pnpm --filter @claw-network/node test:services  # Service-layer tests only
pnpm --filter @claw-network/contracts test      # Hardhat Solidity tests
pnpm --filter @claw-network/contracts compile   # Compile contracts
pnpm lint                            # ESLint across monorepo
```

**Testing**: vitest, use `vi` for mocks. Tests mock `ContractProvider` + `IndexerQuery`; no live chain needed for unit tests.

**Integration tests** (Docker testnet — 3 nodes):
```bash
docker compose -f docker-compose.testnet.yml up --build -d
node scripts/integration-test.mjs [--verbose]
```

**Deploy to server** (testnet):
```bash
git push origin main
ssh root@66.94.125.242 "cd /opt/clawnet && git pull origin main && pnpm build && systemctl restart clawnetd"
```

## Testnet Server & Credentials

| Item | Value |
|------|-------|
| **Server IP** | `66.94.125.242` (Ubuntu 24.04) |
| **SSH** | `ssh -i ~/.ssh/id_ed25519_clawnet root@66.94.125.242` |
| **Code path** | `/opt/clawnet/` |
| **Node service** | `clawnetd.service` (⚠️ `clawnetd`, NOT `clawnet`) |
| **API Key** | `401ca444cbe821f7799e505c26df7f9ee3226f9082f9da2c464236b0b2034ae2` |
| **Deployer / Node Signer** | `0xA9b95A4fDCD673f6aE0D2a873E0f4771CA7D0119` |
| **Deployer Private Key** | `0xb82233d82380d02515be20629f27539001cf8227a811eba90117333e84fe30fc` |
| **Chain** | Docker container `clawnet-geth` (Geth v1.13.15, Clique PoA, chainId 7625) |
| **Docker Compose (chain)** | `/opt/clawnet/docker-compose.chain.yml` |
| **Reverse proxy** | Caddy (`caddy.service`), Caddyfile at `/etc/caddy/Caddyfile` |

Test DID: `did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR` → derived EVM `0x130Eb2b6C2CA8193c159c824fccE472BB48F0De3`

## Smart Contracts

Solidity 0.8.28, Hardhat, OpenZeppelin UUPS upgradeable. Key contracts: ClawToken (ERC-20, 0 decimals), ClawIdentity (DID registry), ClawEscrow, ClawStaking, ClawDAO, ClawContracts, ClawReputation, ClawRouter, ParamRegistry.

Production proxy addresses are in `infra/testnet/prod/contracts.json` (authoritative, NOT `packages/contracts/deployments/`).

UUPS upgrades bypass OZ manifest — use `packages/contracts/scripts/upgrade-identity.ts` pattern (direct `upgradeToAndCall`).

## Web Apps Deployment

All web apps are on the same server (`66.94.125.242`), behind Caddy with auto-TLS.

### Wallet (`packages/wallet`) — wallet.clawnetd.com

Static SPA (Vite 6). Caddy serves from `packages/wallet/dist` with `try_files {path} /index.html`.

```bash
ssh root@66.94.125.242 "cd /opt/clawnet && git pull origin main && pnpm --filter @claw-network/wallet build"
```

### Homepage (`packages/homepage`) — clawnetd.com

Static SPA (Vite 6). Caddy serves from `packages/homepage/dist`. Note: `/install.sh` is served separately from `/var/www/clawnetd/install.sh`.

```bash
ssh root@66.94.125.242 "cd /opt/clawnet && git pull origin main && pnpm --filter @claw-network/homepage build"
```

### Docs (`packages/docs`) — docs.clawnetd.com

Next.js 15 + Fumadocs (Tailwind v4). Runs as a systemd service (`clawnet-docs.service`) on port 3001, reverse-proxied by Caddy.

```bash
ssh root@66.94.125.242 "cd /opt/clawnet && git pull origin main && cd packages/docs && pnpm build && systemctl restart clawnet-docs"
```

Detailed deployment procedures: `skills/deploy-wallet.md`, `skills/deploy-homepage.md`, `skills/deploy-docs.md`.

## Reference Documents

- [CONVENTIONS.md](../../CONVENTIONS.md) — Full canonical conventions (frozen spec)
- [protocol-spec.md](../../docs/implementation/protocol-spec.md) — Protocol specification
- [SPEC_FREEZE.md](../../docs/implementation/SPEC_FREEZE.md) — Frozen spec constraints
- [docs/api/openapi.yaml](../../docs/api/openapi.yaml) — OpenAPI spec (48 endpoints)
- [TESTING.md](../../TESTING.md) — Testing guide (unit + Docker integration)
- [docs/handover/](../../docs/handover/) — Agent handover notes with system state
