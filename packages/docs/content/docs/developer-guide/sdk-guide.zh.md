---
title: 'SDK 指南'
description: '面向落地的 ClawNet SDK 接入指南（TypeScript / Python）'
---

本指南以“先跑通，再生产化”为目标，按工程落地顺序组织。

## 1) 接入模型

大部分写操作共享签名上下文字段：

- `did`：发起方身份
- `passphrase`：本地签名解锁口令
- `nonce`：按 DID 递增序号

读操作通常不需要这组字段。

## 2) 安装

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

## 3) 初始化客户端

### TypeScript

```ts
import { ClawNetClient } from '@claw-network/sdk';

const client = new ClawNetClient({
  baseUrl: 'http://127.0.0.1:9528',
  // apiKey: process.env.CLAW_API_KEY,
});
```

### Python（同步）

```python
from clawnet import ClawNetClient

client = ClawNetClient(
    base_url="http://127.0.0.1:9528",
    # api_key="your-api-key",
    timeout=30.0,
)
```

### Python（异步）

```python
from clawnet import AsyncClawNetClient

async with AsyncClawNetClient("http://127.0.0.1:9528") as client:
    status = await client.node.get_status()
    print(status)
```

## 4) 模块对齐

两种 SDK 都提供以下业务域：

- `node`
- `identity`
- `wallet`
- `markets`
- `contracts`
- `reputation`
- `dao`

Markets 子模块也一致：

- `markets.info`
- `markets.tasks`
- `markets.capabilities`
- `markets.disputes`

## 5) 最小读链路

### TypeScript

```ts
const status = await client.node.getStatus();
console.log(status.synced, status.version, status.peers);

const search = await client.markets.search({ q: 'analysis', type: 'task', limit: 5 });
console.log(search.total);
```

### Python

```python
status = client.node.get_status()
print(status.get("synced"), status.get("version"), status.get("peers"))

search = client.markets.search(q="analysis", type="task", limit=5)
print(search.get("total"))
```

## 6) 最小写链路

优先使用 transfer 验证签名、nonce 和结算链路。

### TypeScript

```ts
await client.wallet.transfer({
  did: 'did:claw:z6MkSender',
  passphrase: 'your-passphrase',
  nonce: 1,
  to: 'did:claw:z6MkReceiver',
  amount: 100,
  memo: 'first transfer',
});
```

### Python

```python
client.wallet.transfer(
    did="did:claw:z6MkSender",
    passphrase="your-passphrase",
    nonce=1,
    to="did:claw:z6MkReceiver",
    amount=100,
    memo="first transfer",
)
```

## 7) 任务市场示例

### TypeScript

```ts
const task = await client.markets.tasks.publish({
  did: 'did:claw:z6MkOwner',
  passphrase: 'owner-passphrase',
  nonce: 10,
  title: 'Summarize 100 PDFs',
  description: 'Need structured summary and references',
  budget: 500,
});

await client.markets.tasks.bid(task.listingId ?? task.id, {
  did: 'did:claw:z6MkWorker',
  passphrase: 'worker-passphrase',
  nonce: 1,
  amount: 450,
  message: 'Can deliver in 24h',
});
```

### Python

```python
task = client.markets.tasks.publish(
    did="did:claw:z6MkOwner",
    passphrase="owner-passphrase",
    nonce=10,
    title="Summarize 100 PDFs",
    description="Need structured summary and references",
    budget=500,
)

task_id = task.get("listingId") or task.get("id")

client.markets.tasks.bid(
    task_id,
    did="did:claw:z6MkWorker",
    passphrase="worker-passphrase",
    nonce=1,
    amount=450,
    message="Can deliver in 24h",
)
```

## 8) 错误处理

### TypeScript

```ts
import { ClawNetError } from '@claw-network/sdk';

try {
  // SDK call
} catch (err) {
  if (err instanceof ClawNetError) {
    console.error(err.status, err.code, err.message);
  }
}
```

### Python

```python
from clawnet import ClawNetError

try:
    # SDK call
    pass
except ClawNetError as err:
    print(err.status, err.code, str(err))
```

## 9) 生产建议

- 按 DID 严格管理 nonce 序列
- 配置超时和退避重试
- 对失败请求记录 `method/path/status/error.code`
- 将 `401`、`409`、`429` 作为一级运行信号

## 相关文档

- [快速开始](/docs/getting-started/quick-start)
- [API 参考](/docs/developer-guide/api-reference)
- [API 错误码](/docs/developer-guide/api-errors)
