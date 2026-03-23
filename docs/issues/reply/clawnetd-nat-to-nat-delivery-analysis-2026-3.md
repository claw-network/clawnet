# 回复：NAT-to-NAT 消息投递分析：根因与系统性改进建议

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-nat-to-nat-delivery-analysis-2026-3.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-23 |
| 修复版本 | **2026.3.1** |

---

感谢 TelAgent 项目组的详细根因分析。你们识别的三层嵌套失败链是准确的，我们已在 **2026.3.1** 中实施了所有 P0 修复。

---

## 1. 根因确认

你们分析的三层问题全部确认：

| 层级 | 问题 | 根因 |
|------|------|------|
| 第一层 | 直接连接超时 | NAT 穿透失败（预期行为） |
| 第二层 | Relay 投递静默失败 | `tryDeliverViaRelay` 失败时仅有 DEBUG 日志 |
| 第三层 | 重新解析被 TTL 阻止 | `isStalePeerMapping` 判断导致 stale mapping 仍被使用 |

---

## 2. 修复内容

### P0-1: 直接投递失败后强制重新解析

**`packages/node/src/services/messaging-service.ts`**

移除了 `isStalePeerMapping()` 检查，直接投递失败后无论 TTL 是否过期都会触发 `resolveDidViaPeers()`：

```typescript
// 改前（旧行为 ≤2026.3.0）
if (this.isStalePeerMapping(targetDid)) {
  const resolved = await this.resolveDidViaPeers(targetDid);
  // ...
}

// 改后（新行为 2026.3.1+）
const delivered = await this.deliverDirect(peerId, ...);
if (!delivered) {
  // 直接投递失败，立即重新解析（不依赖 TTL）
  const resolved = await this.resolveDidViaPeers(targetDid);
  // ...
}
```

### P0-2: Relay 投递失败日志升级为 INFO

```typescript
// 改前（旧行为）
this.log.debug('[messaging] relay delivery via %s failed: %s', ...);

// 改后（新行为）
this.log.info('[messaging] relay delivery failed', {
  relayPeerId,
  targetPeerId,
  targetDid,
  error: err.message,
  errorType: (err as any).code || 'unknown',
  relayMultiaddr,
});
```

### P0-3: Outbox 入队日志升级为 INFO

`sendToTargets()` 的 multicast 路径现在也会输出 INFO 日志，便于运维感知消息堆积。

### P1-5: flushOutboxForDid 支持 relay 投递

```typescript
let ok = await this.deliverDirect(peerId!, ...);
if (!ok) {
  // 新增：直接投递失败后尝试 relay
  ok = await this.tryDeliverViaRelay(peerId!, ...);
}
```

---

## 3. 行为变化

| 场景 | 旧行为（≤2026.3.0） | 新行为（2026.3.1+） |
|------|----------------------|-------------------|
| 直接投递失败 | 等待 30min TTL 才重新解析 | 立即重新解析 |
| Relay 投递失败 | 仅 DEBUG 日志（静默） | INFO 日志（含错误类型和 relayMultiaddr） |
| Outbox 入队（multicast） | 无日志 | INFO 日志 |
| Outbox flush 失败 | 仅直接重试 | 直接 + relay 双重重试 |

---

## 4. TelAgent 升级步骤

升级 `@claw-network/node` 到 `2026.3.1`：

```bash
npm install @claw-network/node@2026.3.1
# 或
pnpm update @claw-network/node@2026.3.1
```

重启节点后：

1. **直接投递失败**时会立即触发重新解析，不再等待 30 分钟 TTL
2. **Relay 投递失败**会在日志中看到 INFO 级别的详细错误信息
3. **Outbox 消息堆积**会在日志中看到 INFO 级别的队列通知

---

## 5. 验证方法

### 验证 P0-1（重新解析触发）

启动两个 NAT 节点，发送跨 NAT 消息，观察日志：

```
deliverDirect() → failed → resolveDidViaPeers() → re-resolved → deliverDirect() → result
```

### 验证 P0-2（Relay 失败日志）

发送消息到未连接 Bootstrap 的目标节点，确认日志中有：

```
[messaging] relay delivery failed { relayPeerId: '...', errorType: 'timeout', relayMultiaddr: '/p2p/...' }
```

### 验证 P0-3（Outbox 日志）

消息投递失败后，确认日志中有：

```
[messaging] message queued in outbox { messageId: '...', targetDid: '...', reason: 'delivery_failed' }
```

---

## 6. P1/P2 待办

以下问题将在后续版本中处理：

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P1 | Peer Directory NaN total 调查 | 待调查 |
| P1 | 长连接 Keep-Alive for NAT peers | 待设计 |
| P2 | Store-and-Forward Relay 模式 | 需要 Bootstrap 侧支持 |

---

*ClawNet 团队 | 2026-03-23*
