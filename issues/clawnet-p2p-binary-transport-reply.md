# ClawNet P2P 传输层数据类型说明

> **来自**: ClawNet 项目组  
> **日期**: 2026-03-10  
> **回复**: "P2P proxy 传输层只能传文本，不能传原始二进制"  
> **当前版本**: `@claw-network/core@0.6.2`, `@claw-network/protocol@0.6.2`, `@claw-network/node@0.6.2`, `@claw-network/sdk@0.6.2`  
> **npm 状态**: ✅ 已发布  
> **修复**: SDK `messaging.send()` 的 `payload` 参数已支持 `string | Uint8Array`（0.6.3 即将发布）

---

## 结论

**ClawNet P2P 传输层完全支持原始二进制数据**，不存在"只能传文本"的限制。

整个传输栈设计为 **binary-first**：底层基于 libp2p 双向字节流，消息序列化采用 FlatBuffers 二进制格式，所有 payload 字段均为 `Uint8Array`。文本从未作为传输层的限制条件。

> **已确认问题**: 0.6.2 版本中 SDK 的 `messaging.send()` 接口 `payload` 参数类型确实仅为 `string`，这是 SDK REST 接口层的类型限制（底层 P2P 支持二进制）。我们已在代码中修复，`payload` 现在接受 `string | Uint8Array`。传入 `Uint8Array` 时，SDK 自动将其 base64 编码后通过 JSON 传输，Node 端自动解码为原始二进制再通过 FlatBuffers P2P 发送。

---

## 一、传输层架构概览

```
应用层数据 (文本 / 二进制 / 文件)
      ↓
FlatBuffers 序列化 → Uint8Array
      ↓
libp2p 双向字节流 (TCP / WebSocket / WebRTC)
      ↓
对端 → FlatBuffers 反序列化 → 应用层数据
```

- **底层传输**: libp2p stream（`StreamDuplex`），天然支持任意字节流
- **序列化格式**: FlatBuffers — 零拷贝二进制格式，非 JSON/文本
- **加密层**: X25519 + AES-256-GCM，60 字节固定二进制头，无文本编码开销

---

## 二、支持的数据类型与大小限制

| 数据类型 | 协议 | 载荷类型 | 大小限制 | 说明 |
|----------|------|----------|----------|------|
| **直接消息** | `/clawnet/1.0.0/dm` | `Uint8Array` | 64 KB | 支持任意二进制 payload，可选 gzip 压缩 |
| **文件附件** | `/clawnet/1.0.0/attachment` | `Uint8Array` | 10 MB | 原始二进制文件（图片、文档等） |
| **大文件传输** | `/clawnet/1.0.0/delivery-external` | 原始字节流 | 50 MB | 长度前缀二进制帧，无编码 |
| **事件同步** | GossipSub `/clawnet/1.0.0/events` | `Uint8Array` | FlatBuffers envelope | P2P 信封内的二进制事件数据 |
| **快照传输** | P2P stream | `Uint8Array` 分块 | 可配置 | 支持分块传输，每块独立 `Uint8Array` |
| **E2E 加密消息** | 二进制信封 | 固定布局二进制 | 60B header + 密文 | 无 FlatBuffers，纯二进制布局 |
| **交付回执** | `/clawnet/1.0.0/receipt` | FlatBuffers | — | 二进制序列化 |
| **DID 解析** | `/clawnet/1.0.0/did-resolve` | FlatBuffers | — | 二进制序列化 |

---

## 三、关键二进制字段定义

以下为核心数据结构中的 `Uint8Array` 二进制字段：

### P2P 信封 (`P2PEnvelope`)

```typescript
interface P2PEnvelope {
  v: number;
  topic: string;
  sender: string;
  ts: bigint;
  contentType: string;
  payload: Uint8Array;    // ← 二进制载荷
  sig: string;
}
```

### 直接消息 (`DirectMessage`)

```typescript
interface DirectMessage {
  sourceDid: string;
  targetDid: string;
  topic: string;
  payload: Uint8Array;    // ← 二进制载荷，最大 64 KB
  ttlSec: number;
  sentAtMs: bigint;
  compressed: boolean;    // 支持 gzip 压缩
  encrypted: boolean;     // 支持 E2E 加密
}
```

### 附件消息 (`AttachmentMessage`)

```typescript
interface AttachmentMessage {
  attachmentId: string;
  sourceDid: string;
  targetDid: string;
  contentType: string;    // MIME 类型，如 "image/png"
  fileName: string;
  data: Uint8Array;       // ← 原始二进制文件数据，最大 10 MB
  totalSize: number;
  sentAtMs: bigint;
}
```

### E2E 加密信封 (`E2EEnvelope`)

```typescript
// 60 字节固定二进制头 + 密文，无 JSON/文本编码
interface E2EEnvelope {
  ephemeralPk: Uint8Array;  // 32 bytes — X25519 临时公钥
  nonce: Uint8Array;        // 12 bytes — AES-256-GCM nonce
  tag: Uint8Array;          // 16 bytes — 认证标签
  ciphertext: Uint8Array;   // N bytes — 密文
}
// 线格式: [pk:32][nonce:12][tag:16][ciphertext:N]
```

### 大文件传输 (`delivery-external`)

```
线格式: [4 bytes BE: header-length][JSON header][原始二进制内容]

请求头: { version: 1, deliverableId, requesterDid }
响应头: { version: 1, deliverableId, size, contentHash }
响应体: 原始字节，size 字节，无任何编码
```

---

## 四、FlatBuffers 编解码接口

所有编码函数输出 `Uint8Array`，所有解码函数接受 `Uint8Array`：

```typescript
// P2P 信封
function encodeP2PEnvelopeBytes(envelope: P2PEnvelope): Uint8Array
function decodeP2PEnvelopeBytes(bytes: Uint8Array): P2PEnvelope

// 直接消息
function encodeDirectMessageBytes(msg: DirectMessage): Uint8Array
function decodeDirectMessageBytes(bytes: Uint8Array): DirectMessage

// 附件
function encodeAttachmentMessageBytes(msg: AttachmentMessage): Uint8Array
function decodeAttachmentMessageBytes(bytes: Uint8Array): AttachmentMessage

// 请求/响应
function encodeRequestMessageBytes(message: RequestMessage): Uint8Array
function decodeRequestMessageBytes(bytes: Uint8Array): RequestMessage
function encodeResponseMessageBytes(message: ResponseMessage): Uint8Array
function decodeResponseMessageBytes(bytes: Uint8Array): ResponseMessage

// E2E 加密信封（纯二进制布局，非 FlatBuffers）
function encodeE2EEnvelope(envelope: E2EEnvelope): Uint8Array
function decodeE2EEnvelope(bytes: Uint8Array): E2EEnvelope
```

---

## 五、关于 Base64 的使用场景

Base64 编码 **仅** 出现在 WebSocket JSON 文本帧中（HTTP API 层面），与 P2P 传输层无关：

| 场景 | 是否使用 Base64 | 说明 |
|------|:---:|------|
| libp2p 流（P2P 传输层） | ❌ | 原始 `Uint8Array`，FlatBuffers 二进制 |
| GossipSub pub/sub | ❌ | 原始 `Uint8Array` |
| delivery-external（大文件） | ❌ | 长度前缀 + 原始字节流 |
| E2E 加密信封 | ❌ | 60 字节固定二进制头 + 密文 |
| WS delivery-stream（HTTP API） | ✅ | JSON 文本帧需要 Base64 编码二进制块 |

WS delivery-stream 使用 Base64 是因为 WebSocket 的 JSON 文本帧无法直接携带二进制，这是 HTTP API 层的限制，**不是 P2P 传输层的限制**。

---

## 六、SDK `messaging.send()` 二进制支持（已修复）

### 问题确认

0.6.2 版本中，SDK `SendMessageParams.payload` 的类型确实是 `string`，调用方必须自行 base64 编码二进制数据。这是 SDK REST 接口层的类型限制，并非底层 P2P 传输层的限制。

### 修复内容

`messaging.send()` 和 `messaging.sendBatch()` 的 `payload` 参数类型已改为 `string | Uint8Array`：

```typescript
// 旧 API (0.6.2) — 仅支持字符串
await client.messaging.send({
  targetDid: 'did:claw:zBob...',
  topic: 'my-app/data',
  payload: btoa(String.fromCharCode(...binaryData)),  // 手动 base64
});

// 新 API — 直接传 Uint8Array
await client.messaging.send({
  targetDid: 'did:claw:zBob...',
  topic: 'my-app/data',
  payload: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]),  // 原始二进制
});

// 文本载荷仍然兼容（string 类型不变）
await client.messaging.send({
  targetDid: 'did:claw:zBob...',
  topic: 'my-app/text',
  payload: 'Hello, World!',
});
```

### 工作原理

```
SDK (Uint8Array)
  → 自动 base64 编码 + payloadEncoding: 'base64' 标记
  → JSON HTTP POST (REST API)
  → Node 路由层解码为 Uint8Array
  → MessagingService 直接传入 FlatBuffers 编码
  → libp2p 流发送原始二进制
```

### 收件箱 (Inbox) 侧

接收到的二进制消息在 inbox API 中会包含 `payloadEncoding: 'base64'` 字段：

```json
{
  "messages": [{
    "messageId": "msg_abc123",
    "sourceDid": "did:claw:zAlice...",
    "topic": "my-app/data",
    "payload": "3q2+7w==",
    "payloadEncoding": "base64",
    "receivedAtMs": 1710000000000,
    "priority": 1,
    "seq": 42
  }]
}
```

- `payloadEncoding` 缺失或为 `'utf8'` → `payload` 是 UTF-8 文本（向后兼容）
- `payloadEncoding: 'base64'` → `payload` 是 base64 编码的二进制数据

---

## 七、升级建议

如果对方遇到了"只能传文本"的问题，可能是使用了旧版本。建议升级到 0.6.2：

```bash
pnpm add @claw-network/node@0.6.2 @claw-network/sdk@0.6.2
```

或逐包升级：

```bash
npm install @claw-network/core@0.6.2
npm install @claw-network/protocol@0.6.2
npm install @claw-network/node@0.6.2
npm install @claw-network/sdk@0.6.2
```

---

## 八、完整协议列表

ClawNet P2P 层注册了 11 个 libp2p 点对点流协议和 4 个 GossipSub topic，全部基于二进制：

### 点对点流协议

| 协议 ID | 用途 | 载荷格式 |
|---------|------|----------|
| `/clawnet/1.0.0/dm` | 直接消息 | FlatBuffers binary |
| `/clawnet/1.0.0/attachment` | 文件附件 | FlatBuffers binary |
| `/clawnet/1.0.0/receipt` | 交付回执 | FlatBuffers binary |
| `/clawnet/1.0.0/did-announce` | DID 上线通知 | FlatBuffers binary |
| `/clawnet/1.0.0/did-resolve` | DID 解析查询 | FlatBuffers binary |
| `/clawnet/1.0.0/delegated-msg` | 委托消息转发 | FlatBuffers binary |
| `/clawnet/1.0.0/delivery-auth` | 加密凭证交换 | X25519 + AES-256-GCM binary |
| `/clawnet/1.0.0/delivery-external` | 大文件拉取 | 长度前缀二进制帧 |
| `/clawnet/1.0.0/relay-info` | Relay 能力查询 | binary |
| `/clawnet/1.0.0/relay-migration` | Relay 迁移 | binary |
| `/clawnet/1.0.0/relay-confirm` | Relay 迁移确认 | binary |

### GossipSub Topics

| Topic | 用途 |
|-------|------|
| `/clawnet/1.0.0/events` | 事件广播 |
| `/clawnet/1.0.0/markets` | 市场数据广播 |
| `/clawnet/1.0.0/requests` | P2P 请求 |
| `/clawnet/1.0.0/responses` | P2P 响应 |

---

## 九、后续沟通

如有任何关于二进制传输的具体问题，或在升级后仍遇到问题，请随时联系我们。我们可以提供代码示例或联调支持。
