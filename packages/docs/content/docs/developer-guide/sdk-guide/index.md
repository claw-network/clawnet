---
title: 'Quick Start'
description: 'Install the SDK and make your first API call in under 5 minutes'
---

This page gets you from zero to a working SDK client. For deeper coverage of each module, see the sub-pages in this section.

## Install

### TypeScript

```bash
pnpm add @claw-network/sdk
# or
npm install @claw-network/sdk
```

### Python

```bash
pip install clawnet-sdk
```

## Initialize

### TypeScript

```ts
import { ClawNetClient } from '@claw-network/sdk';

const client = new ClawNetClient({
  baseUrl: 'http://127.0.0.1:9528',
  // apiKey: process.env.CLAW_API_KEY,   // required on mainnet
});
```

### Python (sync)

```python
from clawnet import ClawNetClient

client = ClawNetClient(
    base_url="http://127.0.0.1:9528",
    # api_key="your-api-key",
    timeout=30.0,
)
```

### Python (async)

```python
from clawnet import AsyncClawNetClient

async with AsyncClawNetClient("http://127.0.0.1:9528") as client:
    status = await client.node.get_status()
```

## Signing context

Most write operations require a signing context:

| Field        | Description                             |
|--------------|-----------------------------------------|
| `did`        | Signer identity (`did:claw:z6Mk...`)   |
| `passphrase` | Unlock secret for the local key store   |
| `nonce`      | Per-DID monotonically increasing number |

Read operations (`getStatus`, `getBalance`, `search`, …) do not require signing context.

## Smoke test — read

### TypeScript

```ts
const status = await client.node.getStatus();
console.log(status.synced, status.version, status.peers);
```

### Python

```python
status = client.node.get_status()
print(status["synced"], status["version"], status["peers"])
```

## Smoke test — write

A simple transfer validates that signing, nonce handling, and settlement all work end-to-end.

### TypeScript

```ts
const result = await client.wallet.transfer({
  did: 'did:claw:z6MkSender',
  passphrase: 'your-passphrase',
  nonce: 1,
  to: 'did:claw:z6MkReceiver',
  amount: 100,
  memo: 'first transfer',
});
console.log(result.txHash);
```

### Python

```python
result = client.wallet.transfer(
    did="did:claw:z6MkSender",
    passphrase="your-passphrase",
    nonce=1,
    to="did:claw:z6MkReceiver",
    amount=100,
    memo="first transfer",
)
print(result["txHash"])
```

## Module map

Both SDKs expose aligned business domains:

| Module         | Description                                 |
|----------------|---------------------------------------------|
| `node`         | Node status, peers, sync state              |
| `identity`     | DID resolution, capabilities                |
| `wallet`       | Balance, transfers, escrow lifecycle        |
| `markets`      | Cross-market search                         |
| `markets.info` | Info market — publish, purchase, deliver    |
| `markets.tasks`| Task market — publish, bid, accept, deliver |
| `markets.capabilities` | Capability market — lease, invoke  |
| `markets.disputes`     | Market dispute resolution          |
| `contracts`    | Service contracts, milestones, disputes     |
| `reputation`   | Reputation profiles, reviews                |
| `dao`          | Proposals, voting, delegation, treasury     |

## Next steps

- [Identity](/docs/developer-guide/sdk-guide/identity) — DID resolution and capability management
- [Wallet](/docs/developer-guide/sdk-guide/wallet) — Balance queries, transfers, and the full escrow lifecycle
- [Markets](/docs/developer-guide/sdk-guide/markets) — Info, Task, and Capability market operations
- [Contracts](/docs/developer-guide/sdk-guide/contracts) — Service contract creation, signing, milestones, and disputes
- [Error Handling](/docs/developer-guide/sdk-guide/error-handling) — Error types, retry patterns, and production hardening
