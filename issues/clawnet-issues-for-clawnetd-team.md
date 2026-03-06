# ClawNet 整改需求清单

> **来源**: TelAgent 项目组  
> **日期**: 2026-03-06  
> **涉及版本**: `@claw-network/node@0.4.0`, `@claw-network/core@0.4.0`, `@claw-network/protocol@0.4.0`  
> **上下文**: TelAgent v0.2.0 已全面迁移至 ClawNet P2P，移除了 HTTP Federation。本地开发和嵌入式 ClawNet 模式（TelAgent 自动启动 ClawNet 节点）是核心使用场景。

---

## 问题 1 [P0 — 阻塞] 依赖版本声明错误

### 现象

`@claw-network/node@0.4.0` 的 `package.json` 声明：

```json
{
  "dependencies": {
    "@claw-network/core": "^0.1.0",
    "@claw-network/protocol": "^0.1.0"
  }
}
```

但代码实际依赖 `0.4.0` 引入的新 API。包管理器（pnpm/npm）按语义版本解析，可能安装到 `0.1.x` ~ `0.3.x` 的旧版本，导致运行时崩溃。

### 复现

```bash
mkdir test && cd test
npm init -y
npm install @claw-network/node@0.4.0
node -e "const { ClawNetNode } = require('@claw-network/node'); new ClawNetNode().start()"
```

### 报错

**@claw-network/protocol**: 缺少 `./messaging` 导出（0.4.0 新增），pnpm 解析到 0.2.2：

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './messaging' is not defined
by "exports" in @claw-network/protocol/package.json
```

**@claw-network/core**: 缺少 `onPeerDisconnect` 等新 P2P API（0.4.0 新增），pnpm 解析到 0.1.2：

```
TypeError: this.p2p?.onPeerDisconnect is not a function
    at ClawNetNode.startMeshAmplifier
```

### 修复建议

将 `@claw-network/node@0.4.0` 的依赖声明改为：

```json
{
  "dependencies": {
    "@claw-network/core": "^0.4.0",
    "@claw-network/protocol": "^0.4.0"
  }
}
```

发布 `@claw-network/node@0.4.1` patch 修复。

### TelAgent 临时绕过

根 `package.json` 中添加 pnpm overrides：

```json
"pnpm": {
  "overrides": {
    "@claw-network/core": "0.4.0",
    "@claw-network/protocol": "0.4.0"
  }
}
```

---

## 问题 2 [P0 — 阻塞] 缺少轻量级 passphrase 验证 API

### 场景

TelAgent WebApp 用户通过输入 ClawNet passphrase 登录。TelAgent 节点需要向本地 ClawNet 节点验证 passphrase 是否正确。

当前唯一可用的验证方式是调用 `/api/v1/nonce/<DID>`（内部通过 `WalletService` 实现）。但 `WalletService` 依赖链配置（`config.chain`）——在嵌入式模式下（TelAgent 自动启动 ClawNet 节点、未配置 chain RPC），wallet service 不会初始化。

### 复现

```bash
# 嵌入式 ClawNet 节点（无 chain 配置）
curl -s http://127.0.0.1:9528/api/v1/nonce/did:claw:z2Dzhx93g...

# 返回：
{
  "type": "https://clawnet.dev/errors/internal-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "Wallet service unavailable"
}
```

### 影响

PassPhrase 验证永远失败 → TelAgent `POST /api/v1/session/unlock` 返回 500 "Invalid passphrase" → **用户无法登录 WebApp**。

### 修复建议

新增一个 **不依赖链/wallet** 的 passphrase 验证端点：

```
POST /api/v1/auth/verify-passphrase
Content-Type: application/json

{ "passphrase": "user_input_passphrase" }
```

成功响应：

```json
{
  "data": {
    "valid": true,
    "did": "did:claw:z2Dzhx93g5j88yMz2i7iVfpN4xdJMUXR36LCvFCNfLzd4"
  }
}
```

失败响应：

```json
{
  "data": {
    "valid": false
  }
}
```

**实现思路**：使用 `@claw-network/core` 的 `decryptKeyRecord(record, passphrase)` 尝试解密 identity key record。解密成功说明 passphrase 正确，解密报错说明不正确。这是纯本地操作，不需要任何链上交互。

参考代码路径：
- `@claw-network/core/src/storage/keystore.ts` → `decryptKeyRecord()`
- `@claw-network/node/src/index.ts` → `ensureIdentityKeyRecord()` 中已有类似逻辑

### TelAgent 临时绕过

如果 passphrase 验证失败但 ClawNet 节点 `/api/v1/node` 返回了有效 DID，TelAgent 将视为"验证不确定"并放行（降级为信任模式）。这不安全，仅作为等待此端点上线前的临时方案。

---

## 问题 3 [P1 — 已绕过] WS topic 过滤不支持通配符/前缀匹配

### 现象

`ws-messaging.js` 中的 topic 格式校验：

```js
const TOPIC_PATTERN = /^[a-zA-Z0-9._\-:/]{1,128}$/;
```

不允许 `*` 字符。TelAgent 需要订阅 `telagent/envelope`、`telagent/receipt`、`telagent/group-sync` 三个 topic，理想情况下通过 `telagent/*` 一次订阅到全部。

尝试连接时：

```
ws://127.0.0.1:9528/api/v1/messaging/subscribe?topic=telagent/*
→ ws.close(4001, 'Invalid topic filter')
```

同时，subscriber 过滤逻辑是精确匹配（非前缀）：

```js
if (client.topicFilter && msg.topic !== client.topicFilter) return;
```

### TelAgent 临时绕过

不传 `topic` 参数 → 订阅所有消息 → 客户端按 topic 路由。在当前消息量下可接受。

### 修复建议（任选一种或组合）

**方案 A — 支持通配符**：
- `TOPIC_PATTERN` 允许 `*` 字符
- subscriber 过滤改为前缀匹配：`telagent/*` 匹配所有 `telagent/` 开头的 topic

**方案 B — 支持多 topic 订阅**：
- 允许逗号分隔的 topic 列表：`topic=telagent/envelope,telagent/receipt,telagent/group-sync`
- subscriber 过滤改为集合匹配

**方案 C — 支持 topic 前缀参数**：
- 新增 `topicPrefix` 参数与 `topic` 并列使用

---

## 问题 4 [P2 — 建议] `better-sqlite3` 版本应对齐

### 现象

`@claw-network/node@0.4.0` 声明 `better-sqlite3@^11.10.0`，当前最新稳定版为 `12.x`。

下游项目如果自己使用 `better-sqlite3@^12.x`，pnpm 会安装两个版本。`11.x` 版本如果不在 `pnpm.onlyBuiltDependencies` 列表中，原生模块不会被编译：

```
Error: Could not locate the bindings file.
Tried: .../better-sqlite3@11.10.0/.../better_sqlite3.node
```

### 修复建议

将依赖升级到 `"better-sqlite3": "^12.2.0"`。

---

## 问题 5 [P2 — 文档] `ClawNetNode.init()` 移除未在 CHANGELOG 说明

### 现象

`@claw-network/node@0.3.x` 暴露 `ClawNetNode.init()` 用于首次初始化密钥。`0.4.0` 将此逻辑合并进了 `start()`（自动检测 dataDir 是否为空），但 `init()` 方法被移除且没有在 CHANGELOG 或迁移指南中说明。

上游使用 `node.init(); node.start()` 模式的代码会直接崩溃：

```
TypeError: this.node.init is not a function
```

### 修复建议

在 CHANGELOG / Migration Guide 中注明：

> **Breaking Change**: `ClawNetNode.init()` has been removed.  
> `start()` now auto-initializes the data directory on first run (generates identity key, config.yaml, etc.).  
> Callers should only call `start()`.

---

## 优先级总结

| # | 优先级 | 问题 | 阻塞TelAgent | 需要发版 |
|---|--------|------|-------------|---------|
| 1 | **P0** | 依赖版本声明错误 | ✅ 需 pnpm overrides 绕过 | `@claw-network/node@0.4.1` |
| 2 | **P0** | 缺少 passphrase 验证 API | ✅ 降级为信任模式 | `@claw-network/node@0.4.1` |
| 3 | **P1** | WS topic 不支持通配符 | ❌ 已绕过（订阅全部） | `@claw-network/node@0.5.0` |
| 4 | **P2** | better-sqlite3 版本过旧 | ❌ 可 overrides 绕过 | `@claw-network/node@0.5.0` |
| 5 | **P2** | init() 移除未说明 | ❌ 已适配 | CHANGELOG 补充 |

---

## 联系方式

如有疑问请联系 TelAgent 项目组。我们可以提供更详细的复现步骤或协助验证修复。
