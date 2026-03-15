# ClawNet 团队协作请求：公共水龙头 API 地址确认 & 本地节点领取机制说明

| 字段 | 值 |
| --- | --- |
| 优先级 | **P1 — 水龙头功能完全不可用** |
| 提出方 | TelagentNode 团队 |
| 提出日期 | 2026-03-15 |
| 影响范围 | 所有 TelAgent 用户，无法领取 testnet Token |
| `@claw-network/node` 版本 | 0.6.7 |
| `@claw-network/sdk` 版本 | 0.6.7 |
| 网络环境 | devnet / testnet，chainId 7625 |

---

## 1. 问题背景

TelAgent 以**嵌入式模式**运行 ClawNet Node（`ClawNetNode` embedded，不是独立的 `clawnetd` 进程）。  
用户在 WebApp 钱包页面点击"领取代币"时，后端调用 `@claw-network/sdk` 的：

```typescript
await unsafeClient.faucet.claim({ did, signature, timestamp })
```

SDK 的 `FaucetApi.claim()` 将请求 POST 到本地节点的 `http://127.0.0.1:9528/api/v1/faucet`。  
本地节点的 faucet 路由（`faucetRoutes`）需要 `walletService.mint()` 来铸币，而这要求节点持有 **MINTER_ROLE**。  
我们是普通客户端节点，没有铸币权限，因此本地 faucet 端点直接失败。

---

## 2. 我们尝试过的方案

### 方案一：通过本地节点 faucet API（当前实现）

```
TelAgent WebApp
  → telagent node API /api/v1/clawnet/faucet/claim
  → sdk.unsafeClient.faucet.claim()
  → POST http://127.0.0.1:9528/api/v1/faucet   ← 本地嵌入节点
  → walletService.mint()                         ← 需要 MINTER_ROLE
  → ❌ "chain services not configured" 或铸币权限不足
```

**结果**：失败（返回 500）。

---

### 方案二：直接 POST 外部 testnet faucet

我们知道 `ClawNetNode` 的 `tryFaucetAutoClaim()` 使用 `process.env.CLAW_FAUCET_URL`，我们在 `.env` 里配置了：

```
CLAW_FAUCET_URL=https://clawnetd.com
```

但直接 POST 到 `https://clawnetd.com/api/v1/faucet` 返回：

```
HTTP/2 405 Method Not Allowed
allow: GET, HEAD
server: Caddy
```

该域名的 Caddy 反向代理只允许 GET/HEAD，推测这是 **网站域名**，不是 API 节点地址。

---

### 方案三：尝试其他可能的公共节点地址

我们依次探测了以下地址：

| 地址 | GET 结果 | POST `/api/v1/faucet` 结果 |
|------|----------|---------------------------|
| `https://clawnetd.com/api/v1/faucet` | 405 (Caddy) | 405 |
| `https://rpc.clawnetd.com/api/v1/faucet` | 405 | 404（EVM JSON-RPC，非 ClawNet API） |
| `https://node.clawnetd.com/api/v1/faucet` | 连接超时 | 连接超时 |
| `https://testnet.clawnetd.com/api/v1/faucet` | 连接超时 | 连接超时 |
| `https://faucet.clawnetd.com/api/v1/faucet` | 连接超时 | 连接超时 |

**均未找到可用的外部公共水龙头端点。**

---

## 3. 我们需要确认的问题

### Q1：外部公共水龙头的正确 URL 是什么？

`@claw-network/node` 的 `tryFaucetAutoClaim()` 读取 `process.env.CLAW_FAUCET_URL`，然后拼接 `/api/v1/faucet` 作为目标地址。  
请问正确的 `CLAW_FAUCET_URL` 值应该是什么？

```
CLAW_FAUCET_URL=???
```

---

### Q2：普通客户端节点（无 MINTER_ROLE）应该通过哪条路径领取水龙头 Token？

目前我们理解有两种可能的设计：

**路径 A：SDK 代理模式**  
`sdk.unsafeClient.faucet.claim()` 调用本地节点，本地节点将请求**转发**到外部公共水龙头（不自己铸币）。  
如果这是预期行为，请问本地节点需要哪些配置才能启用转发（例如 `faucetUrl` 参数）？

```typescript
new ClawNetNode({
  dataDir,
  passphrase,
  faucetUrl: 'https://???',   // ← 这里填什么？
  ...
})
```

**路径 B：直连模式**  
TelAgent 绕过本地节点，直接 HTTP POST 到外部公共水龙头 URL。  
如果这是预期行为，正确的端点 URL 是什么？

---

### Q3：`ClawNetNode` 嵌入式模式下 faucet 路由是否有效？

我们观察到 `faucetRoutes` 的第一行：

```javascript
if (!ctx.walletService || !ctx.identityService || !ctx.indexerQuery) {
    internalError(res, 'Faucet unavailable: chain services not configured');
    return;
}
```

我们的嵌入式节点启动时没有完整的 chain 配置（ClawToken 合约未部署到本 devnet），因此 `walletService` 不可用。  
**请问：在没有 MINTER_ROLE 的普通节点上，`POST /api/v1/faucet` 是否预期可用？还是该端点仅在 ClawNet 官方节点（持有 MINTER_ROLE）上才有效？**

---

## 4. 附：当前我们的节点配置

```yaml
# ~/.telagent/clawnet/config.yaml
v: 1
network: devnet
p2p:
  listen:
    - /ip4/0.0.0.0/tcp/9527
  bootstrap: []
logging:
  level: info
```

```dotenv
# .env (关键配置)
TELAGENT_CHAIN_RPC_URL=https://rpc.clawnetd.com
TELAGENT_CHAIN_ID=7625
CLAW_FAUCET_URL=https://clawnetd.com
CLAWNET_HOME=/Users/xiasenhai/.telagent/clawnet
```

---

## 5. 期望的回复

1. **正确的 `CLAW_FAUCET_URL` 值**（用于 `tryFaucetAutoClaim` 和手动领取）
2. **推荐的水龙头领取路径**（路径 A 还是 B？）
3. **`ClawNetNode` 嵌入 + `faucetUrl` 参数**的正确用法示例（如果路径 A 可行）

感谢！
