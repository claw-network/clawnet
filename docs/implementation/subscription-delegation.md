# P2P 事件订阅代理（Subscription Delegation）实施文档

> **需求来源**: TelagentNode 团队 — [clawnet-p2p-event-subscription-proxy.md](../issues/clawnet-p2p-event-subscription-proxy.md)
>
> **优先级**: P2 | **日期**: 2026-03-09

---

## 目录

1. [概述](#1-概述)
2. [架构设计](#2-架构设计)
3. [Phase 1: 数据模型 — Storage Layer](#3-phase-1-数据模型)
4. [Phase 2: 服务层 — MessagingService 扩展](#4-phase-2-服务层)
5. [Phase 3: REST API 路由](#5-phase-3-rest-api-路由)
6. [Phase 4: WebSocket — Delegated 订阅端点](#6-phase-4-websocket)
7. [Phase 5: SDK 客户端](#7-phase-5-sdk-客户端)
8. [Phase 6: 测试](#8-phase-6-测试)
9. [验证清单](#9-验证清单)
10. [设计决策记录](#10-设计决策记录)

---

## 1. 概述

### 问题

TelagentNode Webapp 通过网关节点（Gateway）远程访问 NAT 内网目标节点（Target）。目前 Webapp→Gateway→P2P→Target 全靠 HTTP 轮询，单次 round-trip 200–800ms，大量空查询浪费带宽。

### 解决方案

ClawNet 协议层新增 **Subscription Delegation**：Target 节点授权 Gateway 节点接收指定 topic 的消息副本（或仅元数据）。消息到达 Target 时，自动通过 P2P 直发协议转发给已授权的 Gateway，Gateway 再通过 WebSocket 推送给 Webapp。

### 核心数据流

```
Peer C  ──P2P DM──▶  Target Node
                        │
                        ├─ 1. 消息入 inbox
                        ├─ 2. 查询 active delegations
                        └─ 3. /clawnet/1.0.0/delegated-msg ──▶ Gateway Node
                                                                   │
                                                                   ├─ 存入 delegated_inbox
                                                                   └─ WS 推送 ──▶ Webapp
                                                                                    │
                                                                                    └─ fetch 实际内容 (API Proxy)
```

### 涉及文件总览

| 文件 | 改动类型 |
|------|----------|
| `packages/protocol/src/messaging/types.ts` | 新增类型 |
| `packages/node/src/services/message-store.ts` | 新增表 + CRUD |
| `packages/node/src/services/messaging-service.ts` | 核心：delegation 管理 + 自动转发 + 新 P2P 协议 |
| `packages/node/src/api/routes/messaging.ts` | 新增 4 个 REST 端点 |
| `packages/node/src/api/ws-messaging.ts` | 新增 delegated WS 端点 |
| `packages/sdk/src/messaging.ts` | 新增 3 个 SDK 方法 |

---

## 2. 架构设计

### P2P Stream Protocol

新增 stream protocol，独立于现有 DM 协议：

```
/clawnet/1.0.0/delegated-msg
```

**不复用** `/clawnet/1.0.0/dm` 的原因：
- 语义隔离：delegation 转发不应混入 Gateway 的正常 inbox
- Rate-limit 独立控制
- Gateway 侧可独立处理、存储、分发

### 安全模型

- **单向授权**：只有 Target 可创建 delegation，Gateway 不能自行订阅
- **精确 topic**：delegation 只能指定具体 topic 列表，**不支持通配符**
- **TTL 强制**：授权必须有有效期（60s–86400s），到期自动清除
- **撤销即失效**：Target 撤销后立即停止转发
- **配额限制**：每个节点最多 10 个活跃 delegation
- **metadataOnly 模式**：Gateway 只收到事件通知，看不到消息 payload 内容

### 验证策略（信任模式）

Gateway 收到 `/clawnet/1.0.0/delegated-msg` 时：
- **信任 P2P 层身份验证**：libp2p 连接已通过 Noise 握手验证 PeerId → PeerId 绑定 DID
- **不额外校验** delegationId 是否在 Target DB 中仍有效
- 后续迭代可加签名 delegation token 做更强验证

### 反压控制

Target 侧自动转发走 **异步队列**（`DelegationForwarder`）：
- bounded concurrency ≤ 5（同时最多向 5 个 Gateway 并发发送）
- 队列深度上限 200，溢出时 log warning 并丢弃最旧任务
- 发送失败不重试，downstream 通过 sinceSeq 补回

### 消息排序与去重

- Gateway 侧对收到的 delegated message 分配本地单调递增 `seq`
- `delegated_inbox` 表设 `UNIQUE(delegation_id, message_id)` 唯一约束，防网络重传重复
- WS 推送和 sinceSeq 回放均按本地 `seq` 升序，天然有序

---

## 3. Phase 1: 数据模型

### Step 1.1: 类型定义

**文件**: `packages/protocol/src/messaging/types.ts`

在文件末尾追加：

```typescript
// ── Subscription Delegation ──────────────────────────────────────

export interface DelegationRecord {
  delegationId: string;
  delegateDid: string;
  topics: string[];
  metadataOnly: boolean;
  expiresAtMs: number;
  createdAtMs: number;
  revoked: boolean;
}

export interface DelegatedMessage {
  type: 'delegated-message';
  delegationId: string;
  originalTargetDid: string;
  sourceDid: string;
  topic: string;
  seq: number;
  receivedAtMs: number;
  /** 完整 payload（仅 metadataOnly=false 时存在） */
  payload?: string;
  /** 消息元数据（仅 metadataOnly=true 时存在） */
  metadata?: {
    messageId: string;
    payloadSizeBytes: number;
  };
}

export interface CreateDelegationParams {
  delegateDid: string;
  topics: string[];
  expiresInSec: number;
  metadataOnly?: boolean;
}
```

同时确保从 `packages/protocol/src/messaging/index.ts` 导出这些类型。

### Step 1.2: SQLite Schema 扩展

**文件**: `packages/node/src/services/message-store.ts`

在 `SCHEMA_SQL` 常量末尾（`attachments` 表之后）追加两个新表：

```sql
-- ── Subscription Delegations (Target 侧) ────────────────────────
CREATE TABLE IF NOT EXISTS delegations (
  delegation_id  TEXT PRIMARY KEY,
  delegate_did   TEXT NOT NULL,
  topics         TEXT NOT NULL,
  metadata_only  INTEGER NOT NULL DEFAULT 1,
  expires_at_ms  INTEGER NOT NULL,
  created_at_ms  INTEGER NOT NULL,
  revoked        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_delegations_delegate ON delegations(delegate_did, revoked);
CREATE INDEX IF NOT EXISTS idx_delegations_expires ON delegations(expires_at_ms);

-- ── Delegated Inbox (Gateway 侧) ────────────────────────────────
CREATE TABLE IF NOT EXISTS delegated_inbox (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id       TEXT NOT NULL,
  source_did          TEXT NOT NULL,
  original_target_did TEXT NOT NULL,
  topic               TEXT NOT NULL,
  message_id          TEXT,
  payload_size        INTEGER,
  received_at_ms      INTEGER NOT NULL,
  seq                 INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delegated_inbox_dedup ON delegated_inbox(delegation_id, message_id);
CREATE INDEX IF NOT EXISTS idx_delegated_inbox_seq ON delegated_inbox(delegation_id, seq);

INSERT OR IGNORE INTO meta (key, value) VALUES ('delegated_inbox_seq', '0');
```

**关键点**：
- `delegations.topics` 存储为 JSON 数组字符串 `'["telagent/envelope","telagent/receipt"]'`
- `delegated_inbox` 的 `seq` 是 Gateway 本地单调递增序列号，独立于 Target 的 inbox seq
- `UNIQUE(delegation_id, message_id)` 防止网络重传导致重复

### Step 1.3: MessageStore CRUD 方法

**文件**: `packages/node/src/services/message-store.ts`

在 `MessageStore` 类中新增以下方法：

#### 1.3.1 Delegation 序列号

```typescript
  // ── Delegated Inbox Seq ────────────────────────────────────────

  private nextDelegatedSeq(): number {
    this.db
      .prepare(
        "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'delegated_inbox_seq'",
      )
      .run();
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'delegated_inbox_seq'")
      .get() as { value: string };
    return parseInt(row.value, 10);
  }

  currentDelegatedSeq(): number {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'delegated_inbox_seq'")
      .get() as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  }
```

#### 1.3.2 Delegation CRUD（Target 侧使用）

```typescript
  import crypto from 'node:crypto';
  // 注意：crypto import 应在文件顶部，此处仅标明依赖

  // ── Delegation Management (Target 侧) ─────────────────────────

  createDelegation(opts: {
    delegateDid: string;
    topics: string[];
    metadataOnly: boolean;
    expiresAtMs: number;
  }): DelegationRecord {
    const delegationId = `dlg_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO delegations (delegation_id, delegate_did, topics, metadata_only, expires_at_ms, created_at_ms, revoked)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        delegationId,
        opts.delegateDid,
        JSON.stringify(opts.topics),
        opts.metadataOnly ? 1 : 0,
        opts.expiresAtMs,
        now,
      );
    return {
      delegationId,
      delegateDid: opts.delegateDid,
      topics: opts.topics,
      metadataOnly: opts.metadataOnly,
      expiresAtMs: opts.expiresAtMs,
      createdAtMs: now,
      revoked: false,
    };
  }

  revokeDelegation(delegationId: string): boolean {
    const result = this.db
      .prepare('UPDATE delegations SET revoked = 1 WHERE delegation_id = ? AND revoked = 0')
      .run(delegationId);
    return result.changes > 0;
  }

  getDelegation(delegationId: string): DelegationRecord | null {
    const row = this.db
      .prepare('SELECT * FROM delegations WHERE delegation_id = ?')
      .get(delegationId) as DelegationRow | undefined;
    return row ? toDelegationRecord(row) : null;
  }

  listDelegations(opts?: { activeOnly?: boolean }): DelegationRecord[] {
    let sql = 'SELECT * FROM delegations';
    const params: unknown[] = [];
    if (opts?.activeOnly) {
      sql += ' WHERE revoked = 0 AND expires_at_ms > ?';
      params.push(Date.now());
    }
    sql += ' ORDER BY created_at_ms DESC';
    const rows = this.db.prepare(sql).all(...params) as DelegationRow[];
    return rows.map(toDelegationRecord);
  }

  /** 查询指定 topic 的所有活跃 delegation — 消息到达时调用 */
  getActiveDelegationsForTopic(topic: string): DelegationRecord[] {
    const now = Date.now();
    const rows = this.db
      .prepare(
        'SELECT * FROM delegations WHERE revoked = 0 AND expires_at_ms > ?',
      )
      .all(now) as DelegationRow[];

    return rows
      .map(toDelegationRecord)
      .filter((d) => d.topics.includes(topic));
  }

  /** 活跃 delegation 计数（配额检查用） */
  activeDelegationCount(): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) as cnt FROM delegations WHERE revoked = 0 AND expires_at_ms > ?',
      )
      .get(Date.now()) as { cnt: number };
    return row.cnt;
  }

  /** 清理过期 delegation 记录 */
  cleanupExpiredDelegations(): number {
    const result = this.db
      .prepare('DELETE FROM delegations WHERE expires_at_ms <= ?')
      .run(Date.now());
    return result.changes;
  }
```

#### 1.3.3 行转换辅助函数

在 `MessageStore` 类外部定义：

```typescript
interface DelegationRow {
  delegation_id: string;
  delegate_did: string;
  topics: string;
  metadata_only: number;
  expires_at_ms: number;
  created_at_ms: number;
  revoked: number;
}

function toDelegationRecord(row: DelegationRow): DelegationRecord {
  return {
    delegationId: row.delegation_id,
    delegateDid: row.delegate_did,
    topics: JSON.parse(row.topics) as string[],
    metadataOnly: row.metadata_only === 1,
    expiresAtMs: row.expires_at_ms,
    createdAtMs: row.created_at_ms,
    revoked: row.revoked === 1,
  };
}
```

#### 1.3.4 Delegated Inbox 操作（Gateway 侧使用）

```typescript
  // ── Delegated Inbox (Gateway 侧) ──────────────────────────────

  /** 存入一条 delegated 消息通知，返回本地 seq。重复则返回 null。 */
  addToDelegatedInbox(msg: {
    delegationId: string;
    sourceDid: string;
    originalTargetDid: string;
    topic: string;
    messageId?: string;
    payloadSize?: number;
  }): number | null {
    const seq = this.nextDelegatedSeq();
    try {
      this.db
        .prepare(
          `INSERT INTO delegated_inbox
             (delegation_id, source_did, original_target_did, topic, message_id, payload_size, received_at_ms, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          msg.delegationId,
          msg.sourceDid,
          msg.originalTargetDid,
          msg.topic,
          msg.messageId ?? null,
          msg.payloadSize ?? null,
          Date.now(),
          seq,
        );
      return seq;
    } catch (err: unknown) {
      // UNIQUE 约束冲突 → 重复消息，忽略
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return null;
      }
      throw err;
    }
  }

  /** 查询 delegated inbox（用于 WS sinceSeq 回放） */
  getDelegatedInbox(opts: {
    delegationId: string;
    sinceSeq?: number;
    limit?: number;
  }): Array<{
    delegationId: string;
    sourceDid: string;
    originalTargetDid: string;
    topic: string;
    messageId: string | null;
    payloadSize: number | null;
    receivedAtMs: number;
    seq: number;
  }> {
    let sql = 'SELECT * FROM delegated_inbox WHERE delegation_id = ?';
    const params: unknown[] = [opts.delegationId];
    if (opts.sinceSeq !== undefined) {
      sql += ' AND seq > ?';
      params.push(opts.sinceSeq);
    }
    sql += ' ORDER BY seq ASC LIMIT ?';
    params.push(opts.limit ?? 500);
    return this.db.prepare(sql).all(...params) as Array<{
      delegation_id: string;
      source_did: string;
      original_target_did: string;
      topic: string;
      message_id: string | null;
      payload_size: number | null;
      received_at_ms: number;
      seq: number;
    }>;
    // 注意：实际需要列名映射，见下方说明
  }
```

> **注意**：`getDelegatedInbox` 返回的 SQLite 行是 snake\_case，需映射到 camelCase，或直接在 SQL 中使用 AS 别名。推荐在方法内部做 `.map()` 转换，保持与 `toDelegationRecord` 一致的模式。

#### 1.3.5 Delegated Inbox 清理

```typescript
  /** 清理超过 24 小时的 delegated inbox 记录 */
  cleanupDelegatedInbox(maxAgeMs: number = 86_400_000): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db
      .prepare('DELETE FROM delegated_inbox WHERE received_at_ms < ?')
      .run(cutoff);
    return result.changes;
  }
```

### Step 1.4: 导入与导出

**`packages/protocol/src/messaging/types.ts`** — 类型定义在此文件，直接 export。

**`packages/protocol/src/messaging/index.ts`** — 确保 re-export：

```typescript
export type {
  DelegationRecord,
  DelegatedMessage,
  CreateDelegationParams,
} from './types.js';
```

**`packages/node/src/services/message-store.ts`** — 顶部新增 import：

```typescript
import type { DelegationRecord } from '@claw-network/protocol/messaging';
```

---

## 4. Phase 2: 服务层

### Step 2.1: 常量定义

**文件**: `packages/node/src/services/messaging-service.ts`

在现有协议常量块中追加：

```typescript
const PROTO_DELEGATED_MSG = '/clawnet/1.0.0/delegated-msg';

const MAX_ACTIVE_DELEGATIONS = 10;
const MIN_DELEGATION_TTL_SEC = 60;
const MAX_DELEGATION_TTL_SEC = 86_400;
const DELEGATION_CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 分钟
const DELEGATION_FORWARD_CONCURRENCY = 5;
const DELEGATION_FORWARD_QUEUE_DEPTH = 200;
```

### Step 2.2: DelegationForwarder 内部类

**文件**: `packages/node/src/services/messaging-service.ts`

在 `MessagingService` 类之前定义：

```typescript
/**
 * 异步转发队列 — 控制 delegation 消息转发的并发和背压。
 * bounded concurrency + bounded queue depth.
 */
class DelegationForwarder {
  private queue: Array<{ delegateDid: string; peerId: string; data: Uint8Array }> = [];
  private active = 0;

  constructor(
    private readonly maxConcurrency: number,
    private readonly maxQueueDepth: number,
    private readonly sendFn: (peerId: string, data: Uint8Array) => Promise<boolean>,
    private readonly log: Logger,
  ) {}

  enqueue(delegateDid: string, peerId: string, data: Uint8Array): void {
    if (this.queue.length >= this.maxQueueDepth) {
      this.log.warn('delegation forward queue full, dropping oldest', {
        delegateDid,
        queueLen: this.queue.length,
      });
      this.queue.shift(); // 丢弃最旧
    }
    this.queue.push({ delegateDid, peerId, data });
    this.drain();
  }

  private drain(): void {
    while (this.active < this.maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active++;
      this.sendFn(item.peerId, item.data)
        .catch((err) => {
          this.log.warn('delegation forward failed', {
            delegateDid: item.delegateDid,
            error: (err as Error).message,
          });
        })
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
}
```

### Step 2.3: Delegation 管理公共 API

**文件**: `packages/node/src/services/messaging-service.ts`

在 `MessagingService` 类中新增以下公共方法：

```typescript
  // ── Subscription Delegation Management ─────────────────────────

  createSubscriptionDelegation(params: {
    delegateDid: string;
    topics: string[];
    expiresInSec: number;
    metadataOnly?: boolean;
  }): DelegationRecord {
    // 验证 delegateDid 格式
    if (!params.delegateDid || !params.delegateDid.startsWith('did:claw:z')) {
      throw new Error('Invalid delegateDid: must be a valid did:claw: identifier');
    }

    // 验证 topics
    if (!Array.isArray(params.topics) || params.topics.length === 0) {
      throw new Error('topics must be a non-empty array');
    }
    for (const t of params.topics) {
      if (typeof t !== 'string' || t.length === 0 || t.length > 256) {
        throw new Error(`Invalid topic: must be 1-256 characters, got "${t}"`);
      }
      if (t.includes('*')) {
        throw new Error(`Wildcard topics not allowed in delegation: "${t}"`);
      }
    }

    // 验证 TTL
    if (
      params.expiresInSec < MIN_DELEGATION_TTL_SEC ||
      params.expiresInSec > MAX_DELEGATION_TTL_SEC
    ) {
      throw new Error(
        `expiresInSec must be between ${MIN_DELEGATION_TTL_SEC} and ${MAX_DELEGATION_TTL_SEC}`,
      );
    }

    // 配额检查
    const activeCount = this.store.activeDelegationCount();
    if (activeCount >= MAX_ACTIVE_DELEGATIONS) {
      throw new Error(
        `Maximum active delegations (${MAX_ACTIVE_DELEGATIONS}) reached`,
      );
    }

    const expiresAtMs = Date.now() + params.expiresInSec * 1000;
    return this.store.createDelegation({
      delegateDid: params.delegateDid,
      topics: params.topics,
      metadataOnly: params.metadataOnly ?? true,
      expiresAtMs,
    });
  }

  revokeSubscriptionDelegation(delegationId: string): boolean {
    return this.store.revokeDelegation(delegationId);
  }

  listSubscriptionDelegations(opts?: { activeOnly?: boolean }): DelegationRecord[] {
    return this.store.listDelegations(opts);
  }

  getSubscriptionDelegation(delegationId: string): DelegationRecord | null {
    return this.store.getDelegation(delegationId);
  }
```

### Step 2.4: 消息到达时自动转发（核心逻辑）

**文件**: `packages/node/src/services/messaging-service.ts`

在 `handleInboundMessage()` 方法中，**在 `this.notifySubscribers(...)` 调用之后**追加：

```typescript
      // ── Delegation forwarding ────────────────────────────────────
      this.forwardToDelegates(msg.topic, {
        messageId,
        sourceDid: msg.sourceDid,
        payload: storagePayload,
        payloadSize: msg.payload.length,
        seq: currentSeq,
        receivedAtMs: Date.now(),
      });
```

新增私有方法 `forwardToDelegates`：

```typescript
  /**
   * 查询匹配的 active delegations，将 DelegatedMessage 推入异步转发队列。
   * Fire-and-forget — 不阻塞消息接收主流程。
   */
  private forwardToDelegates(
    topic: string,
    msg: {
      messageId: string;
      sourceDid: string;
      payload: string;
      payloadSize: number;
      seq: number;
      receivedAtMs: number;
    },
  ): void {
    let delegations: DelegationRecord[];
    try {
      delegations = this.store.getActiveDelegationsForTopic(topic);
    } catch {
      return; // DB 异常不影响主流程
    }

    if (delegations.length === 0) return;

    for (const dlg of delegations) {
      const delegatedMsg: DelegatedMessage = {
        type: 'delegated-message',
        delegationId: dlg.delegationId,
        originalTargetDid: this.localDid,
        sourceDid: msg.sourceDid,
        topic,
        seq: msg.seq,
        receivedAtMs: msg.receivedAtMs,
      };

      if (dlg.metadataOnly) {
        delegatedMsg.metadata = {
          messageId: msg.messageId,
          payloadSizeBytes: msg.payloadSize,
        };
      } else {
        delegatedMsg.payload = msg.payload;
      }

      // 解析 delegate DID → PeerId
      const peerId = this.getDidPeerId(dlg.delegateDid);
      if (!peerId) {
        this.log.debug('delegation forward skipped: unknown peerId', {
          delegationId: dlg.delegationId,
          delegateDid: dlg.delegateDid,
        });
        continue;
      }

      const data = Buffer.from(JSON.stringify(delegatedMsg), 'utf-8');
      this.delegationForwarder.enqueue(dlg.delegateDid, peerId, data);
    }
  }
```

### Step 2.5: 新 P2P Stream Protocol Handler

**文件**: `packages/node/src/services/messaging-service.ts`

#### Target 侧（发送） — 在 `start()` 或构造函数中初始化 forwarder：

```typescript
  // 类成员
  private delegationForwarder!: DelegationForwarder;
  private delegationCleanupTimer?: ReturnType<typeof setInterval>;
  private readonly delegatedMsgSubscribers = new Set<DelegatedMsgSubscriber>();
```

在 `start()` 方法中，注册协议处理器之后，追加：

```typescript
    // ── Delegation forwarding infrastructure ─────────────────────
    this.delegationForwarder = new DelegationForwarder(
      DELEGATION_FORWARD_CONCURRENCY,
      DELEGATION_FORWARD_QUEUE_DEPTH,
      async (peerId, data) => this.sendDelegatedMsg(peerId, data),
      this.log,
    );

    // Register handler for receiving delegated messages (Gateway 侧)
    await this.p2p.handleProtocol(PROTO_DELEGATED_MSG, (incoming) => {
      void this.handleInboundDelegatedMsg(incoming);
    }, { maxInboundStreams: 64 });

    // 定时清理过期 delegation + 过期 delegated inbox 记录
    this.delegationCleanupTimer = setInterval(() => {
      try {
        const cleaned = this.store.cleanupExpiredDelegations();
        const inboxCleaned = this.store.cleanupDelegatedInbox();
        if (cleaned > 0 || inboxCleaned > 0) {
          this.log.info('delegation cleanup', { delegations: cleaned, inbox: inboxCleaned });
        }
      } catch (err) {
        this.log.warn('delegation cleanup failed', { error: (err as Error).message });
      }
    }, DELEGATION_CLEANUP_INTERVAL_MS);
```

在 `stop()` 方法中追加：

```typescript
    if (this.delegationCleanupTimer) {
      clearInterval(this.delegationCleanupTimer);
    }
```

#### Target 侧 — 发送 delegated message：

```typescript
  /** 通过 P2P stream 发送 delegated message 给 Gateway */
  private async sendDelegatedMsg(peerId: string, data: Uint8Array): Promise<boolean> {
    let stream: StreamDuplex | null = null;
    try {
      stream = await this.p2p.newStream(peerId, PROTO_DELEGATED_MSG);
      await writeBinaryStream(stream.sink, data);
      await stream.close();
      return true;
    } catch (err) {
      this.log.warn('delegated-msg send failed', { peerId, error: (err as Error).message });
      if (stream) {
        try { await stream.close(); } catch { /* ignore */ }
      }
      return false;
    }
  }
```

#### Gateway 侧 — 接收 delegated message：

```typescript
  /** Gateway 侧：接收并存储 delegated message */
  private async handleInboundDelegatedMsg(incoming: {
    stream: StreamDuplex;
    connection: { remotePeer?: { toString: () => string } };
  }): Promise<void> {
    const { stream } = incoming;
    try {
      const raw = await readStream(stream.source, 64 * 1024, 10_000);
      await stream.close();

      const msg = JSON.parse(raw.toString('utf-8')) as DelegatedMessage;

      // 基本校验
      if (msg.type !== 'delegated-message' || !msg.delegationId || !msg.topic) {
        this.log.warn('invalid delegated message received');
        return;
      }

      // 存入 delegated_inbox（去重由 UNIQUE 约束保证）
      const messageId = msg.metadata?.messageId ?? msg.delegationId + ':' + msg.seq;
      const seq = this.store.addToDelegatedInbox({
        delegationId: msg.delegationId,
        sourceDid: msg.sourceDid,
        originalTargetDid: msg.originalTargetDid,
        topic: msg.topic,
        messageId,
        payloadSize: msg.metadata?.payloadSizeBytes ?? (msg.payload ? Buffer.byteLength(msg.payload) : 0),
      });

      if (seq === null) {
        // 重复消息，忽略
        return;
      }

      this.log.info('delegated message received', {
        delegationId: msg.delegationId,
        topic: msg.topic,
        seq,
      });

      // 通知 WS subscribers
      this.notifyDelegatedMsgSubscribers({ ...msg, seq });
    } catch (err) {
      this.log.warn('failed to handle delegated message', { error: (err as Error).message });
      try { await stream.close(); } catch { /* ignore */ }
    }
  }
```

### Step 2.6: Delegated Message Subscriber 机制

```typescript
export type DelegatedMsgSubscriber = (msg: DelegatedMessage) => void;
```

```typescript
  addDelegatedMsgSubscriber(cb: DelegatedMsgSubscriber): void {
    this.delegatedMsgSubscribers.add(cb);
  }

  removeDelegatedMsgSubscriber(cb: DelegatedMsgSubscriber): void {
    this.delegatedMsgSubscribers.delete(cb);
  }

  private notifyDelegatedMsgSubscribers(msg: DelegatedMessage): void {
    for (const cb of this.delegatedMsgSubscribers) {
      queueMicrotask(() => {
        try { cb(msg); } catch { /* ignore */ }
      });
    }
  }
```

### Step 2.7: 辅助方法

确保 `MessagingService` 中有访问 DID→PeerId 映射的方法：

```typescript
  /** 获取已知 DID 对应的 PeerId（用于 delegation 转发） */
  private getDidPeerId(did: string): string | undefined {
    // 查找内存缓存（didPeerMap）
    return this.didPeerMap.get(did);
    // 注意：如果 didPeerMap 是 Map<string, { peerId, ts }> 形式，
    // 则返回 this.didPeerMap.get(did)?.peerId
  }
```

> **注意**：需确认 `didPeerMap` 的实际数据结构。如果 Gateway 尚未与 Target 有过 DM 交互，可能没有 PeerId 缓存。这种情况下 delegation 转发会被跳过，**这是正确行为** — Gateway 必须先建立 P2P 连接才能接收消息。

---

## 5. Phase 3: REST API 路由

### Step 3.1: 路由定义

**文件**: `packages/node/src/api/routes/messaging.ts`

在 `messagingRoutes()` 函数的 `return r` 之前，追加以下路由：

```typescript
  // ── Subscription Delegations ─────────────────────────────────

  // POST /subscription-delegations — 创建授权
  r.post('/subscription-delegations', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const body = route.body as Record<string, unknown> | undefined;
    if (!body) {
      badRequest(res, 'Request body required', route.url.pathname);
      return;
    }

    const delegateDid = body.delegateDid as string | undefined;
    const topics = body.topics as string[] | undefined;
    const expiresInSec = typeof body.expiresInSec === 'number' ? body.expiresInSec : undefined;
    const metadataOnly = typeof body.metadataOnly === 'boolean' ? body.metadataOnly : undefined;

    if (!delegateDid || typeof delegateDid !== 'string') {
      badRequest(res, 'Missing or invalid "delegateDid"', route.url.pathname);
      return;
    }
    if (!Array.isArray(topics) || topics.length === 0) {
      badRequest(res, 'Missing or invalid "topics": must be a non-empty array', route.url.pathname);
      return;
    }
    if (expiresInSec === undefined || expiresInSec <= 0) {
      badRequest(res, 'Missing or invalid "expiresInSec": must be a positive number', route.url.pathname);
      return;
    }

    try {
      const record = ctx.messagingService.createSubscriptionDelegation({
        delegateDid,
        topics,
        expiresInSec,
        metadataOnly,
      });
      created(res, record, {
        self: `/api/v1/messaging/subscription-delegations/${record.delegationId}`,
      });
    } catch (err) {
      badRequest(res, (err as Error).message, route.url.pathname);
    }
  });

  // GET /subscription-delegations — 列出授权
  r.get('/subscription-delegations', async (_req, res, _route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const delegations = ctx.messagingService.listSubscriptionDelegations({
      activeOnly: true,
    });
    ok(res, delegations);
  });

  // GET /subscription-delegations/:id — 查看单个
  r.get('/subscription-delegations/:id', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const id = route.params.id;
    const record = ctx.messagingService.getSubscriptionDelegation(id);
    if (!record) {
      notFound(res, `Delegation not found: ${id}`, route.url.pathname);
      return;
    }
    ok(res, record);
  });

  // DELETE /subscription-delegations/:id — 撤销授权
  r.delete('/subscription-delegations/:id', async (_req, res, route) => {
    if (!ctx.messagingService) {
      internalError(res, 'Messaging service unavailable');
      return;
    }

    const id = route.params.id;
    const revoked = ctx.messagingService.revokeSubscriptionDelegation(id);
    if (!revoked) {
      notFound(res, `Delegation not found or already revoked: ${id}`, route.url.pathname);
      return;
    }
    noContent(res);
  });
```

### Step 3.2: 确认 import

在 `messaging.ts` 路由文件顶部确保已导入：

```typescript
import { ok, created, noContent, badRequest, notFound, internalError } from '../response.js';
```

大部分已存在（现有路由已使用），只需确认 `created` 和 `noContent` 已导入。

---

## 6. Phase 4: WebSocket

### Step 4.1: 新增 Delegated WS 端点

**文件**: `packages/node/src/api/ws-messaging.ts`

#### 常量

```typescript
const WS_DELEGATED_PATH = '/api/v1/messaging/subscribe-delegated';
```

#### 在 `attachWebSocketHandler()` 中扩展 upgrade handler

在现有 `server.on('upgrade', ...)` 回调中，在原有 `WS_PATH` 检查**之前**，追加 delegated 路径处理：

```typescript
    // ── Delegated subscription endpoint ────────────────────────────
    if (url.pathname === WS_DELEGATED_PATH) {
      // Auth (same as regular WS)
      if (apiKeyStore && apiKeyStore.activeCount() > 0) {
        const apiKey =
          url.searchParams.get('apiKey') ??
          (req.headers['x-api-key'] as string | undefined) ??
          extractBearerToken(req.headers.authorization);

        if (!apiKey || !apiKeyStore.validate(apiKey)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      // 必须提供 delegationId
      const delegationId = url.searchParams.get('delegationId');
      if (!delegationId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        handleDelegatedConnection(ws, delegationId, url, svc);
      });
      return;
    }
```

#### Delegated Connection Handler

函数定义在同文件中：

```typescript
function handleDelegatedConnection(
  ws: WebSocket,
  delegationId: string,
  url: URL,
  svc: MessagingService | undefined,
): void {
  if (!svc) {
    ws.close(4000, 'Messaging service unavailable');
    return;
  }

  const sinceSeqParam = url.searchParams.get('sinceSeq');

  // 注册 delegated message subscriber
  const subscriber: DelegatedMsgSubscriber = (msg: DelegatedMessage) => {
    if (msg.delegationId !== delegationId) return;
    if (ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: 'delegated-message', data: msg }));
  };

  svc.addDelegatedMsgSubscriber(subscriber);

  // 发送 connected 帧
  const currentSeq = svc.store.currentDelegatedSeq();
  ws.send(JSON.stringify({
    type: 'connected',
    delegationId,
    seq: currentSeq,
  }));

  // 重连回放 (sinceSeq)
  if (sinceSeqParam != null) {
    const sinceSeq = parseInt(sinceSeqParam, 10);
    if (!isNaN(sinceSeq) && sinceSeq >= 0) {
      const missed = svc.store.getDelegatedInbox({
        delegationId,
        sinceSeq,
        limit: 500,
      });
      for (const row of missed) {
        if (ws.readyState !== ws.OPEN) break;
        ws.send(JSON.stringify({
          type: 'delegated-message',
          data: {
            type: 'delegated-message',
            delegationId: row.delegationId,
            originalTargetDid: row.originalTargetDid,
            sourceDid: row.sourceDid,
            topic: row.topic,
            seq: row.seq,
            receivedAtMs: row.receivedAtMs,
            metadata: row.messageId
              ? { messageId: row.messageId, payloadSizeBytes: row.payloadSize ?? 0 }
              : undefined,
          },
        }));
      }
      ws.send(JSON.stringify({
        type: 'replay_done',
        lastSeq: svc.store.currentDelegatedSeq(),
      }));
    }
  }

  // Heartbeat (复用现有 heartbeat 机制或独立管理)
  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  ws.on('close', () => {
    clearInterval(pingInterval);
    svc.removeDelegatedMsgSubscriber(subscriber);
  });

  ws.on('pong', () => {
    // 客户端仍然活跃
  });
}
```

### Step 4.2: 导入新类型

在 `ws-messaging.ts` 顶部新增导入：

```typescript
import type { DelegatedMsgSubscriber, DelegatedMessage } from '../services/messaging-service.js';
```

> **注意**：`DelegatedMsgSubscriber` 和 `DelegatedMessage` 从 `messaging-service.ts` 导出。`DelegatedMessage` 也可从 `@claw-network/protocol/messaging` 导入，选择更近的来源。

### Step 4.3: WS 帧格式汇总

| 帧类型 | 格式 | 方向 |
|--------|------|------|
| `connected` | `{ type: "connected", delegationId, seq }` | Server → Client |
| `delegated-message` | `{ type: "delegated-message", data: DelegatedMessage }` | Server → Client |
| `replay_done` | `{ type: "replay_done", lastSeq }` | Server → Client |

---

## 7. Phase 5: SDK 客户端

### Step 5.1: 类型定义

**文件**: `packages/sdk/src/messaging.ts`

在现有类型定义区域追加：

```typescript
// ── Subscription Delegation ──────────────────────────────────────

export interface CreateDelegationParams {
  delegateDid: string;
  topics: string[];
  expiresInSec: number;
  metadataOnly?: boolean;
}

export interface DelegationRecord {
  delegationId: string;
  delegateDid: string;
  topics: string[];
  metadataOnly: boolean;
  expiresAtMs: number;
  createdAtMs: number;
  revoked: boolean;
}
```

### Step 5.2: MessagingApi 新增方法

在 `MessagingApi` 类中追加：

```typescript
  // ── Subscription Delegations ─────────────────────────────────

  async createSubscriptionDelegation(
    params: CreateDelegationParams,
    opts?: RequestOptions,
  ): Promise<DelegationRecord> {
    return this.http.post<DelegationRecord>(
      '/api/v1/messaging/subscription-delegations',
      params,
      opts,
    );
  }

  async revokeSubscriptionDelegation(
    delegationId: string,
    opts?: RequestOptions,
  ): Promise<void> {
    await this.http.delete(`/api/v1/messaging/subscription-delegations/${delegationId}`, opts);
  }

  async listSubscriptionDelegations(
    opts?: RequestOptions,
  ): Promise<DelegationRecord[]> {
    return this.http.get<DelegationRecord[]>(
      '/api/v1/messaging/subscription-delegations',
      opts,
    );
  }
```

---

## 8. Phase 6: 测试

### Step 6.1: 单元测试 — MessageStore Delegation CRUD

**文件**: `packages/node/src/services/__tests__/messaging-service.test.ts`（或新建 `message-store-delegation.test.ts`）

测试用例：

```typescript
describe('MessageStore — Delegation', () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore(':memory:'); // SQLite in-memory
  });

  test('createDelegation — 创建后可查询', () => {
    const d = store.createDelegation({
      delegateDid: 'did:claw:zGateway1',
      topics: ['telagent/envelope', 'telagent/receipt'],
      metadataOnly: true,
      expiresAtMs: Date.now() + 3600_000,
    });
    expect(d.delegationId).toMatch(/^dlg_/);
    expect(d.topics).toEqual(['telagent/envelope', 'telagent/receipt']);

    const fetched = store.getDelegation(d.delegationId);
    expect(fetched).toEqual(d);
  });

  test('revokeDelegation — 撤销后不再出现在 active 列表', () => {
    const d = store.createDelegation({
      delegateDid: 'did:claw:zGateway1',
      topics: ['telagent/envelope'],
      metadataOnly: true,
      expiresAtMs: Date.now() + 3600_000,
    });
    expect(store.listDelegations({ activeOnly: true })).toHaveLength(1);

    store.revokeDelegation(d.delegationId);
    expect(store.listDelegations({ activeOnly: true })).toHaveLength(0);

    // 但仍可查询到（revoked=true）
    const fetched = store.getDelegation(d.delegationId);
    expect(fetched?.revoked).toBe(true);
  });

  test('getActiveDelegationsForTopic — 按 topic 过滤', () => {
    store.createDelegation({
      delegateDid: 'did:claw:zGateway1',
      topics: ['telagent/envelope'],
      metadataOnly: true,
      expiresAtMs: Date.now() + 3600_000,
    });
    store.createDelegation({
      delegateDid: 'did:claw:zGateway2',
      topics: ['telagent/receipt'],
      metadataOnly: true,
      expiresAtMs: Date.now() + 3600_000,
    });

    expect(store.getActiveDelegationsForTopic('telagent/envelope')).toHaveLength(1);
    expect(store.getActiveDelegationsForTopic('telagent/receipt')).toHaveLength(1);
    expect(store.getActiveDelegationsForTopic('telagent/other')).toHaveLength(0);
  });

  test('过期 delegation 不出现在活跃列表', () => {
    store.createDelegation({
      delegateDid: 'did:claw:zGateway1',
      topics: ['telagent/envelope'],
      metadataOnly: true,
      expiresAtMs: Date.now() - 1000, // 已过期
    });
    expect(store.getActiveDelegationsForTopic('telagent/envelope')).toHaveLength(0);
  });

  test('cleanupExpiredDelegations — 清除过期记录', () => {
    store.createDelegation({
      delegateDid: 'did:claw:zGateway1',
      topics: ['t'],
      metadataOnly: true,
      expiresAtMs: Date.now() - 1000,
    });
    expect(store.cleanupExpiredDelegations()).toBe(1);
  });

  test('activeDelegationCount — 配额计数', () => {
    for (let i = 0; i < 10; i++) {
      store.createDelegation({
        delegateDid: `did:claw:zGateway${i}`,
        topics: ['t'],
        metadataOnly: true,
        expiresAtMs: Date.now() + 3600_000,
      });
    }
    expect(store.activeDelegationCount()).toBe(10);
  });
});
```

### Step 6.2: 单元测试 — Delegated Inbox

```typescript
describe('MessageStore — Delegated Inbox', () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore(':memory:');
  });

  test('addToDelegatedInbox — 存入并分配递增 seq', () => {
    const seq1 = store.addToDelegatedInbox({
      delegationId: 'dlg_abc',
      sourceDid: 'did:claw:zPeerC',
      originalTargetDid: 'did:claw:zTarget',
      topic: 'telagent/envelope',
      messageId: 'msg_001',
      payloadSize: 2048,
    });
    const seq2 = store.addToDelegatedInbox({
      delegationId: 'dlg_abc',
      sourceDid: 'did:claw:zPeerD',
      originalTargetDid: 'did:claw:zTarget',
      topic: 'telagent/envelope',
      messageId: 'msg_002',
      payloadSize: 1024,
    });
    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
  });

  test('addToDelegatedInbox — 重复消息返回 null', () => {
    store.addToDelegatedInbox({
      delegationId: 'dlg_abc',
      sourceDid: 'did:claw:zPeerC',
      originalTargetDid: 'did:claw:zTarget',
      topic: 'telagent/envelope',
      messageId: 'msg_001',
    });
    const dup = store.addToDelegatedInbox({
      delegationId: 'dlg_abc',
      sourceDid: 'did:claw:zPeerC',
      originalTargetDid: 'did:claw:zTarget',
      topic: 'telagent/envelope',
      messageId: 'msg_001', // 重复
    });
    expect(dup).toBeNull();
  });

  test('getDelegatedInbox — sinceSeq 回放', () => {
    for (let i = 1; i <= 5; i++) {
      store.addToDelegatedInbox({
        delegationId: 'dlg_abc',
        sourceDid: 'did:claw:zPeerC',
        originalTargetDid: 'did:claw:zTarget',
        topic: 'telagent/envelope',
        messageId: `msg_${i}`,
      });
    }
    const results = store.getDelegatedInbox({ delegationId: 'dlg_abc', sinceSeq: 3 });
    expect(results).toHaveLength(2); // seq 4, 5
  });
});
```

### Step 6.3: 单元测试 — MessagingService Delegation

```typescript
describe('MessagingService — Delegation', () => {
  // Mock P2PNode + MessageStore
  let svc: MessagingService;
  let mockP2p: MockP2PNode;
  let store: MessageStore;

  beforeEach(async () => {
    mockP2p = createMockP2PNode();
    store = new MessageStore(':memory:');
    svc = new MessagingService(mockP2p, store, 'did:claw:zTarget');
    await svc.start();
  });

  afterEach(async () => {
    await svc.stop();
  });

  test('createSubscriptionDelegation — 验证参数', () => {
    // 无效 DID
    expect(() => svc.createSubscriptionDelegation({
      delegateDid: 'invalid',
      topics: ['t'],
      expiresInSec: 3600,
    })).toThrow('Invalid delegateDid');

    // 空 topics
    expect(() => svc.createSubscriptionDelegation({
      delegateDid: 'did:claw:zGateway',
      topics: [],
      expiresInSec: 3600,
    })).toThrow('non-empty array');

    // 通配符 topic
    expect(() => svc.createSubscriptionDelegation({
      delegateDid: 'did:claw:zGateway',
      topics: ['telagent/*'],
      expiresInSec: 3600,
    })).toThrow('Wildcard');

    // TTL 过小
    expect(() => svc.createSubscriptionDelegation({
      delegateDid: 'did:claw:zGateway',
      topics: ['t'],
      expiresInSec: 1,
    })).toThrow('expiresInSec');
  });

  test('配额限制 — 超过 10 个拒绝', () => {
    for (let i = 0; i < 10; i++) {
      svc.createSubscriptionDelegation({
        delegateDid: `did:claw:zGateway${i}`,
        topics: ['t'],
        expiresInSec: 3600,
      });
    }
    expect(() => svc.createSubscriptionDelegation({
      delegateDid: 'did:claw:zGateway99',
      topics: ['t'],
      expiresInSec: 3600,
    })).toThrow('Maximum active delegations');
  });

  test('消息到达时触发 delegation 转发', async () => {
    // 创建 delegation
    svc.createSubscriptionDelegation({
      delegateDid: 'did:claw:zGateway1',
      topics: ['telagent/envelope'],
      expiresInSec: 3600,
      metadataOnly: true,
    });

    // Mock: 设置 Gateway 的 PeerId 映射
    // (需根据实际 didPeerMap 结构调整)
    // ...

    // 模拟消息到达
    // 验证 mockP2p.newStream 被调用，protocol = PROTO_DELEGATED_MSG
    // 验证写入的数据包含 type: 'delegated-message'
  });
});
```

### Step 6.4: API 路由测试

```typescript
describe('Messaging Routes — Delegation', () => {
  // 使用现有测试基础设施启动 ApiServer

  test('POST /subscription-delegations — 创建成功', async () => {
    const res = await request(server)
      .post('/api/v1/messaging/subscription-delegations')
      .set('X-Api-Key', TEST_API_KEY)
      .send({
        delegateDid: 'did:claw:zGateway1',
        topics: ['telagent/envelope', 'telagent/receipt'],
        expiresInSec: 3600,
        metadataOnly: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.delegationId).toMatch(/^dlg_/);
    expect(res.body.data.topics).toEqual(['telagent/envelope', 'telagent/receipt']);
  });

  test('POST /subscription-delegations — 参数缺失返回 400', async () => {
    const res = await request(server)
      .post('/api/v1/messaging/subscription-delegations')
      .set('X-Api-Key', TEST_API_KEY)
      .send({ topics: ['t'] }); // 缺少 delegateDid
    expect(res.status).toBe(400);
  });

  test('GET /subscription-delegations — 列出活跃授权', async () => {
    // 先创建一个
    await request(server)
      .post('/api/v1/messaging/subscription-delegations')
      .set('X-Api-Key', TEST_API_KEY)
      .send({
        delegateDid: 'did:claw:zGateway1',
        topics: ['t'],
        expiresInSec: 3600,
      });

    const res = await request(server)
      .get('/api/v1/messaging/subscription-delegations')
      .set('X-Api-Key', TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('DELETE /subscription-delegations/:id — 撤销', async () => {
    const create = await request(server)
      .post('/api/v1/messaging/subscription-delegations')
      .set('X-Api-Key', TEST_API_KEY)
      .send({
        delegateDid: 'did:claw:zGateway1',
        topics: ['t'],
        expiresInSec: 3600,
      });

    const res = await request(server)
      .delete(`/api/v1/messaging/subscription-delegations/${create.body.data.delegationId}`)
      .set('X-Api-Key', TEST_API_KEY);
    expect(res.status).toBe(204);
  });

  test('DELETE /subscription-delegations/:id — 不存在返回 404', async () => {
    const res = await request(server)
      .delete('/api/v1/messaging/subscription-delegations/dlg_nonexistent')
      .set('X-Api-Key', TEST_API_KEY);
    expect(res.status).toBe(404);
  });
});
```

### Step 6.5: 集成测试

**文件**: `scripts/integration-test.mjs`

追加 delegation 测试场景：

```javascript
// ── Scenario: Subscription Delegation ────────────────────────────
async function testDelegation(nodeA, nodeB) {
  log('--- Delegation: create on Node A, delegate to Node B ---');

  // 1. Node A 创建 delegation 授权 Node B
  const dlg = await api(nodeA, 'POST', '/api/v1/messaging/subscription-delegations', {
    delegateDid: nodeB.did,
    topics: ['test/delegation'],
    expiresInSec: 300,
    metadataOnly: true,
  });
  assert(dlg.data.delegationId, 'delegation created');

  // 2. Node B 连接 delegated WS
  const ws = new WebSocket(
    `ws://localhost:${nodeB.port}/api/v1/messaging/subscribe-delegated?delegationId=${dlg.data.delegationId}&apiKey=${nodeB.apiKey}`
  );
  await waitForWsMessage(ws, 'connected');

  // 3. 第三方节点向 Node A 发送消息
  await api(nodeC, 'POST', '/api/v1/messaging/send', {
    targetDid: nodeA.did,
    topic: 'test/delegation',
    payload: 'hello delegation',
  });

  // 4. Node B 的 WS 应收到 delegated-message
  const msg = await waitForWsMessage(ws, 'delegated-message', 5000);
  assert(msg.data.topic === 'test/delegation', 'correct topic');
  assert(msg.data.metadata.messageId, 'has messageId metadata');
  assert(!msg.data.payload, 'metadataOnly: no payload');

  // 5. Revoke delegation
  await api(nodeA, 'DELETE', `/api/v1/messaging/subscription-delegations/${dlg.data.delegationId}`);

  ws.close();
  log('--- Delegation test passed ---');
}
```

---

## 9. 验证清单

| # | 验证项 | 命令 / 方法 |
|---|--------|-------------|
| 1 | TypeScript 编译无错误 | `pnpm build` |
| 2 | ESLint 无错误 | `pnpm lint` |
| 3 | Node 包全部测试通过 | `pnpm --filter @claw-network/node test` |
| 4 | SDK 包测试通过 | `pnpm --filter @claw-network/sdk test` |
| 5 | delegation CRUD 正确 | 单元测试 Step 6.1 |
| 6 | delegated inbox 去重 + seq 正确 | 单元测试 Step 6.2 |
| 7 | 参数验证（DID/topics/TTL/配额）| 单元测试 Step 6.3 |
| 8 | REST 端点返回正确状态码和 body | 路由测试 Step 6.4 |
| 9 | WS subscribe-delegated 实时推送 | 手动 / 集成测试 |
| 10 | sinceSeq 重连回放正确 | 手动 / 集成测试 |
| 11 | metadataOnly=true 时无 payload | 单元 + 集成测试 |
| 12 | 过期 delegation 不触发转发 | 单元测试 |
| 13 | 反压队列溢出不崩溃 | 压力测试 |
| 14 | 双节点集成测试（Docker testnet）| `scripts/integration-test.mjs` |

---

## 10. 设计决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| 转发机制 | Target 主动 push | Target 是唯一知道"消息到达"的节点 |
| P2P 协议 | 新 `/clawnet/1.0.0/delegated-msg` | 语义隔离、独立 rate-limit、不混入 inbox |
| Gateway 侧存储 | SQLite `delegated_inbox` | 支持 sinceSeq 重连 + 进程重启不丢数据 |
| Topics 通配符 | 不支持 | 安全考量，精确授权 |
| Gateway 验证 delegation | 信任 P2P 层身份 | libp2p Noise 已验证 PeerId→DID，后续可加签名 |
| 反压 | 异步队列 concurrency=5, depth=200 | 防突发流量，失败不重试（sinceSeq 补回） |
| 消息排序 | Gateway 本地 seq + UNIQUE 去重 | P2P best-effort 可能乱序，本地 seq 解决 |
| Scope 排除 | 无 CLI、无 Python SDK | delegation 操作频率低，REST/SDK 足够 |

---

## 附录：完整 API 参考

### REST API

#### `POST /api/v1/messaging/subscription-delegations`

创建订阅授权。

**Request Body:**

```json
{
  "delegateDid": "did:claw:zGateway...",
  "topics": ["telagent/envelope", "telagent/receipt"],
  "expiresInSec": 3600,
  "metadataOnly": true
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| delegateDid | string | 是 | 被授权方 DID |
| topics | string[] | 是 | 精确 topic 列表，不支持通配 |
| expiresInSec | number | 是 | TTL 秒数（60–86400） |
| metadataOnly | boolean | 否 | 默认 true，只转发元数据 |

**Response 201:**

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
  }
}
```

**Error 400:** 参数校验失败 / 配额超限

---

#### `GET /api/v1/messaging/subscription-delegations`

列出所有活跃授权。

**Response 200:**

```json
{
  "data": [
    { "delegationId": "...", "delegateDid": "...", ... }
  ]
}
```

---

#### `GET /api/v1/messaging/subscription-delegations/:id`

查看单个授权详情。

**Response 200:** `{ "data": DelegationRecord }`

**Error 404:** 授权不存在

---

#### `DELETE /api/v1/messaging/subscription-delegations/:id`

撤销授权。

**Response 204:** No Content

**Error 404:** 授权不存在或已撤销

---

### WebSocket API

#### `WS /api/v1/messaging/subscribe-delegated`

Gateway 侧连接此端点接收 delegated 消息。

**Query Parameters:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| delegationId | string | 是 | 授权 ID |
| sinceSeq | number | 否 | 从此 seq 后开始回放 |
| apiKey | string | 否 | API Key (或用 header) |

**Server → Client 帧:**

```jsonc
// 连接成功
{ "type": "connected", "delegationId": "dlg_xxx", "seq": 42 }

// 新消息通知
{
  "type": "delegated-message",
  "data": {
    "type": "delegated-message",
    "delegationId": "dlg_xxx",
    "originalTargetDid": "did:claw:zTarget...",
    "sourceDid": "did:claw:zPeerC...",
    "topic": "telagent/envelope",
    "seq": 43,
    "receivedAtMs": 1741564800000,
    "metadata": {
      "messageId": "msg_abc123",
      "payloadSizeBytes": 2048
    }
  }
}

// 回放完成
{ "type": "replay_done", "lastSeq": 42 }
```

---

### SDK 方法

```typescript
// 创建授权（Target 节点调用）
const dlg = await client.messaging.createSubscriptionDelegation({
  delegateDid: 'did:claw:zGateway...',
  topics: ['telagent/envelope', 'telagent/receipt'],
  expiresInSec: 3600,
  metadataOnly: true,
});
// → DelegationRecord { delegationId, delegateDid, topics, ... }

// 撤销授权
await client.messaging.revokeSubscriptionDelegation('dlg_xxx');

// 列出授权
const list = await client.messaging.listSubscriptionDelegations();
// → DelegationRecord[]
```
