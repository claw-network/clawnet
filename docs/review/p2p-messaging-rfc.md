# RFC: TelAgent 消息通信迁移至 ClawNet P2P 层

- 文档版本：v0.7（Phase 5 FlatBuffers 二进制编码后更新）
- 状态：**ClawNet messaging API Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 已全部实现**，TelAgent 可开始适配
- 作者：TelAgent 团队
- 审阅 & 实现：ClawNet 项目组
- 日期：2026-03-06

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

- NAT 穿透：ClawNet P2P 层具备完整 NAT 穿透能力——autoNAT + dcutr hole-punching + **circuit relay 中继**（Phase 2 已在 bootstrap 节点启用 `@libp2p/circuit-relay-v2` 服务端），覆盖包括对称 NAT 在内的所有 NAT 场景。
- 去中心化路由：无需 DNS、无需 TLS 证书、无需公网 IP
- DID 原生寻址：用 DID 直接寻址，无需域名映射。DID→PeerId 映射通过 `/clawnet/1.0.0/did-announce`（连接时自动交换）和 `/clawnet/1.0.0/did-resolve`（主动查询）两个协议实现，映射持久化到 SQLite 并带 30min TTL 自动刷新。
- 离线暂存：**已支持**。目标节点离线时消息自动进入 outbox（SQLite），peer 上线后并行 flush 投递，遵循 TTL 自动清理。

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

### 3.4 增强能力

以下能力在 Phase 2、Phase 3、Phase 4 和 Phase 5 中已全部实现：

| 能力 | 状态 | 说明 |
|------|------|------|
| **多播（Multicast）** | ✅ Phase 2 | 群聊场景下向多个 DID 同时发送消息，最多 100 DID |
| **投递回执** | ✅ Phase 2 | ClawNet 层面的投递确认（区别于 TelAgent 层面的已读回执） |
| **优先级队列** | ✅ Phase 3 | 4 级优先级（LOW/NORMAL/HIGH/URGENT），高优先级消息优先投递 |
| **消息去重（幂等键）** | ✅ Phase 3 | 通过 `idempotencyKey` 实现 at-least-once → exactly-once |
| **传输层 E2E 加密** | ✅ Phase 3 | X25519 + HKDF + AES-256-GCM，可选对载荷进行传输层加密 |
| **消息压缩** | ✅ Phase 3 | 载荷 > 1 KB 时自动 gzip 压缩，减少带宽消耗 |
| **WS 断线重连补发** | ✅ Phase 3 | 通过 `sinceSeq` 参数在 WS 重连后补发遗漏消息 |
| **DID Resolve 介绍协议** | ✅ Phase 4 | 通过 bootstrap/peers 解析未知 DID→PeerId，首次消息无需等待 announce |
| **DID 映射 TTL 刷新** | ✅ Phase 4 | 30 分钟 TTL，投递失败时自动重新解析过期映射 |
| **DID→PeerId 持久化** | ✅ Phase 4 | SQLite did_peers 表持久化映射+时间戳，重启后恢复 |
| **多播 per-recipient E2E 加密** | ✅ Phase 4 | 批量发送时为每个收件人独立加密 |
| **SQLite 共享速率限制** | ✅ Phase 4 | 速率限制持久化到 SQLite，进程重启后限流状态不丢失 |
| **Bootstrap 洪泛防护** | ✅ Phase 4 | 全局入站速率限制、流超时、yamux stream 限制、Docker 资源限制 |
| **并行 outbox flush** | ✅ Phase 4 | outbox 逐条发送改为并行 flush，加速离线消息投递 |
| **FlatBuffers 二进制编码** | ✅ Phase 5 | 所有 P2P 协议从 JSON 迁移到 FlatBuffers 二进制，线上体积减少 ~30-40% |
| **二进制 E2E 信封** | ✅ Phase 5 | E2E 加密信封从 JSON hex 编码改为固定布局二进制（60 字节头），节省 ~140 字节/消息 |
| **流量控制** | ⏳ 待定 | 当接收方处理不过来时的背压机制 |

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

## 附录 C：ClawNet 实现说明（v0.7 更新）

> **本节由 ClawNet 项目组编写。Messaging API 已实现并合入主分支，TelAgent 可立即开始适配。**

### C.1 已实现的能力

| 能力 | 状态 | 说明 |
|------|------|------|
| **发送消息** (`POST /api/v1/messaging/send`) | ✅ 已实现 | 通过 P2P libp2p stream 直接投递到目标 DID |
| **接收消息** (`GET /api/v1/messaging/inbox`) | ✅ 已实现 | 轮询接口，支持 topic/since/limit 过滤 |
| **确认消息** (`DELETE /api/v1/messaging/inbox/:messageId`) | ✅ 已实现 | 确认后消息从 inbox 中移除 |
| **DID→PeerId 解析** | ✅ 已实现 | `/clawnet/1.0.0/did-announce` (连接时交换) + `/clawnet/1.0.0/did-resolve` (主动查询) |
| **离线暂存 + 自动重投** | ✅ 已实现 | 目标离线时消息进入 outbox，peer 重连后自动投递 |
| **TTL 自动清理** | ✅ 已实现 | 每 5 分钟清理过期消息（inbox + outbox） |
| **Topic 命名空间** | ✅ 已实现 | 任意 topic 字符串，建议 `telagent/*` |
| **SDK `MessagingApi`** | ✅ 已实现 | `@claw-network/sdk` 新增 `messaging` 模块 |
| **WebSocket 订阅** | ✅ Phase 2 已实现 | `WS /api/v1/messaging/subscribe`，支持 topic 过滤和实时推送 |
| **Circuit Relay（全 NAT 穿透）** | ✅ Phase 2 已实现 | bootstrap 节点启用 `@libp2p/circuit-relay-v2` 服务端 + 客户端 relay transport |
| **多播 / 批量发送** | ✅ Phase 2 已实现 | `POST /api/v1/messaging/send/batch`，单次最多 100 个目标 DID |
| **速率限制** | ✅ Phase 2 已实现 | 滑动窗口 600 条/分钟/DID，超限返回 429 + `Retry-After: 60` |
| **投递回执** | ✅ Phase 2 已实现 | `/clawnet/1.0.0/receipt` 协议，收到消息后自动回执，通过 WS 推送给发送方 |
| **消息去重（幂等键）** | ✅ Phase 3 已实现 | `idempotencyKey` 参数，相同幂等键的消息只入库一次（24h 去重窗口） |
| **传输层 E2E 加密** | ✅ Phase 3 已实现 | X25519 ECDH + HKDF-SHA-256 + AES-256-GCM；发送方指定 `encryptForKeyHex` |
| **消息压缩** | ✅ Phase 3 已实现 | `compress: true` 时载荷 > 1 KB 自动 gzip 压缩，接收方自动解压 |
| **QoS 优先级队列** | ✅ Phase 3 已实现 | `priority` 参数 (0-3)，inbox/outbox 按优先级排序投递 |
| **WS 断线重连补发** | ✅ Phase 3 已实现 | `sinceSeq` 查询参数，WS 重连后自动补发遗漏消息 + `replay_done` 帧 |
| **DID Resolve 介绍协议** | ✅ Phase 4 已实现 | `/clawnet/1.0.0/did-resolve` 协议，向 peers 查询未知 DID→PeerId |
| **DID 映射 TTL 刷新** | ✅ Phase 4 已实现 | 30min TTL，投递失败+映射过期时自动 re-resolve 获取新 PeerId |
| **多播 per-recipient E2E 加密** | ✅ Phase 4 已实现 | 批量发送时通过 `recipientKeys` 为每个收件人独立加密 |
| **SQLite 共享速率限制** | ✅ Phase 4 已实现 | `rate_limits` 表持久化滑动窗口事件，进程重启后限流状态延续 |
| **Bootstrap 洪泛防护** | ✅ Phase 4 已实现 | 全局入站速率限制 3000/min + per-peer 300/min + 流超时 10s + Docker 资源限制 |
| **并行 outbox flush** | ✅ Phase 4 已实现 | outbox 消息并行投递（bounded concurrency=20），加速离线消息重投 |
| **FlatBuffers 二进制编码** | ✅ Phase 5 已实现 | 所有 4 个 P2P 协议（dm/did-announce/did-resolve/receipt）从 JSON 迁移到 FlatBuffers 二进制格式 |
| **二进制 E2E 信封** | ✅ Phase 5 已实现 | E2E 加密信封使用固定二进制布局 `[pk:32][nonce:12][tag:16][ciphertext:...]`，60 字节头 |

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
  priority: 1,             // 可选，0=LOW 1=NORMAL 2=HIGH 3=URGENT
  compress: true,          // 可选，载荷 > 1KB 时自动 gzip 压缩
  encryptForKeyHex: '...',  // 可选，收件人 X25519 公钥 hex，启用 E2E 加密
  idempotencyKey: 'uuid-xxx',  // 可选，幂等键，相同键只入库一次
});

console.log(result);
// { messageId: "msg_abc123def456", delivered: true, compressed: true, encrypted: true }
// delivered=true  → 目标在线，已直接投递
// delivered=false → 目标离线，已入 outbox 等待重投

// ── 批量发送（多播） ─────────────────────────────────────────

const batchResult = await claw.messaging.sendBatch({
  targetDids: ['did:claw:zAlice...', 'did:claw:zBob...', 'did:claw:zCharlie...'],
  topic: 'telagent/envelope',
  payload: '<base64-encoded data>',
  ttlSec: 86400,
  priority: 2,             // 可选，HIGH 优先级
  compress: true,          // 可选
  idempotencyKey: 'batch-uuid-xxx',  // 可选
});

console.log(batchResult);
// { results: [
//   { targetDid: "did:claw:zAlice...", messageId: "msg_...", delivered: true },
//   { targetDid: "did:claw:zBob...", messageId: "msg_...", delivered: false },
//   ...
// ] }

// ── 轮询 inbox ────────────────────────────────────────────────

const inbox = await claw.messaging.inbox({
  topic: 'telagent/envelope',  // 可选，按 topic 过滤
  since: 1709654400000,        // 可选，只返回该时间戳之后的消息
  sinceSeq: 42,                // 可选，只返回 seq > 42 的消息（用于断线重连补发）
  limit: 100,                  // 可选，默认 100，最大 500
});

for (const msg of inbox.messages) {
  console.log(msg);
  // {
  //   messageId: "msg_...",
  //   sourceDid: "did:claw:zAliceKey...",
  //   topic: "telagent/envelope",
  //   payload: "<base64>",
  //   receivedAtMs: 1709654400123,
  //   priority: 1,
  //   seq: 43
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
  "ttlSec": 86400,
  "priority": 1,
  "compress": true,
  "encryptForKeyHex": "<recipient X25519 pubkey hex>",
  "idempotencyKey": "<unique key for dedup>"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `targetDid` | string | ✅ | 目标节点 DID (`did:claw:z...`) |
| `topic` | string | ✅ | 消息主题/通道名 |
| `payload` | string | ✅ | 不透明载荷（base64 编码） |
| `ttlSec` | number | ❌ | 存活时间（秒），默认 86400 |
| `priority` | number | ❌ | 优先级 0=LOW 1=NORMAL 2=HIGH 3=URGENT，默认 1 |
| `compress` | boolean | ❌ | 载荷 > 1KB 时启用 gzip 压缩 |
| `encryptForKeyHex` | string | ❌ | 收件人 X25519 公钥 hex，启用 E2E 加密 |
| `idempotencyKey` | string | ❌ | 幂等键，相同键的消息只入库一次 |

**Response (201 Created)**:
```json
{
  "data": {
    "messageId": "msg_abc123def456",
    "delivered": true,
    "compressed": true,
    "encrypted": true
  },
  "links": {
    "self": "/api/v1/messaging/inbox"
  }
}
```

#### GET /api/v1/messaging/inbox

```http
GET /api/v1/messaging/inbox?topic=telagent/envelope&since=1709654400000&sinceSeq=42&limit=100
X-Api-Key: <api-key>
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `topic` | string | ❌ | 按主题过滤 |
| `since` | number | ❌ | 只返回该时间戳之后的消息（ms） |
| `sinceSeq` | number | ❌ | 只返回 seq > 该值的消息（断线重连补发） |
| `limit` | number | ❌ | 最大返回数 (1-500，默认 100) |

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
        "receivedAtMs": 1709654400123,
        "priority": 1,
        "seq": 43
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
| `/clawnet/1.0.0/did-resolve` | DID→PeerId 主动查询 | 未知 DID 时向 peers 查询 |
| `/clawnet/1.0.0/receipt` | 投递回执 | 收到 `/dm` 消息后自动回执给发送方 |

消息在 P2P 层以 **FlatBuffers 二进制格式**传输（Phase 5 从 JSON 迁移，线上体积减少 ~30-40%）。libp2p noise 提供传输层加密。  
载荷大小限制：**64 KB**。

### C.5 离线暂存与 DID 解析机制

```
TelAgent A → POST /send → clawnetd A
                            │
                            ├── 目标 PeerId 已知且在线？
                            │     ├── 是 → 打开 /clawnet/1.0.0/dm stream → 直接投递 → delivered=true
                            │     │        └── 投递失败且映射超过 30min？
                            │     │              ├── 是 → did-resolve 重新查询 → 拿到新 PeerId → 重试投递
                            │     │              └── 否 → 存入 outbox
                            │     └── 否 → did-resolve 向已连接 peers 查询（最多 3 个，5s 超时）
                            │           ├── 查到 → registerDidPeer + dialPeer + deliverDirect → delivered=true
                            │           └── 未查到 → 存入 outbox (SQLite) → delivered=false
                            │
                            └── 目标 peer 上线时 (peer:connect event)
                                  ├── 交换 DID (did-announce 协议)
                                  └── flush outbox → 并行投递 → 成功后从 outbox 删除
```

- 每条消息最多重试 50 次
- 过期（超过 `ttlSec`）的消息自动清理
- 每个 outbox 消息记录重试次数

### C.6 TelAgent 适配指南

根据 §4.1 的 `ClawNetTransportService` 设计，建议如下适配：

```typescript
import { ClawNetClient } from '@claw-network/sdk';
import WebSocket from 'ws';

class ClawNetTransportService {
  private client: ClawNetClient;
  private ws?: WebSocket;
  private baseUrl: string;
  private apiKey: string;
  private lastSeq = 0;        // 跟踪最后收到的 seq，用于断线重连补发

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
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
      priority: envelope.contentType.startsWith('control/') ? 3 : 1,  // control 消息用 URGENT
      compress: true,          // 自动压缩大载荷
      idempotencyKey: envelope.envelopeId,  // 用 envelopeId 作为幂等键，实现 exactly-once
    });
    if (!result.delivered) {
      console.log(`Envelope ${envelope.envelopeId} queued for offline delivery`);
    }
  }

  /** 批量发送信封（群聊场景） */
  async sendEnvelopeMulticast(targetDids: string[], envelope: Envelope): Promise<void> {
    const payload = Buffer.from(JSON.stringify(envelope)).toString('base64');
    await this.client.messaging.sendBatch({
      targetDids,
      topic: 'telagent/envelope',
      payload,
      ttlSec: envelope.ttlSec,
      priority: envelope.contentType.startsWith('control/') ? 3 : 1,
      compress: true,
      idempotencyKey: envelope.envelopeId,
    });
  }

  /**
   * 订阅入站消息（推荐方式：WebSocket + 断线重连补发）
   *
   * 首次连接时不传 sinceSeq，后续重连时带上 sinceSeq 参数，
   * 服务端会自动补发断线期间遗漏的消息。
   */
  startListening(
    onEnvelope: (sourceDid: string, envelope: Envelope) => Promise<void>,
  ): void {
    // 构建 WS URL，带上 sinceSeq 参数实现断线重连补发
    let wsUrl = this.baseUrl.replace(/^http/, 'ws')
      + '/api/v1/messaging/subscribe?topic=telagent/envelope'
      + `&apiKey=${this.apiKey}`;
    if (this.lastSeq > 0) {
      wsUrl += `&sinceSeq=${this.lastSeq}`;
    }

    this.ws = new WebSocket(wsUrl);

    this.ws.on('message', async (data) => {
      try {
        const frame = JSON.parse(data.toString()) as {
          type: string;
          seq?: number;
          lastSeq?: number;
          data?: { sourceDid: string; payload: string; messageId: string; seq: number };
        };

        if (frame.type === 'connected' && frame.seq) {
          // 记录服务端当前 seq，用于下次重连
          if (this.lastSeq === 0) this.lastSeq = frame.seq;
        }

        if (frame.type === 'message' && frame.data) {
          const envelope = JSON.parse(
            Buffer.from(frame.data.payload, 'base64').toString('utf-8'),
          ) as Envelope;
          await onEnvelope(frame.data.sourceDid, envelope);
          // 更新 lastSeq 用于后续重连
          if (frame.data.seq > this.lastSeq) this.lastSeq = frame.data.seq;
          // ACK via REST（可选，用于清理 inbox）
          await this.client.messaging.ack(frame.data.messageId);
        }

        if (frame.type === 'replay_done') {
          console.log(`Replay done, caught up to seq ${frame.lastSeq}`);
          if (frame.lastSeq && frame.lastSeq > this.lastSeq) {
            this.lastSeq = frame.lastSeq;
          }
        }

        if (frame.type === 'receipt') {
          // 投递回执，可用于更新 UI 或消息状态
          console.log('Delivery receipt:', frame.data);
        }
      } catch (err) {
        console.error('Failed to process WS message:', err);
      }
    });

    this.ws.on('close', () => {
      // 自动重连，带上 lastSeq 以补发遗漏消息
      setTimeout(() => this.startListening(onEnvelope), 3000);
    });
  }

  stopListening(): void {
    this.ws?.close();
    this.ws = undefined;
  }
}
```

**轮询回退模式**（如 WebSocket 不可用，使用 sinceSeq 代替 since）：

```typescript
// 使用 sinceSeq 进行轮询，比时间戳更可靠
let lastSeq = 0;
setInterval(async () => {
  const inbox = await claw.messaging.inbox({
    topic: 'telagent/envelope',
    sinceSeq: lastSeq,
  });
  for (const msg of inbox.messages) {
    // ... 处理消息 ...
    await claw.messaging.ack(msg.messageId);
    lastSeq = Math.max(lastSeq, msg.seq);
  }
}, 2000);
```

### C.7 Phase 2 实现总结（v0.4）

Phase 2 所有能力均已实现并通过测试（297 tests passing）：

| 能力 | 实现方式 | 文件 |
|------|---------|------|
| **WebSocket 订阅** | `WS /api/v1/messaging/subscribe` — `ws` 包 + HTTP upgrade | `api/ws-messaging.ts` |
| **Circuit Relay** | `@libp2p/circuit-relay-v2` — 服务端 + relay transport | `p2p/node.ts`, `p2p/config.ts` |
| **多播 / 批量发送** | `POST /api/v1/messaging/send/batch` — 最多 100 DID | `routes/messaging.ts`, `messaging-service.ts` |
| **速率限制** | 滑动窗口 600/min/DID — 超限返回 429 | `messaging-service.ts` |
| **投递回执** | `/clawnet/1.0.0/receipt` 协议 — 收到消息后自动回执 | `messaging-service.ts` |

#### WebSocket 帧格式

```jsonc
// 服务端 → 客户端
{ "type": "connected", "topicFilter": "telagent/envelope", "seq": 42 }  // 连接确认，包含当前序列号
{ "type": "message", "data": { "messageId": "...", "sourceDid": "...", "topic": "...", "payload": "...", "receivedAtMs": ..., "priority": 1, "seq": 43 } }
{ "type": "receipt", "data": { "type": "delivered", "messageId": "...", "recipientDid": "...", "deliveredAtMs": ... } }
{ "type": "replay_done", "lastSeq": 45 }                              // 断线补发完成标志
```

#### 速率限制响应

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/problem+json

{
  "type": "urn:clawnet:error:too-many-requests",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Rate limit exceeded for did:claw:z...: max 600 messages/minute"
}
```

#### 批量发送 API

```http
POST /api/v1/messaging/send/batch
Content-Type: application/json
X-Api-Key: <api-key>

{
  "targetDids": ["did:claw:zAlice...", "did:claw:zBob...", "did:claw:zCharlie..."],
  "topic": "telagent/envelope",
  "payload": "<base64>",
  "ttlSec": 86400,
  "priority": 2,
  "compress": true,
  "idempotencyKey": "batch-uuid-xxx"
}
```

**Response (201)**:
```json
{
  "data": {
    "results": [
      { "targetDid": "did:claw:zAlice...", "messageId": "msg_...", "delivered": true },
      { "targetDid": "did:claw:zBob...", "messageId": "msg_...", "delivered": false },
      { "targetDid": "did:claw:zCharlie...", "messageId": "msg_...", "delivered": true }
    ]
  }
}
```

### C.8 Phase 3 增强功能总结（v0.5）

Phase 3 在 Phase 2 基础上新增了 5 项生产级增强功能，全部已实现并通过测试（307 tests passing）：

| 能力 | 实现方式 | 文件 |
|------|---------|------|
| **消息去重（幂等键）** | SQLite `dedup` 表 (idempotencyKey → messageId)，24h 去重窗口 | `message-store.ts` |
| **传输层 E2E 加密** | X25519 ECDH + HKDF-SHA-256 + AES-256-GCM | `messaging-service.ts` |
| **消息压缩** | gzip 压缩（自动对 >1KB 载荷生效），接收方自动解压 | `messaging-service.ts` |
| **QoS 优先级队列** | `priority` 列 (0-3)，inbox/outbox 按优先级排序投递 | `message-store.ts`, `messaging-service.ts` |
| **WS 断线重连补发** | `sinceSeq` 查询参数 + 单调递增 `seq` + `replay_done` 帧 | `ws-messaging.ts`, `message-store.ts` |

#### 消息去重（幂等键）

发送方在请求中指定 `idempotencyKey`，ClawNet 节点在存储时检查 `dedup` 表：

- 若该 key 已存在 → 返回之前的 `messageId`，不重复入库
- 若不存在 → 正常入库，同时记录到 dedup 表
- 去重记录 24 小时后自动清理（随 TTL cleanup 一起执行）

```
POST /send { idempotencyKey: "abc" }
  → 首次: 新建消息 msg_001, 记录 dedup["abc"] = msg_001
  → 重试: 命中 dedup["abc"], 直接返回 msg_001, 不重复入库
```

**TelAgent 适配建议**：使用 `envelope.envelopeId` 作为 `idempotencyKey`，实现 at-least-once → exactly-once 语义升级。

#### 传输层 E2E 加密

可选的传输层加密，在 TelAgent 自有 E2E 加密之上提供额外保护层。加密流程：

```
发送方:
  1. 生成临时 X25519 密钥对 (ephemeralPub, ephemeralPriv)
  2. ECDH: sharedSecret = x25519(ephemeralPriv, recipientPubKey)
  3. HKDF: key = HKDF-SHA-256(sharedSecret, info="clawnet:e2e-msg:v1")
  4. AES-256-GCM 加密 payload → ciphertext + tag
  5. P2P 线上格式（Phase 5）: 固定二进制布局 [ephemeralPk:32][nonce:12][tag:16][ciphertext:...] = 60 字节头
     SQLite 存储格式: { _e2e: 1, pk: ephemeralPubHex, n: nonceHex, c: ciphertextHex, t: tagHex }

接收方:
  1. 从 FlatBuffers DirectMessage.payload 解析二进制 E2E 信封（60 字节头）
  2. ECDH: sharedSecret = x25519(recipientPriv, ephemeralPub)
  3. HKDF + AES-256-GCM 解密
```

SDK 静态方法：
- `MessagingService.decryptPayload(payload, recipientPrivateKey: Uint8Array)` — 解密 E2E 信封
- `MessagingService.decompressPayload(payload)` — 解压 gzip 载荷

#### 消息压缩

发送时指定 `compress: true`，若载荷大于 1 KB：

1. 用 gzip 压缩载荷为 raw bytes
2. P2P 线上格式（Phase 5）：raw gzip bytes 直接作为 FlatBuffers `DirectMessage.payload`（`compressed=true` 标志位）
3. SQLite 存储格式：`{ _compressed: 1, data: "<gzip-base64>" }`（保持向后兼容）
4. 接收方根据 `compressed` 标志位自动解压

低于 1 KB 的载荷即使指定 `compress: true` 也不会被压缩（避免膨胀）。

#### QoS 优先级队列

4 级优先级：

| 值 | 名称 | 用途 |
|----|------|------|
| 0 | LOW | 不紧急的通知、日志 |
| 1 | NORMAL | 普通消息（默认） |
| 2 | HIGH | 重要消息、群组同步 |
| 3 | URGENT | 控制消息、紧急通知 |

影响范围：
- **inbox 查询**：按 `priority DESC, received_at_ms ASC` 排序
- **outbox 重投**：按 `priority DESC` 排序，高优先级消息优先投递
- **SDK 字段**：`InboxMessage.priority`（只读）

#### WS 断线重连补发

基于单调递增序列号 `seq` 的 gap-fill 机制：

```
WS 连接 #1:
  ← connected { seq: 100 }       // 客户端记录 lastSeq = 100
  ← message { seq: 101 }
  ← message { seq: 102 }
  ✕ 网络断开，客户端 lastSeq = 102

WS 连接 #2 (重连):
  → WS /subscribe?sinceSeq=102
  ← connected { seq: 105 }       // 服务端当前 seq
  ← message { seq: 103 }         // 补发 #1
  ← message { seq: 104 }         // 补发 #2
  ← message { seq: 105 }         // 补发 #3
  ← replay_done { lastSeq: 105 } // 补发完成
  ← message { seq: 106 }         // 实时推送恢复
```

客户端只需：
1. 连接时记录 `connected.seq`
2. 每条消息更新 `lastSeq = msg.seq`
3. 重连时带上 `?sinceSeq=<lastSeq>`
4. 收到 `replay_done` 后进入正常实时模式

### C.9 Phase 4 P2P 健壮性增强总结（v0.6）

Phase 4 聚焦于 P2P 层健壮性和 DID 发现机制的完善。全部已实现并通过测试（217 tests passing across 24 test files）。

#### DID Resolve 介绍协议

**问题**：当节点 A 首次向节点 B 发消息，但 A 不知道 B 的 PeerId 时（B 从未连过 A），消息只能进 outbox 等待 B 碰巧上线并 announce 自己。

**方案**：新增 `/clawnet/1.0.0/did-resolve` 协议，让节点主动向已连接的 peers（尤其是 bootstrap）查询未知 DID 的 PeerId。Bootstrap 拥有最完整的映射表（所有新节点都会连它并 announce）。

```
send(targetDid):
  1. didToPeerId.get(targetDid)  → 找到 → 直连
  2.【新增】resolveDidViaPeers(targetDid) → 向已连接 peers 查询
     - 最多并发查 3 个节点，5s 超时
     - 拿到 peerId → dialPeer(peerId) → deliverDirect()
  3. 都失败 → 进 outbox（保持现有兜底）
```

**协议格式**（Phase 5 已迁移至 FlatBuffers 二进制）：

```
// FlatBuffers schema（参见 docs/implementation/messaging-spec.fbs）

// 请求: DidResolveRequest
table DidResolveRequest {
  did: string;           // 要查询的 DID
}

// 响应: DidResolveResponse
table DidResolveResponse {
  did: string;           // 查询的 DID
  peerId: string;        // 对应的 PeerId（未找到时为空字符串）
  found: bool;           // 是否找到
}
```

**安全措施**：
- DID 格式校验后才查表，防止注入
- 复用 inbound rate limit（per-peer 300/min + global 3000/min）
- 只返回 PeerId（不泄露 multiaddrs，地址由 KadDHT/peerStore 负责）
- 5s 超时，resolve 失败不阻塞 `send()`

#### DID→PeerId 映射 TTL 刷新

**问题**：节点重启后 PeerId 可能改变，但旧的 DID→PeerId 映射仍在本地缓存，导致投递持续失败。

**方案**：为映射加 30 分钟 TTL。当 `deliverDirect()` 投递失败且映射超过 TTL 时，自动触发 re-resolve：

```
deliverDirect(targetDid) 失败：
  映射 < 30min → 直接进 outbox（映射还新鲜，可能是临时网络问题）
  映射 > 30min → resolveDidViaPeers(targetDid)
    → 新 PeerId ≠ 旧 PeerId → registerDidPeer + dialPeer + 重试投递
    → 新 PeerId = 旧 PeerId 或查不到 → 进 outbox
```

**实现细节**：
- `didPeerUpdatedAt` Map 追踪每个映射的最后确认时间
- `isStalePeerMapping(did)` 检查映射是否超过 `DID_PEER_TTL_MS`（30min）
- `getAllDidPeers()` 现在返回 `updatedAtMs` 字段，重启后时间戳从 SQLite 恢复
- `registerDidPeer()` 每次更新时同时更新内存时间戳和 SQLite `updated_at_ms`

#### DID→PeerId 持久化

映射持久化到 SQLite `did_peers` 表，重启后自动恢复：

| 列 | 类型 | 说明 |
|----|------|------|
| `did` | TEXT PK | DID 标识 |
| `peer_id` | TEXT | 对应的 libp2p PeerId |
| `updated_at_ms` | INTEGER | 映射最后确认时间（用于 TTL 判断） |

#### 多播 per-recipient E2E 加密

批量发送时，通过 `recipientKeys` Map（DID → X25519 公钥 hex）为每个收件人独立加密载荷，防止群组消息被非目标节点解密。

#### SQLite 共享速率限制

速率限制事件持久化到 SQLite `rate_limits` 表（滑动窗口），进程重启后限流状态延续。三级限制：

| 级别 | Bucket 前缀 | 限额 |
|------|------------|------|
| 出站 per-DID | `out:<did>` | 600/min |
| 入站 per-peer | `in:<peerId>` | 300/min |
| 入站 全局汇总 | `in:_global` | 3000/min |

#### Bootstrap 洪泛防护

专用 `BOOTSTRAP_P2P_CONFIG` 配置，降低 bootstrap 节点被恶意 peer 攻击的风险：

| 参数 | 值 | 说明 |
|------|-----|------|
| `floodPublish` | `false` | 不向所有连接广播 GossipSub 消息 |
| `maxConnections` | `500` | 当前默认 100 |
| `yamuxMaxInboundStreams` | `128` | 限制每个连接的流数量（默认 256） |
| Stream read timeout | `10s` | 慢/挂起的流自动终止 |
| Per-protocol `maxInboundStreams` | 64-256 | 各协议独立限制 |
| Docker resource limits | 2G memory / 2 CPU | 容器级硬限制 |

#### 并行 Outbox Flush

outbox 消息改为 bounded concurrency（`MULTICAST_CONCURRENCY=20`）并行投递，显著加速离线消息重投。此前为逐条串行。

#### 文件变更清单

| 文件 | 变更 |
|------|------|
| `packages/node/src/services/messaging-service.ts` | DID resolve 协议 handler + client, TTL 机制, multicast resolve, per-recipient E2E, 并行 flush |
| `packages/node/src/services/message-store.ts` | `getAllDidPeers()` 返回 `updatedAtMs` |
| `packages/core/src/p2p/config.ts` | `BOOTSTRAP_P2P_CONFIG` 配置 |
| `packages/core/src/p2p/node.ts` | `handleProtocol()` 支持 `maxInboundStreams` option |
| `packages/node/test/messaging-did-resolve.test.ts` | 11 个测试覆盖 resolve handler/client/TTL/timeout |
| `packages/node/test/message-store.test.ts` | 28 个测试（含 did_peers + rate_limits） |
| `packages/core/test/p2p-config.test.ts` | 5 个测试覆盖 BOOTSTRAP_P2P_CONFIG |
| `docker-compose.*.yml` (6 files) | 所有 compose 文件添加 Docker resource limits |

### C.10 Phase 5 FlatBuffers 二进制编码总结（v0.7）

Phase 5 将所有 4 个 P2P 协议的线上格式从 JSON 迁移到 FlatBuffers 二进制编码。全部已实现并通过测试（217 node tests + 101 protocol tests，含 14 个新增 messaging codec 测试）。

#### 动机

- **JSON 开销大**：字段名、引号、逗号等文本开销占比高；二进制数据（E2E 密文、gzip）需 base64/hex 编码再膨胀 33-100%
- **FlatBuffers 优势**：零拷贝解析、无 schema 文本开销、二进制数据原生支持
- **实测效果**：典型文本消息线上体积减少 ~30-40%；E2E 加密信封从 ~200+ 字节 JSON → 60 字节固定二进制头

#### 受影响的 P2P 协议

| 协议 | FlatBuffers 表 | 主要字段 |
|------|---------------|----------|
| `/clawnet/1.0.0/dm` | `DirectMessage` | sourceDid, targetDid, topic, payload (`[ubyte]`), ttlSec, sentAtMs, priority, compressed, encrypted, idempotencyKey |
| `/clawnet/1.0.0/did-announce` | `DidAnnounce` | did |
| `/clawnet/1.0.0/did-resolve` | `DidResolveRequest` / `DidResolveResponse` | did, peerId, found |
| `/clawnet/1.0.0/receipt` | `DeliveryReceipt` | messageId, recipientDid, senderDid, deliveredAtMs, type |

#### DirectMessage FlatBuffers 格式

```
table DirectMessage {
  sourceDid: string;        // 发送方 DID
  targetDid: string;        // 目标 DID
  topic: string;            // 消息主题
  payload: [ubyte];         // 不透明二进制载荷（plain UTF-8 / raw gzip / binary E2E envelope）
  ttlSec: int;              // 存活时间（秒）
  sentAtMs: long;           // 发送时间戳（毫秒）
  priority: int;            // 优先级 0-3
  compressed: bool;         // 载荷是否 gzip 压缩
  encrypted: bool;          // 载荷是否 E2E 加密
  idempotencyKey: string;   // 幂等键
}
```

> `payload` 字段为 `[ubyte]`（原始字节数组）。对比 JSON 方案中 payload 需要 base64/hex 编码，FlatBuffers 直接携带原始二进制，零膨胀。

#### 二进制 E2E 信封格式

替代原有的 JSON hex 编码信封 `{ _e2e:1, pk:hex, n:hex, c:hex, t:hex }`（~200+ 字节），改为固定布局二进制：

```
[ephemeralPk: 32 bytes][nonce: 12 bytes][tag: 16 bytes][ciphertext: N bytes]
|<────────────── E2E_HEADER_SIZE = 60 bytes ──────────────>|
```

- **线上格式**：上述固定布局二进制，作为 `DirectMessage.payload` 的值（`encrypted=true`）
- **SQLite 存储格式**：接收方解析后转换为 JSON `{ _e2e:1, pk:hex, n:hex, c:hex, t:hex }` 存入 TEXT 列，保持 REST API 向后兼容

#### 二进制压缩格式

- **线上格式**：raw gzip bytes 直接作为 `DirectMessage.payload`（`compressed=true`）
- **SQLite 存储格式**：接收方转换为 `{ _compressed:1, data:"<gzip-base64>" }`

#### 双格式输出（线上 vs 存储）

`encodePayload()` 现在返回双格式：

| 输出 | 类型 | 用途 |
|------|------|------|
| `payloadBytes` | `Uint8Array` | P2P 线上传输（FlatBuffers `[ubyte]`） |
| `storagePayload` | `string` | SQLite TEXT 列 / REST API 响应 |

这确保 P2P 层使用高效二进制，而 REST API 和 SQLite 保持字符串格式向后兼容。

#### 编解码架构

```
@claw-network/protocol/messaging          （新增子模块）
  ├── types.ts          — TypeScript 接口（DirectMessage, DeliveryReceipt, ...）
  ├── flatbuffers.ts    — 手写 FlatBuffers encode/decode（复用 p2p/flatbuffers.ts 的 FlatBufferReader + Builder）
  ├── codec.ts          — 高层 encode*Bytes() / decode*Bytes() + 二进制 E2E envelope
  └── index.ts          — barrel exports

@claw-network/node
  └── messaging-service.ts  — 所有 P2P handler 从 JSON.stringify/parse 迁移到 FlatBuffers codec
```

> **无 `flatc` 代码生成**：沿用项目已有的手写 FlatBuffers 模式（`packages/protocol/src/p2p/flatbuffers.ts`），直接使用 `flatbuffers` npm 包的 `Builder` + 自定义 `FlatBufferReader`。

#### 对 SDK / REST API 的影响

**无影响**。FlatBuffers 编码仅影响节点间 P2P stream 传输。SDK 通过 REST API 发送/接收消息，payload 格式（base64 字符串）不变。SQLite 存储格式（TEXT 列）也不变。

#### 向后兼容性

**不向后兼容**。所有节点需同时升级。新旧节点之间无法互通 P2P 消息（旧节点发 JSON，新节点期望 FlatBuffers）。这是有意的设计决策——当前所有节点由同一团队部署，可统一升级。

#### 测试覆盖

| 测试文件 | 测试数 | 覆盖范围 |
|---------|--------|----------|
| `packages/protocol/test/messaging-codec.test.ts`（新增） | 14 | 全部 5 个 FlatBuffers 表的 round-trip 编解码 + E2E envelope + size comparison |
| `packages/node/test/messaging-did-resolve.test.ts`（更新） | 11 | DID resolve handler/client 使用 FlatBuffers 二进制 stream |
| 其余 node tests | 206 | messaging-api、message-store 等不受影响 |
| **合计** | 217 + 101 | node 217 tests (24 files) + protocol 101 tests (15 files) |

#### 文件变更清单

| 文件 | 变更 |
|------|------|
| `docs/implementation/messaging-spec.fbs`（新增） | FlatBuffers schema 文档，定义 5 个表 |
| `packages/protocol/src/messaging/types.ts`（新增） | TypeScript 接口：DirectMessage, DeliveryReceipt, DidAnnounce, DidResolveRequest/Response, E2EEnvelope |
| `packages/protocol/src/messaging/flatbuffers.ts`（新增） | 手写 FlatBuffers encode/decode 函数 |
| `packages/protocol/src/messaging/codec.ts`（新增） | 高层 codec + 二进制 E2E envelope encode/decode |
| `packages/protocol/src/messaging/index.ts`（新增） | barrel exports |
| `packages/protocol/src/index.ts` | 新增 `export * from './messaging/index.js'` |
| `packages/protocol/package.json` | 新增 `./messaging` subpath export |
| `packages/protocol/test/messaging-codec.test.ts`（新增） | 14 个 round-trip 测试 |
| `packages/node/src/services/messaging-service.ts` | 全部 P2P handler 从 JSON 迁移到 FlatBuffers codec；新增 `writeBinaryStream()`；`encodePayload()` 双格式输出 |
| `packages/node/test/messaging-did-resolve.test.ts` | `fakeStream` 从 JSON 字符串改为 FlatBuffers 二进制 |
