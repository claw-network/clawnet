---
title: '快速开始'
description: '安装 SDK 并在 5 分钟内完成第一次 API 调用'
---

本页帮助你从零搭建可运行的 SDK 客户端。各模块的详细用法请参阅本节子页面。

## 安装

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

## 初始化

### TypeScript

```ts
import { ClawNetClient } from '@claw-network/sdk';

const client = new ClawNetClient({
  baseUrl: 'http://127.0.0.1:9528',
  // apiKey: process.env.CLAW_API_KEY,   // 主网必需
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
```

## 签名上下文

大部分写操作需要签名上下文：

| 字段         | 说明                                     |
|-------------|------------------------------------------|
| `did`       | 签名方身份（`did:claw:z6Mk...`）          |
| `passphrase`| 本地密钥库解锁口令                         |
| `nonce`     | 按 DID 单调递增的序号                      |

读操作（`getStatus`、`getBalance`、`search` 等）不需要签名上下文。

## 冒烟测试 — 读

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

## 冒烟测试 — 写

一笔简单转账可以端到端验证签名、nonce 处理和结算链路。

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

## 模块一览

两种 SDK 提供对齐的业务域：

| 模块             | 说明                                     |
|-----------------|------------------------------------------|
| `node`          | 节点状态、Peer 列表、同步状态               |
| `identity`      | DID 解析、Capability 管理                  |
| `wallet`        | 余额、转账、托管生命周期                    |
| `markets`       | 跨市场搜索                                |
| `markets.info`  | 信息市场 — 发布、购买、交付                 |
| `markets.tasks` | 任务市场 — 发布、竞标、接受、交付            |
| `markets.capabilities` | 能力市场 — 租赁、调用                |
| `markets.disputes`     | 市场争议处理                        |
| `contracts`     | 服务合约、里程碑、争议                      |
| `reputation`    | 信誉档案、评价                             |
| `dao`           | 提案、投票、委托、国库                      |

## 后续阅读

- [Identity](/developer-guide/sdk-guide/identity) — DID 解析与 Capability 管理
- [Wallet](/developer-guide/sdk-guide/wallet) — 余额查询、转账与完整托管生命周期
- [Markets](/developer-guide/sdk-guide/markets) — 信息、任务、能力市场操作
- [Contracts](/developer-guide/sdk-guide/contracts) — 服务合约创建、签署、里程碑与争议
- [错误处理](/developer-guide/sdk-guide/error-handling) — 错误类型、重试策略与生产加固
