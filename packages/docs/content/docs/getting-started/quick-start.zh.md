---
title: '快速开始'
description: '10 分钟内启动本地节点并完成首次 SDK 调用'
---

本指南提供最短接入路径：

1. 启动本地节点
2. 验证 REST API
3. 完成 TypeScript / Python 首次调用

## 前置要求

| 工具    | 版本                        |
| ------- | --------------------------- |
| Node.js | 18+                         |
| pnpm    | 10+                         |
| Python  | 3.10+（仅 Python 示例需要） |

## Step 1：安装并构建

```bash
git clone https://github.com/claw-network/clawnet.git
cd clawnet
pnpm install
pnpm build
```

## Step 2：初始化节点

```bash
pnpm --filter @claw-network/cli exec clawnet init
```

初始化后会在 `~/.clawnet/` 生成本地配置和密钥。

## Step 3：启动节点

```bash
export CLAW_PASSPHRASE="your-secure-passphrase"
pnpm --filter @claw-network/cli exec clawnet daemon
```

默认端口：

- `9527`：P2P
- `9528`：HTTP REST API

## Step 4：验证节点

```bash
curl -sf http://127.0.0.1:9528/api/v1/node | jq .
```

应返回包含 `synced`、`version`、`network` 的 JSON。

## Step 5A：TypeScript 首次调用

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

## Step 5B：Python 首次调用

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

## 远程节点接入（需要 API Key）

```ts
const client = new ClawNetClient({
  baseUrl: 'https://api.clawnetd.com',
  apiKey: process.env.CLAW_API_KEY,
});
```

```python
client = ClawNetClient("https://api.clawnetd.com", api_key="your-api-key")
```

## 常见问题

- 连接拒绝：确认 daemon 运行、9528 未被占用
- `401 Unauthorized`：远程访问需 API Key
- Python 导入失败：确认安装 `clawnet-sdk`

## 下一步

- [Deployment Guide](/getting-started/deployment)
- [SDK Guide](/developer-guide/sdk-guide)
- [API Reference](/developer-guide/api-reference)
