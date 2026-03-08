# ClawNet 团队协作请求：P2P Binary 消息支持 / 附件中继 API

| 字段 | 值 |
| --- | --- |
| 优先级 | **P1 — 跨节点图片传输功能性缺陷** |
| 提出方 | TelagentNode 团队 |
| 提出日期 | 2026-03-08 |
| 影响范围 | 所有跨节点附件（图片、文件）收发 |
| 当前临时方案 | 客户端用 `nodeUrl` 构造 `downloadUrl`，绕开服务端 bind 地址问题 |

---

## 1. 问题背景

### 1.1 当前图片发送链路

```
Sender                              Sender Node                   Receiver
  │                                      │                            │
  ├─ initAttachmentUpload() ────────────►│                            │
  │◄─ { objectKey, uploadUrl } ──────────┤                            │
  │                                      │                            │
  ├─ completeAttachmentUpload(           │                            │
  │    objectKey, base64(file)           │                            │
  │  ) ──────────────────────────────────►                            │
  │   (file saved to ~/.telagent/data/attachments/ on SENDER's node)  │
  │◄─ { manifestHash } ─────────────────┤                            │
  │                                      │                            │
  ├─ sendEnvelope(                       │                            │
  │    ciphertext = hex(downloadUrl)     │                            │
  │  ) ──────────────────────────────────►── ClawNet relay ──────────►│
  │                                      │                            │
  │                                      │           ┌────────────────┤
  │                                      │           │ decode ciphertext
  │                                      │           │ → downloadUrl
  │                                      │           │   = "https://alex.telagent.org
  │                                      │           │     /api/v1/attachments/<key>"
  │                                      │           │                │
  │                                      │           └─ HTTP GET ─────►（Sender's Node）
  │                                      │                            │  读文件，返回图片
```

### 1.2 当前的根本性局限

**文件只存储在发送方节点上。** 接收方需要能直接通过 HTTP 访问发送方节点才能获取图片。

这在以下场景中完全失效：

| 场景 | 失败原因 |
|------|---------|
| 发送方节点运行在 `localhost:9529` | `downloadUrl = http://localhost:9529/...`，接收方访问的是自己的 localhost，文件不存在 |
| 发送方节点在 NAT 内网 | 接收方无法穿透 NAT 访问发送方 |
| 发送方节点宕机或重启 | 文件可能丢失或服务不可达 |
| 发送方节点 IP 变更 | 历史消息中的 `downloadUrl` 永久失效 |

### 1.3 已有的临时修复

TelagentNode 于 2026-03-08 实施了一个客户端侧修复：`downloadUrl` 改为由 webapp 用户实际连接的 URL（`nodeUrl`）构造，而非使用服务端计算的基于 bind 地址的 URL。

```typescript
// packages/webapp/src/hooks/use-message-sender.ts
const downloadUrl =
  `${nodeUrl.replace(/\/$/, "")}/api/v1/attachments/${encodeURIComponent(objectKey)}`
```

这解决了"服务端用 `127.0.0.1` 作为 bind 地址导致 `downloadUrl` 错误"的问题，但**架构性局限依然存在**：文件仍只在发送方节点上，接收方仍依赖直接 HTTP 可达性。

---

## 2. 期望 ClawNet 提供的能力

### 方案 A（推荐）：P2P Binary 消息 / 附件中继

在 ClawNet 的 P2P 传输层中增加对二进制 payload 的支持，并提供附件中继 API，流程如下：

```
Sender Node                    ClawNet Network               Receiver Node
    │                                │                              │
    ├─ publishAttachment(            │                              │
    │    targetDid,                  │                              │
    │    binaryData,                 │                              │
    │    contentType                 │                              │
    │  ) ────────────────────────────►── P2P relay ───────────────►│
    │                                │                              │ store to
    │                                │                              │ ~/.telagent/data/
    │                                │                              │   attachments/
    │◄─ { attachmentId } ───────────┤                              │
    │                                                               │
    └─ sendEnvelope(                                                │
         ciphertext = hex("local:" + attachmentId)                  │
       ) ─────────────────────────────────────────────────────────►│
                                                                    │
                                                  downloadUrl = "http://localhost:9529
                                                    /api/v1/attachments/<attachmentId>"
                                                  （始终可用，无需跨节点 HTTP）
```

**核心价值：**
- 文件存储在接收方本地 → `downloadUrl` 始终是 `http://localhost:...`，永远可用
- 发送方节点下线后历史图片依然可查
- 完全消除跨节点 HTTP 依赖

### 方案 B（最小化）：附件 Chunk 中继 API

如果全量 P2P Binary 实现周期较长，可以先提供一个 chunk 中继接口：

```
ClawNet 新增协议：/clawnet/1.0.0/attachment-chunk

请求体（发送方 Node → ClawNet → 接收方 Node）：
{
  "attachmentId": "sha256:abc...",
  "chunkIndex": 0,
  "totalChunks": 3,
  "contentType": "image/png",
  "data": "<base64 encoded chunk>"
}
```

TelagentNode 在接收端组装 chunk，完成后存入本地磁盘。接口对 ClawNet 透明（只做路由，不解析 payload）。

---

## 3. TelagentNode 侧配套工作

ClawNet 提供上述任一 API 后，TelagentNode 将同步完成以下工作：

| 工作项 | 说明 |
|--------|------|
| `AttachmentService.receiveAttachment()` | 接收方接收并存储附件 |
| `ClawNetTransportService` 扩展 | 处理 `/clawnet/1.0.0/attachment-chunk` 协议 |
| `completeAttachmentUpload` 路由扩展 | 触发 P2P 附件发布 |
| `use-message-sender.ts` | `downloadUrl` 改为 `http://localhost:9529/...` |

---

## 4. 当前状态与优先级建议

目前两个公网节点（`alex.telagent.org`、`bess.telagent.org`）已通过临时修复正常收发图片，因为它们都有公网域名，HTTP 直连可行。

**但以下场景仍受阻**，建议 ClawNet 团队将此列为 P1 规划：

1. 本地开发环境中两个节点互发图片（两台机器各运行本地节点）
2. NAT 后的节点互发图片
3. 移动客户端未来接入时

---

## 5. 接口建议草案

```typescript
// ClawNet SDK 期望新增的方法（草案，供参考，以实际设计为准）

interface ClawNetGatewayService {
  /**
   * 将附件数据通过 P2P 网络中继到目标节点，存储到目标节点本地。
   * 返回接收方可用的本地 attachmentId。
   */
  relayAttachment(params: {
    targetDid: string;
    data: Buffer;
    contentType: string;
    attachmentId?: string;   // 可选，调用方可提供确定性 ID（如 sha256 hex）
  }): Promise<{ attachmentId: string }>;
}
```

---

## 6. 联系人

| 角色 | 说明 |
|------|------|
| TelagentNode 接口对接 | 参见 `packages/node/src/services/clawnet-transport-service.ts` |
| 当前附件实现 | `packages/node/src/services/attachment-service.ts` |
| 当前临时修复 | `packages/webapp/src/hooks/use-message-sender.ts` L260–270 |
| 相关设计文档 | `docs/design/clawnet-deep-integration-rfc.md` |
