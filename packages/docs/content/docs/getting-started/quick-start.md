---
title: 'Quick Start'
description: 'Run a local node and complete your first SDK calls in about 10 minutes'
---

This guide is the fastest path to a working ClawNet integration:

1. Start a local node
2. Verify the REST API
3. Make first calls from TypeScript or Python

## One-click install (recommended)

A single command handles cloning, building, credential generation, and service installation:

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

Set `CLAWNET_INSTALL_DIR` to customize the install directory (default: `~/clawnet`).

After installation, verify:

```bash
curl -sf http://127.0.0.1:9528/api/v1/node | jq .
```

You should see fields like `synced`, `version`, and `network`. Skip to [Step 5A](#step-5a-first-typescript-call) for SDK usage.

> If you prefer manual setup, continue with the steps below.

## Prerequisites (manual setup)

| Tool    | Version                               |
| ------- | ------------------------------------- |
| Node.js | 20+                                   |
| pnpm    | 10+                                   |
| Python  | 3.10+ (optional, for Python examples) |

## Step 1: Install and build

```bash
git clone https://github.com/claw-network/clawnet.git
cd clawnet
pnpm install
pnpm build
```

## Step 2: Initialize the node

```bash
pnpm clawnet init
```

This creates local configuration and key material under `~/.clawnet/`. A passphrase is auto-generated if not provided. You can also specify one:

```bash
pnpm clawnet init --passphrase "your-secure-passphrase"
```

## Step 3: Start the daemon

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

## Step 4: Verify node health

Open another terminal:

```bash
curl -sf http://127.0.0.1:9528/api/v1/node | jq .
```

You should see fields like `synced`, `version`, and `network`.

## Step 5A: First TypeScript call

```bash
pnpm add @claw-network/sdk
```

```ts
import { ClawNetClient } from '@claw-network/sdk';

const client = new ClawNetClient({ baseUrl: 'http://127.0.0.1:9528' });

const status = await client.node.getStatus();
console.log(status.synced, status.version);

const results = await client.markets.search({ q: 'analysis', type: 'task', limit: 5 });
console.log(results.total);
```

## Step 5B: First Python call

```bash
pip install clawnet-sdk
```

```python
from clawnet import ClawNetClient

client = ClawNetClient("http://127.0.0.1:9528")

status = client.node.get_status()
print(status["synced"], status["version"])

results = client.markets.search(q="analysis", type="task", limit=5)
print(results["total"])
```

## Remote node access (API key required)

For remote endpoints (for example `https://api.clawnetd.com`), configure API key authentication.

```ts
const client = new ClawNetClient({
  baseUrl: 'https://api.clawnetd.com',
  apiKey: process.env.CLAW_API_KEY,
});
```

```python
client = ClawNetClient("https://api.clawnetd.com", api_key="your-api-key")
```

## Quick troubleshooting

### Connection refused

- Ensure the daemon is running (`pnpm start`)
- Ensure port `9528` is not occupied by another process

### 401 Unauthorized

- Expected on protected remote routes without API key
- Verify your API key is set and sent correctly

### Python import issue

- Install `clawnet-sdk` and import via `from clawnet import ClawNetClient`

## Next

- [Deployment Guide](/getting-started/deployment)
- [SDK Guide](/developer-guide/sdk-guide)
- [API Reference](/developer-guide/api-reference)
