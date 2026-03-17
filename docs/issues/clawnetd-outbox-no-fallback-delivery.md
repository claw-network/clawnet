# ClawNet：P2P 消息 Outbox 无降级投递机制 — 0 peers 时消息永远无法送达

| 字段 | 值 |
| --- | --- |
| 优先级 | **P1 — 影响 NAT 后节点的所有 P2P 消息可靠性** |
| 提出方 | TelAgent 团队 |
| 提出日期 | 2026-03-17 |
| 影响范围 | 所有 P2P 连接不稳定或 NAT 后的节点 |
| `@claw-network/node` 版本 | 0.6.14 |

---

## 1. 问题描述

当 ClawNet 节点的 P2P 连接数为 0 时，所有通过 `messagingService.send()` 发送的消息会被放入 outbox。但 **outbox flush 仅在 `peer:connect` 事件触发时执行**，导致：

- 如果节点因 NAT、网络隔离、bootstrap 故障等原因无法建立 P2P 连接
- 所有消息**永远卡在 outbox**，不会有任何重试或降级投递
- 用户在 Webapp 上看到消息已发送（本地入 outbox 成功），但对方永远收不到

ClawNet Node 日志：

```
[messaging] message queued in outbox { messageId: 'msg_xxx', targetDid: 'did:claw:z...', topic: 'telagent/profile-card' }
[messaging] message queued in outbox { messageId: 'msg_yyy', targetDid: 'did:claw:z...', topic: 'telagent/envelope' }
# ... 无 delivered 日志，无 retry 日志
```

---

## 2. 当前行为

```
消息发送 → messagingService.send()
    │
    ├─ 目标 peer 在线且已连接 → 直接投递 ✅
    │
    └─ 目标 peer 不可达 → 入 outbox
        │
        └─ 等待 peer:connect 事件 → flush outbox
            │
            └─ 永远不触发 → 消息永久丢失 ❌
```

---

## 3. 期望行为

建议增加以下降级机制（按可行性排序）：

### 3.1 定时 Outbox 重试（最小改动）

即使没有新的 `peer:connect`，也定时扫描 outbox 并尝试投递。如果此时有任何可达的节点（通过 relay 或直连），消息可以被投递。

```
每 30 秒 → 扫描 outbox → 尝试 dial 目标 peer → 投递或跳过
```

### 3.2 通过 Bootstrap / Relay 节点中继 Outbox 消息

当直连不可用时，通过 bootstrap 或 relay 节点作为中间人存储转发：

```
本地节点 → relay/bootstrap → 目标 peer（relay 缓存直到目标上线）
```

这类似邮件系统的 MX 记录 — 消息不需要端到端直连，可以通过中间节点中继。

### 3.3 HTTP Relay 降级

对于有公网 URL 的节点（如设置了 `TELAGENT_PUBLIC_URL`），可以通过 HTTP 直接投递消息而不依赖 P2P：

```
本地节点 → HTTP POST target.publicUrl/api/v1/messaging/receive → 目标节点
```

---

## 4. 关联问题

- [NAT 环境下 P2P 连接无法建立](clawnetd-nat-p2p-connection-failure.md) — 根本原因是连接建立失败
- [空 bootstrap 配置](clawnetd-empty-bootstrap-config.md) — 加剧了连接问题
- [开放式 Relay 激励机制](clawnetd-open-relay-incentive.md) — 建设更可靠的 relay 网络

---

## 5. 临时讨论

如果 P2P outbox 降级短期内较难实现，是否可以**暴露一个 HTTP API 用于消息投递**？类似：

```
POST /api/v1/messaging/relay
{
  "targetDid": "did:claw:z...",
  "topic": "telagent/profile-card",
  "payload": "...",
  "sourceDid": "did:claw:z..."
}
```

这样 telagent 节点可以在 P2P 不可用时，通过已知的公网 relay 节点 HTTP 投递消息。这不需要修改 P2P 层，只需要添加一个 HTTP-to-P2P 的桥接端点。
