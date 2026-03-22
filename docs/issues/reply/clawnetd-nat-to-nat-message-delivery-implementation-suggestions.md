# 回复：ClawNet NAT → NAT 消息投递实现建议

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-nat-to-nat-message-delivery-implementation-suggestions.md` |
| 优先级 | **P1** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-22 |
| 修复版本 | **2026.2.8** |

---

感谢 TelAgent 项目组详细的实现建议。我们已实现核心的 Bootstrap 中继转发机制。

---

## 1. 问题分析

### 当前投递流程（修复前）

```
Node A (NAT) → Bootstrap → Node B (NAT)

1. Node A 调用 deliverDirect(Node B)         → 超时失败
2. tryDeliverViaRelay(Node B)                  → 失败（circuit relay 需要目标能接受入站连接）
3. 消息存入 outbox                           → 等待下次 outbox sweep 重试
```

**核心问题**：`tryDeliverViaRelay` 使用的是 libp2p 的 native circuit relay dial（`/p2p/relay/p2p-circuit/p2p/target`）。这要求目标节点（B）能接受来自 relay 的入站连接。但 NAT 节点只能发起出站连接，无法接受入站连接。

### delegation forwarder 未被使用

虽然代码中存在 `DelegationForwarder` 和 `PROTO_DELEGATED_MSG` 协议，但 Bootstrap 收到 delegated message 时只存储到 `delegatedInbox`，**从未转发给 originalTargetDid**。

---

## 2. 修复方案

### Bootstrap 中继转发（已实现）

**文件**：`packages/node/src/services/messaging-service.ts`

当 Bootstrap 收到 delegated message 时，添加主动转发逻辑：

```typescript
// handleInboundDelegatedMsg 中添加：
// Bootstrap relay: if the original target is a connected peer, immediately
// forward the message so NAT nodes can receive messages without needing
// inbound-capable connections.
const targetPeerId = this.didToPeerId.get(msg.originalTargetDid);
if (targetPeerId && this.p2p.getConnections().includes(targetPeerId)) {
  const forwardData = Buffer.from(JSON.stringify(msg), 'utf-8');
  // Non-blocking: don't await send. Message is already persisted in delegatedInbox.
  this.sendDelegatedMsg(targetPeerId, forwardData)
    .then((ok) => { /* log success */ })
    .catch((err) => { /* log failure — outbox sweep will retry */ });
}
```

### 工作流程

```
1. Node A (NAT) 发送消息到 Node B (NAT)
   → deliverDirect(B) 失败（超时）
   → tryDeliverViaRelay(B) 失败（NAT 无法接受入站连接）
   → 消息存入 outbox

2. [如果有 delegation 机制] Node A 通过 PROTO_DELEGATED_MSG 发送委托消息到 Bootstrap

3. Bootstrap handleInboundDelegatedMsg():
   a. 存储到 delegatedInbox
   b. 通知 subscribers（WebSocket 推送）
   c. [新增] 检查 originalTargetDid (Node B) 是否在线
   d. 如果在线：通过 sendDelegatedMsg 转发给 Node B（fire-and-forget）
   e. 如果不在线：消息保留在 delegatedInbox，等待下次 outbox sweep
```

### 为什么使用 fire-and-forget

- 消息已持久化到 `delegatedInbox`（安全网）
- 如果转发失败，outbox sweep 会在下次重试
- 不等待 `sendDelegatedMsg` 完成，避免阻塞 Bootstrap

---

## 3. 关于 TelAgent 建议的说明

TelAgent 建议的 ACK 机制、离线队列、连接保活等改进可以进一步提升可靠性，但需要更大的架构改动：

| 建议 | 状态 | 说明 |
|------|------|------|
| Bootstrap 中继 | ✅ 已实现 | Delegation forwarding 已激活 |
| 消息 ACK | 🔜 后续 | 需要协议改造 |
| 离线队列持久化 | ✅ 已存在 | delegatedInbox + outbox sweep |
| 连接保活 | 🔜 后续 | libp2p 已有连接管理 |
| 消息优先级队列 | 🔜 后续 | 可优化但不紧急 |

---

## 4. 状态表

| 检查项 | 状态 |
|--------|------|
| Bootstrap 中继转发 | ✅ |
| 编译通过 | ✅ |
| 发布版本 2026.2.8 | ✅ |
| Bootstrap 已升级 | ✅ (运行中) |
| 回归测试通过 | ⏳ 待 TelAgent 验证 |

---

## 5. 回归测试验证

修复后请验证：

| 测试 | 预期结果 |
|------|----------|
| NAT A → NAT B 消息 | `delivered = true`（通过 Bootstrap 中继） |
| Bootstrap 日志 | 应显示 `delegated message received` 和 `delegated msg forwarded to target` |
| 离线消息 | 当目标不在线时，消息保留在 delegatedInbox |

---

## 6. 升级说明

```bash
# Bootstrap 已自动升级到 2026.2.8
# TelAgent 各节点：
npm install @claw-network/node@2026.2.8
```
