# ClawNet 整改回复

> **来自**: ClawNet 项目组  
> **日期**: 2026-03-06  
> **回复**: TelAgent 项目组《ClawNet 整改需求清单》(2026-03-06)  
> **修复版本**: `@claw-network/node@0.4.1`, `@claw-network/core@0.4.1`, `@claw-network/protocol@0.4.1`, `@claw-network/sdk@0.4.1`  
> **npm 状态**: ✅ 已发布

---

## 总览

收到整改需求后，我们已完成全部 5 个问题的修复，并以 `0.4.1` patch 版本发布至 npm。TelAgent 可移除所有临时绕过方案，直接升级到 `@claw-network/node@0.4.1`。

| # | 问题 | 状态 | 版本 |
|---|------|------|------|
| 1 | 依赖版本声明错误 | ✅ 已修复 | 0.4.1 |
| 2 | 缺少 passphrase 验证 API | ✅ 已实现 | 0.4.1 |
| 3 | WS topic 不支持通配符 | ✅ 已实现（方案 A+B） | 0.4.1 |
| 4 | better-sqlite3 版本过旧 | ✅ 已升级 | 0.4.1 |
| 5 | init() 移除未说明 | ✅ 已补充 CHANGELOG | 0.4.1 |

---

## 问题 1 — 依赖版本声明错误

### 修复内容

所有 workspace 内部依赖声明从 `workspace:^0.1.0` 改为 `workspace:^`。pnpm 发布时会自动将其解析为当前版本（如 `^0.4.1`）。

已验证 `@claw-network/node@0.4.1` 发布产物中的 `package.json`：

```json
{
  "dependencies": {
    "@claw-network/core": "^0.4.1",
    "@claw-network/protocol": "^0.4.1"
  }
}
```

### TelAgent 侧操作

可移除 `pnpm.overrides`，直接安装：

```bash
pnpm add @claw-network/node@0.4.1
```

---

## 问题 2 — 缺少 passphrase 验证 API

### 新增端点

```
POST /api/v1/auth/verify-passphrase
Content-Type: application/json

{ "passphrase": "user_input_passphrase" }
```

**成功响应** (200):

```json
{
  "data": {
    "valid": true,
    "did": "did:claw:z2Dzhx93g5j88yMz2i7iVfpN4xdJMUXR36LCvFCNfLzd4"
  }
}
```

**失败响应** (200):

```json
{
  "data": {
    "valid": false
  }
}
```

### 实现说明

- 纯本地操作：读取 `dataDir` 下的 identity key record，使用 `decryptKeyRecord(record, passphrase)` 尝试解密
- **不依赖** chain 配置、WalletService 或任何链上交互
- 嵌入式模式下可正常工作
- 受 API Key 认证保护（与其他 POST 端点一致）

### TelAgent 侧操作

将 `POST /api/v1/session/unlock` 的 passphrase 验证逻辑从 nonce 接口迁移到此端点，可移除"信任模式"降级逻辑。

---

## 问题 3 — WS topic 不支持通配符

### 修复方案

同时实现了 **方案 A（通配符）** 和 **方案 B（多 topic）**：

**通配符（尾部 `*`）**：

```
ws://127.0.0.1:9528/api/v1/messaging/subscribe?topic=telagent/*
```

匹配所有 `telagent/` 开头的 topic（`telagent/envelope`、`telagent/receipt`、`telagent/group-sync` 等）。

**逗号分隔多 topic**：

```
ws://127.0.0.1:9528/api/v1/messaging/subscribe?topic=telagent/envelope,telagent/receipt,telagent/group-sync
```

精确匹配列表中的任一 topic。

**两者可混合使用**：

```
topic=telagent/*,system/health
```

### 技术细节

- `TOPIC_PATTERN` 现在允许尾部 `*` 字符
- 订阅过滤从精确匹配改为 matcher 函数（前缀匹配 / 集合匹配）
- 向后兼容：不带 `*` 的单 topic 行为不变

### TelAgent 侧操作

推荐使用 `topic=telagent/*`，可移除客户端侧的 topic 路由逻辑。

---

## 问题 4 — better-sqlite3 版本过旧

### 修复内容

```diff
- "better-sqlite3": "^11.10.0"
+ "better-sqlite3": "^12.2.0"
```

### TelAgent 侧操作

如有 `pnpm.overrides` 中的 `better-sqlite3` 覆盖，可一并移除。

---

## 问题 5 — init() 移除未说明

### 修复内容

已在项目根目录新增 `CHANGELOG.md`，记录完整的 0.4.x 变更，包括：

> **Breaking Change**: `ClawNetNode.init()` has been removed.  
> `start()` now auto-initializes the data directory on first run (generates identity key, config.yaml, etc.).  
> Callers should only call `start()`.

后续版本发布将持续维护此 CHANGELOG。

---

## 升级指南

```bash
# 1. 升级依赖
pnpm add @claw-network/node@0.4.1

# 2. 移除不再需要的 overrides（如有）
#    删除 package.json 中的:
#    "pnpm": { "overrides": { "@claw-network/core": "...", "@claw-network/protocol": "..." } }

# 3. 重新安装
pnpm install
```

---

## 后续沟通

如在集成过程中遇到任何问题，请随时联系我们。我们可以配合 TelAgent 项目组进行联调验证。
