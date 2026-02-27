---
title: 'Error Handling'
description: 'ClawNetError class, retry patterns, nonce management, and production hardening'
---

Both SDKs surface API failures through a typed error class. This page covers the error interface, common patterns for handling each status code, retry strategies, and production-grade resilience techniques.

## The error class

### TypeScript — `ClawNetError`

```ts
import { ClawNetError } from '@claw-network/sdk';

try {
  await client.wallet.transfer({ /* ... */ });
} catch (err) {
  if (err instanceof ClawNetError) {
    console.error(err.status);   // HTTP status: 400, 401, 404, 409, ...
    console.error(err.code);     // Error type string: 'VALIDATION', 'NOT_FOUND', ...
    console.error(err.message);  // Human-readable detail from the server
  }
}
```

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code |
| `code` | `string` | Stable error identifier for programmatic matching |
| `message` | `string` | Human-readable detail (may change between releases) |

### Python — `ClawNetError`

```python
from clawnet import ClawNetError

try:
    client.wallet.transfer(...)
except ClawNetError as err:
    print(err.status)    # HTTP status
    print(err.code)      # Error type string
    print(str(err))      # Human-readable detail
```

| Attribute | Type | Description |
|-----------|------|-------------|
| `status` | `int` | HTTP status code |
| `code` | `str` | Stable error identifier |
| message via `str()` | `str` | Human-readable detail |

## Status code decision tree

Match on `status` first, then refine by `code` when needed:

```ts
try {
  await client.wallet.transfer(params);
} catch (err) {
  if (!(err instanceof ClawNetError)) throw err;

  switch (err.status) {
    case 400: // INVALID_REQUEST — fix the request payload
      console.error('Validation error:', err.message);
      break;

    case 401: // UNAUTHORIZED — check API key
      console.error('Auth failed — rotate or re-issue API key');
      break;

    case 402: // INSUFFICIENT_BALANCE — not enough Tokens
      console.error('Balance too low:', err.message);
      break;

    case 403: // FORBIDDEN — scope or ownership issue
      console.error('Permission denied:', err.message);
      break;

    case 404: // NOT_FOUND — resource or route missing
      console.error('Not found:', err.message);
      break;

    case 409: // CONFLICT — state machine or concurrency conflict
      // Re-read the resource, then retry with fresh state
      console.warn('Conflict — retrying after re-read');
      break;

    case 429: // RATE_LIMITED — back off and retry
      const retryAfter = 5; // or parse Retry-After header
      await sleep(retryAfter * 1000);
      break;

    case 500: // INTERNAL_ERROR — server-side failure
      console.error('Server error — retry with backoff');
      break;

    default:
      throw err;
  }
}
```

## Retry strategy

Not all errors are retryable. Use this table:

| Status | Retryable | Strategy |
|--------|-----------|----------|
| 400 | No | Fix request payload |
| 401 | No | Fix authentication |
| 402 | No | Increase balance first |
| 403 | No | Fix permissions |
| 404 | No | Fix resource ID or path |
| 409 | Yes (conditional) | Re-read resource state, rebuild request, then retry |
| 429 | Yes | Exponential backoff with jitter, respect `Retry-After` |
| 500 | Yes | Exponential backoff, max 3 retries |

### Exponential backoff with jitter

```ts
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ClawNetError)) throw err;
      if (![429, 500, 502, 503].includes(err.status)) throw err;
      if (attempt === maxRetries) throw err;

      const delay = baseDelayMs * 2 ** attempt + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

// Usage
const result = await withRetry(() =>
  client.wallet.transfer({ did, passphrase, nonce, to, amount })
);
```

```python
import time
import random
from clawnet import ClawNetError

def with_retry(fn, max_retries=3, base_delay=1.0):
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except ClawNetError as err:
            if err.status not in (429, 500, 502, 503):
                raise
            if attempt == max_retries:
                raise
            delay = base_delay * (2 ** attempt) + random.uniform(0, 0.5)
            time.sleep(delay)
```

## Nonce management

Every write operation requires a per-DID monotonically increasing `nonce`. Getting this wrong causes `409 CONFLICT` errors.

### Rules

1. **One nonce per DID** — each DID has an independent sequence starting from 1
2. **Strictly monotonic** — no gaps, no reuse; each call increments by 1
3. **Serialize writes per DID** — never submit two concurrent writes for the same DID

### TypeScript pattern

```ts
class NonceManager {
  private nonces = new Map<string, number>();

  next(did: string): number {
    const current = this.nonces.get(did) ?? 0;
    const next = current + 1;
    this.nonces.set(did, next);
    return next;
  }

  // Call on startup to sync with on-chain state
  async sync(client: ClawNetClient, did: string) {
    const balance = await client.wallet.getBalance({ did });
    this.nonces.set(did, balance.nonce ?? 0);
  }
}

const nonces = new NonceManager();
await nonces.sync(client, myDid);

await client.wallet.transfer({
  did: myDid,
  passphrase,
  nonce: nonces.next(myDid),
  to: recipient,
  amount: 100,
});
```

### Python pattern

```python
class NonceManager:
    def __init__(self):
        self._nonces: dict[str, int] = {}

    def next(self, did: str) -> int:
        current = self._nonces.get(did, 0)
        nxt = current + 1
        self._nonces[did] = nxt
        return nxt

    def sync(self, client, did: str):
        balance = client.wallet.get_balance(did=did)
        self._nonces[did] = balance.get("nonce", 0)

nonces = NonceManager()
nonces.sync(client, my_did)

client.wallet.transfer(
    did=my_did,
    passphrase=passphrase,
    nonce=nonces.next(my_did),
    to=recipient,
    amount=100,
)
```

## Handling 409 conflicts

The most nuanced error to handle. A `409` means the resource state has changed since you last read it (optimistic concurrency violation).

### Pattern: read-then-write loop

```ts
async function safeAction(escrowId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // 1. Read current state
    const escrow = await client.wallet.getEscrow(escrowId);

    // 2. Verify precondition
    if (escrow.status !== 'funded') {
      throw new Error(`Cannot release: escrow is ${escrow.status}`);
    }

    // 3. Attempt the action
    try {
      return await client.wallet.releaseEscrow(escrowId, {
        did: myDid,
        passphrase,
        nonce: nonces.next(myDid),
      });
    } catch (err) {
      if (err instanceof ClawNetError && err.status === 409) {
        // State changed — loop back and re-read
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retry attempts exceeded for escrow release');
}
```

## Timeout configuration

Different endpoints have different response latencies. Configure per-operation timeouts:

```ts
// Global default
const client = new ClawNetClient({
  baseUrl: 'http://127.0.0.1:9528',
  timeout: 30_000,  // 30s default for write operations
});

// Per-call override for fast reads
const status = await client.node.getStatus({ timeout: 5_000 });

// Longer timeout for on-chain operations
const result = await client.wallet.transfer(params, { timeout: 60_000 });
```

```python
# Global default
client = ClawNetClient(base_url="http://127.0.0.1:9528", timeout=30.0)

# Per-call (if supported by your HTTP library wrapper)
status = client.node.get_status(timeout=5.0)
```

## Production checklist

### Structured logging

Log every failed request with structured fields:

```ts
catch (err) {
  if (err instanceof ClawNetError) {
    logger.error({
      method: 'POST',
      path: '/api/v1/transfers',
      status: err.status,
      code: err.code,
      detail: err.message,
      did: params.did,
      nonce: params.nonce,
      timestamp: new Date().toISOString(),
    });
  }
}
```

### Alert thresholds

| Signal | Threshold | Action |
|--------|-----------|--------|
| 5xx rate | > 1% of requests | Investigate server health, check `GET /api/v1/node` |
| 429 rate | > 5% of requests | Reduce concurrency, increase backoff |
| 401/403 spike | Sudden increase | Credential rotation issue, check API key lifecycle |
| 409 rate | > 10% of writes | Nonce contention — serialize write paths per DID |

### Circuit breaker

For high-throughput clients, implement a circuit breaker to avoid hammering a failing node:

```ts
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly threshold = 5;
  private readonly resetMs = 30_000;

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error('Circuit open — node may be down');
    }
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (err) {
      if (err instanceof ClawNetError && err.status >= 500) {
        this.failures++;
        this.lastFailure = Date.now();
      }
      throw err;
    }
  }

  private isOpen(): boolean {
    if (this.failures < this.threshold) return false;
    return Date.now() - this.lastFailure < this.resetMs;
  }
}
```

## See also

- [API Error Codes](/docs/developer-guide/api-errors) — Full error code reference with detailed descriptions
- [API Reference](/docs/developer-guide/api-reference) — Complete REST API documentation
