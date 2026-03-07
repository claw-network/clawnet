# clawnetd 钱包 API 问题整改文档

| 字段       | 值                        |
| ---------- | ------------------------- |
| 提交方     | telagent 项目组           |
| 日期       | 2026-03-07                |
| clawnetd   | v0.2.0 (testnet)          |
| SDK        | @claw-network/sdk v0.3.0  |
| 链环境     | Geth PoA, chainId 7625    |
| 严重程度   | P1 — 阻塞钱包功能上线     |

---

## 问题一：`GET /api/v1/wallets/{did}` 传入 DID 时返回 ENS 错误

### 现象

调用 `GET /api/v1/wallets/did:claw:z6tor6XFy7EYf6GJrqknsgjvEHZxoZbC1KQQkLBvmNyXn` 返回 500：

```json
{
  "type": "https://clawnet.dev/errors/internal-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "network does not support ENS (operation=\"getEnsAddress\", info={ \"network\": { \"chainId\": \"7625\", \"name\": \"clawnet\" } }, code=UNSUPPORTED_OPERATION, version=6.16.0)"
}
```

### 传入原生 EVM 地址时正常

调用 `GET /api/v1/wallets/0x1FcC6D54Aa002358cD623e2d8b246Da912B2C38d` 返回 200：

```json
{
  "data": {
    "balance": "0",
    "available": "0",
    "pending": "0",
    "locked": "0"
  },
  "links": {
    "self": "/api/v1/wallets/0x1FcC6D54Aa002358cD623e2d8b246Da912B2C38d"
  }
}
```

### 根因分析

clawnetd 在处理 `/api/v1/wallets/{target}` 时，将 `target` 参数直接传给了 ethers.js v6 的 `provider.getBalance(target)`。当 `target` 不是合法的 `0x` 地址时，ethers.js 尝试通过 ENS 解析该字符串，但 chainId 7625 网络没有部署 ENS 合约，导致抛出 `UNSUPPORTED_OPERATION` 异常。

### 调用链路

```
@claw-network/sdk WalletApi.getBalance({ did })
  → resolveWalletAddress() → 返回 DID 字符串
    → http.get(`/api/v1/wallets/${did}`)
      → clawnetd 收到 did:claw:z6tor... 作为 target
        → ethers.provider.getBalance("did:claw:z6tor...")
          → ethers 尝试 ENS 解析 → 报错
```

### 建议修复方案

clawnetd 应在调用 ethers.js 之前完成 DID → EVM 地址的解析：

```
1. 检查 target 是否为 0x 开头的 EVM 地址
2. 若不是，视为 DID，通过本地 identity 模块将 DID 解析为 controller 地址
3. 用解析后的 EVM 地址调用 provider.getBalance(address)
```

> 或者：如果仅作为紧急修复，可以在 SDK 侧的 `resolveWalletAddress()` 中，先调用 `/api/v1/identities/{did}` 获取 `address` 字段，再用地址请求 `/api/v1/wallets/{address}`。但这是治标不治本，建议 clawnetd 端修复。

---

## 问题二：`GET /api/v1/nonce/{did}` 端点不存在

### 现象

调用 `GET /api/v1/nonce/did:claw:z6tor6XFy7EYf6GJrqknsgjvEHZxoZbC1KQQkLBvmNyXn` 返回 404：

```json
{
  "error": "Not Found",
  "path": "/api/v1/nonce/did:claw:z6tor6XFy7EYf6GJrqknsgjvEHZxoZbC1KQQkLBvmNyXn"
}
```

### 根因分析

`@claw-network/sdk` v0.3.0 的 `WalletApi.getNonce()` 调用 `GET /api/v1/nonce/{target}`，但 clawnetd v0.2.0 没有注册该路由。这是 SDK 与 clawnetd 之间的接口不同步。

### 调用链路

```
@claw-network/sdk WalletApi.getNonce({ did })
  → resolveWalletAddress() → 返回 DID 字符串
    → http.get(`/api/v1/nonce/${did}`)
      → clawnetd 404
```

### 建议修复方案

clawnetd 需要新增端点：

```
GET /api/v1/nonce/{target}

响应 200：
{
  "data": {
    "nonce": <number>,       // provider.getTransactionCount(address)
    "address": "<0x...>"     // 解析后的 EVM 地址
  },
  "links": {
    "self": "/api/v1/nonce/{target}"
  }
}
```

同样需要处理 `target` 为 DID 的情况（先解析为 EVM 地址再查询 nonce）。

---

## 影响范围

| 功能                | 调用的端点               | 状态 |
| ------------------- | ----------------------- | ---- |
| 钱包余额显示        | `GET /wallets/{did}`    | ❌ 500 |
| 钱包 nonce 显示     | `GET /nonce/{did}`      | ❌ 404 |
| 转账                | `POST /transfers`       | ⚠️ 未验证 (可能同样有 DID 解析问题) |
| 托管                | `POST /escrows`         | ⚠️ 未验证 |
| 交易历史            | `GET /wallets/{did}/transactions` | ⚠️ 未验证 (可能同样有 DID 解析问题) |

以上端点在 SDK v0.3.0 中均通过 `resolveWalletAddress()` 将 DID 传给 clawnetd，预计凡涉及 DID → 地址解析的端点都可能存在相同问题。

---

## 复现环境

- **节点**: alex.telagent.org (173.249.46.252)
- **clawnetd**: v0.2.0, 监听 127.0.0.1:9528
- **链**: Geth v1.13.15 Clique PoA, chainId 7625, London fork, baseFee=7 wei
- **DID**: `did:claw:z6tor6XFy7EYf6GJrqknsgjvEHZxoZbC1KQQkLBvmNyXn`
- **对应 EVM 地址**: `0x1FcC6D54Aa002358cD623e2d8b246Da912B2C38d`

### 快速复现命令

```bash
# 问题一：DID 触发 ENS 错误
curl -s 'http://127.0.0.1:9528/api/v1/wallets/did:claw:z6tor6XFy7EYf6GJrqknsgjvEHZxoZbC1KQQkLBvmNyXn'
# → 500 ENS error

# 对照：EVM 地址正常
curl -s 'http://127.0.0.1:9528/api/v1/wallets/0x1FcC6D54Aa002358cD623e2d8b246Da912B2C38d'
# → 200 OK

# 问题二：nonce 端点不存在
curl -s 'http://127.0.0.1:9528/api/v1/nonce/did:claw:z6tor6XFy7EYf6GJrqknsgjvEHZxoZbC1KQQkLBvmNyXn'
# → 404 Not Found
```

---

## 期望时间线

| 项目             | 期望 |
| ---------------- | ---- |
| 问题一修复       | 下一个 patch 版本 (v0.2.1) |
| 问题二实现       | 下一个 patch 版本 (v0.2.1) |
| SDK 同步更新     | 若 clawnetd 端修复，SDK 无需改动；若改路由，SDK 对齐 |
