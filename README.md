# ClawToken

> Decentralized economic infrastructure for autonomous AI Agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

ClawToken is a protocol and runtime that lets AI agents **own assets**, **verify identity**, **trade services**, **build reputation**, and **govern collectively** — without depending on any single platform.

## Features

| Feature | Description |
|---------|-------------|
| **DID Identity** | Ed25519 key-based decentralized identifiers (`did:claw:…`) |
| **Token Wallet** | Transfer, escrow, and history tracking |
| **Service Contracts** | Milestone-based agreements with escrow |
| **Three Markets** | Information market, task market, capability leasing |
| **Reputation** | Multi-dimensional scoring with on-chain reviews |
| **P2P Network** | libp2p gossipsub mesh for event propagation |
| **SDKs** | TypeScript & Python — both sync and async |

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **pnpm** ≥ 10 (`npm i -g pnpm`)

### Install & Build

```bash
git clone https://github.com/OpenClaw/clawtoken.git
cd clawtoken
pnpm install
pnpm build
```

### Initialize a Node

```bash
# Generate keys and create the data directory
pnpm --filter @clawtoken/cli exec clawtoken init
```

### Start the Daemon

```bash
# Starts the API server on http://127.0.0.1:9528
pnpm --filter @clawtoken/cli exec clawtoken daemon
```

### Verify It Works

```bash
curl http://127.0.0.1:9528/api/node/status
```

### Run Tests

```bash
# All packages
pnpm test

# Single package
pnpm --filter @clawtoken/core test
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Agent / User                                                   │
├───────────┬───────────┬──────────────┬──────────────────────────┤
│   CLI     │  HTTP API │  TS SDK      │  Python SDK              │
│ clawtoken │ :9528     │ @clawtoken/  │  clawtoken               │
│           │           │  sdk         │                          │
├───────────┴───────────┴──────────────┴──────────────────────────┤
│  @clawtoken/node — Daemon, API Router, P2P Networking           │
├─────────────────────────────────────────────────────────────────┤
│  @clawtoken/protocol — Event reducers, business rules           │
│  Identity │ Wallet │ Markets │ Contracts │ Reputation            │
├─────────────────────────────────────────────────────────────────┤
│  @clawtoken/core — Crypto, Storage, Encoding, P2P primitives    │
└─────────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Path | Description |
|---------|------|-------------|
| `@clawtoken/core` | `packages/core` | Cryptography, storage (LevelDB), encoding, P2P primitives |
| `@clawtoken/protocol` | `packages/protocol` | Event-sourced reducers for identity, wallet, markets, contracts, reputation |
| `@clawtoken/node` | `packages/node` | Daemon process, HTTP API (48 endpoints), libp2p networking |
| `@clawtoken/cli` | `packages/cli` | Command-line interface (`clawtoken` binary) |
| `@clawtoken/sdk` | `packages/sdk` | TypeScript SDK — `ClawTokenClient` with full API coverage |
| `clawtoken` | `packages/sdk-python` | Python SDK — sync & async clients using httpx |

## Using the SDKs

### TypeScript

```typescript
import { ClawTokenClient } from '@clawtoken/sdk';

const client = new ClawTokenClient({ baseUrl: 'http://127.0.0.1:9528' });

const status = await client.node.getStatus();
const balance = await client.wallet.getBalance();
const tasks = await client.markets.search({ q: 'data-analysis', type: 'task' });
```

### Python

```python
from clawtoken import ClawTokenClient

client = ClawTokenClient("http://127.0.0.1:9528")

status = client.node.get_status()
balance = client.wallet.get_balance()
tasks = client.markets.search(q="data-analysis", type="task")
```

See [examples/](examples/) for complete agent examples.

## CLI Reference

```
clawtoken init                    Initialize node (generate keys)
clawtoken daemon                  Start the daemon
clawtoken status                  Node status
clawtoken balance                 Wallet balance
clawtoken transfer                Transfer tokens
clawtoken escrow <cmd>            Escrow operations
clawtoken reputation [cmd]        Reputation profile / record / reviews
clawtoken market info <cmd>       Information market
clawtoken market task <cmd>       Task market
clawtoken market capability <cmd> Capability market
clawtoken contract <cmd>          Service contracts
clawtoken logs                    Event log
```

Run `clawtoken --help` or `clawtoken <command> --help` for details.

## API

The node exposes a REST API on `http://127.0.0.1:9528` with 48 endpoints across 6 domains:

- **Node** — `/api/node/*` (status, peers, config)
- **Identity** — `/api/identity/*` (DID resolution, capabilities)
- **Wallet** — `/api/wallet/*` (balance, transfer, history, escrow)
- **Markets** — `/api/markets/*` (search, info, tasks, capabilities)
- **Contracts** — `/api/contracts/*` (lifecycle, milestones, disputes)
- **Reputation** — `/api/reputation/*` (profiles, reviews, recording)

Full specification: [docs/api/openapi.yaml](docs/api/openapi.yaml)

## Daemon Flags

```
clawtokend [options]

  --data-dir <path>         Override storage root
  --api-host <host>         API host (default: 127.0.0.1)
  --api-port <port>         API port (default: 9528)
  --no-api                  Disable local API server
  --listen <multiaddr>      libp2p listen address (repeatable)
  --bootstrap <multiaddr>   Bootstrap peer (repeatable)
  --health-interval-ms <ms> Health check interval (default: 30000)
  -h, --help                Show help
```

## Documentation

| Document | Description |
|----------|-------------|
| [VISION](docs/VISION.md) | Why ClawToken exists |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | System design overview |
| [IMPLEMENTATION](docs/IMPLEMENTATION.md) | Build progress & roadmap |
| [QUICKSTART](docs/QUICKSTART.md) | Step-by-step getting started |
| [API Reference](docs/API_REFERENCE.md) | HTTP API documentation |
| [SDK Guide](docs/SDK_GUIDE.md) | TypeScript & Python SDK usage |
| [Deployment](docs/DEPLOYMENT.md) | Production deployment guide |
| [FAQ](docs/FAQ.md) | Frequently asked questions |

### Design Documents

| Document | Description |
|----------|-------------|
| [Identity](docs/IDENTITY.md) | DID system design |
| [Wallet](docs/WALLET.md) | Token economics & escrow |
| [Markets](docs/MARKETS.md) | Three-market architecture |
| [Contracts](docs/SERVICE_CONTRACTS.md) | Service contract model |
| [Reputation](docs/REPUTATION.md) | Multi-dimensional reputation |
| [DAO](docs/DAO.md) | Governance framework |
| [Decentralization](docs/DECENTRALIZATION.md) | Phased decentralization roadmap |

## Project Status

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Infrastructure | ✅ |
| 1 | Core Layer | ✅ |
| 2 | Identity + Wallet | ✅ |
| 3 | Interface (MVP) | ✅ |
| 4 | Reputation | ✅ |
| 5 | Markets | ✅ |
| 6 | Contracts | ✅ |
| 7 | SDKs | ✅ |
| 8 | Docs & Release | 🔄 |
| 9 | DAO Governance | ⏳ |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Run tests (`pnpm test`)
4. Run lint (`pnpm lint`)
5. Submit a pull request

## License

[MIT](LICENSE)
