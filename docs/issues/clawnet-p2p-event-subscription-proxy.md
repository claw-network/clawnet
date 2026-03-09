# ClawNet 团队协作请求：P2P 事件订阅代理（Event Subscription Proxy）

| 字段 | 值 |
| --- | --- |
| 优先级 | **P2 — 用户体验优化（非阻塞性）** |
| 提出方 | TelagentNode 团队 |
| 提出日期 | 2026-03-09 |
| 影响范围 | DID 远程访问时的实时消息推送 |
| 当前临时方案 | Webapp 轮询 HTTP API（活跃 3s / 空闲 15s） |
| 前置依赖 | DID 远程接入（API Proxy）已实现 |

---

## 1. 问题背景

### 1.1 当前架构

TelagentNode 已实现基于 DID 的远程节点接入（API Proxy），Webapp 可通过网关节点访问 NAT 内网的目标节点 REST API：

```
Webapp ──HTTP──► Gateway Node ──P2P──► Target Node (NAT 内)
                                           │
                                     ClawNet WS 订阅
                                     topic: telagent/*
```

目标节点通过 **WebSocket 订阅 ClawNet** 获取实时 P2P 消息（信封、回执、群组同步等），响应延迟 <100ms。

但 **Webapp 与节点之间** 没有实时通道，全部通过 HTTP 轮询获取更新：

| 轮询内容 | 间隔 | 端点 |
|---------|------|------|
| 当前会话新消息 | 3 秒 | `GET /api/v1/messages/pull?conversation_id=X` |
| 全局新消息 + 会话列表 | 15 秒 | `GET /api/v1/messages/pull` + `GET /api/v1/conversations` |
| 撤回消息 | 15 秒 | `GET /api/v1/messages/retracted` |

### 1.2 本地连接 vs DID 远程连接

**本地连接**（Webapp 直连本机节点）：

- 轮询延迟可接受（3s 内可见新消息，localhost 无网络延迟）
- 后续可在节点本地加 SSE/WebSocket 端点直接推送（纯 TelagentNode 改造，不需要 ClawNet）

**DID 远程连接**（Webapp 通过网关中继访问远端节点）：

- 每次轮询经过完整 P2P round-trip（Webapp → Gateway → P2P → Target → P2P → Gateway → Webapp）
- 单次 round-trip 延迟 200-800ms，3s 轮询间隔意味着大量浪费的空查询
- 15s 全局轮询延迟导致新消息通知严重滞后

### 1.3 理想架构

```
              ┌─ SSE/WS ──── Webapp
              │
Gateway Node ◄═══ P2P 事件订阅 ═══► Target Node
              │                        │
              │                   ClawNet WS 订阅
              │                   topic: telagent/*
              │
              └── 收到 Target 的
                  新消息事件后
                  立即推送给 Webapp
```

当目标节点收到新的 P2P 消息（信封、回执等）时，网关节点能立即得到通知，并推送给已连接的 Webapp 客户端。

---

## 2. 现有方案评估

### 2.1 方案 A：纯应用层 — 事件转发（不需要 ClawNet 改动）

TelagentNode 可在应用层完全自建事件转发，不依赖 ClawNet 新能力：

```
1. Webapp 通过 Gateway 向 Target 发送"订阅注册"请求
   POST /relay/{targetDid}/api/v1/events/subscribe
   Body: { gatewayDid, sessionId, topics: ["envelope", "receipt"] }

2. Target Node 维护一张 subscribers 表：
   Map<gatewayDid, { sessionIds, subscribedTopics, lastPingMs }>

3. 当 Target 处理完新消息后，向所有注册的 Gateway 推送轻量事件：
   P2P Topic: telagent/event-push
   Payload: { sessionId, event: "new-envelope", conversationId, envelopeId, atMs }

4. Gateway 收到 event-push → 查找对应的 SSE/WS 连接 → 转发给 Webapp

5. Webapp 收到通知 → 立即 fetch 具体数据（增量拉取，非全量轮询）
```

**此方案的问题：**

| 问题 | 影响 |
|------|------|
| Target 必须追踪所有 Gateway 订阅状态 | 增加复杂度、状态管理负担 |
| 订阅注册/注销/超时清理都需要自建 | 大量 edge case（Target 重启、Gateway 断连） |
| Target 每条消息都要额外向 N 个 Gateway 发送通知 | 放大 P2P 消息量，O(N) |
| 无法利用 ClawNet 原生的消息投递保障 | 通知可能丢失，需自建重试 |
| Target 是唯一知道"有新消息到达"的节点 | 瓶颈在 Target 的事件分发 |

**结论：可行但笨重。** 本质上是在 ClawNet P2P 之上重新构建了一套发布-订阅系统。

### 2.2 方案 B：ClawNet 层 — 事件订阅代理（需要 ClawNet 支持）⭐️ 推荐

ClawNet 在协议层支持"授权代理订阅"：一个 DID（Gateway）可由另一个 DID（Target）授权，接收发送给 Target 的特定 topic 消息副本。

**核心优势：Target 节点无需做任何额外工作。** ClawNet 在消息投递时自动向已授权的代理也投递一份副本。

---

## 3. 期望 ClawNet 提供的能力

### 3.1 授权 API — 目标节点发出授权

```typescript
// Target Node 授权 Gateway 代理订阅自己的指定 topic
const delegation = await client.messaging.createSubscriptionDelegation({
  delegateDid: 'did:claw:zGateway...',   // 被授权方 DID
  topics: ['telagent/envelope', 'telagent/receipt', 'telagent/group-sync'],
  expiresInSec: 3600,                     // 授权有效期（秒）
  // 可选：只转发 metadata，不转发完整 payload
  metadataOnly: true,                     
});
// 返回: { delegationId: string, expiresAtMs: number }

// Target Node 撤销授权
await client.messaging.revokeSubscriptionDelegation({
  delegationId: 'dlg_xxx',
});

// Target Node 查看当前授权列表
const delegations = await client.messaging.listSubscriptionDelegations();
// 返回: [{ delegationId, delegateDid, topics, expiresAtMs, createdAtMs }]
```

### 3.2 代理订阅 API — 网关节点使用授权

```typescript
// Gateway Node 使用授权订阅 Target 的消息
const unsub = await client.messaging.subscribeDelegated({
  delegationId: 'dlg_xxx',
  onMessage: (msg: DelegatedMessage) => {
    // msg.originalTargetDid — 消息原始目标 DID
    // msg.sourceDid — 消息来源 DID
    // msg.topic — 原始 topic
    // msg.payload — 完整 payload（如果 metadataOnly=false）
    //   或 msg.metadata — 仅元数据（如果 metadataOnly=true）
    // msg.seq — 序列号（支持 sinceSeq 重连）
  }
});
```

### 3.3 REST API 方式（如果 SDK 暂不支持）

```
# 创建授权（Target Node 调用）
POST /api/v1/messaging/subscription-delegations
{
  "delegateDid": "did:claw:zGateway...",
  "topics": ["telagent/envelope", "telagent/receipt"],
  "expiresInSec": 3600,
  "metadataOnly": true
}
→ { "delegationId": "dlg_abc123", "expiresAtMs": 1741564800000 }

# 撤销授权（Target Node 调用）
DELETE /api/v1/messaging/subscription-delegations/{delegationId}

# 代理订阅（Gateway Node 调用）
WS /api/v1/messaging/subscribe-delegated?delegationId=dlg_abc123&sinceSeq=0
→ 帧格式同现有 messaging/subscribe，增加 originalTargetDid 字段
```

### 3.4 metadataOnly 模式（推荐默认开启）

为了减少数据传输和保护隐私，推荐支持"仅转发元数据"模式：

```typescript
// metadataOnly: true 时，Gateway 收到的消息：
{
  "type": "delegated-message",
  "originalTargetDid": "did:claw:zTarget...",
  "sourceDid": "did:claw:zPeerC...",
  "topic": "telagent/envelope",
  "metadata": {
    "messageId": "msg_xxx",
    "seq": 456,
    "payloadSizeBytes": 2048,
    "receivedAtMs": 1741564800000
  }
  // 注意：不包含 payload 内容
}
```

**Gateway 不需要消息全文**，只需要知道"Target 收到了新消息"这一事件即可。Gateway 收到通知后推送给 Webapp，Webapp 再通过 API Proxy 拉取实际消息内容。

这样设计的好处：
- **隐私安全**：Gateway 看不到消息 payload，只知道"有新消息到达"
- **带宽节省**：元数据 ~100 bytes vs 完整信封 ~2-5 KB
- **授权粒度**：Target 可以随时撤销，不影响消息本身的安全性

---

## 4. TelagentNode 侧的使用场景

### 4.1 完整事件流（有 ClawNet 支持时）

```
          Webapp                Gateway Node              ClawNet             Target Node
            │                       │                        │                     │
            ├── SSE Connect ───────►│                        │                     │
            │   /relay/{did}/events │                        │                     │
            │                       │                        │                     │
            │                       ├── API Proxy ──────────────────────────────►│
            │                       │   POST /events/subscribe                    │
            │                       │   { gatewayDid }                            │
            │                       │                        │                     │
            │                       │                        │◄── createDelegation ┤
            │                       │                        │    { delegateDid,   │
            │                       │                        │      topics,        │
            │                       │                        │      metadataOnly } │
            │                       │                        │                     │
            │                       │◄── delegationId ──────────────────────────── │
            │                       │                        │                     │
            │                       ├── subscribeDelegated ──►                     │
            │                       │   (WS to ClawNet)      │                     │
            │                       │                        │                     │
            │                       │     ╔══════════════════╗                     │
            │                       │     ║  Peer C sends    ║                     │
            │                       │     ║  message to      ║──────────────────►│
            │                       │     ║  Target          ║                     │
            │                       │     ╚══════════════════╝                     │
            │                       │                        │                     │
            │                       │◄── delegated-message ──┤                     │
            │                       │   { topic, metadata }  │                     │
            │                       │                        │                     │
            │◄── SSE event ─────────┤                        │                     │
            │   { type: "new-envelope",                      │                     │
            │     conversationId }  │                        │                     │
            │                       │                        │                     │
            ├── fetch (API Proxy) ──►──────────────────────────────────────────►│
            │   GET /messages/pull  │                        │                     │
            │◄── actual messages ───┤◄─────────────────────────────────────────── │
```

### 4.2 降级方案（无 ClawNet 支持时）

如果 ClawNet 暂不实现，TelagentNode 将自行实现方案 A（应用层事件转发），使用新的 P2P topic：

- `telagent/event-subscribe` — Gateway → Target：注册订阅
- `telagent/event-unsubscribe` — Gateway → Target：取消订阅
- `telagent/event-push` — Target → Gateway：事件推送
- `telagent/event-heartbeat` — 双向心跳保活

我们优先希望减少自建复杂度，所以如果 ClawNet 能在协议层支持，效果会好很多。

---

## 5. 对 ClawNet P2P 层的具体要求

| 能力 | 说明 | 优先级 |
|-----|------|--------|
| 创建订阅授权 | Target DID 授权 Gateway DID 代理订阅指定 topics | **必须** |
| 撤销授权 | Target DID 可随时撤销 | **必须** |
| 授权有效期 | 支持 TTL 自动过期 | **必须** |
| 代理 WebSocket 订阅 | Gateway 通过 WS 接收 Target 的消息副本 | **必须** |
| sinceSeq 重连恢复 | 代理订阅断线后可从断点续接 | **必须** |
| metadataOnly 模式 | 只转发消息元数据不含 payload | **强烈推荐** |
| 多 Gateway 支持 | 一个 Target 可授权多个 Gateway | 推荐 |
| 授权列表查询 | Target 查看/管理所有授权 | 推荐 |
| 授权配额限制 | 防滥用：每个 DID 最多 N 个活跃授权 | 推荐 |

---

## 6. 安全考量

### 6.1 授权模型

- **单向授权**：只有 Target 能创建授权，Gateway 无法自行订阅
- **Scope 限制**：授权只能指定具体 topic，不能用 `*` 通配
- **TTL 强制**：授权必须有有效期，到期自动清除
- **撤销即失效**：Target 撤销后 ClawNet 立即停止向 Gateway 投递

### 6.2 隐私保护

- `metadataOnly=true` 时 Gateway 无法获取消息内容
- Gateway 只知道"Target 收到了来自某 DID 的某 topic 消息"
- Webapp 获取实际内容仍需通过 API Proxy 调用目标节点（经目标节点鉴权）

### 6.3 防滥用

- 每个 DID 的活跃授权数量应有上限（建议 10）
- 代理订阅产生的消息投递应计入 Target 的配额
- 恶意 Gateway 无法扩大授权范围

---

## 7. 不需要 ClawNet 改动的部分

以下工作由 TelagentNode 团队自行完成，无需 ClawNet 支持：

| 工作项 | 说明 |
|--------|------|
| 节点本地 SSE 端点 | `GET /api/v1/events`（SSE），推送新消息/回执/撤回事件给本地 Webapp |
| Gateway SSE 转发 | `GET /relay/{targetDid}/api/v1/events`，Gateway → Webapp 的 SSE 桥接 |
| Webapp SSE 客户端 | 替换 `usePollMessages` 轮询为 EventSource 自动重连 |
| 事件类型定义 | `new-envelope`, `receipt`, `retraction`, `conversation-update` 等 |

---

## 8. 时间线建议

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **v0.2.x（近期）** | TelagentNode 实现本地 SSE 端点（无 ClawNet 依赖） | 无 |
| **v0.3.0** | 如有 ClawNet 支持 → 实现代理订阅方案（方案 B） | ClawNet 订阅代理 API |
| **v0.3.0 降级** | 如无 ClawNet 支持 → 自建应用层事件转发（方案 A） | 无 |

---

