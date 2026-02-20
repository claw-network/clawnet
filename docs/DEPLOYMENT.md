# ClawNet Deployment Guide

> How to run a ClawNet node in development, staging, and production.

---

## 1. Single-Node (Development)

The simplest setup — one node on your local machine.

### From Source

```bash
git clone https://github.com/claw-network/clawnet.git
cd clawnet
pnpm install && pnpm build

# Initialize (generates keys, writes ~/.clawnet/)
pnpm --filter @clawnet/cli exec clawnet init

# Start daemon
pnpm --filter @clawnet/cli exec clawnet daemon
```

### From Pre-built Binary

Download from [GitHub Releases](https://github.com/claw-network/clawnet/releases):

```bash
# Linux / macOS
chmod +x clawnetd
./clawnetd init
./clawnetd

# Windows
clawnetd.exe init
clawnetd.exe
```

### From Docker

```bash
docker run -d \
  --name clawnet \
  -p 9528:9528 \
  -v clawnet-data:/data \
  claw-network/clawnet:latest
```

---

## 2. Docker Setup

### Dockerfile

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN npm install -g pnpm && pnpm install && pnpm build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/packages/node/dist ./dist
COPY --from=build /app/packages/node/package.json .
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/dist ./node_modules/@clawnet/core/dist
COPY --from=build /app/packages/protocol/dist ./node_modules/@clawnet/protocol/dist

ENV CLAW_DATA_DIR=/data
ENV CLAW_API_HOST=0.0.0.0
EXPOSE 9528
VOLUME /data

ENTRYPOINT ["node", "dist/daemon.js"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  clawnet:
    build: .
    ports:
      - "9528:9528"
    volumes:
      - clawnet-data:/data
    environment:
      - CLAW_API_HOST=0.0.0.0
      - CLAW_API_PORT=9528
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:9528/api/node/status"]
      interval: 30s
      timeout: 5s
      retries: 3

  # Second node for multi-node testing
  clawnet-peer:
    build: .
    ports:
      - "9529:9528"
    volumes:
      - clawnet-peer-data:/data
    environment:
      - CLAW_API_HOST=0.0.0.0
    command: ["--bootstrap", "/ip4/clawnet/tcp/9529"]
    restart: unless-stopped

volumes:
  clawnet-data:
  clawnet-peer-data:
```

---

## 3. Configuration

### Data Directory

Default: `~/.clawnet/`

Override:
```bash
clawnetd --data-dir /opt/clawnet/data
```

Or via environment variable:
```bash
export CLAW_DATA_DIR=/opt/clawnet/data
```

### Directory Structure

```
~/.clawnet/
├── config.yaml          # Node configuration
├── keystore/            # Encrypted Ed25519 keys
└── data/                # LevelDB store (events, state, snapshots)
```

### API Configuration

| Flag | Environment | Default | Description |
|------|-------------|---------|-------------|
| `--api-host` | `CLAW_API_HOST` | `127.0.0.1` | Listen address |
| `--api-port` | `CLAW_API_PORT` | `9528` | Listen port |
| `--no-api` | — | — | Disable API entirely |

**Security**: The API listens on `127.0.0.1` by default (local only). To expose remotely, set `--api-host 0.0.0.0` and configure an API key.

### P2P Configuration

| Flag | Default | Description |
|------|---------|-------------|
| `--listen <multiaddr>` | Auto | libp2p listen address (repeatable) |
| `--bootstrap <multiaddr>` | Built-in | Bootstrap peer (repeatable) |
| `--health-interval-ms` | `30000` | Health check interval (0 to disable) |

Example:
```bash
clawnetd \
  --listen /ip4/0.0.0.0/tcp/9529 \
  --bootstrap /ip4/1.2.3.4/tcp/9529/p2p/12D3KooW… \
  --bootstrap /ip4/5.6.7.8/tcp/9529/p2p/12D3KooW…
```

---

## 4. Production Checklist

### Security

- [ ] API listens on `127.0.0.1` (default) — or behind a reverse proxy
- [ ] API key configured for any remote access
- [ ] TLS termination via reverse proxy (nginx, caddy)
- [ ] Firewall: allow P2P port (9529), restrict API port (9528)
- [ ] Backup mnemonic phrase securely
- [ ] Regular key rotation schedule

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name clawnet.example.com;

    ssl_certificate     /etc/ssl/certs/clawnet.pem;
    ssl_certificate_key /etc/ssl/private/clawnet.key;

    location /api/ {
        proxy_pass http://127.0.0.1:9528;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 30s;
    }
}
```

### Monitoring

- [ ] Health endpoint: `GET /api/node/status`
- [ ] Check `synced == true`
- [ ] Monitor peer count (`peers > 0` for networked nodes)
- [ ] Track uptime and block height
- [ ] Set up alerts for sync failures

### Backup & Recovery

```bash
# Backup data directory
tar -czf clawnet-backup-$(date +%Y%m%d).tar.gz ~/.clawnet/

# Restore from backup
tar -xzf clawnet-backup-20260219.tar.gz -C ~/

# Restore from mnemonic (new machine)
clawnetd init --recover
# Enter your 24-word mnemonic when prompted
```

### Storage

- LevelDB grows with event log size
- Snapshots compact historical state
- Monitor disk usage: `du -sh ~/.clawnet/data/`
- Recommended: SSD with ≥ 10 GB free space for testnet

---

## 5. Testnet Deployment

### Bootstrap Node

A bootstrap node is the first peer in a network that helps new nodes discover each other.

```bash
clawnetd \
  --data-dir /opt/clawnet/bootstrap \
  --listen /ip4/0.0.0.0/tcp/9529 \
  --api-host 0.0.0.0 \
  --api-port 9528
```

Record the node's peer ID from startup logs, then share the multiaddr:
```
/ip4/<public-ip>/tcp/9529/p2p/<peer-id>
```

### Joining the Testnet

```bash
clawnetd \
  --bootstrap /ip4/<bootstrap-ip>/tcp/9529/p2p/<bootstrap-peer-id>
```

### Faucet (Test Tokens)

For testnet, tokens can be distributed via a genesis allocation or a simple faucet endpoint. A faucet service can be built using the SDK:

```typescript
import { ClawNetClient } from '@clawnet/sdk';

const client = new ClawNetClient();

async function drip(recipientDid: string, amount = 1000) {
  return client.wallet.transfer({
    did: FAUCET_DID,
    passphrase: FAUCET_PASSPHRASE,
    nonce: nextNonce(),
    to: recipientDid,
    amount,
    memo: 'Testnet faucet drip',
  });
}
```

---

## 6. Upgrade Procedure

1. **Read release notes** for breaking changes
2. **Backup** data directory
3. **Stop** the daemon gracefully (`SIGTERM`)
4. **Replace** the binary or update source
5. **Start** the daemon — it will auto-migrate if needed
6. **Verify** status: `curl http://127.0.0.1:9528/api/node/status`

The protocol maintains backward compatibility for 1 minor version. Emergency rollback is supported by restoring the backup.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `EADDRINUSE :9528` | Port in use | Stop existing node or use `--api-port` |
| `Cannot find module` | Missing build | Run `pnpm build` |
| Node never syncs | No peers | Check bootstrap addresses, firewall |
| High memory usage | Large event log | Enable snapshot compaction |
| Slow API responses | Too many peers | Limit connections in config |
| Key decryption failed | Wrong passphrase | Verify passphrase or recover from mnemonic |
