# RFC: TelAgent 消息通信迁移至 ClawNet P2P 层

- 文档版本：v0.3（ClawNet 实现完成后更新）
- 状态：**ClawNet messaging API 已实现**，TelAgent 可开始适配
- 作者：TelAgent 团队
- 审阅 & 实现：ClawNet 项目组
- 日期：2026-03-05

---

## 1. 背景与动机

### 1.1 当前架构

TelAgent 节点间的消息通信使用 **HTTP Federation** 协议：

```
TelAgent A                         TelAgent B
    │                                  │
    ├── HTTP POST ────────────────────►│
    │   /api/v1/federation/envelopes   │
    │                                  │
    │◄── HTTP POST ────────────────────┤
    │   /api/v1/federation/envelopes   │
```

每个 TelAgent 节点通过 `FederationDeliveryService` 向目标节点的域名发送 HTTP 请求：

```typescript
const url = `https://${targetDomain}/api/v1/federation/envelopes`;
await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-telagent-source-domain': selfDomain,
    'x-telagent-protocol-version': 'v1',
    'x-telagent-federation-token': authToken,
  },
  body: JSON.stringify(envelope),
});
```

### 1.2 问题

| 问题 | 影响 |
|------|------|
| **要求公网可达** | 每个节点必须有公网域名/IP，NAT 后面的节点无法接收消息 |
| **无法穿透 NAT** | 本地开发、移动设备、家庭网络环境下无法参与联邦通信 |
| **TLS 证书依赖** | 每个节点必须配置域名和 TLS 证书 |
| **域名解析** | `targetDomain` 依赖 DNS，增加了部署复杂度 |
| **单点故障** | 目标节点离线时消息只能进入 DLQ 等待重试，无中继机制 |

### 1.3 期望架构

利用 ClawNet 已有的 P2P 网络层实现消息中继，所有 TelAgent 节点通过本地 clawnetd 加入 P2P 网络：

```
TelAgent A                              TelAgent B
    │                                       │
    ▼                                       ▼
clawnetd A ◄──── ClawNet P2P 网络 ────► clawnetd B
    │                │                      │
    │           bootstrap:                  │
    │        clawnetd.com                   │
    │                                       │
NAT 后面 ✓          ✓ 无需公网 IP          NAT 后面 ✓
```

**核心优势**：

- NAT 穿透：ClawNet P2P 层已具备部分 NAT 穿透能力（autoNAT + dcutr hole-punching），但**尚未配置 circuit relay 中继节点**，对称 NAT (Symmetric NAT) 场景下双方均在 NAT 后面时无法直连。需要 ClawNet 在 bootstrap 节点上启用 `@libp2p/circuit-relay-v2` 服务端，才能覆盖所有 NAT 场景。
- 去中心化路由：无需 DNS、无需 TLS 证书、无需公网 IP（在 relay 启用后）
- DID 原生寻址：用 DID 直接寻址，无需域名映射（**注意：ClawNet 当前没有 DID → PeerId 的映射机制，需要新建——见下方 §3.5**）
- 离线中继：**当前不支持**。ClawNet P2P 层是实时 GossipSub + Stream，不具备 store-and-forward 能力。离线暂存需要新建 mailbox 服务（见 §3.1.3 的修订）

---

## 2. TelAgent 消息格式

以下是 ClawNet 需要传输的 TelAgent 数据结构，供 ClawNet 项目组参考。

### 2.1 Envelope（消息信封）

这是 TelAgent 节点间传输的核心数据单元。信封内容已加密，ClawNet 只需当做不透明载荷传输。

```typescript
interface Envelope {
  envelopeId: string;         // 全局唯一的信封 ID（UUID）
  conversationId: string;     // 会话 ID
  conversationType: 'direct' | 'group';  // 直聊或群聊
  routeHint: {
    targetDomain: string;     // 当前用于 HTTP 路由，迁移后可改为 targetDid
    mailboxKeyId: string;     // 收件箱密钥 ID
  };
  sealedHeader: string;       // 加密的消息头（hex）
  seq: bigint;                // 消息序列号
  epoch?: number;             // MLS epoch
  ciphertext: string;         // 加密的消息体（hex）
  contentType: string;        // 消息类型（text/image/file/control/telagent/*）
  attachmentManifestHash?: string;  // 附件清单哈希
  sentAtMs: number;           // 发送时间戳（毫秒）
  ttlSec: number;             // 存活时间（秒）
  provisional?: boolean;      // 是否为临时消息
}
```

**序列化后大小**：典型文本消息 1-5 KB，含附件引用约 5-20 KB。

### 2.2 传输需求

| 需求 | 说明 |
|------|------|
| **寻址** | 通过目标节点的 DID 寻址（`did:claw:z...`） |
| **载荷格式** | JSON 序列化的 Envelope，ClawNet 当做不透明 bytes 传输 |
| **最大载荷** | 建议支持至少 64 KB（覆盖含附件清单的消息） |
| **可靠性** | 至少一次送达（at-least-once），TelAgent 层通过 `envelopeId` 去重 |
| **顺序性** | 不要求严格有序，TelAgent 通过 `seq` 字段在应用层排序 |
| **加密** | 载荷已由 TelAgent 端到端加密，传输层不需要额外加密（但 ClawNet P2P 层本身的传输加密当然欢迎） |
| **TTL** | 信封有 `ttlSec` 字段，过期后可丢弃 |

---

## 3. ClawNet 需要提供的能力

### 3.1 应用层消息 API

TelAgent 需要 ClawNet 提供以下 API（通过 `@claw-network/sdk` 或 REST）：

#### 3.1.1 发送消息

```typescript
// 期望的 SDK 接口
interface ClawNetClient {
  messaging: {
    /**
     * 向目标 DID 发送应用层消息
     *
     * @param targetDid  - 目标节点的 DID
     * @param topic      - 消息主题/通道名（用于区分不同应用，如 "telagent/envelope"）
     * @param payload    - 不透明载荷（JSON string 或 Buffer）
     * @param options    - 可选配置
     * @returns 发送结果
     */
    send(params: {
      targetDid: string;
      topic: string;
      payload: string | Buffer;
      ttlSec?: number;
    }): Promise<{ messageId: string; delivered: boolean }>;
  };
}
```

对应的 REST API：

```
POST /api/v1/messaging/send
Content-Type: application/json

{
  "targetDid": "did:claw:z6Mk...",
  "topic": "telagent/envelope",
  "payload": "<base64 编码的 Envelope JSON>",
  "ttlSec": 86400
}

Response 200:
{
  "data": {
    "messageId": "msg_abc123",
    "delivered": true
  }
}
```

#### 3.1.2 接收消息（订阅）

TelAgent 需要订阅特定 topic 的入站消息。有两种可选方案：

**方案 A：WebSocket 订阅（推荐）**

```typescript
interface ClawNetClient {
  messaging: {
    /**
     * 订阅指定 topic 的入站消息
     * 返回一个异步迭代器或事件发射器
     */
    subscribe(params: {
      topic: string;
      onMessage: (msg: InboundMessage) => void | Promise<void>;
    }): { unsubscribe: () => void };
  };
}

interface InboundMessage {
  messageId: string;
  sourceDid: string;      // 发送方 DID
  topic: string;
  payload: string;        // base64 或 UTF-8
  receivedAtMs: number;
}
```

对应的 WebSocket 端点：

```
WS /api/v1/messaging/subscribe?topic=telagent/envelope

← 入站消息帧:
{
  "messageId": "msg_abc123",
  "sourceDid": "did:claw:z6Mk...",
  "topic": "telagent/envelope",
  "payload": "<base64>",
  "receivedAtMs": 1709654400000
}

→ ACK 帧（可选）:
{
  "ack": "msg_abc123"
}
```

**方案 B：轮询 API**

如果 WebSocket 实现复杂度过高，可以先提供轮询接口：

```
GET /api/v1/messaging/inbox?topic=telagent/envelope&since=1709654400000&limit=100

Response 200:
{
  "data": {
    "messages": [
      {
        "messageId": "msg_abc123",
        "sourceDid": "did:claw:z6Mk...",
        "topic": "telagent/envelope",
        "payload": "<base64>",
        "receivedAtMs": 1709654400000
      }
    ],
    "cursor": "msg_abc124"
  }
}
```

```
DELETE /api/v1/messaging/inbox/{messageId}

Response 204
```

#### 3.1.3 离线消息暂存

当目标节点离线时，ClawNet P2P 网络应为其暂存消息，节点上线后自动投递。

| 参数 | 建议值 | 说明 |
|------|--------|------|
| 每个 DID 暂存上限 | 1000 条或 10 MB | 防止存储溢出 |
| 暂存过期时间 | 遵循 `ttlSec` 字段 | 过期后自动清理 |
| 投递策略 | 节点上线后批量推送 | 按 `receivedAtMs` 排序 |

### 3.2 Topic 命名空间

为支持多应用复用 ClawNet 消息层，建议使用 topic 机制进行隔离：

| Topic | 用途 | 发送方 |
|-------|------|--------|
| `telagent/envelope` | TelAgent 消息信封 | TelAgent Node |
| `telagent/receipt` | 消息送达/已读回执 | TelAgent Node |
| `telagent/group-sync` | 群组状态同步 | TelAgent Node |

ClawNet 自身的业务消息可使用 `clawnet/*` 命名空间。

### 3.3 安全要求

| 要求 | 说明 |
|------|------|
| **发送方验证** | ClawNet 应验证发送方确实拥有其声称的 DID（使用 DID 对应的密钥签名） |
| **不需要解密载荷** | TelAgent 信封已端到端加密，ClawNet 只做传输，无需也不应解密 |
| **速率限制** | 建议对每个 DID 的发送频率限流（如 600 条/分钟），防止滥用 |
| **载荷大小限制** | 单条消息不超过 64 KB |

### 3.4 可选增强能力

以下能力不是第一期必须，但如果后续支持会很有价值：

| 能力 | 说明 |
|------|------|
| **多播（Multicast）** | 群聊场景下向多个 DID 同时发送消息，避免逐一发送 |
| **投递回执** | ClawNet 层面的投递确认（区别于 TelAgent 层面的已读回执） |
| **优先级队列** | 支持不同优先级的消息（如 control 消息优先于普通文本） |
| **流量控制** | 当接收方处理不过来时的背压机制 |

---

## 4. TelAgent 侧的适配计划

以下是 TelAgent 收到 ClawNet 支持后需要做的改动，供 ClawNet 项目组了解上下文。

### 4.1 新增 P2P 传输适配器

```typescript
// packages/node/src/services/clawnet-transport-service.ts
// 新建，替代 FederationDeliveryService 中的 HTTP 投递逻辑

class ClawNetTransportService {
  constructor(
    private gateway: ClawNetGatewayService,
    private selfDid: string,
  ) {}

  /** 通过 ClawNet P2P 发送信封 */
  async sendEnvelope(targetDid: string, envelope: Envelope): Promise<void> {
    await this.gateway.client.messaging.send({
      targetDid,
      topic: 'telagent/envelope',
      payload: JSON.stringify(envelope),
      ttlSec: envelope.ttlSec,
    });
  }

  /** 订阅入站信封 */
  startListening(onEnvelope: (sourceDid: string, envelope: Envelope) => Promise<void>): void {
    this.gateway.client.messaging.subscribe({
      topic: 'telagent/envelope',
      onMessage: async (msg) => {
        const envelope = JSON.parse(msg.payload) as Envelope;
        await onEnvelope(msg.sourceDid, envelope);
      },
    });
  }
}
```

### 4.2 路由变更：域名 → DID

当前 Envelope 的 `routeHint.targetDomain` 是一个域名（如 `alex.telagent.org`）。迁移后改为 DID 寻址：

```typescript
// 现在
routeHint: {
  targetDomain: 'alex.telagent.org',  // 域名
  mailboxKeyId: '...',
}

// 迁移后
routeHint: {
  targetDid: 'did:claw:z6Mk...',      // DID
  mailboxKeyId: '...',
}
```

> 这是 TelAgent protocol 层的变更，不影响 ClawNet。

### 4.3 废弃的组件

迁移完成后以下组件将被废弃：

| 组件 | 文件 | 说明 |
|------|------|------|
| `FederationDeliveryService` | `federation-delivery-service.ts` | HTTP 投递逻辑被 `ClawNetTransportService` 替代 |
| Federation HTTP 路由 | `routes/federation.ts` | 入站 HTTP 端点不再需要 |
| Domain Proof | `domain-proof-*` | 不再需要域名验证 |
| Federation Pinning | config 中 pinning 相关字段 | 不再需要 HTTP 层的密钥钉扎 |

### 4.4 保留的组件

| 组件 | 原因 |
|------|------|
| Envelope 加密/解密 | 端到端加密在 TelAgent 层，不变 |
| 消息序列号 (`seq`) | 应用层排序，不变 |
| 群组注册合约 | TelAgent 自有合约，继续直连 |
| DLQ（改造） | 改为重试 ClawNet P2P 发送失败的消息 |
| Rate Limiting（改造） | 改为限制 P2P 发送频率 |

---

## 5. 迁移路径

建议分两阶段推进：

### 第一阶段：双通道并行

- ClawNet 实现 messaging API
- TelAgent 新增 `ClawNetTransportService`
- 发送时优先走 P2P，P2P 失败时回退到 HTTP Federation
- 入站同时监听 P2P 和 HTTP
- 验证端到端可靠性

### 第二阶段：完全切换

- 确认 P2P 通道稳定后移除 HTTP Federation
- 删除域名相关配置和 Domain Proof
- `routeHint` 字段从 `targetDomain` 迁移到 `targetDid`
- 更新文档和部署指南

---

## 6. 验收标准

| # | 场景 | 预期结果 |
|---|------|---------|
| 1 | 两个公网节点通过 P2P 收发消息 | 消息在 2 秒内送达 |
| 2 | NAT 后的节点向公网节点发消息 | 消息正常送达 |
| 3 | 公网节点向 NAT 后的节点发消息 | 消息通过 P2P 穿透送达 |
| 4 | 接收方离线，上线后收到暂存消息 | 暂存消息按序送达 |
| 5 | 每分钟 600 条消息的吞吐量 | 稳定投递无丢失 |
| 6 | 30 秒内未送达触发重试 | 自动重试直到成功或超过 TTL |

---

## 7. 联系方式与时间线

- **TelAgent 联系人**：（请填写）
- **ClawNet 联系人**：（请填写）
- **期望 ClawNet messaging API 可用时间**：（请协商）
- **TelAgent 侧适配预计工期**：ClawNet API 可用后 1-2 周

---

## 附录 A：现有 ClawNet SDK 已提供的能力

以下是 TelAgent 已在使用的 `@claw-network/sdk` 能力，供参考：

| 模块 | 能力 | 使用场景 |
|------|------|---------|
| `identity` | DID 解析、自身 DID 获取 | 节点启动时获取身份 |
| `wallet` | 余额查询、转账、Escrow | 聊天内交易功能 |
| `markets` | 任务发布、竞标 | 聊天内任务市场 |
| `reputation` | 信誉查询、评价 | 身份展示和互评 |

本 RFC 请求新增的 `messaging` 模块是上述能力之外的新增需求。

## 附录 B：TelAgent Envelope 字段完整说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `envelopeId` | string | ✅ | 全局唯一信封 ID（UUID v4） |
| `conversationId` | string | ✅ | 会话标识 |
| `conversationType` | `'direct' \| 'group'` | ✅ | 会话类型 |
| `routeHint` | object | ✅ | 路由提示（目前含 targetDomain，将迁移为 targetDid） |
| `sealedHeader` | string (hex) | ✅ | 加密的消息头 |
| `seq` | bigint | ✅ | 消息序列号，用于应用层排序 |
| `epoch` | number | ❌ | MLS 密钥更新周期 |
| `ciphertext` | string (hex) | ✅ | 加密的消息体 |
| `contentType` | string | ✅ | 消息类型标识 |
| `attachmentManifestHash` | string | ❌ | 附件清单的哈希 |
| `sentAtMs` | number | ✅ | 发送时间戳（Unix 毫秒） |
| `ttlSec` | number | ✅ | 消息存活时间（秒） |
| `provisional` | boolean | ❌ | 是否为临时/未确认消息 |

---

## 附录 C：ClawNet 实现说明（v0.3 新增）

> **本节由 ClawNet 项目组编写。Messaging API 已实现并合入主分支，TelAgent 可立即开始适配。**

### C.1 已实现的能力

| 能力 | 状态 | 说明 |
|------|------|------|
| **发送消息** (`POST /api/v1/messaging/send`) | ✅ 已实现 | 通过 P2P libp2p stream 直接投递到目标 DID |
| **接收消息** (`GET /api/v1/messaging/inbox`) | ✅ 已实现 | 轮询接口，支持 topic/since/limit 过滤 |
| **确认消息** (`DELETE /api/v1/messaging/inbox/:messageId`) | ✅ 已实现 | 确认后消息从 inbox 中移除 |
| **DID→PeerId 解析** | ✅ 已实现 | 自定义 `/clawnet/1.0.0/did-announce` 协议，peer 连接时自动交换 DID |
| **离线暂存 + 自动重投** | ✅ 已实现 | 目标离线时消息进入 outbox，peer 重连后自动投递 |
| **TTL 自动清理** | ✅ 已实现 | 每 5 分钟清理过期消息（inbox + outbox） |
| **Topic 命名空间** | ✅ 已实现 | 任意 topic 字符串，建议 `telagent/*` |
| **SDK `MessagingApi`** | ✅ 已实现 | `@claw-network/sdk` 新增 `messaging` 模块 |
| WebSocket 订阅 | ⏳ Phase 2 | 当前使用轮询，WebSocket 后续支持 |
| Circuit Relay（全 NAT 穿透） | ⏳ Phase 2 | 当前依赖至少一方有公网 IP |
| 多播（Multicast） | ⏳ Phase 2 | 当前逐一发送 |
| 速率限制 | ⏳ Phase 2 | 当前无限流，后续按 DID 限流 |

### C.2 SDK 接口（最终版）

安装：

```bash
npm install @claw-network/sdk
```

```typescript
import { ClawNetClient } from '@claw-network/sdk';

const claw = new ClawNetClient({
  baseUrl: 'http://127.0.0.1:9528',
  apiKey: '<your-api-key>',
});

// ── 发送消息 ──────────────────────────────────────────────────

const result = await claw.messaging.send({
  targetDid: 'did:claw:zBobPublicKey...',
  topic: 'telagent/envelope',
  payload: '<base64-encoded Envelope JSON>',
  ttlSec: 86400,          // 可选，默认 24 小时
});

console.log(result);
// { messageId: "msg_abc123def456", delivered: true }
// delivered=true  → 目标在线，已直接投递
// delivered=false → 目标离线，已入 outbox 等待重投

// ── 轮询 inbox ────────────────────────────────────────────────

const inbox = await claw.messaging.inbox({
  topic: 'telagent/envelope',  // 可选，按 topic 过滤
  since: 1709654400000,        // 可选，只返回该时间戳之后的消息
  limit: 100,                  // 可选，默认 100，最大 500
});

for (const msg of inbox.messages) {
  console.log(msg);
  // {
  //   messageId: "msg_...",
  //   sourceDid: "did:claw:zAliceKey...",
  //   topic: "telagent/envelope",
  //   payload: "<base64>",
  //   receivedAtMs: 1709654400123
  // }

  // 处理完消息后确认（acknowledge）
  await claw.messaging.ack(msg.messageId);
}

// ── 调试：查看 DID↔PeerId 映射 ─────────────────────────────

const peers = await claw.messaging.peers();
console.log(peers.didPeerMap);
// { "did:claw:zAlice...": "12D3KooW...", "did:claw:zBob...": "12D3KooW..." }
```

### C.3 REST API 规范

#### POST /api/v1/messaging/send

```http
POST /api/v1/messaging/send
Content-Type: application/json
X-Api-Key: <api-key>

{
  "targetDid": "did:claw:z6Mk...",
  "topic": "telagent/envelope",
  "payload": "<base64-encoded opaque data>",
  "ttlSec": 86400
}
```

**Response (201 Created)**:
```json
{
  "data": {
    "messageId": "msg_abc123def456",
    "delivered": true
  },
  "links": {
    "self": "/api/v1/messaging/inbox"
  }
}
```

#### GET /api/v1/messaging/inbox

```http
GET /api/v1/messaging/inbox?topic=telagent/envelope&since=1709654400000&limit=100
X-Api-Key: <api-key>
```

**Response (200 OK)**:
```json
{
  "data": {
    "messages": [
      {
        "messageId": "msg_abc123",
        "sourceDid": "did:claw:z6MkAlice...",
        "topic": "telagent/envelope",
        "payload": "<base64>",
        "receivedAtMs": 1709654400123
      }
    ]
  },
  "links": {
    "self": "/api/v1/messaging/inbox"
  }
}
```

#### DELETE /api/v1/messaging/inbox/:messageId

```http
DELETE /api/v1/messaging/inbox/msg_abc123
X-Api-Key: <api-key>
```

**Response**: 204 No Content

#### GET /api/v1/messaging/peers

```http
GET /api/v1/messaging/peers
X-Api-Key: <api-key>
```

**Response (200 OK)**:
```json
{
  "data": {
    "didPeerMap": {
      "did:claw:zAlice...": "12D3KooWAbc...",
      "did:claw:zBob...": "12D3KooWDef..."
    }
  }
}
```

### C.4 P2P 协议

| 协议 ID | 用途 | 触发时机 |
|---------|------|---------|
| `/clawnet/1.0.0/dm` | 直接消息投递 | 调用 `messaging.send()` 时 |
| `/clawnet/1.0.0/did-announce` | DID↔PeerId 映射交换 | peer 连接时自动触发 |

消息在 P2P 层以 JSON 格式传输（不做额外加密，libp2p noise 已提供传输加密）。  
载荷大小限制：**64 KB**。

### C.5 离线暂存机制

```
TelAgent A → POST /send → clawnetd A
                            │
                            ├── 目标 PeerId 已知且在线？
                            │     ├── 是 → 打开 /clawnet/1.0.0/dm stream → 直接投递 → delivered=true
                            │     └── 否 → 存入 outbox (SQLite) → delivered=false
                            │
                            └── 目标 peer 上线时 (peer:connect event)
                                  ├── 交换 DID (did-announce 协议)
                                  └── flush outbox → 逐条投递 → 成功后从 outbox 删除
```

- 每条消息最多重试 50 次
- 过期（超过 `ttlSec`）的消息自动清理
- 每个 outbox 消息记录重试次数

### C.6 TelAgent 适配指南

根据 §4.1 的 `ClawNetTransportService` 设计，建议如下适配：

```typescript
import { ClawNetClient } from '@claw-network/sdk';

class ClawNetTransportService {
  private client: ClawNetClient;
  private pollTimer?: NodeJS.Timeout;

  constructor(baseUrl: string, apiKey: string) {
    this.client = new ClawNetClient({ baseUrl, apiKey });
  }

  /** 发送信封 */
  async sendEnvelope(targetDid: string, envelope: Envelope): Promise<void> {
    const payload = Buffer.from(JSON.stringify(envelope)).toString('base64');
    const result = await this.client.messaging.send({
      targetDid,
      topic: 'telagent/envelope',
      payload,
      ttlSec: envelope.ttlSec,
    });
    if (!result.delivered) {
      console.log(`Envelope ${envelope.envelopeId} queued for offline delivery`);
    }
  }

  /** 开始轮询入站消息 */
  startPolling(
    onEnvelope: (sourceDid: string, envelope: Envelope) => Promise<void>,
    intervalMs = 2000,
  ): void {
    let lastSince = Date.now();

    this.pollTimer = setInterval(async () => {
      const inbox = await this.client.messaging.inbox({
        topic: 'telagent/envelope',
        since: lastSince,
      });

      for (const msg of inbox.messages) {
        try {
          const envelope = JSON.parse(
            Buffer.from(msg.payload, 'base64').toString('utf-8'),
          ) as Envelope;
          await onEnvelope(msg.sourceDid, envelope);
          await this.client.messaging.ack(msg.messageId);
          lastSince = Math.max(lastSince, msg.receivedAtMs);
        } catch (err) {
          console.error('Failed to process envelope:', err);
        }
      }
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
}
```

### C.7 已知限制 & Phase 2 规划

| 限制 | 影响 | Phase 2 计划 |
|------|------|-------------|
| **轮询而非 WebSocket** | 延迟取决于轮询间隔（建议 1-2 秒） | 新增 WebSocket 端点 `WS /api/v1/messaging/subscribe` |
| **无 Circuit Relay** | 双方均在 NAT 后时无法直连 | 在 bootstrap 节点启用 `@libp2p/circuit-relay-v2` |
| **单播只** | 群聊需逐一发送 | 新增批量发送 API + GossipSub topic relay |
| **无速率限制** | 理论上可被滥用 | 按 DID 限流 600 条/分钟 |
| **无投递回执** | 发送方不知道对方何时消费了消息 | 新增 delivery receipt 协议 |
