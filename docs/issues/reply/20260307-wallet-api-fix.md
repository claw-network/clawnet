# clawnetd 钱包 API 问题修复回复

> **回复方**: ClawNet 团队  
> **接收方**: TelAgent 项目组  
> **日期**: 2026-03-07  
> **关联文档**: `docs/issues/clawnetd-wallet-api-issues.md`  
> **修复版本**: `@claw-network/node@0.5.1`

---

## 状态：全部已修复 ✅

三个问题均已修复、发布并部署。

---

## 问题一：`GET /api/v1/wallets/{did}` 传入 DID 时返回 ENS 错误

### 修复状态：✅ 已修复

**根因确认**：与文档分析一致。`wallets.ts` 路由中的 `resolveEvmAddress` 仅通过链上 `ClawIdentity` 注册表查找 DID 对应的 controller 地址。当 DID 未在链上注册时返回 `null`，导致代码未能走链上查询路径。

**修复方式**：在链上注册表查询失败时，回退到确定性地址推导 `deriveAddressForDid(did)`（`keccak256("clawnet:did-address:" + did)` 取后 20 字节），确保 DID 始终能解析为有效的 EVM 地址。

**修复文件**：`packages/node/src/api/routes/wallets.ts`

**修复后行为**：

```bash
curl -s 'https://api.clawnetd.com/api/v1/wallets/did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR' \
  -H 'X-Api-Key: <key>'
```

```json
{
  "data": {
    "balance": "0",
    "available": "0",
    "pending": "0",
    "locked": "0"
  },
  "links": {
    "self": "/api/v1/wallets/did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR"
  }
}
```

> **注意**：响应格式有细微变化 — `balance` 等字段现在是**字符串**（链上路径），而非数字（旧 legacy 路径）。如果 TelAgent 有字段类型断言，请兼容 `string | number`。

---

## 问题二：`GET /api/v1/nonce/{did}` 端点不存在

### 修复状态：✅ 已存在（版本问题）

**说明**：该端点在 `@claw-network/node@0.4.0` 起已实现（`packages/node/src/api/routes/nonce.ts`），挂载在 `/api/v1/nonce`。TelAgent 复现环境使用的是 `clawnetd v0.2.0`，因此返回 404。

**当前行为**（v0.5.1）：

```bash
curl -s 'https://api.clawnetd.com/api/v1/nonce/did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR' \
  -H 'X-Api-Key: <key>'
```

```json
{
  "data": {
    "did": "did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR",
    "address": "0x130eb2b6c2ca8193c159c824fcce472bb48f0de3",
    "nonce": 0
  },
  "links": {
    "self": "/api/v1/nonce/did%3Aclaw%3A..."
  }
}
```

**建议**：TelAgent 侧的 clawnetd 升级到 v0.5.1 即可。

---

## 额外修复：`POST /api/v1/transfers` DID 解析同样的问题

### 修复状态：✅ 已修复

在审查中发现 `transfers.ts` 路由存在与问题一相同的 bug：DID 仅查链上注册表，未注册时直接拒绝请求（400 "Sender DID not registered on-chain"），没有回退到 `deriveAddressForDid`。

**修复文件**：`packages/node/src/api/routes/transfers.ts`

已提取通用的 `resolveEvmAddress` 辅助函数，与 `wallets.ts` 和 `nonce.ts` 行为一致。

---

## 其他端点审查结果

| 端点 | 状态 | 说明 |
|------|------|------|
| `GET /api/v1/wallets/{did}` | ✅ 已修复 | 添加 `deriveAddressForDid` 回退 |
| `GET /api/v1/nonce/{did}` | ✅ 已存在 | v0.4.0 起可用，已有正确回退逻辑 |
| `POST /api/v1/transfers` | ✅ 已修复 | 添加 `deriveAddressForDid` 回退 |
| `GET /api/v1/wallets/{did}/transactions` | ✅ 正常 | 复用同一 `resolveEvmAddress` |
| `POST /api/v1/escrows` | ✅ 正常 | 使用 legacy `resolveAddress`，不直接调用 ethers |
| `GET /api/v1/contracts` | ✅ 正常 | 不涉及 DID→EVM 解析 |

---

## 版本与部署信息

| 项目 | 版本 |
|------|------|
| @claw-network/node | 0.5.1 (npm 已发布) |
| @claw-network/sdk | 0.5.1 (npm 已发布) |
| @claw-network/core | 0.5.1 (npm 已发布) |
| @claw-network/protocol | 0.5.1 (npm 已发布) |
| 服务端部署 | api.clawnetd.com 已更新至 v0.5.1 |
| Git commit | `8712313` (fix) + `959cec1` (version bump) |

## TelAgent 侧建议操作

1. **升级 SDK**：`pnpm add @claw-network/sdk@0.5.1`
2. **升级 clawnetd**（如自建节点）：`pnpm add @claw-network/node@0.5.1`
3. **注意 balance 字段类型变化**：链上路径返回字符串（`"0"`），legacy 路径返回数字（`0`），建议兼容处理
4. **重新创世提醒**：由于共识引擎迁移（Geth → Besu QBFT），链上数据已重置，详见 `docs/handover/20260307-besu-migration-telagent.md`
