# 公共水龙头 API 地址确认 & 本地节点领取机制说明

> **回复方**: ClawNet 团队
> **接收方**: TelagentNode 项目组
> **日期**: 2026-03-15
> **涉及包**: `@claw-network/node@0.6.12`, `@claw-network/sdk@0.6.12`
> **修复状态**: ✅ 已修复并部署
> **关联文档**: `docs/issues/clawnet-faucet-api-inquiry.md`

---

## 概述

我们确认了两个 bug 导致公共水龙头无法从外部调用：

1. **Caddy 反向代理错误拦截** — `api.clawnetd.com` 的 Caddy 配置要求所有 POST 请求携带 `X-API-Key`，但水龙头端点使用 Ed25519 签名认证（不需要 API Key），导致请求被 Caddy 以 401 拒绝，根本到不了 Node 服务。
2. **`install.sh` 默认 URL 错误** — 默认 `CLAW_FAUCET_URL` 为 `https://clawnetd.com`（项目主页域名），正确值应为 `https://api.clawnetd.com`（API 域名）。

两个问题均已修复并部署到生产环境。

---

## Q1 回答：正确的 `CLAW_FAUCET_URL`

```
CLAW_FAUCET_URL=https://api.clawnetd.com
```

完整调用路径：`POST https://api.clawnetd.com/api/v1/faucet`

验证（修复后）：

```bash
# 正确返回 400 验证错误（说明请求已到达 Node 服务）
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"did":"test","signature":"test","timestamp":1}' \
  https://api.clawnetd.com/api/v1/faucet

# 返回:
# {"type":"https://clawnet.dev/errors/validation-error","title":"Bad Request","status":400,"detail":"Invalid DID format: must start with did:claw:","instance":"/api/v1/faucet"}
```

修复前该请求返回 `401 Unauthorized: X-API-Key required`（被 Caddy 拦截）。

---

## Q2 回答：推荐路径 — 路径 B（直连外部公共水龙头）

**普通客户端节点（无 MINTER_ROLE）不应通过本地 `/api/v1/faucet` 端点领取。** 该端点仅在 ClawNet 官方节点上有效（持有 MINTER_ROLE 的节点签名者执行链上铸币）。

### 推荐方式：使用 `ClawNetNode` 的自动领取功能

`ClawNetNode` 内置了 `tryFaucetAutoClaim()` 方法，在节点首次启动时自动向外部公共水龙头领取 Token。你们只需要正确配置 `faucetUrl`：

```typescript
const node = new ClawNetNode({
  dataDir,
  passphrase,
  faucetUrl: 'https://api.clawnetd.com',   // ← 正确值
  // ... 其他配置
});

await node.start();
// 启动后自动执行:
// 1. 检查 faucet-claimed 标记文件是否存在（防止重复领取）
// 2. 查询链上余额（> 0 则跳过）
// 3. 构造签名请求 POST 到 https://api.clawnetd.com/api/v1/faucet
// 4. 成功后写入标记文件
```

或者通过环境变量：

```dotenv
CLAW_FAUCET_URL=https://api.clawnetd.com
```

`ClawNetNode` 会自动读取 `this.config.faucetUrl ?? process.env.CLAW_FAUCET_URL`。

### 手动领取（绕过 Node，直接 HTTP）

如果需要手动领取（例如 WebApp 中用户点击"领取代币"），直接 POST 到公共水龙头：

```typescript
import { signBytes, utf8ToBytes } from '@claw-network/core';

const did = 'did:claw:z...';       // 用户的 DID
const timestamp = Date.now();
const message = `faucet:claim:${did}:${timestamp}`;
const signature = await signBytes(utf8ToBytes(message), privateKey);

const response = await fetch('https://api.clawnetd.com/api/v1/faucet', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    did,
    signature: Buffer.from(signature).toString('hex'),
    timestamp,
  }),
});

// 成功: 200 { data: { txHash, amount, did, evmAddress } }
// 已领取过: 409 Conflict
// 频率限制: 429 Too Many Requests
```

### 使用 SDK 直连

也可以用 SDK 的 `FaucetApi`，但需要将 `baseUrl` 指向公共 API（而非本地节点）：

```typescript
import { ClawNetClient } from '@claw-network/sdk';

// ✅ 指向公共 API
const publicClient = new ClawNetClient({
  baseUrl: 'https://api.clawnetd.com',
});

await publicClient.faucet.claim({ did, signature, timestamp });
```

> ⚠️ 注意：`FaucetApi` 的所有请求都走同一个 `baseUrl`。如果你们的 `unsafeClient` 已经指向 `http://127.0.0.1:9528`，需要单独创建一个指向公共 API 的 client 实例来调用 faucet。

---

## Q3 回答：嵌入式模式下 faucet 路由状态

**`POST /api/v1/faucet` 不在普通节点上可用**，这是预期行为。

该端点需要：

1. `ctx.walletService` — 需要链配置（RPC URL + ClawToken 合约地址）
2. `ctx.identityService` — 需要 ClawIdentity 合约
3. `ctx.indexerQuery` — 需要 SQLite indexer（记录领取历史、频率限制）
4. **MINTER_ROLE** — 节点签名者必须在 ClawToken 合约上持有铸币角色

你们的嵌入式节点缺少以上配置，`walletService` 为空，因此返回 `500 Faucet unavailable: chain services not configured` 是正确的。

**架构设计意图**：

```
┌─────────────────────────┐
│  TelAgent 嵌入式节点     │
│  (无 MINTER_ROLE)       │
│                         │       POST /api/v1/faucet
│  tryFaucetAutoClaim() ──────────────────────────────────┐
│  或 手动 HTTP POST       │                              │
└─────────────────────────┘                               ▼
                                              ┌──────────────────────┐
                                              │  api.clawnetd.com    │
                                              │  (ClawNet 官方节点)  │
                                              │  持有 MINTER_ROLE    │
                                              │                      │
                                              │  验证 Ed25519 签名   │
                                              │  → walletService.mint│
                                              │  → 链上铸币到目标地址│
                                              └──────────────────────┘
```

---

## 水龙头规则

| 规则 | 值 | 环境变量 |
|------|------|----------|
| 单次领取数量 | 100 Token | `CLAW_FAUCET_AMOUNT` |
| 每 DID 限制 | **一次性**（409 Conflict） | — |
| 每 IP 每天 | 10 次 | `CLAW_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY` |
| 每日总预算 | 1,000 Token | `CLAW_FAUCET_DAILY_BUDGET` |
| 签名时间窗口 | ±5 分钟 | — |
| 签名格式 | `faucet:claim:{did}:{timestamp}` | — |

---

## 你们需要做的变更

### 1. 修改 `.env`

```diff
- CLAW_FAUCET_URL=https://clawnetd.com
+ CLAW_FAUCET_URL=https://api.clawnetd.com
```

### 2. 修改 `ClawNetNode` 初始化（如果通过代码传参）

```diff
  new ClawNetNode({
    dataDir,
    passphrase,
-   faucetUrl: 'https://clawnetd.com',
+   faucetUrl: 'https://api.clawnetd.com',
  })
```

### 3. WebApp "领取代币" 按钮

不要通过本地节点的 `/api/v1/faucet`，改为直接 POST 到公共水龙头：

```diff
- await unsafeClient.faucet.claim({ did, signature, timestamp })
+ // 使用指向公共 API 的独立 client
+ const faucetClient = new ClawNetClient({ baseUrl: 'https://api.clawnetd.com' });
+ await faucetClient.faucet.claim({ did, signature, timestamp });
```

或直接 `fetch('https://api.clawnetd.com/api/v1/faucet', ...)`。

### 4. 升级 SDK/Node（推荐）

你们当前使用 `0.6.7`，建议升级到 `0.6.12`，包含多项修复：

```bash
pnpm add @claw-network/sdk@0.6.12 @claw-network/node@0.6.12
```

---

## 我们已修复的问题

| 修复 | 说明 | 状态 |
|------|------|------|
| Caddy `/api/v1/faucet` 放行 | 在 API key 校验前添加路径例外，允许水龙头 POST 不带 `X-API-Key` | ✅ 已部署 |
| `install.sh` 默认 URL | `https://clawnetd.com` → `https://api.clawnetd.com` | ✅ 已提交 |

---

## 验证方法

修改完成后，可以运行以下命令验证领取是否正常：

```bash
# 替换为实际 DID 和签名
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"did":"did:claw:zFy3...","signature":"<hex>","timestamp":'$(date +%s000)'}' \
  https://api.clawnetd.com/api/v1/faucet
```

或查看水龙头统计：

```bash
curl -s https://api.clawnetd.com/api/v1/faucet/stats | jq .
```

如有问题请随时联系。
