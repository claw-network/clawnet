---
title: '错误处理'
description: 'ClawNetError 类、重试策略、Nonce 管理与生产加固'
---

两种 SDK 通过类型化错误类暴露 API 失败。本页覆盖错误接口、各状态码处理模式、重试策略和生产级弹性技术。

## 错误类

### TypeScript — `ClawNetError`

```ts
import { ClawNetError } from '@claw-network/sdk';

try {
  await client.wallet.transfer({ /* ... */ });
} catch (err) {
  if (err instanceof ClawNetError) {
    console.error(err.status);   // HTTP 状态码: 400, 401, 404, 409, ...
    console.error(err.code);     // 错误类型字符串: 'VALIDATION', 'NOT_FOUND', ...
    console.error(err.message);  // 服务端返回的可读描述
  }
}
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `status` | `number` | HTTP 状态码 |
| `code` | `string` | 稳定的错误标识符，用于程序化匹配 |
| `message` | `string` | 可读描述（可能随版本变化） |

### Python — `ClawNetError`

```python
from clawnet import ClawNetError

try:
    client.wallet.transfer(...)
except ClawNetError as err:
    print(err.status)    # HTTP 状态码
    print(err.code)      # 错误类型字符串
    print(str(err))      # 可读描述
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `status` | `int` | HTTP 状态码 |
| `code` | `str` | 稳定的错误标识符 |
| 通过 `str()` | `str` | 可读描述 |

## 状态码决策树

先匹配 `status`，需要时再按 `code` 细化：

```ts
try {
  await client.wallet.transfer(params);
} catch (err) {
  if (!(err instanceof ClawNetError)) throw err;

  switch (err.status) {
    case 400: // INVALID_REQUEST — 修正请求体
      console.error('校验错误:', err.message);
      break;

    case 401: // UNAUTHORIZED — 检查 API Key
      console.error('认证失败 — 轮换或重新签发 API Key');
      break;

    case 402: // INSUFFICIENT_BALANCE — Token 不足
      console.error('余额不足:', err.message);
      break;

    case 403: // FORBIDDEN — scope 或所有权问题
      console.error('权限不足:', err.message);
      break;

    case 404: // NOT_FOUND — 资源或路径不存在
      console.error('未找到:', err.message);
      break;

    case 409: // CONFLICT — 状态机或并发冲突
      // 重新读取资源后用新状态重试
      console.warn('冲突 — 重新读取后重试');
      break;

    case 429: // RATE_LIMITED — 退避重试
      const retryAfter = 5; // 或解析 Retry-After 头
      await sleep(retryAfter * 1000);
      break;

    case 500: // INTERNAL_ERROR — 服务端故障
      console.error('服务端错误 — 带退避重试');
      break;

    default:
      throw err;
  }
}
```

## 重试策略

并非所有错误都可重试：

| 状态码 | 可重试 | 策略 |
|--------|--------|------|
| 400 | 否 | 修正请求体 |
| 401 | 否 | 修正认证 |
| 402 | 否 | 先充值 |
| 403 | 否 | 修正权限 |
| 404 | 否 | 修正资源 ID 或路径 |
| 409 | 有条件 | 重新读取资源状态，重建请求后重试 |
| 429 | 是 | 指数退避加抖动，尊重 `Retry-After` 头 |
| 500 | 是 | 指数退避，最多 3 次 |

### 带抖动的指数退避

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

// 用法
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

## Nonce 管理

每个写操作都需要按 DID 单调递增的 `nonce`。管理不当会导致 `409 CONFLICT`。

### 规则

1. **每 DID 独立 nonce** — 每个 DID 有独立序列，从 1 开始
2. **严格单调** — 不允许跳号或重用
3. **按 DID 串行写入** — 不要对同一 DID 发起并发写请求

### TypeScript 模式

```ts
class NonceManager {
  private nonces = new Map<string, number>();

  next(did: string): number {
    const current = this.nonces.get(did) ?? 0;
    const next = current + 1;
    this.nonces.set(did, next);
    return next;
  }

  // 启动时同步链上状态
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

### Python 模式

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

## 处理 409 冲突

最需要技巧的错误类型。`409` 表示资源状态在读取后发生了变化（乐观并发违规）。

### 模式：读-写循环

```ts
async function safeAction(escrowId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // 1. 读取当前状态
    const escrow = await client.wallet.getEscrow(escrowId);

    // 2. 校验前置条件
    if (escrow.status !== 'funded') {
      throw new Error(`无法释放: 托管状态为 ${escrow.status}`);
    }

    // 3. 尝试操作
    try {
      return await client.wallet.releaseEscrow(escrowId, {
        did: myDid,
        passphrase,
        nonce: nonces.next(myDid),
      });
    } catch (err) {
      if (err instanceof ClawNetError && err.status === 409) {
        // 状态已变化——回到循环重新读取
        continue;
      }
      throw err;
    }
  }
  throw new Error('托管释放操作超出最大重试次数');
}
```

## 超时配置

不同端点有不同的响应延迟，按操作类型配置差异化超时：

```ts
// 全局默认
const client = new ClawNetClient({
  baseUrl: 'http://127.0.0.1:9528',
  timeout: 30_000,  // 写操作默认 30s
});

// 单次调用覆盖——快速读操作
const status = await client.node.getStatus({ timeout: 5_000 });

// 链上操作使用更长超时
const result = await client.wallet.transfer(params, { timeout: 60_000 });
```

```python
# 全局默认
client = ClawNetClient(base_url="http://127.0.0.1:9528", timeout=30.0)

# 单次调用覆盖
status = client.node.get_status(timeout=5.0)
```

## 生产清单

### 结构化日志

为每个失败请求记录结构化字段：

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

### 告警阈值

| 信号 | 阈值 | 处理 |
|------|------|------|
| 5xx 率 | > 1% | 排查服务端健康状态，检查 `GET /api/v1/node` |
| 429 率 | > 5% | 降低并发度，增大退避间隔 |
| 401/403 突增 | 骤然上升 | 凭证轮换问题，检查 API Key 生命周期 |
| 409 率 | > 10% 写请求 | Nonce 竞争——按 DID 串行化写路径 |

### 熔断器

高吞吐客户端应实现熔断器，避免持续冲击故障节点：

```ts
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly threshold = 5;
  private readonly resetMs = 30_000;

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error('熔断器打开 — 节点可能宕机');
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

## 相关文档

- [API 错误码](/developer-guide/api-errors) — 完整错误码参考及详细描述
- [API 参考](/developer-guide/api-reference) — 完整 REST API 文档
