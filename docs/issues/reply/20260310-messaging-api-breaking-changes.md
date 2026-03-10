# 消息 API 破坏性变更通知（v0.6.5）

> **回复方**: ClawNet 团队  
> **接收方**: TelAgent 项目组  
> **日期**: 2026-03-10  
> **涉及包**: `@claw-network/core@0.6.5`, `@claw-network/protocol@0.6.5`, `@claw-network/node@0.6.5`, `@claw-network/sdk@0.6.5`  
> **npm 状态**: ✅ 已发布  
> **关联文档**: `issues/clawnet-p2p-binary-transport-reply.md`

---

## 概述

`v0.6.5` 对消息系统进行了 **破坏性重构**，核心变更：

1. **全面移除 base64** — 整个消息链路不再使用 base64 编码
2. **文本与二进制接口分离** — REST API 和 SDK 拆分为独立的文本/二进制接口
3. **存储层 TEXT → BLOB** — SQLite payload 列从 TEXT 改为 BLOB，旧数据库不兼容
4. **移除 `payloadEncoding` 字段** — 不再存在编码声明，二进制就是二进制

> ⚠️ **这是破坏性变更**。升级后旧消息数据库不兼容，需要重新初始化。所有向后兼容和迁移代码已移除。

---

## 一、REST API 变更

### 已移除

| 变更 | 说明 |
|------|------|
| `payloadEncoding` 字段 | 发送和收件箱响应中不再存在此字段 |
| `POST /send` 中的 base64 payload | 不再接受 base64 编码的 payload |

### 发送消息（新接口）

**文本消息** — `POST /api/v1/messaging/send`（JSON body，仅支持字符串 payload）

```bash
curl -X POST http://localhost:9528/api/v1/messaging/send \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: YOUR_KEY" \
  -d '{
    "targetDid": "did:claw:zBob...",
    "topic": "my-app/text",
    "payload": "Hello, World!"
  }'
```

`payload` 字段类型为 `string`，不再接受 base64 编码的二进制。

**二进制消息** — `POST /api/v1/messaging/send-binary`（🆕 新增端点）

```bash
curl -X POST http://localhost:9528/api/v1/messaging/send-binary \
  -H "Content-Type: application/octet-stream" \
  -H "X-Api-Key: YOUR_KEY" \
  -H "X-Target-Did: did:claw:zBob..." \
  -H "X-Topic: my-app/binary-data" \
  -H "X-Compress: true" \
  --data-binary @my-file.bin
```

元数据通过 HTTP headers 传递，body 是原始二进制字节：

| Header | 必填 | 说明 |
|--------|------|------|
| `X-Target-Did` | ✅ | 目标 DID |
| `X-Topic` | ✅ | 消息 topic |
| `X-Compress` | 可选 | 是否 gzip 压缩（`true`/`false`） |
| `X-Encrypt` | 可选 | 是否 E2E 加密（`true`/`false`） |
| `X-Priority` | 可选 | 优先级（整数） |
| `X-Ttl` | 可选 | 过期秒数 |

**批量发送** — 两个端点：

- `POST /api/v1/messaging/send/batch` — 文本批量发送（JSON body）
- `POST /api/v1/messaging/send-binary/batch` — 二进制批量发送（`X-Target-Dids` header，逗号分隔）

### 收件箱变更

**`GET /api/v1/messaging/inbox` 响应格式变更**：

```json
{
  "messages": [{
    "messageId": "msg_abc123",
    "sourceDid": "did:claw:zAlice...",
    "topic": "my-app/text",
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

| 字段变更 | 说明 |
|----------|------|
| `payloadEncoding` | ❌ 已移除 |
| `payload` | 仅在 `compressed: false` 且 `encrypted: false` 时存在（UTF-8 文本） |
| `payloadSize` | 🆕 始终存在，表示原始 payload 字节数 |
| `compressed` | 🆕 是否已 gzip 压缩 |
| `encrypted` | 🆕 是否已 E2E 加密 |

**重要**：已压缩或已加密的消息，`payload` 字段 **不存在**。需通过独立端点下载原始字节。

**`GET /api/v1/messaging/inbox/:messageId/payload`**（🆕 新增端点）

下载单条消息的原始二进制 payload：

```bash
curl -s http://localhost:9528/api/v1/messaging/inbox/msg_abc123/payload \
  -H "X-Api-Key: YOUR_KEY" \
  -o output.bin
```

响应：
- `Content-Type: application/octet-stream`
- `Content-Length` — 字节数
- `X-Compressed: 1` — 如果已压缩
- `X-Encrypted: 1` — 如果已加密

---

## 二、SDK 变更

### 已移除

- `send()` 不再接受 `payloadEncoding` 参数
- `send()` 的 `payload` 不再接受 `Uint8Array`，仅接受 `string`

### 新增方法

```typescript
import { ClawNetClient } from '@claw-network/sdk';

const client = new ClawNetClient({
  baseUrl: 'http://localhost:9528',
  apiKey: 'YOUR_KEY',
});

// ✅ 发送文本（与旧版 send 类似，但 payload 仅 string）
await client.messaging.send({
  targetDid: 'did:claw:zBob...',
  topic: 'my-app/text',
  payload: 'Hello, World!',
});

// ✅ 发送二进制（🆕）
await client.messaging.sendBinary({
  targetDid: 'did:claw:zBob...',
  topic: 'my-app/binary-data',
  payload: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]),
  compress: true,
});

// ✅ 批量发送文本
await client.messaging.sendBatch({
  targetDids: ['did:claw:zBob...', 'did:claw:zCharlie...'],
  topic: 'broadcast',
  payload: 'Hello everyone!',
});

// ✅ 批量发送二进制（🆕）
await client.messaging.sendBinaryBatch({
  targetDids: ['did:claw:zBob...', 'did:claw:zCharlie...'],
  topic: 'binary-broadcast',
  payload: new Uint8Array([0x01, 0x02, 0x03]),
});

// ✅ 下载原始 payload（🆕，返回 ArrayBuffer）
const rawBytes = await client.messaging.downloadPayload('msg_abc123');
```

### InboxMessage 类型变更

```typescript
// v0.6.4 及之前
interface InboxMessage {
  messageId: string;
  payload: string;         // 可能是 base64
  payloadEncoding?: string; // "base64" | "utf-8"
  // ...
}

// v0.6.5（当前）
interface InboxMessage {
  messageId: string;
  payload?: string;        // 仅纯文本消息存在
  payloadSize: number;     // 始终存在
  compressed: boolean;     // 是否已压缩
  encrypted: boolean;      // 是否已加密
  // ...
}
```

---

## 三、存储层变更

| 变更项 | 旧版 | 新版 |
|--------|------|------|
| payload 列类型 | `TEXT`（base64 或 UTF-8） | `BLOB`（原始字节） |
| 编码标记 | `payloadEncoding` 列 | `compressed` + `encrypted` 标志列 |
| 向后兼容 | 自动迁移旧格式 | ❌ 无迁移，旧数据库不兼容 |

> ⚠️ **升级后需删除旧消息数据库并重新初始化**。所有迁移代码已移除。

---

## 四、迁移指南

### 1. 升级依赖

```bash
pnpm add @claw-network/sdk@0.6.5
# 或
npm install @claw-network/sdk@0.6.5
```

如果直接运行节点：

```bash
pnpm add @claw-network/node@0.6.5
```

### 2. 代码迁移

**发送文本消息** — 无需改动（如果之前用的就是纯文本 payload）：

```typescript
// 之前和现在都一样
await client.messaging.send({
  targetDid: 'did:claw:zBob...',
  topic: 'chat',
  payload: '你好',
});
```

**发送二进制数据** — 从 `send()` + base64 迁移到 `sendBinary()`：

```typescript
// ❌ 旧版（base64）
await client.messaging.send({
  targetDid: 'did:claw:zBob...',
  payload: Buffer.from(binaryData).toString('base64'),
  payloadEncoding: 'base64',
});

// ✅ 新版（原始二进制）
await client.messaging.sendBinary({
  targetDid: 'did:claw:zBob...',
  topic: 'binary-data',
  payload: binaryData, // Uint8Array
});
```

**读取收件箱** — 处理新字段：

```typescript
const { messages } = await client.messaging.inbox({ topic: 'my-app/*' });

for (const msg of messages) {
  if (msg.payload !== undefined) {
    // 纯文本消息，直接使用
    console.log('Text:', msg.payload);
  } else {
    // 二进制/压缩/加密消息，需下载原始 payload
    const raw = await client.messaging.downloadPayload(msg.messageId);
    console.log('Binary payload size:', raw.byteLength);
  }
}
```

### 3. REST API 直接调用

如果 TelAgent 直接调用 REST API（非 SDK）：

| 旧调用 | 新调用 |
|--------|--------|
| `POST /send` + base64 payload + `payloadEncoding` | `POST /send-binary` + octet-stream body + metadata headers |
| 收件箱中读取 base64 再解码 | `GET /inbox/:messageId/payload` 直接下载原始字节 |
| 通过 `payloadEncoding` 判断类型 | 通过 `compressed`/`encrypted` 字段 + `payload` 是否存在判断 |

### 4. 数据库重建

升级节点后，删除旧消息数据库：

```bash
# 停止节点
systemctl stop clawnetd

# 备份旧数据（如需要）
cp ~/.clawnet/data/messages.db ~/.clawnet/data/messages.db.bak

# 删除旧数据库（节点重启时自动重建）
rm ~/.clawnet/data/messages.db

# 重启节点
systemctl start clawnetd
```

---

## 五、WebSocket 推送变更

WebSocket 收件箱推送（`ws://localhost:9528/api/v1/messaging/subscribe`）同步变更：

- JSON 帧中 `payload` 字段仅在 `compressed: false` 且 `encrypted: false` 时包含文本
- 不再包含 `payloadEncoding` 字段
- 新增 `payloadSize`、`compressed`、`encrypted` 字段
- 二进制/压缩/加密消息需通过 REST API 的 `GET /inbox/:messageId/payload` 下载原始字节

---

## 六、变更影响范围汇总

| 模块 | 影响 | 迁移复杂度 |
|------|------|:---:|
| `send()` 纯文本 | 无影响（接口不变） | 无 |
| `send()` 发送二进制 | 改用 `sendBinary()` | 低 |
| 收件箱读取 | 新增字段判断 + `downloadPayload()` | 中 |
| WebSocket 推送 | 新字段适配 | 低 |
| REST API 直接调用 | 新端点 + header 传元数据 | 中 |
| 数据库 | 需重建 | 一次性操作 |

---

## 七、后续沟通

如有升级或迁移问题，请随时联系我们。可以安排联调时间或提供更详细的代码示例。
