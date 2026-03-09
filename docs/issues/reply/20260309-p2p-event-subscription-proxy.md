# P2P 事件订阅代理（Subscription Delegation）实现回复

> **回复方**: ClawNet 团队
> **接收方**: TelagentNode 团队
> **日期**: 2026-03-09
> **关联文档**: `docs/issues/clawnet-p2p-event-subscription-proxy.md`
> **实施文档**: `docs/implementation/subscription-delegation.md`
> **涉及包**: `@claw-network/protocol`, `@claw-network/node`, `@claw-network/sdk`

---

## 状态：方案 B 已实现 ✅

采纳需求文档推荐的 **方案 B（ClawNet 协议层事件订阅代理）**，已完成全链路实现：协议类型 → SQLite 存储 → 服务层（自动转发 + 反压控制） → REST API → WebSocket 代理订阅端点 → SDK 方法。

编译通过，lint 零错误，全部 304 个测试通过（含新增 20 个 delegation 测试）。

---

## 实现概览

### 新增 P2P 流协议

```
协议 ID:  /clawnet/1.0.0/delegated-msg
序列化:   JSON（轻量、可扩展）
最大负载: 64 KB
流超时:   10 秒
```

### 核心数据流

```
Peer C  ──P2P DM──►  Target Node
                        │
                        ├─ 1. 消息存入 inbox
                        ├─ 2. 查询 active delegations（按 topic 匹配）
                        └─ 3. /clawnet/1.0.0/delegated-msg ──► Gateway Node
                                                                   │
                                                                   ├─ 存入 delegated_inbox（UNIQUE 去重）
                                                                   ├─ 分配本地单调递增 seq
                                                                   └─ WS 实时推送 ──► Webapp
                                                                                        │
                                                                                        └─ fetch 实际内容（API Proxy）
```

### 安全模型

| 特性 | 实现 |
|------|------|
| **单向授权** | 只有 Target 可创建 delegation，Gateway 无法自行订阅 |
| **精确 topic** | 必须指定具体 topic 列表，**不支持通配符** `*` |
| **TTL 强制** | 授权必须有有效期（60s–86400s），到期自动清除 |
| **撤销即失效** | Target 撤销后立即停止转发 |
| **配额限制** | 每个节点最多 **10 个**活跃 delegation |
| **metadataOnly** | 默认 `true`，Gateway 只收到元数据，看不到 payload |
| **P2P 身份验证** | 信任 libp2p Noise 握手已验证的 PeerId→DID 绑定 |

### 反压控制

Target 侧转发走异步队列（`DelegationForwarder`）：
- 并发上限 5（同时最多向 5 个 Gateway 发送）
- 队列深度上限 200，溢出时丢弃最旧任务并 warn 日志
- 发送失败不重试——Gateway 通过 `sinceSeq` 补回

---

## 新增 REST API 端点

所有端点挂载在 `/api/v1/messaging/` 下，需 `X-Api-Key` 或 `Authorization: Bearer` 认证。

### 1. `POST /api/v1/messaging/subscription-delegations`

Target Node 创建订阅授权。

**请求体**：

```json
{
  "delegateDid": "did:claw:zGateway...",
  "topics": ["telagent/envelope", "telagent/receipt"],
  "expiresInSec": 3600,
  "metadataOnly": true
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `delegateDid` | ✅ | 被授权方 DID（`did:claw:z...`） |
| `topics` | ✅ | 精确 topic 列表，不支持通配符 |
| `expiresInSec` | ✅ | 授权有效期秒数（60–86400） |
| `metadataOnly` | 可选 | 默认 `true`，只转发元数据不含 payload |

**成功响应** `201 Created`：

```json
{
  "data": {
    "delegationId": "dlg_a1b2c3d4e5f6a1b2c3d4e5f6",
    "delegateDid": "did:claw:zGateway...",
    "topics": ["telagent/envelope", "telagent/receipt"],
    "metadataOnly": true,
    "expiresAtMs": 1741568400000,
    "createdAtMs": 1741564800000,
    "revoked": false
  },
  "links": {
    "self": "/api/v1/messaging/subscription-delegations/dlg_a1b2c3d4e5f6a1b2c3d4e5f6"
  }
}
```

**错误响应**：

| HTTP 状态码 | 场景 |
|-------------|------|
| 400 | 缺少必填字段、DID 格式无效、topics 为空数组、包含通配符、TTL 超出范围、超过 10 个活跃 delegation |

### 2. `GET /api/v1/messaging/subscription-delegations`

列出所有活跃授权。

**响应** `200 OK`：

```json
{
  "data": [
    {
      "delegationId": "dlg_a1b2c3d4e5f6a1b2c3d4e5f6",
      "delegateDid": "did:claw:zGateway...",
      "topics": ["telagent/envelope", "telagent/receipt"],
      "metadataOnly": true,
      "expiresAtMs": 1741568400000,
      "createdAtMs": 1741564800000,
      "revoked": false
    }
  ]
}
```

### 3. `GET /api/v1/messaging/subscription-delegations/:id`

查看单个授权详情。

**成功响应**：`200 OK`（格式同上单条记录）
**错误响应**：`404` 授权不存在

### 4. `DELETE /api/v1/messaging/subscription-delegations/:id`

撤销授权。撤销后 Target 立即停止向该 Gateway 转发消息。

**成功响应**：`204 No Content`
**错误响应**：`404` 授权不存在或已撤销

---

## 新增 WebSocket 端点

### `WS /api/v1/messaging/subscribe-delegated`

Gateway Node 使用此端点接收 Target 的代理推送。

**连接参数**：

| 参数 | 必填 | 说明 |
|------|------|------|
| `delegationId` | ✅ | delegation ID |
| `sinceSeq` | 可选 | 断线续接：从该 seq 之后开始回放 |
| `apiKey` | 可选 | 认证（或通过 `X-Api-Key` header） |

**连接示例**：

```
ws://localhost:9528/api/v1/messaging/subscribe-delegated?delegationId=dlg_abc123&sinceSeq=0&apiKey=xxx
```

**服务端推送帧格式**：

#### `connected` — 连接确认

```json
{
  "type": "connected",
  "delegationId": "dlg_abc123",
  "seq": 42
}
```

#### `delegated-message` — 新消息通知

**metadataOnly=true 时**（推荐）：

```json
{
  "type": "delegated-message",
  "data": {
    "type": "delegated-message",
    "delegationId": "dlg_abc123",
    "originalTargetDid": "did:claw:zTarget...",
    "sourceDid": "did:claw:zPeerC...",
    "topic": "telagent/envelope",
    "seq": 43,
    "receivedAtMs": 1741564800000,
    "metadata": {
      "messageId": "msg_xxx",
      "payloadSizeBytes": 2048
    }
  }
}
```

**metadataOnly=false 时**：

```json
{
  "type": "delegated-message",
  "data": {
    "type": "delegated-message",
    "delegationId": "dlg_abc123",
    "originalTargetDid": "did:claw:zTarget...",
    "sourceDid": "did:claw:zPeerC...",
    "topic": "telagent/envelope",
    "seq": 43,
    "receivedAtMs": 1741564800000,
    "payload": "base64-encoded-content..."
  }
}
```

#### `replay_done` — 回放完成

```json
{
  "type": "replay_done",
  "lastSeq": 45
}
```

**断线续接**：连接时传 `sinceSeq=42`，服务端自动回放 seq > 42 的所有 delegated 消息，然后发 `replay_done`，之后切换到实时推送模式。Delegated inbox 记录保留 24 小时。

---

## SDK 新增方法

`@claw-network/sdk` 的 `MessagingApi` 类新增以下方法：

```typescript
import { ClawNetClient } from '@claw-network/sdk';

const client = new ClawNetClient({ baseUrl: 'http://localhost:9528', apiKey: '...' });

// 1. 创建订阅授权（Target Node 调用）
const delegation = await client.messaging.createSubscriptionDelegation({
  delegateDid: 'did:claw:zGateway...',
  topics: ['telagent/envelope', 'telagent/receipt', 'telagent/group-sync'],
  expiresInSec: 3600,
  metadataOnly: true,
});
// delegation = { delegationId: "dlg_...", delegateDid, topics, metadataOnly, expiresAtMs, createdAtMs, revoked }

// 2. 撤销授权（Target Node 调用）
await client.messaging.revokeSubscriptionDelegation('dlg_...');

// 3. 列出活跃授权（Target Node 调用）
const list = await client.messaging.listSubscriptionDelegations();
// list = [{ delegationId, delegateDid, topics, metadataOnly, expiresAtMs, createdAtMs, revoked }]
```

### TypeScript 类型导出

```typescript
import type {
  CreateDelegationParams,
  DelegationRecord,
} from '@claw-network/sdk';
```

> **注意**：SDK 提供的是 REST 客户端方法。WebSocket 代理订阅需要 Gateway 直接连接 `WS /api/v1/messaging/subscribe-delegated` 端点，SDK 当前不封装 WS 连接。TelagentNode Gateway 侧可直接使用 `ws` 库连接。

---

## 需求覆盖对照

| 需求（§5） | 优先级 | 实现状态 | 说明 |
|------------|--------|---------|------|
| 创建订阅授权 | 必须 | ✅ | `POST /subscription-delegations` |
| 撤销授权 | 必须 | ✅ | `DELETE /subscription-delegations/:id` |
| 授权有效期 TTL | 必须 | ✅ | 60s–86400s，到期自动清除（5 分钟清理周期） |
| 代理 WebSocket 订阅 | 必须 | ✅ | `WS /subscribe-delegated` |
| sinceSeq 重连恢复 | 必须 | ✅ | 连接时传 `sinceSeq` 自动回放 |
| metadataOnly 模式 | 强烈推荐 | ✅ | 默认 `true`，Gateway 不可见 payload |
| 多 Gateway 支持 | 推荐 | ✅ | 一个 Target 可授权多个 Gateway（上限 10） |
| 授权列表查询 | 推荐 | ✅ | `GET /subscription-delegations` |
| 授权配额限制 | 推荐 | ✅ | 每个节点最多 10 个活跃 delegation |

---

## TelagentNode 对接指南

### 完整对接流程

```
1. Webapp 通过 Gateway 向 Target 发起"建立事件订阅"请求
   （TelagentNode 应用层逻辑，经 API Proxy 中继）

2. Target Node 收到请求后，调用 ClawNet REST API 创建授权：
   POST /api/v1/messaging/subscription-delegations
   { delegateDid: gatewayDid, topics: [...], expiresInSec: 3600, metadataOnly: true }
   → 返回 delegationId

3. Target 将 delegationId 通过 API 响应返回给 Gateway

4. Gateway 使用 delegationId 连接 ClawNet WS 端点：
   ws://localhost:9528/api/v1/messaging/subscribe-delegated?delegationId=xxx

5. 当 Peer C 发消息给 Target 时：
   - ClawNet 照常存入 Target inbox + 通知 Target WS 订阅者
   - ClawNet **自动**通过 P2P 转发给已授权的 Gateway
   - Gateway 的 WS 连接收到 delegated-message 帧
   - Gateway 推送给 Webapp（SSE/WS）
   - Webapp 通过 API Proxy 拉取实际消息内容

6. Webapp 离开页面 → Gateway 关闭 WS → Target 通过 API 撤销授权
   或等待 TTL 自动过期
```

### Gateway 侧 WS 连接示例（Node.js）

```typescript
import WebSocket from 'ws';

const ws = new WebSocket(
  `ws://localhost:9528/api/v1/messaging/subscribe-delegated` +
  `?delegationId=${delegationId}&sinceSeq=${lastSeq}&apiKey=${apiKey}`
);

ws.on('message', (raw) => {
  const frame = JSON.parse(raw.toString());

  switch (frame.type) {
    case 'connected':
      console.log('connected, current seq:', frame.seq);
      break;

    case 'delegated-message':
      // frame.data.originalTargetDid — 消息原始目标 DID
      // frame.data.sourceDid — 消息发送方 DID
      // frame.data.topic — 原始 topic
      // frame.data.seq — 用于断线续接
      // frame.data.metadata — { messageId, payloadSizeBytes }（metadataOnly 时）
      pushToWebapp(frame.data);
      lastSeq = frame.data.seq; // 记录用于重连
      break;

    case 'replay_done':
      console.log('replay complete, lastSeq:', frame.lastSeq);
      break;
  }
});

// 断线重连
ws.on('close', () => {
  setTimeout(() => reconnect(lastSeq), 1000);
});
```

### 注意事项

1. **P2P 连接前提**：Gateway 与 Target 必须已建立 P2P 连接（通过 DID Announce 互相发现 PeerId），否则 Target 无法将 delegated message 发送给 Gateway。正常使用 API Proxy 时此条件已满足。

2. **delegated_inbox 保留时间**：Gateway 侧的 delegated inbox 记录保留 **24 小时**，超过后自动清理。`sinceSeq` 重连回放仅在此窗口内有效。

3. **TTL 续期**：当前不支持续期，到期后需重新创建 delegation。建议设置较长 TTL（如 3600s），并在应用层定期续期。

4. **seq 语义**：`seq` 是 Gateway 本地单调递增序列号，不同 Gateway 的 seq 空间独立，也与 Target 的 inbox seq 无关。

---

## 变更文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `packages/protocol/src/messaging/types.ts` | 新增类型 | `DelegationRecord`, `DelegatedMessage`, `CreateDelegationParams` |
| `packages/node/src/services/message-store.ts` | 新增表 + CRUD | `delegations` + `delegated_inbox` 表，12 个 CRUD 方法 |
| `packages/node/src/services/messaging-service.ts` | 核心逻辑 | `DelegationForwarder`、P2P 协议处理、自动转发、subscriber 机制 |
| `packages/node/src/api/routes/messaging.ts` | 新增路由 | 4 个 REST 端点 |
| `packages/node/src/api/ws-messaging.ts` | 新增 WS 端点 | `/subscribe-delegated` 含回放 + 心跳 |
| `packages/sdk/src/messaging.ts` | 新增 SDK 方法 | 3 个类型安全的 REST 客户端方法 |
| `packages/node/test/delegation.test.ts` | 新增测试 | 20 个测试用例覆盖存储、API、去重、回放 |

---

## 后续迭代方向（非本次范围）

| 方向 | 说明 |
|------|------|
| 签名 delegation token | 当前信任 P2P 层身份验证，后续可加签名令牌做更强校验 |
| delegation TTL 续期 | 支持 PATCH 延长有效期，避免重复创建 |
| SDK WebSocket 封装 | 在 SDK 层封装 WS 订阅，提供 `subscribeDelegated()` 方法 |
| Python SDK 支持 | `packages/sdk-python` 新增 delegation 方法 |
| CLI 支持 | `clawnet messaging delegation create/revoke/list` 子命令 |
