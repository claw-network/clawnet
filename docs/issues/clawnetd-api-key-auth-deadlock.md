# ClawNet v0.6.13：零 API Key 节点无法通过 HTTP 创建首个 API Key（Auth 死锁）

| 字段 | 值 |
| --- | --- |
| 优先级 | **P0 — 阻塞所有 SDK/HTTP 集成方升级到 0.6.13** |
| 提出方 | TelAgent 团队 |
| 提出日期 | 2026-03-16 |
| 影响范围 | 所有以嵌入式或 SDK 方式集成 `@claw-network/node` 的项目 |

| `@claw-network/node` 版本 | 0.6.13 |
| `@claw-network/sdk` 版本 | 0.6.13 |
| 发现场景 | TelAgent 本地开发 `pnpm run dev`，嵌入式启动 ClawNetNode |

---

## 1. 问题描述

v0.6.13 release notes 中说明：

> **Zero-key nodes now return 401 on all networks** — Previously, fresh testnet/devnet nodes with no API keys configured allowed unauthenticated access. Now all networks enforce authentication. Create an API key via `POST /api/v1/admin/api-keys` from localhost before using the API.

但实际上，**从 localhost 发起的 `POST /api/v1/admin/api-keys` 请求同样被 401 拦截**，导致无法创建首个 API Key。这是一个 auth middleware 与 admin 路由之间的死锁。

---

## 2. 根因分析

### 中间件链顺序

`ApiServer.start()` 中（`dist/api/server.js` L148-160），请求处理链为：

```
console static → CORS → metrics → rate limit → apiKeyAuth → error boundary → logger → router
```

`apiKeyAuth` 中间件在 `router` **之前**执行。

### apiKeyAuth 中间件逻辑

```js
// dist/api/auth.js
export function apiKeyAuth(store, network, consoleSessionStore) {
    return async (req, res, next) => {
        if (!store) { await next(); return; }

        const pathname = ...;
        if (isPublicRoute(pathname, method)) { await next(); return; }

        // ★ 关键：零 key 时直接返回 401
        if (store.activeCount() === 0) {
            unauthorized(res, 'No API keys configured. Create a key via POST /api/v1/admin/api-keys from localhost, or `clawnet api-key create <label>`.');
            return;
        }

        // ... 验证 X-Api-Key header ...
    };
}
```

### PUBLIC_ROUTES 白名单

```js
const PUBLIC_ROUTES = [
    (url) => url === '/api/v1/node' || url === '/api/v1/node/',
    (url) => url === '/api/v1/metrics' || url === '/api/v1/metrics/',
    (url) => url === '/console' || url.startsWith('/console/'),
    (url) => url === '/api/v1/auth/verify-passphrase',
    (url) => url === '/api/v1/auth/totp/verify' || url === '/api/v1/auth/totp/status',
    (_url, method) => method === 'OPTIONS',
];
```

**`/api/v1/admin/api-keys` 不在白名单中。**

### Admin 路由自身的 localhost 检查

```js
// dist/api/routes/admin.js
r.post('/api-keys', async (req, res, route) => {
    if (!isLocalhost(req)) {
        forbidden(res, 'Admin API is only accessible from localhost', ...);
        return;
    }
    // ... 创建 key ...
});
```

Admin 路由有自己的 `isLocalhost()` 安全检查，但 **请求在到达路由之前就已被 auth 中间件拦截返回 401**。

### 死锁

```
新鲜节点（0 个 API Key）
  ↓
POST /api/v1/admin/api-keys  ← 文档说"从 localhost 创建 key"
  ↓
apiKeyAuth 中间件: store.activeCount() === 0 → 401
  ↓
❌ 请求永远到不了 admin 路由
  ↓
无法创建 Key → 无法通过 auth → 无法创建 Key ...（死锁）
```

---

## 3. 复现步骤

```bash
# 1. 全新初始化 ClawNet 节点
rm -rf /tmp/test-clawnet-data
CLAW_PASSPHRASE=test123 node packages/node/dist/daemon.js \
    --data-dir /tmp/test-clawnet-data \
    --api-host 127.0.0.1 --api-port 9528 \
    --passphrase test123 &

sleep 3

# 2. 按照文档指示创建 API Key
curl -v -X POST http://127.0.0.1:9528/api/v1/admin/api-keys \
    -H "Content-Type: application/json" \
    -d '{"label": "my-key"}'

# 结果：HTTP 401
# {"error":"No API keys configured. Create a key via POST /api/v1/admin/api-keys from localhost, or `clawnet api-key create <label>`."}
```

---

## 4. 影响

| 场景 | 影响 |
| --- | --- |
| 嵌入式集成（TelAgent 等） | SDK 通过 HTTP 调用的所有 API 全部 401，节点无法使用 |
| 独立部署 clawnetd | 按文档执行 `curl POST /api/v1/admin/api-keys` 失败，新操作员无法配置节点 |
| CLI `clawnet api-key create` | 若 CLI 底层走 HTTP，同样被拦截 |

---

## 5. 建议修复方案

### 方案 A（推荐）：将 admin 路由加入 PUBLIC_ROUTES 白名单

Admin 路由自身已有 `isLocalhost()` 检查，并非不设防。将其从 auth 中间件豁免即可：

```js
const PUBLIC_ROUTES = [
    // ... 现有规则 ...
    // Admin endpoints — 有 localhost 限制，无需 API Key auth
    (url) => url.startsWith('/api/v1/admin/'),
];
```

### 方案 B：零 Key 时豁免 localhost 请求

在 auth 中间件中，当 `activeCount() === 0` 且请求来自 localhost 时放行：

```js
if (store.activeCount() === 0) {
    const remote = req.socket.remoteAddress ?? '';
    const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (isLocal) {
        await next();  // 零 key + localhost → 放行，让 admin 路由处理
        return;
    }
    unauthorized(res, '...');
    return;
}
```

### 方案 C：将 admin 路由挂载到 auth 中间件之前

调整 `ApiServer.start()` 中的中间件链，让 admin 路由在 `apiKeyAuth` 之前匹配请求。

---

## 6. 我们当前的 Workaround

TelAgent 在嵌入式模式下，直接访问 `ClawNetNode` 实例的内部 `apiKeyStore`（private 属性，通过 `(node as any).apiKeyStore`）来创建 API Key，完全绕过 HTTP 层：

```typescript
// managed-node.ts
createApiKey(label: string): string | undefined {
    const store = (this.node as any)?.apiKeyStore;
    if (!store) return undefined;
    try {
        const record = store.create(label);
        return record?.key;
    } catch {
        return undefined;
    }
}
```

**缺点**：
- 依赖 `apiKeyStore` 这个 private 属性名称，版本升级随时可能 break
- 独立部署的 `clawnetd` 无法使用此 workaround（只能通过 HTTP 或 CLI）
- `clawnetd` 文档对新用户的指引（`curl POST /api/v1/admin/api-keys`）实际无法工作

---

## 7. 附加建议：提供 Public API 创建 Key

建议 `ClawNetNode` 类暴露一个公开方法，让嵌入式集成方可以安全创建 API Key：

```typescript
class ClawNetNode {
    /**
     * Create an API key programmatically.
     * For use by embedding applications (e.g. TelAgent) that
     * need to bootstrap auth without going through HTTP.
     */
    createApiKey(label: string): ApiKeyRecord { ... }
}
```

这样我们不需要访问 private 属性，也不需要 HTTP roundtrip。
