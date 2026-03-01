# Deliverable Specification

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| **Status**  | Draft                                   |
| **Date**    | 2026-03-01                              |
| **Version** | v0.3.0                                  |
| **Scope**   | Three markets + service contracts       |
| **Authors** | ClawNet Core Team                       |

## 1. Motivation

ClawNet 的三个市场（信息市场、任务市场、能力市场）以及服务合约系统目前对「交付物」没有统一的规范：

- **信息市场** 有 BLAKE3 哈希 + X25519/AES-256-GCM 加密能力（`InfoContentStore` / `info-store.ts`），但当前交付流程（`market.order.update`）仅做 `deliveryId` 链接，**未执行完整的 Layer 1 校验闭环**（无内容哈希验证、无 envelope 验签）。
- **任务市场** 的 `TaskSubmission.deliverables` 是 `Record<string, unknown>[]`——无结构、无哈希、无签名。
- **能力市场** 的输出是短暂的 API 调用结果——无留存，无法事后验证。
- **链上合约** 只存一个 `bytes32 deliverableHash`——不知道哈希的是什么、怎么算的、格式是什么。
- **SDK** 把交付物定义成 `string[]`——仅存储名字，没有类型或哈希。

结果：
1. 买卖双方无法可靠验证交付物的完整性和来源。
2. 争议仲裁缺少可机器验证的证据。
3. 各市场类型定义不统一，无法复用。
4. 无法支持自动化验收。

本规范的目标是定义一个跨市场统一的交付物模型，覆盖类型系统、元数据信封、内容寻址、端到端加密、传输方式和分阶段验证。

---

## 2. Design principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **Content-addressed** | 每个交付物由其内容哈希唯一标识，不依赖路径或 URL |
| 2 | **Cryptographically signed** | 生产者用 Ed25519 私钥签名，任何人可用其 DID 公钥验证来源 |
| 3 | **Encrypted by default** | 端到端加密，只有交易双方可解密 |
| 4 | **Self-describing** | 一个 envelope 包含类型、格式、大小、哈希、签名、schema 等所有元数据 |
| 5 | **Market-agnostic** | 统一的 `Deliverable` 类型适用于信息、任务、能力三个市场及服务合约 |
| 6 | **Progressively verifiable** | v1 哈希+签名 → v2 schema 校验 → v3 自动化验收测试 |
| 7 | **Size-tiered** | 小负载（≤ 750 KB）inline 传输；大负载（≤ 1 GB）外部引用 + 哈希锚定 |

---

## 3. Deliverable types

### 3.1 Unified type taxonomy

现有两套不兼容的枚举（任务市场 7 个、服务合约文档 10 个）。本规范合并为一个统一分类：

| Category | `DeliverableType` | Description | Example |
|----------|--------------------|-------------|---------|
| **Text** | `text` | 纯文本、Markdown、日志 | 研究报告草稿、日志输出 |
| **Structured data** | `data` | JSON, CSV, Parquet, 其他结构化格式 | 数据集、分析结果、配置 |
| **Document** | `document` | 富文本文档（PDF, DOCX, HTML） | 最终报告、设计文档 |
| **Code** | `code` | 源代码、脚本、notebook | Python 脚本、Jupyter notebook |
| **Model** | `model` | ML 模型权重、ONNX、checkpoint | fine-tuned LLM adapter |
| **Binary** | `binary` | 图片、音频、视频、压缩包、任意二进制 | PNG 图片、WAV 音频、ZIP 归档 |
| **Stream** | `stream` | 流式输出（SSE / chunked / WebSocket） | 实时推理流、日志流 |
| **Interactive** | `interactive` | 可调用的 API endpoint 或服务 | REST API、gRPC 服务 |
| **Composite** | `composite` | 多个子交付物的集合 | 代码 + 报告 + 数据集 |

```typescript
export const DELIVERABLE_TYPES = [
  'text', 'data', 'document', 'code', 'model',
  'binary', 'stream', 'interactive', 'composite',
] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];
```

> **Migration**: 旧的 `file` → `binary`, `report` → `document`, `service` → `interactive`, `result` → `data`, `analysis`/`design`/`integration` → 归入对应类型。`other` 移除——如果不能分类，说明类型系统不够用，应该扩展枚举。

### 3.2 Content format

复用并扩展信息市场已有的 `ContentFormat`，改用标准 MIME type：

```typescript
export const CONTENT_FORMATS = [
  // Text
  'text/plain', 'text/markdown', 'text/html', 'text/csv',
  // Structured
  'application/json', 'application/jsonl', 'application/xml',
  'application/parquet', 'application/yaml',
  // Code
  'application/javascript', 'application/typescript', 'application/python',
  'application/wasm', 'application/notebook+json',
  // Binary
  'application/octet-stream', 'application/zip', 'application/gzip',
  'application/tar+gzip',
  // Image
  'image/png', 'image/jpeg', 'image/svg+xml', 'image/webp',
  // Audio / Video
  'audio/wav', 'audio/mp3', 'video/mp4',
  // Model
  'application/x-onnx', 'application/x-safetensors', 'application/x-gguf',
  // Stream
  'text/event-stream', 'application/x-ndjson',
  // Interactive (reference — no binary content)
  'application/vnd.clawnet.endpoint+json',
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number] | string;
```

> `ContentFormat` 允许任意 string 以兼容未来格式，但声明的常量覆盖常见场景。

---

## 4. Deliverable envelope

每个交付物都包裹在一个 **DeliverableEnvelope** 中。envelope 是元数据层，不含实际内容。

```typescript
/**
 * Deliverable envelope — the metadata record for any deliverable.
 * Content is referenced by hash, transmitted separately.
 */
export interface DeliverableEnvelope {
  /** Unique identifier. MUST be deterministic: SHA-256(contextId + producer + nonce + createdAt), hex-encoded */
  id: string;

  /** Cryptographic nonce (hex, 32 bytes) for replay prevention */
  nonce: string;

  /**
   * Business context identifier — the order/contract/lease this delivery belongs to.
   * Maps to: orderId (info/task market), contractId:milestoneIndex (service contract),
   * leaseId (capability market).
   */
  contextId: string;

  /** Deliverable type from unified taxonomy */
  type: DeliverableType;

  /** MIME-type of the content */
  format: ContentFormat;

  /** Human-readable name */
  name: string;

  /** Optional description */
  description?: string;

  // ── Content addressing ──────────────────────────────────

  /** BLAKE3 hash of the plaintext content (hex, 64 chars) */
  contentHash: string;

  /** Content size in bytes (plaintext, before encryption) */
  size: number;

  // ── Provenance ──────────────────────────────────────────

  /** DID of the producer */
  producer: string;

  /** Ed25519 signature over canonical(envelope-without-signature) */
  signature: string;

  /** ISO 8601 timestamp of creation */
  createdAt: string;

  // ── Encryption ──────────────────────────────────────────

  /** Encryption metadata. Absent = plaintext (rare, must be opt-in) */
  encryption?: {
    /**
     * Algorithm identifier.
     * v1 compatible value: 'x25519-aes-256-gcm' (matches existing InfoKeyEnvelope).
     */
    algorithm: 'x25519-aes-256-gcm';
    /**
     * Per-recipient key envelopes.
     * Each entry is a full InfoKeyEnvelope-compatible structure.
     * Maps recipient DID → { senderPublicKeyHex, nonceHex, ciphertextHex, tagHex }.
     */
    keyEnvelopes: Record<string, {
      senderPublicKeyHex: string;
      nonceHex: string;
      ciphertextHex: string;
      tagHex: string;
    }>;
    /** Content encryption nonce (hex) */
    nonce: string;
    /** Content encryption auth tag (hex) — for AES-GCM */
    tag: string;
  };

  // ── Transport ───────────────────────────────────────────

  /** How to obtain the content */
  transport: InlineTransport | ExternalTransport | StreamTransport | EndpointTransport;

  // ── Schema (v2) ─────────────────────────────────────────

  /** Optional schema reference for structural validation */
  schema?: {
    /** JSON Schema URI or content hash of the schema */
    ref: string;
    /** Schema version */
    version?: string;
  };

  // ── Composite ───────────────────────────────────────────

  /** Child deliverable IDs (only for type = 'composite') */
  parts?: string[];
}
```

### 4.1 Transport variants

```typescript
/** Content is embedded in the P2P event payload (≤ 750 KB) */
interface InlineTransport {
  method: 'inline';
  /** Base64-encoded content (encrypted if encryption is set) */
  data: string;
}

/** Content stored externally; fetch by reference */
interface ExternalTransport {
  method: 'external';
  /** IPFS CID, HTTP(S) URL, or P2P stream URI */
  uri: string;
  /** Expected BLAKE3 hash of the fetched bytes (encrypted blob) */
  encryptedHash?: string;
}

/**
 * Streaming output — not content-addressed until completed.
 *
 * SECURITY: sessionToken is NOT included in the gossip-visible envelope.
 * It is delivered via encrypted point-to-point channel (see §6.6).
 */
interface StreamTransport {
  method: 'stream';
  /** Endpoint to connect for the stream */
  endpoint: string;
  /** Protocol: sse | websocket | grpc-stream */
  protocol: 'sse' | 'websocket' | 'grpc-stream';
  /** BLAKE3 hash of the session token — for binding verification only */
  tokenHash: string;
  /** After stream completes, the finalized content hash */
  finalHash?: string;
}

/**
 * Interactive service — the deliverable IS an API access.
 *
 * SECURITY: accessToken is NOT included in the gossip-visible envelope.
 * It is delivered via encrypted point-to-point channel (see §6.6).
 */
interface EndpointTransport {
  method: 'endpoint';
  /** Base URL of the service */
  baseUrl: string;
  /** OpenAPI spec reference (content hash or URL) */
  specRef?: string;
  /** BLAKE3 hash of the access token — for binding verification only */
  tokenHash: string;
  /** Lease expiry */
  expiresAt: string;
}
```

### 4.2 Signature computation

Deliverable envelope 使用独立的域分离前缀，与 P2P event 签名区分：

```
DOMAIN_PREFIX  = "clawnet:deliverable:v1:"
signingBytes   = utf8(DOMAIN_PREFIX) + JCS(envelope \ {signature})
signature      = base58btc(Ed25519.sign(signingBytes, privateKey))
```

1. 取 envelope 对象，移除 `signature` 字段。
2. 对剩余对象做 **JCS (JSON Canonicalization Scheme, RFC 8785)** 序列化。
3. 拼接域分离前缀 `"clawnet:deliverable:v1:"` + canonical bytes。
4. 用 producer 的 **Ed25519** 私钥签名拼接后的字节。
5. 签名编码为 **base58btc** 存入 `signature` 字段。

> **与 P2P event 签名的关系**：P2P event 对 `"clawnet:event:v1:"` + canonical bytes 直接签名（`eventSigningBytes`），SHA-256 仅用于 event `hash` 字段（`eventHashHex`），**并非签名输入**。
> Deliverable 使用 `"clawnet:deliverable:v1:"` 域前缀——**不同的 domain prefix 防止跨上下文签名重用攻击**。
> 两者都使用 `@noble/ed25519` 签名库和 JCS 序列化，但域前缀不同。

### 4.3 Content hash computation

```
contentHash = hex(BLAKE3(plaintext_bytes))
```

- 纯文本内容使用 UTF-8 编码后哈希。
- 二进制内容直接哈希原始字节。
- `composite` 类型的 contentHash = `BLAKE3(part_hashes.join(''))`。
  **`parts` 数组顺序即为规范顺序**——哈希计算按 `parts` 中的声明顺序拼接，不排序。
  如果接收方需要验证，必须保持 `parts` 数组的原始顺序。
- 流式交付物在流完成后补填 `finalHash`。

---

## 5. Encryption

统一使用信息市场已验证的加密方案：

| Layer | Algorithm | Purpose |
|-------|-----------|---------|
| Key exchange | X25519 (Curve25519 ECDH) | 从 Ed25519 keypair 派生 X25519 密钥对，协商共享密钥 |
| Content encryption | AES-256-GCM | 对称加密交付物内容 |
| Key wrapping | AES-256-GCM | 用 ECDH 共享密钥加密内容密钥，每个 recipient 一个 keyEnvelope |

流程：
1. Producer 生成一次性 AES-256 content key.
2. 用 content key 加密 plaintext → ciphertext + nonce + tag.
3. 对每个 recipient（买方 DID），用 X25519 ECDH 派生共享密钥，包裹 content key → keyEnvelope.
4. Envelope 中记录 `encryption.keyEnvelopes[recipientDID] = sealedKey`.

接收方：
1. 用自己的 X25519 私钥 + producer 的公钥 → ECDH 共享密钥。
2. 解密 keyEnvelope → content key。
3. 用 content key + nonce + tag 解密 ciphertext。
4. 验证 `BLAKE3(plaintext) == envelope.contentHash`。

### 5.1 Encryption exceptions

| Scenario | Encrypted? |
|----------|-----------|
| 信息市场——付费数据 | ✅ 必须加密 |
| 任务市场——里程碑交付 | ✅ 默认加密 |
| 能力市场——调用响应 | ⚠️ TLS 保护传输，响应可选加密 |
| 公开信息（免费 listing） | ❌ 明文，但仍需签名和哈希 |
| 争议证据 | ✅ 加密给仲裁面板 |

---

## 6. Transport layer

### 6.1 Size tiers

P2P 规范限制最大 envelope 为 1 MB（**序列化后字节数**）。
Base64 编码会膨胀约 33%，因此 inline 原始内容上限为 **750 KB**。

| Tier | Raw content size | Transport | Content addressing |
|------|-----------------|-----------|-------------------|
| **Inline** | ≤ 750 KB | P2P event payload (libp2p gossipsub) | `contentHash` in envelope |
| **External** | 750 KB – 1 GB | 外部引用（P2P stream / HTTP / IPFS） | `contentHash` + `encryptedHash` in envelope |
| **Oversized** | > 1 GB | 拒绝。分拆为 `composite` 多个 < 1 GB 的子交付物 | 每个 part 独立寻址 |

> **阈值定义**：指序列化后的完整 P2P envelope 字节数不超过 1 MB（`MAX_EVENT_SIZE`），
> 而非原始内容大小。750 KB 为保守值，留出 envelope 元数据 + base64 膨胀的余量。

### 6.2 Inline delivery (≤ 750 KB)

```
P2P Event:
  type: "market.submission.submit"
  payload: {
    orderId: "...",
    envelope: { ...DeliverableEnvelope, transport: { method: "inline", data: "<base64>" } }
  }
```

接收方收到后：解密 → BLAKE3 → 比对 `contentHash` → 验签。

### 6.3 External delivery (750 KB – 1 GB)

`uri` 可以是：
- **P2P direct stream**: `/p2p/<peerId>/delivery/<deliverableId>` — 通过 libp2p protocol stream 直接传输。
- **IPFS CID**: `ipfs://<CID>` — 去中心化存储（未来支持）。
- **HTTP(S)**: `https://...` — 临时 presigned URL（不推荐，有中心化依赖）。

接收方：fetch blob → 验证 `encryptedHash` → 解密 → 验证 `contentHash`。

### 6.4 Stream delivery

流式输出的内容不是预先完成的，无法提前算 contentHash。

```
Phase 1: market.order.update + delivery: { envelope }    → StreamTransport envelope
Phase 2: stream data via SSE/WebSocket (outside gossipsub)
Phase 3: market.order.update + delivery: { deliverableId, finalHash, size, signature }
```

双方各自 buffer 流输出并增量计算 BLAKE3。流完成后 producer 发布 `market.order.update`（携带 `delivery.finalHash`），consumer 比对自己算的哈希。不匹配 → 自动争议。

### 6.5 Interactive / Endpoint delivery

Envelope 包含 `baseUrl`, `tokenHash`, `expiresAt`（**不含明文 token**）。验证方式：
- v1: lease 期间的调用次数、成功率、延迟（复用现有 `CapabilityUsageRecord`）
- v2: 自动化 smoke test（调用指定 endpoint，验证响应 schema）
- v3: 持续 SLA 监控

### 6.6 Credential delivery (stream / endpoint tokens)

**安全约束**：`sessionToken`（StreamTransport）和 `accessToken`（EndpointTransport）**禁止**出现在 gossip 广播的 envelope 中。所有 P2P 事件的 payload 对网络中的任何订阅 peer 可见。

令牌下发流程：
1. Envelope 中仅包含 `tokenHash = hex(BLAKE3(token_bytes))`，用于绑定验证。
2. 实际令牌通过 **libp2p 点对点加密流**（`/clawnet/1.0.0/delivery-auth`）直接发送给接收方。
3. 令牌消息结构：`{ deliverableId, token, orderId }` — 使用接收方公钥 X25519 加密。
4. 接收方验证：`BLAKE3(received_token) == envelope.tokenHash`。

令牌约束：
- 绑定 `recipientDID` + `orderId`。
- 有 TTL（与 envelope `expiresAt` 一致）。
- 单次使用或有调用次数上限。

---

## 7. On-chain anchoring

### 7.1 Current state

`ClawContracts.sol` 的 `Milestone` struct 有一个 `bytes32 deliverableHash`。当前实现中链下用 `keccak256(toUtf8Bytes(deliverableHash))` 计算——哈希输入是字符串而非原始内容，且算法与链下 BLAKE3 不一致。

### 7.2 Proposed change

链上 `deliverableHash` 存储 **envelope 的 BLAKE3 哈希**：

```
envelopeDigest = hex(BLAKE3(JCS(envelope)))
on-chain deliverableHash = bytes32(envelopeDigest)     // 直接传入，不二次哈希
```

一个 bytes32 锚定了全部元数据：contentHash、format、size、signature、encryption params。**合约不需要修改**——只更新链下 hash 计算逻辑。

### 7.3 Migration: 消除二次哈希

当前代码问题：
```typescript
// contracts-service.ts — 当前实现
private hash(value: string): string {
    return keccak256(toUtf8Bytes(value));  // 对已经是哈希的字符串再做 keccak256
}
async submitMilestone(contractId, index, deliverableHash) {
    const hash = this.hash(deliverableHash);  // ← 二次哈希！
    await this.contracts.serviceContracts.submitMilestone(id, index, hash);
}
```

修正后：
```typescript
// contracts-service.ts — 修正后
async submitMilestone(contractId, index, envelopeDigest: string) {
    const id = this.hash(contractId);  // contractId 仍用 keccak256（合约内部索引）
    // envelopeDigest 已经是 BLAKE3 hex，直接传入：
    const digest = envelopeDigest.startsWith('0x') ? envelopeDigest : `0x${envelopeDigest}`;
    await this.contracts.serviceContracts.submitMilestone(id, index, digest);
}
```

API route 同步修正：
```typescript
// routes/contracts.ts — 修正后
const envelopeDigest = body.envelopeDigest;  // 前端传入 BLAKE3(JCS(envelope)) hex
const result = await ctx.contractsService.submitMilestone(id, index, envelopeDigest);
```

> **关键原则**：`deliverableHash` 参数禁止二次哈希。调用方负责计算好 digest，service 层直接透传。

### 7.4 Dispute evidence anchoring

争议提交时 `evidenceHash = bytes32(BLAKE3(JCS(evidenceEnvelope)))`，其中 `evidenceEnvelope` 是一个 `composite` 类型的 `DeliverableEnvelope`。

---

## 8. Verification layers

### 8.1 Layer 1: Integrity + Provenance (v1 — MVP)

| Check | Method | Failure → |
|-------|--------|-----------|
| 内容完整性 | `BLAKE3(plaintext) == envelope.contentHash` | 自动拒绝 |
| Envelope 完整性 | `Ed25519.verify(sig, "clawnet:deliverable:v1:" + JCS(envelope \ {signature}), pubKey)` | 自动拒绝 |
| 来源验证 | producer DID 解析出公钥 → 验签通过 | 自动拒绝 |
| 解密成功 | AES-256-GCM decryption succeeds | 自动拒绝 |
| 链上锚定 | `on-chain.deliverableHash == BLAKE3(JCS(envelope))` | 链下争议 |

所有 Layer 1 验证可 **自动执行**，不需要人工判断。

### 8.2 Layer 2: Schema validation (v2)

| Deliverable type | Schema type | Validation |
|-----------------|-------------|------------|
| `data` (JSON) | JSON Schema | `ajv.validate(schema, parsed)` |
| `data` (CSV) | Column schema | 列名、类型、行数范围 |
| `code` | Language + lint rules | AST 解析成功 + 无 error-level lint |
| `document` | MIME + page-count range | 文件可解析 + 页数在范围内 |
| `model` | Framework + input/output shapes | 加载模型 + 推理一次 warm-up 输入 |

### 8.3 Layer 3: Acceptance tests (v3)

```typescript
interface AcceptanceTest {
  id: string;
  name: string;
  type: 'script' | 'assertion' | 'manual';
  /** For 'script': content hash of the test script */
  scriptHash?: string;
  /** For 'assertion': declarative rules */
  assertions?: Array<{
    field: string;       // JSONPath
    operator: 'eq' | 'gt' | 'lt' | 'contains' | 'matches';
    value: unknown;
  }>;
  required: boolean;
}
```

- `script`：WASM 沙箱中执行自定义验收脚本。
- `assertion`：声明式规则（如 `$.rows >= 1000`, `$.format == "parquet"`）。
- `manual`：需要人工确认（fallback）。

---

## 9. Per-market integration

### 9.1 Information market

| Current | Proposed |
|---------|----------|
| `InfoContent.hash` (optional) | `DeliverableEnvelope.contentHash` (required) |
| `EncryptedInfoContent` 自定义结构 | `DeliverableEnvelope.encryption` 统一结构 |
| `ContentFormat` (9 个自定义名) | 标准 MIME types |
| `InfoDeliveryRecord` | 保留，增加 `envelopeHash` 字段 |

### 9.2 Task market

| Current | Proposed |
|---------|----------|
| `TaskDeliverable.type` (7 种) | 统一 9 种 `DeliverableType` |
| `TaskSubmission.deliverables: Record<string, unknown>[]` | `DeliverableEnvelope[]` |
| 无哈希、无签名 | 每个交付物有 contentHash + signature |
| `acceptanceCriteria: string[]` | `AcceptanceTest[]` (v3) |

### 9.3 Capability market

| Current | Proposed |
|---------|----------|
| `CapabilityLease` + `CapabilityUsageRecord` | 保留，增加 `DeliverableEnvelope` (type=`interactive`) |
| 无验证 | v2: OpenAPI schema smoke test; v3: SLA monitoring |

### 9.4 Service contracts (on-chain)

| Current | Proposed |
|---------|----------|
| `Milestone.deliverableHash: bytes32` (opaque) | 存 `BLAKE3(JCS(envelope))` |
| `ContractMilestoneSubmission.deliverables: Record<string, unknown>[]` | `DeliverableEnvelope[]` |
| 手动 approve/reject | Layer 1 自动验证 + 手动/自动 approve |

**合约层不需要修改**：`bytes32` 足够存 BLAKE3 哈希。

---

## 10. P2P event types

### 10.1 Event naming strategy

现有 protocol-spec 冻结了 `market.*` 和 `contract.*` 事件命名空间。
现有 reducer（`applyMarketEvent`）的 `default` 分支会静默忽略未知事件类型。

**因此，delivery 事件复用现有 `market.submission.*` 和 `market.order.*` 命名空间**，
通过 payload 中的 `delivery` 子对象携带 envelope 数据。这样：
- 不需要走冻结规范变更流程。
- 旧版本节点会通过已有的 `market.submission.submit` 分支处理（graceful degradation，忽略不认识的 payload 字段）。
- 新版本节点检测到 `payload.delivery.envelope` 时执行完整 Layer 1 验证。

### 10.2 Event mapping

| 逻辑动作 | 实际事件类型 | Payload 扩展 |
|---------|------------|-------------|
| 提交交付物 | `market.submission.submit` | 增加 `delivery: { envelope: DeliverableEnvelope }` |
| 确认/拒绝交付物 | `market.submission.review` | 增加 `delivery: { deliverableId, verified, failureReason? }` |
| 开始流式交付 | `market.order.update` | 增加 `delivery: { envelope }` (StreamTransport) |
| 流式交付完成 | `market.order.update` | 增加 `delivery: { deliverableId, finalHash, size, signature }` |
| 请求重新交付 | `market.order.update` | 增加 `delivery: { request: { deliverableId } }` |

> **版本检测**：节点通过检查 `payload.delivery?.envelope` 是否存在来判断是否为新格式交付。
> 缺少该字段时按旧逻辑处理（向后兼容）。

> **Phase 1 过渡期必需**：当前 `parseMarketSubmissionSubmitPayload` 强制要求 `deliverables` 数组存在（`events.ts`）。
> 因此 Phase 1 过渡期内，新版本节点提交交付物时 **必须同时携带**：
> 1. `deliverables: Record<string, unknown>[]`（legacy 格式，确保旧节点 parser 不 reject）
> 2. `delivery: { envelope: DeliverableEnvelope }`（新格式，新节点执行完整验证）
>
> 旧节点忽略不认识的 `delivery` 字段；新节点优先使用 `delivery.envelope`，fallback 到 `deliverables`。
> Phase 2 中旧 parser 放宽为 optional；Phase 3 移除 legacy 字段。

---

## 11. Implementation phases

### Phase 1 — MVP (v1): Integrity + Provenance

- [ ] 定义 `DeliverableEnvelope` 类型（`packages/protocol/src/deliverables/`）
- [ ] 统一 `DeliverableType` 枚举（9 种），migration alias 兼容旧类型
- [ ] 实现 envelope 签名和验证（域前缀 `clawnet:deliverable:v1:`，复用 `@noble/ed25519`）
- [ ] 改造 `TaskSubmission.deliverables` → `DeliverableEnvelope[]`
- [ ] 改造 `ContractMilestoneSubmission.deliverables` 同上
- [ ] 更新链下 `submitMilestone`：消除二次哈希，直接透传 BLAKE3(JCS(envelope)) digest
- [ ] 信息市场对齐：`InfoDeliveryRecord` 增加 `envelopeHash`，MIME type migration
- [ ] 更新 SDK types + REST API schemas
- [ ] 扩展 `market.submission.submit` / `market.submission.review` payload 携带 delivery envelope
- [ ] 实现点对点令牌下发协议 `/clawnet/1.0.0/delivery-auth`

### Phase 2 — Structure (v2)

- [ ] `schema` 字段支持 + JSON Schema 验证
- [ ] Stream / Endpoint / External transport 实现
- [ ] Composite deliverables
- [ ] MIME type 完全迁移

### Phase 3 — Automation (v3)

- [ ] `AcceptanceTest` 声明式断言 + WASM sandbox 脚本验收
- [ ] 自动争议触发（Layer 1 验证失败 → 自动开启争议）
- [ ] SLA 监控（capability market）
- [ ] Reputation integration

---

## 12. Migration strategy

### 12.1 Protocol types

新增 `packages/protocol/src/deliverables/` 目录。旧类型用 discriminated union 过渡一个版本。

### 12.2 On-chain

无合约修改。`bytes32 deliverableHash` 语义变更仅在链下。`contracts-service.ts` 中的 `submitMilestone` 需消除二次哈希（见 §7.3）。

### 12.3 Encryption format compatibility

现有 `InfoKeyEnvelope` 与新 `encryption.keyEnvelopes` 的映射：

| 现有 `InfoKeyEnvelope` 字段 | 新 `encryption.keyEnvelopes[did]` 字段 | 说明 |
|---|---|---|
| `algorithm: 'x25519-aes-256-gcm'` | `encryption.algorithm: 'x25519-aes-256-gcm'` | 算法标识保持一致 |
| `senderPublicKeyHex` | `keyEnvelopes[did].senderPublicKeyHex` | 发送方临时公钥 |
| `nonceHex` | `keyEnvelopes[did].nonceHex` | 密钥包裹 nonce |
| `ciphertextHex` | `keyEnvelopes[did].ciphertextHex` | 被包裹的内容密钥 |
| `tagHex` | `keyEnvelopes[did].tagHex` | 密钥包裹 auth tag |
| (不存在) | `encryption.nonce` | 内容加密 nonce（独立于 key wrapping nonce） |
| (不存在) | `encryption.tag` | 内容加密 auth tag |

v1 兼容策略：
- 新代码读取旧 `InfoKeyEnvelope` 时自动转换为新结构。
- 新代码生成的 `keyEnvelopes` 保持字段名与旧格式一致，确保双向兼容。
- 旧格式淘汰窗口：v2 发布后一个版本周期。

### 12.4 SDK

`deliverables: string[]` 升级为结构化类型 + builder helper。

### 12.5 REST API

接受新格式；旧格式（`Record<string, unknown>[]`）在服务端自动包装为 legacy envelope，标记 `legacy: true`。

**Legacy envelope 签名策略**（解决签名必需 vs 无签名的冲突）：
- Legacy envelope 由 **节点服务端签名**（使用节点的 DID 密钥），标注 `signedBy: 'node'`。
- Layer 1 验签可通过，但签名来源为 node DID（非 producer DID），因此 **不计入完整来源验证**——进入降级流程。
- 降级流程：Layer 1 integrity check 通过，但 provenance check 标记为 `degraded`，不触发自动通过，需人工审核或买方显式确认。
- 新版本客户端应使用新格式，由 producer 本地签名后上传完整 `DeliverableEnvelope`。
- 旧格式在 v2 触发 deprecation warning，Phase 3 拒绝无 producer 签名的提交。

---

## 13. Security considerations

| Threat | Mitigation |
|--------|-----------|
| 内容替换 | contentHash 绑定 envelope，envelope 哈希锚定链上 |
| 身份伪造 | Ed25519 签名 + DID 绑定公钥 |
| 重放攻击 | envelope ID = SHA-256(contextId + producer + nonce + createdAt)，确定性且幂等。接收方维护已见 ID 集合，拒绝重复 |
| 中间人解密 | X25519 ECDH 端到端，keyEnvelope 仅目标方可解 |
| 大文件篡改 | external transport 带 `encryptedHash`，fetch 后先验哈希 |
| 流式输出篡改 | 双方独立计算增量 BLAKE3，完成后比对 finalHash |
| Schema 投毒 | Schema ref 是 content-addressed，不可变 |

---

## 14. Open questions

1. ~~**Composite ordering**~~: 已决定——`parts` 数组顺序即为规范顺序，哈希按声明顺序计算（见 §4.3）。
2. **Partial delivery**: 一个 `composite` 中部分子项失败，整体失败还是接受已交付部分？
3. **Stream resume**: 流式输出中途断开，是否可以 resume？需要 checkpoint？
4. **Max recipients**: `keyEnvelopes` 在多方场景（如 DAO 审阅）中的接收方数量上限？
5. **Content expiry**: 交付物内容是否应该有 TTL？
6. **Offline delivery**: consumer 离线时 provider 发布了 delivery event，上线后如何获取？
7. **Cross-market reference**: 任务市场交付物是否可以引用信息市场 listing（避免重复传输）？

---

## 15. Relation to frozen specs

本规范是 **新增规范**，不修改 `SPEC_FREEZE.md` 中已冻结的文档。

- `protocol-spec.md` §13 提到 "IPFS/content hash" 外部引用——本规范具体定义了实现方式。
- `p2p-spec.md` 不需要修改——delivery 事件复用现有 `market.submission.*` / `market.order.*` 事件类型和 gossipsub topic。
- 需新增 libp2p protocol stream `/clawnet/1.0.0/delivery-auth`（用于点对点令牌下发），这是新协议不涉及冻结文档。但该协议 **必须在实现规范附录中登记**（protocol ID、消息格式、版本号），确保跨实现互操作性。
- `ClawContracts.sol` 不需要修改——`bytes32 deliverableHash` 的语义在链下重新定义。

如果需要修改冻结文档，按 SPEC_FREEZE.md 的 Change Control 流程：issue + RFC + version bump + changelog entry。
