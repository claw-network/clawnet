# ClawNet NAT → NAT 消息投递 2026.2.8 仍失败

日期: 2026-03-22
报告方: TelAgent 项目组
优先级: P1
关联 Issue:
- clawnetd-nat-to-nat-message-delivery-implementation-suggestions.md
- clawnetd-peer-directory-fallback-still-not-working-2026-2-6.md

---

## 摘要

2026.2.8 已部署，Bootstrap delegation forwarding 已实现，但 `direct delivery failed` 仍然发生。NAT → NAT 消息投递仍然超时失败。

---

## 环境与版本

| 节点 | IP | 版本 | peers |
|------|----|------|-------|
| Bootstrap | 66.94.125.242 | 2026.2.8 | 5 |
| Alex | 173.249.46.252 | 2026.2.8 | 1 |
| Bess | 167.86.93.216 | 2026.2.8 | 1 |
| 本地 (NAT) | 127.0.0.1 | 2026.2.8 | 1 |

---

## 验证结果

### Peer Directory ✅

本地节点成功获取了 9 个 DID，包括所有关键节点。

### NAT → NAT 消息投递 ❌

**本地节点日志：**

```
[mesh] fetchPeerDirectory received 9 entries from 12D3KooWQnQQNGBG
[mesh] peer directory: no new entries (peer has NaN total, all already known)

[WARN] direct delivery failed {
  peerId: '12D3KooWGHAyjsmxTn4Ei4ahrWLS4uhCZZMozJvY9t2R6a9WEgys',
  targetDid: 'did:claw:z7ToozkCFGsnkJB5HDub6J7cN5EKAxcr4CHfPiazcLkFw',
  category: 'timeout',
  error: 'The operation was aborted due to timeout'
}
```

**关键观察：**
1. Peer directory 同步正常（9 个 DID）
2. `direct delivery` 仍然超时失败
3. 没有看到 delegation forwarding 相关的日志（如 `delegated message received` 或 `delegated msg forwarded`）

---

## 根因分析

### 消息投递路径

根据日志，`direct delivery` 使用的是直连路径，而不是 delegation 协议：

```
当前路径（失败）：
NAT 节点 A → direct dial → NAT 节点 B（超时）

期望路径（未生效）：
NAT 节点 A → Bootstrap（delegation）→ NAT 节点 B
```

### 可能原因

1. **消息发送未使用 delegation 协议** - TelAgent 可能仍然使用直连投递
2. **Bootstrap delegation forwarding 未被调用** - 需要检查 ClawNet 代码是否正确路由
3. **Delegation 协议与现有投递路径不一致** - 需要确认 delegation 是新协议还是现有协议的增强

---

## 需要的 ClawNet 调查

1. **确认消息投递路径**：
   - TelAgent 发送消息时使用的是什么协议？
   - 是 `direct delivery` 还是 `delegation`？

2. **确认 delegation forwarding 触发条件**：
   - Bootstrap 收到什么样的消息才会触发 delegation forwarding？
   - 是否需要 TelAgent 显式使用 delegation 协议？

3. **添加调试日志**：
   - Bootstrap 收到消息时，日志应显示消息类型和目标
   - 如果不是 delegation 类型，应说明原因

---

## 建议修复

### 方案 1：确保消息走 delegation 协议

TelAgent 需要使用 delegation 协议发送消息，而不是直连：

```typescript
// 正确的发送方式（如果 TelAgent 没有使用）
await this.gateway.client.messaging.sendDelegated({
  targetDid: recipientDid,
  originalTargetDid: recipientDid,
  payload: envelope,
});
```

### 方案 2：Bootstrap 自动识别并转发

如果 TelAgent 仍然使用直连协议，Bootstrap 应能自动识别并通过 delegation 转发：

```typescript
// handleInboundMessage 中添加：
if (isDirectDeliveryFailed(msg)) {
  // 自动转换为 delegation 并转发
  await forwardViaDelegation(msg);
}
```

---

## 回归测试

修复后需验证：
```
1. Bootstrap 日志应显示 "delegated message received"
2. Bootstrap 日志应显示 "delegated msg forwarded to target"
3. NAT → NAT 消息投递：delivered = true
4. 无 "direct delivery failed" 错误
```
