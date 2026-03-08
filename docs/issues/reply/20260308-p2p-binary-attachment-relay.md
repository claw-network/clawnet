# P2P Binary 附件中继功能实现回复

> **回复方**: ClawNet 团队
> **接收方**: TelagentNode 团队
> **日期**: 2026-03-08
> **关联文档**: `docs/issues/clawnet-p2p-binary-attachment-relay.md`
> **涉及包**: `@claw-network/protocol`, `@claw-network/core`, `@claw-network/node`, `@claw-network/sdk`

---

## 状态：方案 A 已实现 ✅

采纳文档推荐的 **方案 A（P2P Binary 附件中继）**，已完成全链路实现：协议编解码 → P2P 流协议 → 服务层 → REST API → SDK 方法。编译通过，全部测试通过。

---

## 实现概览

### 新增 P2P 流协议

```
协议 ID:  /clawnet/1.0.0/attachment
序列化:   FlatBuffers（手写 codec，与现有消息协议一致）
最大负载: 10 MB
流超时:   30 秒
```

### 数据流（与需求文档 §2 方案 A 一致）

```
Sender Node                    ClawNet P2P                   Receiver Node
    │                                │                              │
    ├─ POST /relay-attachment        │                              │
    │    { targetDid, data(base64),  │                              │
    │      contentType, fileName? }  │                              │
    │                                │                              │
    │── FlatBuffers encode ──────────►── libp2p stream ───────────►│
    │   AttachmentMessage {          │   /clawnet/1.0.0/attachment  │ FlatBuffers decode
    │     attachmentId (sha256),     │                              │ → 存储到磁盘
    │     sourceDid, targetDid,      │                              │   <dataDir>/attachments/
    │     contentType, fileName,     │                              │ → 元数据写入 SQLite
    │     data (raw bytes),          │                              │
    │     totalSize, sentAtMs        │                              │
    │   }                            │                              │
    │                                │                              │
    │◄─ { attachmentId, delivered }──┤                              │
    │                                                               │
    │   (TelagentNode 接下来可用)                                     │
    │   sendEnvelope(                                               │
    │     ciphertext = hex("local:" + attachmentId)                 │
    │   ) ──────────────────────────────────────────────────────────►│
    │                                                               │
    │                                     downloadUrl = "http://localhost:9529
    │                                       /api/v1/attachments/<attachmentId>"
    │                                     （始终可用，无需跨节点 HTTP）
```

---

## 新增 REST API 端点

所有端点挂载在 `/api/v1/messaging/` 下，需 `X-Api-Key` 或 `Authorization: Bearer` 认证。

### 1. `POST /api/v1/messaging/relay-attachment`

通过 P2P 将附件中继到目标节点。

**请求体**：

```json
{
  "targetDid": "did:claw:z...",
  "data": "<base64 编码的二进制数据>",
  "contentType": "image/png",
  "fileName": "photo.png",
  "attachmentId": "sha256:abc..."
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `targetDid` | ✅ | 接收方 DID（`did:claw:z...`） |
| `data` | ✅ | Base64 编码的附件数据（上限 10 MB 原始数据） |
| `contentType` | ✅ | MIME 类型（`image/png`, `application/pdf` 等） |
| `fileName` | 可选 | 原始文件名 |
| `attachmentId` | 可选 | 调用方提供的确定性 ID；缺省时使用 `sha256(data)` 的 hex |

**成功响应** `201 Created`：

```json
{
  "data": {
    "attachmentId": "e3b0c44298fc1c149afbf4c8996fb924...",
    "delivered": true
  },
  "links": { "self": "/api/v1/messaging/attachments" }
}
```

| `delivered` 值 | 含义 |
|----------------|------|
| `true` | 附件已成功通过 P2P 传输并存储到接收方节点 |
| `false` | 接收方节点不在线，无法投递（**附件不做 outbox 排队**，因二进制数据过大） |

**错误响应**：

| HTTP 状态码 | 场景 |
|-------------|------|
| 400 | 缺少必填字段、DID 格式不合法、base64 无效、数据为空、附件超 10 MB |
| 429 | 频率限制 |
| 500 | 内部错误 |

### 2. `GET /api/v1/messaging/attachments`

列出本节点已接收的附件元数据。

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | number | 返回数量上限（1–500，默认全部） |
| `since` | number | 仅返回此时间戳（ms epoch）之后接收的附件 |

**响应** `200 OK`：

```json
{
  "data": {
    "attachments": [
      {
        "attachmentId": "e3b0c44298fc1c...",
        "sourceDid": "did:claw:zSender...",
        "contentType": "image/png",
        "fileName": "photo.png",
        "totalSize": 102400,
        "receivedAtMs": 1741392000000
      }
    ]
  }
}
```

### 3. `GET /api/v1/messaging/attachments/:id`

下载指定附件的原始二进制数据。

**成功响应** `200 OK`：
- `Content-Type`: 附件的 MIME 类型
- `Content-Length`: 数据字节数
- `Content-Disposition`: `inline; filename="<fileName>"`（如有文件名）
- Body: 原始二进制数据

**错误响应**：`404` 附件不存在

### 4. `DELETE /api/v1/messaging/attachments/:id`

删除指定附件（文件 + 元数据）。

**成功响应**：`204 No Content`
**错误响应**：`404` 附件不存在

---

## SDK 新增方法

`@claw-network/sdk` 的 `MessagingApi` 类新增以下方法：

```typescript
import { ClawNetClient } from '@claw-network/sdk';

const client = new ClawNetClient({ baseUrl: 'http://localhost:9528', apiKey: '...' });

// 1. 中继附件到目标节点
const result = await client.messaging.relayAttachment({
  targetDid: 'did:claw:zReceiver...',
  data: Buffer.from(imageBytes).toString('base64'),
  contentType: 'image/png',
  fileName: 'photo.png',
  // attachmentId: 可选，缺省自动 sha256
});
// result = { attachmentId: "e3b0c44...", delivered: true }

// 2. 列出已接收的附件
const list = await client.messaging.listAttachments({ limit: 20 });
// list = { attachments: [{ attachmentId, sourceDid, contentType, ... }] }

// 3. 下载附件（返回 ArrayBuffer）
const data = await client.messaging.getAttachment('e3b0c44...');

// 4. 删除附件
await client.messaging.deleteAttachment('e3b0c44...');
```

### TypeScript 类型导出

```typescript
import type {
  RelayAttachmentParams,
  RelayAttachmentResult,
  AttachmentInfo,
  AttachmentListResponse,
} from '@claw-network/sdk';
```

---

## 接收方事件通知

接收方节点收到附件后，会以普通消息格式写入 inbox（topic 为 `_attachment`），TelagentNode 可通过已有的 inbox 轮询或 subscriber 机制获知新附件到达：

```json
{
  "topic": "_attachment",
  "payload": "{\"attachmentId\":\"e3b0c44...\",\"sourceDid\":\"did:claw:z...\",\"contentType\":\"image/png\",\"fileName\":\"photo.png\",\"totalSize\":102400}"
}
```

TelagentNode 收到此消息后，可直接用 `http://localhost:9529/api/v1/attachments/<attachmentId>` 或 ClawNet SDK 的 `getAttachment()` 获取文件数据。

---

## 存储机制

| 存储 | 位置 | 说明 |
|------|------|------|
| 附件文件 | `<dataDir>/attachments/<attachmentId>.<ext>` | 按 MIME 类型推断扩展名 |
| 元数据 | SQLite `attachments` 表 | `attachment_id`, `source_did`, `content_type`, `file_name`, `stored_file`, `total_size`, `received_at_ms` |

扩展名映射：`image/png` → `.png`、`image/jpeg` → `.jpg`、`image/gif` → `.gif`、`image/webp` → `.webp`、`application/pdf` → `.pdf`、其他 → `.bin`

---

## 设计决策与限制

| 决策 | 说明 |
|------|------|
| 最大附件 10 MB | 单次 P2P 流传输，FlatBuffers 编码。超大文件需求可后续按方案 B（chunk）扩展 |
| 不做 outbox 排队 | 与文本消息不同，二进制数据不写入发送方 outbox。接收方不在线时 `delivered: false`，由调用方决定重试策略 |
| `attachmentId` 默认 sha256 | 调用方可传入自定义 ID（如 `sha256:abc...`），缺省则取 `sha256(data).hex()` |
| P2P DID 解析 | 复用已有 DID → PeerId 映射机制，含 stale mapping 重解析 |
| 流超时 30 秒 | 防止慢速传输占用连接，10 MB @ 30s ≈ 333 KB/s 最低速 |

---

## 验证结果

| 检查项 | 结果 |
|--------|------|
| `pnpm build`（全包） | ✅ 9 个包编译通过 |
| `pnpm --filter @claw-network/protocol test` | ✅ 105 测试通过（15 文件），含 4 个新增 AttachmentMessage 编解码测试 |
| `pnpm --filter @claw-network/node test` | ✅ 227 测试通过（24 文件），含 10 个新增附件 API 测试 |

### 新增测试覆盖

**协议层** (`packages/protocol/test/messaging-codec.test.ts`)：
- AttachmentMessage round-trip（全字段）
- 空文件名场景
- 大文件（1 MB）编解码
- 各种 contentType

**API 层** (`packages/node/test/messaging-api.test.ts`)：
- `POST /relay-attachment` 成功
- 缺少 `targetDid` / 无效 DID / 缺少 `data` / 缺少 `contentType`
- `GET /attachments` 列表查询
- `GET /attachments/:id` 下载成功 + 404
- `DELETE /attachments/:id` 删除成功 + 404

---

## 变更文件清单

| 文件 | 变更内容 |
|------|---------|
| `packages/protocol/src/messaging/types.ts` | 新增 `AttachmentMessage` 接口 |
| `packages/protocol/src/messaging/flatbuffers.ts` | 新增 `encodeAttachmentMessage()` / `decodeAttachmentMessage()` |
| `packages/protocol/src/messaging/codec.ts` | 新增 `encodeAttachmentMessageBytes()` / `decodeAttachmentMessageBytes()` |
| `packages/core/src/p2p/topics.ts` | 新增 `PROTOCOL_ATTACHMENT = '/clawnet/1.0.0/attachment'` |
| `packages/node/src/services/messaging-service.ts` | 新增 `relayAttachment()`, `getAttachment()`, `listAttachments()`, `deleteAttachment()`, P2P 入站处理, inbox 通知 |
| `packages/node/src/services/message-store.ts` | 新增 `attachments` 表 + CRUD 方法 |
| `packages/node/src/index.ts` | `MessagingService` 构造传入 `dataDir` |
| `packages/node/src/api/routes/messaging.ts` | 新增 4 个 REST 端点 |
| `packages/sdk/src/messaging.ts` | 新增 4 个 SDK 方法 + 类型 |
| `packages/sdk/src/http.ts` | 新增 `getRaw()` 二进制下载方法 |
| `packages/sdk/src/index.ts` | 新增类型导出 |
| `packages/protocol/test/messaging-codec.test.ts` | 新增 4 个编解码测试 |
| `packages/node/test/messaging-api.test.ts` | 新增 10 个 API 测试 |

---

## TelagentNode 侧对接指南

### 1. 发送附件（发送方 TelagentNode）

在 `completeAttachmentUpload` 路由中，上传完成后调用 ClawNet 附件中继：

```typescript
// ClawNetTransportService 扩展
async relayAttachment(targetDid: string, fileBuffer: Buffer, contentType: string, fileName?: string) {
  const result = await this.clawnetClient.messaging.relayAttachment({
    targetDid,
    data: fileBuffer.toString('base64'),
    contentType,
    fileName,
  });

  if (!result.delivered) {
    // 接收方不在线 — 可选：记录待重试，或通知用户
    this.logger.warn('Attachment relay failed: peer offline', { targetDid });
  }

  return result; // { attachmentId, delivered }
}
```

### 2. 接收附件（接收方 TelagentNode）

**方式 A（推荐）**：通过 inbox 轮询检测 `_attachment` topic 的消息：

```typescript
const inbox = await this.clawnetClient.messaging.inbox({ topic: '_attachment' });
for (const msg of inbox.messages) {
  const info = JSON.parse(msg.payload);
  // info = { attachmentId, sourceDid, contentType, fileName, totalSize }

  // 下载到本地
  const data = await this.clawnetClient.messaging.getAttachment(info.attachmentId);
  // data: ArrayBuffer — 写入 ~/.telagent/data/attachments/

  // 确认消费
  await this.clawnetClient.messaging.ack(msg.messageId);
}
```

**方式 B**：直接 HTTP 获取（与需求文档 §2 的 `downloadUrl` 方案一致）：

```
downloadUrl = "http://localhost:9528/api/v1/messaging/attachments/<attachmentId>"
```

> **注意端口差异**：ClawNet REST API 监听 9528，TelagentNode 的 API 监听 9529。接收方获取附件时应从本地 ClawNet 节点 (9528) 拉取。

### 3. `use-message-sender.ts` 改造

```typescript
// 发送时：
const { attachmentId, delivered } = await clawnetTransport.relayAttachment(
  targetDid, fileBuffer, contentType, fileName
);
// downloadUrl 改为指向接收方本地 ClawNet 节点
const downloadUrl = `local:${attachmentId}`;
// 将 downloadUrl 放入 envelope ciphertext 发送

// 接收时（接收方 webapp）：
if (downloadUrl.startsWith('local:')) {
  const attachmentId = downloadUrl.slice(6);
  const actualUrl = `http://localhost:9528/api/v1/messaging/attachments/${attachmentId}`;
  // 用 actualUrl 获取图片（始终本地可达）
}
```

---

## 后续扩展路径

| 方向 | 说明 |
|------|------|
| 方案 B（chunk 传输） | 对于 >10 MB 的文件，可新增 `/clawnet/1.0.0/attachment-chunk` 协议，分块传输 |
| 离线投递队列 | 当前接收方不在线则投递失败。后续可扩展写入发送方 outbox，上线后自动重投 |
| CLI 命令 | `clawnet messaging relay-attachment --target <did> --file <path>` |
| 端到端加密 | 当前附件明文传输，后续可在传输层加入 session key 加密 |

---

如有疑问或需要调整接口设计，请随时沟通。
