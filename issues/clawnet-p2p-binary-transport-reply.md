# ClawNet P2P 传输层数据类型说明

> **来自**: ClawNet 项目组  
> **日期**: 2026-03-10  
> **回复**: "P2P proxy 传输层只能传文本，不能传原始二进制"  
> **当前版本**: `@claw-network/core@0.6.5`, `@claw-network/protocol@0.6.5`, `@claw-network/node@0.6.5`, `@claw-network/sdk@0.6.5`  
> **npm 状态**: ✅ 已发布

---

## 结论

**ClawNet 全栈支持原始二进制数据**，不存在"只能传文本"的限制。

整个系统设计为 **binary-first**：

- **P2P 传输层**: libp2p 双向字节流 + FlatBuffers 二进制序列化，所有 payload 均为 `Uint8Array`
- **存储层**: SQLite BLOB 列，直接存储原始二进制，无任何编码
- **REST API 层**: 文本消息通过 JSON 接口 (`POST /send`)，二进制消息通过独立的 octet-stream 接口 (`POST /send-binary`)
- **SDK 层**: `send()` 发送文本，`sendBinary()` 发送二进制，**全链路无 base64**

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
- **存储层**: SQLite BLOB 列 + `compressed`/`encrypted` 标志位

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

## 五、全链路零 Base64

**整个消息链路不使用 base64**。文本和二进制通过独立接口分离：

| 层级 | 文本消息 | 二进制消息 |
|------|----------|------------|
| **SDK** | `send()` — JSON body, string payload | `sendBinary()` — octet-stream body, Uint8Array payload |
| **REST API** | `POST /send` — JSON body | `POST /send-binary` — raw body + 元数据 headers |
| **Node 服务层** | `Buffer.from(payload, 'utf-8')` | `new Uint8Array(rawBody)` — 直传 |
| **SQLite 存储** | BLOB 列 | BLOB 列 |
| **P2P 传输** | FlatBuffers `Uint8Array` | FlatBuffers `Uint8Array` |

| 场景 | 是否使用 Base64 | 说明 |
|------|:---:|------|
| libp2p 流（P2P 传输层） | ❌ | 原始 `Uint8Array`，FlatBuffers 二进制 |
| GossipSub pub/sub | ❌ | 原始 `Uint8Array` |
| delivery-external（大文件） | ❌ | 长度前缀 + 原始字节流 |
| E2E 加密信封 | ❌ | 60 字节固定二进制头 + 密文 |
| REST API 发送 | ❌ | 文本用 JSON，二进制用 octet-stream |
| REST API 收件箱 | ❌ | 文本内联，二进制通过独立端点下载原始字节 |
| SQLite 存储 | ❌ | BLOB 列直存原始字节 |
| SDK | ❌ | `send()` 和 `sendBinary()` 分离 |

---

## 六、REST API 接口设计

### 发送消息

**文本消息** — `POST /api/v1/messaging/send`

```bash
curl -X POST http://localhost:9528/api/v1/messaging/send \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{"targetDid":"did:claw:zBob...","topic":"my-app/text","payload":"Hello, World!"}'
```

**二进制消息** — `POST /api/v1/messaging/send-binary`

元数据通过 HTTP headers 传递，body 是原始二进制：

```bash
curl -X POST http://localhost:9528/api/v1/messaging/send-binary \
  -H "Content-Type: application/octet-stream" \
  -H "X-Api-Key: YOUR_KEY" \
  -H "X-Target-Did: did:claw:zBob..." \
  -H "X-Topic: my-app/binary-data" \
  -H "X-Compress: true" \
  --data-binary @my-file.bin
```

**批量文本** — `POST /api/v1/messaging/send/batch`  
**批量二进制** — `POST /api/v1/messaging/send-binary/batch`（DIDs 在 `X-Target-Dids` header）

### 收件箱

**查询消息列表** — `GET /api/v1/messaging/inbox`

```json
{
  "messages": [{
    "messageId": "msg_abc123",
    "sourceDid": "did:claw:zAlice...",
    "topic": "my-app/data",
    "payload": "Hello, World!",
    "payloadSize": 13,
    "compressed": false,
    "encrypted": false,
    "receivedAtMs": 1710000000000,
    "priority": 1,
    "seq": 42
  }]
}
```

- 未压缩 + 未加密的消息：`payload` 字段包含 UTF-8 文本
- 已压缩或已加密的消息：`payload` 字段不存在，仅有 `payloadSize`

**下载原始 payload** — `GET /api/v1/messaging/inbox/:messageId/payload`

返回 `application/octet-stream` 原始字节，响应头包含：
- `Content-Length` — 字节数
- `X-Compressed: 1` — 如果已 gzip 压缩
- `X-Encrypted: 1` — 如果已 E2E 加密

---

## 七、SDK 接口

```typescript
import { ClawNetClient } from '@claw-network/sdk';

const client = new ClawNetClient({ baseUrl: 'http://localhost:9528', apiKey: 'YOUR_KEY' });

// 发送文本消息
await client.messaging.send({
  targetDid: 'did:claw:zBob...',
  topic: 'my-app/text',
  payload: 'Hello, World!',
});

// 发送二进制消息（原始字节，无 base64）
await client.messaging.sendBinary({
  targetDid: 'did:claw:zBob...',
  topic: 'my-app/binary-data',
  payload: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]),
  compress: true,
});

// 批量发送文本
await client.messaging.sendBatch({
  targetDids: ['did:claw:zBob...', 'did:claw:zCharlie...'],
  topic: 'broadcast',
  payload: 'Hello everyone!',
});

// 批量发送二进制
await client.messaging.sendBinaryBatch({
  targetDids: ['did:claw:zBob...', 'did:claw:zCharlie...'],
  topic: 'binary-broadcast',
  payload: new Uint8Array([0x01, 0x02, 0x03]),
});

// 查询收件箱
const { messages } = await client.messaging.inbox({ topic: 'my-app/*' });

// 下载二进制 payload（返回 ArrayBuffer）
const rawBytes = await client.messaging.downloadPayload('msg_abc123');
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
| `/clawnet/1.0.0/delegated-msg` | 委托消息转发 | JSON over stream |
| `/clawnet/1.0.0/delivery-auth` | 加密凭证交换 | X25519 + AES-256-GCM |
| `/clawnet/1.0.0/delivery-external` | 大文件拉取 | 长度前缀二进制帧 |
| `/clawnet/1.0.0/relay-info` | Relay 能力查询 | JSON over stream |
| `/clawnet/1.0.0/relay-migration` | Relay 迁移 | JSON over stream |
| `/clawnet/1.0.0/relay-confirm` | Relay 迁移确认 | JSON over stream |

### GossipSub Topics

| Topic | 用途 |
|-------|------|
| `/clawnet/1.0.0/events` | 事件广播 |
| `/clawnet/1.0.0/markets` | 市场数据广播 |
| `/clawnet/1.0.0/requests` | P2P 请求 |
| `/clawnet/1.0.0/responses` | P2P 响应 |

---

## 九、升级建议

```bash
pnpm add @claw-network/node@0.6.5 @claw-network/sdk@0.6.5
```

或逐包升级：

```bash
npm install @claw-network/core@0.6.5
npm install @claw-network/protocol@0.6.5
npm install @claw-network/node@0.6.5
npm install @claw-network/sdk@0.6.5
```

> **注意**: 0.6.5 是破坏性变更。存储层从 TEXT 改为 BLOB，REST API 移除了 `payloadEncoding` 字段，新增了独立的二进制发送/下载端点。旧版数据库不兼容，需要重新初始化。

---

## 十、后续沟通

如有任何关于二进制传输的具体问题，或在升级后仍遇到问题，请随时联系我们。我们可以提供代码示例或联调支持。
