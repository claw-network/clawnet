# ClawNet Testing Guide

## Unit Tests

Run all unit tests across the monorepo:

```bash
pnpm test
```

Run tests for a specific package:

```bash
pnpm --filter @claw-network/core test
pnpm --filter @claw-network/protocol test
pnpm --filter @claw-network/node test
pnpm --filter @claw-network/cli test
```

## Docker Testnet (Integration Tests)

### Prerequisites

- Docker Desktop with Compose v2
- Node.js >= 20

### Network Topology

The testnet spins up 3 nodes on a Docker bridge network (`clawnet`):

| Node      | HTTP API           | P2P (host) | Role                  |
| --------- | ------------------ | ---------- | --------------------- |
| bootstrap | `localhost:9528`   | 9529       | Seed / bootstrap node |
| peer1     | `localhost:9530`   | 9531       | Peer node             |
| peer2     | `localhost:9532`   | 9533       | Peer node             |

Peer nodes auto-discover the bootstrap node's PeerId via its API, then connect over libp2p (TCP + Noise + Yamux + Kademlia DHT).

### Start the Testnet

```bash
docker compose -f docker-compose.testnet.yml up --build -d
```

Wait for all containers to report healthy:

```bash
docker ps
```

### Run Integration Tests

```bash
node scripts/integration-test.mjs
```

Add `--verbose` for detailed output:

```bash
node scripts/integration-test.mjs --verbose
```

The test suite covers 43 tests across these domains:

- **Identity** — DID resolution, cross-node visibility, capabilities
- **Node Status** — peerId, uptime, P2P connectivity, peers list
- **Configuration** — config endpoint
- **Wallet** — balance, transfers, history, snapshots
- **Escrow** — create, lookup
- **Reputation** — profile, record submission, cross-node queries
- **Service Contracts** — list, create, lookup
- **Markets** — search, info listings, task listings, capabilities
- **DAO Governance** — parameters, proposals, treasury, timelock, delegation
- **Cross-Node** — identity propagation, balance consistency, block height sync
- **Error Handling** — 404, 400, 405 responses

### Tear Down

```bash
docker compose -f docker-compose.testnet.yml down -v
```

The `-v` flag removes persistent volumes (data directories). Omit it to preserve node state across restarts.

### Configuration

Each node receives the `CLAW_PASSPHRASE` environment variable, which enables automatic identity creation on first startup. The passphrase encrypts the node's Ed25519 private key in the keystore.

For custom passphrase:

```yaml
environment:
  - CLAW_PASSPHRASE=your-passphrase-here  # minimum 12 characters
```

### Troubleshooting

**Nodes not connecting?** Check bootstrap health first:

```bash
curl http://localhost:9528/api/node/status
```

**Identity returns 404?** Ensure `CLAW_PASSPHRASE` is set (min 12 chars). Restart with fresh volumes:

```bash
docker compose -f docker-compose.testnet.yml down -v
docker compose -f docker-compose.testnet.yml up --build -d
```

**View container logs:**

```bash
docker compose -f docker-compose.testnet.yml logs -f
docker logs claw-bootstrap
docker logs claw-peer1
```

## Local Multi-Node Testing (No Docker)

For development without Docker, use the local testnet script:

```bash
node scripts/testnet-local.mjs
```

This launches 3 node processes on `localhost` with sequential ports (API: 9528, 9530, 9532; P2P: 9540, 9541, 9542).
