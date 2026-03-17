# 回复：P2P 消息 Outbox 无降级投递机制

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-outbox-no-fallback-delivery.md` |
| 优先级 | **P1** |
| 状态 | **已修复（方案 3.1 — 定时 Outbox 重试）** |
| 修复日期 | 2026-03-17 |
| 修复版本 | **0.6.15** (已发布至 npm + PyPI，tag `v0.6.15`) |

---

## 1. 确认

问题已确认。原有的 outbox flush 机制仅在以下两个时机触发：

1. `peer:connect` 事件 → `onPeerConnected()` → `flushOutboxForDid()`
2. DID announce 协议收到对端 DID 映射时

如果 P2P 连接始终无法建立（如 NAT 环境），outbox 中的消息不会有任何重试尝试。消息在达到最大 TTL（默认 24 小时）后被 `cleanupOutbox()` 静默清除，用户不可感知。

---

## 2. 修复方案

采用 Issue 建议的**方案 3.1（定时 Outbox 重试）**，这是改动最小且最可靠的第一步。

### 2.1 新增 `getAllOutboxTargetDids()` — MessageStore

**文件**: `packages/node/src/services/message-store.ts`

```typescript
getAllOutboxTargetDids(): string[] {
  const now = Date.now();
  const rows = this.db.prepare(
    'SELECT DISTINCT target_did FROM outbox WHERE (sent_at_ms + ttl_sec * 1000) > ?',
  ).all(now) as Array<{ target_did: string }>;
  return rows.map((r) => r.target_did);
}
```

返回所有有待投递消息（未过期）的目标 DID 列表。

### 2.2 新增 Outbox Sweep 定时器 — MessagingService

**文件**: `packages/node/src/services/messaging-service.ts`

```typescript
/** Outbox sweep interval: attempt re-delivery of queued messages (30 seconds). */
const OUTBOX_SWEEP_INTERVAL_MS = 30_000;

private outboxSweepTimer?: NodeJS.Timeout;

private startOutboxSweep(): void {
  this.outboxSweepTimer = setInterval(() => void this.sweepOutbox(), OUTBOX_SWEEP_INTERVAL_MS);
}

private stopOutboxSweep(): void {
  if (this.outboxSweepTimer) {
    clearInterval(this.outboxSweepTimer);
    this.outboxSweepTimer = undefined;
  }
}

private async sweepOutbox(): Promise<void> {
  const targetDids = this.store.getAllOutboxTargetDids();
  if (targetDids.length === 0) return;

  let totalDelivered = 0;
  for (const did of targetDids) {
    const delivered = await this.flushOutboxForDid(did);
    totalDelivered += delivered;
  }
  if (totalDelivered > 0) {
    this.log.info('[messaging] outbox sweep delivered', {
      delivered: totalDelivered, targets: targetDids.length,
    });
  }
}
```

### 2.3 生命周期集成

- `start()` 中调用 `this.startOutboxSweep()`
- `stop()` 中调用 `this.stopOutboxSweep()`

定时器随 MessagingService 的生命周期自动管理，无需 ClawNetNode 额外接线。

---

## 3. 修复后的消息投递流程

```
消息发送 → messagingService.send()
    │
    ├─ 目标 peer 在线且已连接 → 直接投递 ✅
    │
    └─ 目标 peer 不可达 → 入 outbox
        │
        ├─ peer:connect 事件 → flushOutboxForDid() ✅   (原有)
        ├─ DID announce 事件 → flushOutboxForDid() ✅   (原有)
        └─ 每 30s outbox sweep → flushOutboxForDid() ✅ (新增)
            │
            ├─ 已有 DID→PeerId 映射 → 尝试 deliverDirect()
            │   ├─ 成功 → 从 outbox 移除
            │   └─ 失败 → 保留，下次 sweep 继续（指数退避 1s~60s，最多 50 次）
            │
            └─ 无 DID→PeerId 映射 → 跳过（等待 peer 上线后通过 DID announce 建立映射）
```

关键改进：即使没有新的 `peer:connect` 事件，sweep 也会主动尝试投递，确保在以下场景中消息不会永远卡住：

- 节点重启后恢复了 P2P 连接，但 outbox flush 没有被触发的旧消息
- peer:connect 事件中的 flush 因并发或 backoff 跳过的消息
- DID→PeerId 映射在 sweep 间隔内才建立的消息

---

## 4. 关于方案 3.2 和 3.3 的评估

> **升级命令**：
> ```bash
> npm install @claw-network/node@0.6.15
> # 或
> pnpm add @claw-network/node@0.6.15
> ```

| 方案 | 评估 | 状态 |
|------|------|------|
| **3.1 定时 Outbox 重试** | 改动最小，已实现 | ✅ 已完成 |
| **3.2 Bootstrap/Relay 存储转发** | 需要设计 relay 层消息缓存协议，涉及安全性（中继节点可见消息元数据）和存储策略 | 📋 需单独设计 |
| **3.3 HTTP Relay 降级** | 需要节点公开声明 HTTP URL，建立信任机制确保非伪装投递 | 📋 需单独设计 |

方案 3.2 和 3.3 涉及较大的架构决策（中继存储、身份验证、激励机制等），建议作为独立 RFC 讨论。当前的定时 sweep 机制已经解决了"消息永远卡死"的核心问题。

---

## 5. TelAgent 侧的影响

### 可移除的 workaround

升级到 0.6.15 后，TelAgent 无需为 outbox 问题做任何额外处理。消息队列会自动重试投递。

### 日志变化

升级后在 outbox 有积压消息时，会看到新的 sweep 日志：

```
[messaging] outbox sweep delivered { delivered: 3, targets: 2 }
```

如果所有消息都因目标不可达而未能投递，sweep 静默运行不产生日志（避免日志噪音）。

### 关于提议的 HTTP Relay API

Issue 中提议的 `POST /api/v1/messaging/relay` HTTP 桥接端点是一个好方向。我们将在后续版本中评估此方案，届时会单独沟通设计细节。

---

## 6. 验证方法

```bash
# 1. 发送消息到离线 DID
curl -X POST http://127.0.0.1:9528/api/v1/messaging/send \
  -H "X-Api-Key: <key>" \
  -H "Content-Type: application/json" \
  -d '{"targetDid":"did:claw:zOfflinePeer","topic":"test/ping","payload":"aGVsbG8="}'
# → { "data": { "messageId": "msg_xxx", "delivered": false } }

# 2. 等待 30~60 秒，观察日志
# 应看到 sweep 尝试投递的日志（如有 DID 映射）或静默运行（无映射）

# 3. 当对端节点上线后，sweep 会在下一个 30s 周期内自动投递
```
