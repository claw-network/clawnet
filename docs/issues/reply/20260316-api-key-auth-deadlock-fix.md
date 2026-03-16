# 零 API Key 节点 Auth 死锁修复

> **回复方**: ClawNet 团队
> **接收方**: TelAgent 项目组
> **日期**: 2026-03-16
> **涉及包**: `@claw-network/node@0.6.14`, `@claw-network/sdk@0.6.14`
> **修复状态**: ✅ 已修复并发布 (v0.6.14)
> **关联文档**: `docs/issues/clawnetd-api-key-auth-deadlock.md`

---

## 概述

确认这是 v0.6.13 安全加固引入的 P0 回归 bug。零 API Key 节点上，`apiKeyAuth` 中间件在请求到达 admin 路由之前就返回 401，导致无法通过 HTTP 创建首个 API Key（死锁）。

已在 **v0.6.14** 中修复，npm 和 GitHub Packages 均已发布。

---

## 根因确认

你们的分析完全正确。中间件链顺序为：

```
CORS → rate limit → apiKeyAuth → router
```

v0.6.13 将零 key 节点从"放行"改为"401 拒绝所有网络"，但未将 `/api/v1/admin/` 加入白名单。admin 路由自身的 `isLocalhost()` 检查根本没有机会执行。

---

## 修复方案

采用了你们建议的 **方案 A**（将 admin 路由加入 `PUBLIC_ROUTES` 白名单），因为 admin 路由已有双重安全检查：

1. `isLocalhost(req)` — 仅允许 127.0.0.1 / ::1
2. `isCsrfSafe(req)` — 阻止跨域浏览器请求

### 变更 1：Auth 中间件白名单

```typescript
// packages/node/src/api/auth.ts — PUBLIC_ROUTES
const PUBLIC_ROUTES = [
  (url) => url === '/api/v1/node' || url === '/api/v1/node/',
  (url) => url === '/api/v1/metrics' || url === '/api/v1/metrics/',
  (url) => url === '/console' || url.startsWith('/console/'),
  (url) => url === '/api/v1/auth/verify-passphrase',
  (url) => url === '/api/v1/auth/totp/verify' || url === '/api/v1/auth/totp/status',
  // ✅ 新增：Admin 端点由 isLocalhost() + CSRF 检查保护，无需 API Key auth
  (url) => url.startsWith('/api/v1/admin/'),
  (_url, method) => method === 'OPTIONS',
];
```

### 变更 2：`ClawNetNode.createApiKey()` 公开方法

针对你们提出的第 7 点建议，已添加公开方法，嵌入式集成方无需再通过 `(node as any).apiKeyStore` 访问私有属性：

```typescript
// packages/node/src/index.ts — ClawNetNode
class ClawNetNode {
  /**
   * Create an API key programmatically.
   * For embedding applications that need to bootstrap auth
   * without going through the HTTP layer.
   */
  createApiKey(label: string): { key: string; id: number; label: string } | null {
    if (!this.apiKeyStore) return null;
    const record = this.apiKeyStore.create(label);
    return { key: record.key, id: record.id, label: record.label };
  }
}
```

### 变更 3：回归测试

新增测试用例确保零 key 节点的 admin 端点可达：

```typescript
it('allows POST /api/v1/admin/api-keys on zero-key node from localhost (no deadlock)', async () => {
  expect(store.activeCount()).toBe(0);
  const res = await fetch(`${baseUrl}/api/v1/admin/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'bootstrap' }),
  });
  expect(res.status).toBe(200);
  // 创建 key 后，受保护路由仍需携带 key
  const protectedRes = await fetch(`${baseUrl}/api/v1/wallets/did:claw:test/balance`);
  expect(protectedRes.status).toBe(401);
});
```

---

## 升级指引

```bash
# npm
npm install @claw-network/node@0.6.14 @claw-network/sdk@0.6.14

# pnpm
pnpm update @claw-network/node@0.6.14 @claw-network/sdk@0.6.14
```

### TelAgent 嵌入式集成迁移

**之前（v0.6.13 workaround）**：
```typescript
// ❌ 访问私有属性，版本升级可能 break
const store = (this.node as any)?.apiKeyStore;
const record = store.create(label);
```

**之后（v0.6.14）**：
```typescript
// ✅ 公开 API，稳定接口
const result = node.createApiKey('telagent-default');
if (result) {
  console.log('API Key:', result.key);
}
```

### 独立部署 clawnetd

v0.6.14 中文档指引的命令现在可以正常工作：

```bash
curl -X POST http://127.0.0.1:9528/api/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -d '{"label": "my-key"}'
# ✅ 返回 200 + API Key
```

---

## 安全性说明

此修复 **不降低** v0.6.13 引入的安全防护等级：

| 安全属性 | v0.6.13 | v0.6.14 |
|----------|---------|---------|
| 非 localhost 的 admin 请求 | 被 auth 中间件 401 拦截 | 被 admin 路由 `isLocalhost()` 403 拦截 |
| 跨域浏览器 CSRF | 被 CORS 策略阻止 | 被 CORS + `isCsrfSafe()` 双重阻止 |
| 零 key 节点非 admin 路由 | 401 | 401（不变） |
| 有 key 节点的 key 验证 | 正常 | 正常（不变） |

唯一变化是 admin 路由的拒绝层从 auth 中间件移到了路由自身的 localhost 检查，安全效果等价。

---

## 测试验证

全量测试通过（435 tests, 39 files），包含新增的死锁回归测试。

如有疑问请随时联系。
