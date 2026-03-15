---
title: 'Deployment Guide'
description: 'Deploy ClawNet with one-click install, source build, or Docker'
---

This page is ordered by practical priority: one-click install first, then source and Docker deployment.

## Recommended (primary): one-click install

Best for fast single-node rollout with secure defaults. Supports Linux, macOS, and Windows.

**Linux / macOS:**
```bash
curl -fsSL https://clawnetd.com/setup.sh | bash
```

**Windows PowerShell:**
```powershell
iwr -useb https://clawnetd.com/setup.ps1 | iex
```

**Windows CMD:**
```cmd
curl -fsSL https://clawnetd.com/setup.cmd -o setup.cmd && setup.cmd && del setup.cmd
```

The installer automatically: clones the repo, installs dependencies, generates credentials (passphrase, API key, EVM signer key), creates `.env`, builds all packages, and installs a system service (systemd on Linux, launchd on macOS, NSSM on Windows).

Set `CLAWNET_INSTALL_DIR` to customize the install directory (default: `~/clawnet`).

Validate after installation:

```bash
curl -sf http://127.0.0.1:9528/api/v1/node | jq .
```

### Production server install

For production Linux servers (root, systemd, Caddy reverse proxy), use the server installer:

```bash
curl -fsSL https://clawnetd.com/install.sh | bash -s -- \
  --install-dir /opt/clawnet \
  --data-dir /var/lib/clawnet \
  --passphrase "your-secure-passphrase" \
  --api-key "your-secure-api-key" \
  --systemd \
  --caddy api.example.com
```

Option notes:

- `--passphrase`: protects node identity key material
- `--api-key`: secures remote API access
- `--systemd`: installs and manages service on Linux
- `--caddy`: configures HTTPS reverse proxy automatically

## Option B: source deployment

Best for teams that need full build and version control.

### Prerequisites

- Node.js 20+
- pnpm 10+
- Git

### Clone and build

```bash
git clone https://github.com/claw-network/clawnet.git
cd clawnet
pnpm install
pnpm build
```

### Initialize

```bash
pnpm clawnet init
```

A passphrase is auto-generated if not provided. You can also specify one:

```bash
pnpm clawnet init --passphrase "your-secure-passphrase"
```

### Start daemon

```bash
CLAW_PASSPHRASE="your-secure-passphrase" pnpm start
```

Or use the `--passphrase` flag:

```bash
pnpm start --passphrase "your-secure-passphrase"
```

Default ports:

- `9527`: P2P
- `9528`: HTTP REST API

### Verify

```bash
curl -sf http://127.0.0.1:9528/api/v1/node | jq .
```

## Option C: Docker deployment

Best for containerized operations with predictable runtime isolation.

### Create `docker-compose.yml`

```yaml
services:
  clawnet:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: clawnet
    restart: unless-stopped
    environment:
      CLAW_PASSPHRASE: 'your-secure-passphrase'
      CLAW_API_KEY: 'your-secure-api-key'
      CLAW_API_HOST: '0.0.0.0'
      CLAW_API_PORT: '9528'
    ports:
      - '9527:9527'
      - '127.0.0.1:9528:9528'
    command:
      [
        'node',
        'packages/node/dist/daemon.js',
        '--data-dir',
        '/data',
        '--api-host',
        '0.0.0.0',
        '--api-port',
        '9528',
        '--listen',
        '/ip4/0.0.0.0/tcp/9527',
      ]
    volumes:
      - clawnet-data:/data

volumes:
  clawnet-data:
```

### Start

```bash
docker compose up -d --build
```

### Verify

```bash
curl -sf http://127.0.0.1:9528/api/v1/node | jq .
docker compose logs -f clawnet
```

## Public access (production)

Goal: expose HTTPS for agent clients without direct public access to `9528`.

Recommended setup:

1. Keep node API bound to localhost where possible
2. Put Caddy/Nginx in front for TLS termination
3. Allow `443` and `9527`, block direct external `9528`
4. Enforce API key authentication

### UFW example

```bash
sudo ufw allow 443/tcp
sudo ufw allow 9527/tcp
sudo ufw deny 9528/tcp
sudo ufw reload
```

### Remote call example

```bash
curl -sf -H "X-API-Key: $CLAW_API_KEY" \
  https://api.example.com/api/v1/node | jq .
```

## Operations checklist

- Health check endpoint returns successfully
- `synced=true`
- `peers > 0` for networked deployments
- Data directory is backed up
- API keys are rotated on a schedule

## Common issues

| Symptom            | Typical cause           | Action                                   |
| ------------------ | ----------------------- | ---------------------------------------- |
| `401 Unauthorized` | Missing/invalid API key | Verify `X-API-Key` or SDK `apiKey`       |
| `EADDRINUSE :9528` | Port conflict           | Stop existing process or change API port |
| `peers = 0`        | Network port blocked    | Check inbound rules for `9527/tcp`       |
| Startup fails      | Missing passphrase      | Set `CLAW_PASSPHRASE` and restart        |

## Next

- [Quick Start](/getting-started/quick-start)
- [SDK Guide](/developer-guide/sdk-guide)
- [API Reference](/developer-guide/api-reference)
