# ClawNet：NAT 节点 P2P 消息路由失败 — 有连接但消息无法中继到目标 DID

| 字段 | 值 |
| --- | --- |
| 优先级 | **P0 — 阻塞所有 NAT 后节点的联系人发现和消息投递** |
| 提出方 | TelAgent 团队 |
| 提出日期 | 2026-03-18 |
| 影响范围 | 所有在 NAT 后运行的嵌入式节点，即使已建立 bootstrap 连接 |
| `@claw-network/node` 版本 | 2026.1.1 |
| `@claw-network/core` 版本 | 2026.1.1 |
| `@claw-network/sdk` 版本 | 2026.1.1 |
| 发现场景 | TelAgent WebApp 添加联系人时无法获取对端头像和昵称 |
| 关联 Issue | `clawnetd-nat-p2p-connection-failure.md`, `clawnetd-outbox-no-fallback-delivery.md` |

---

## 1. 问题描述

NAT 后的本地节点**已成功连接 1 个 bootstrap peer**（`peers: 1, connections: 1`），但通过 `messagingService.send()` 发送的 P2P 消息**始终返回 `delivered: false`**，消息被放入 outbox 后永远无法到达目标节点。

### 用户可见影响

TelAgent WebApp 添加联系人时：
- ✅ DID 链上解析正常（身份验证通过）
- ❌ 对端头像无法显示
- ❌ 对端昵称无法获取
- ❌ 所有 P2P 消息（文本消息、profile-card 交换、回执）无法投递

这意味着 NAT 后的节点**完全无法进行任何 P2P 通信**，即使它已经与 bootstrap 节点建立了连接。

### 与之前 Issue 的区别

| Issue | 状态 | 本次新发现 |
|-------|------|-----------|
| `clawnetd-nat-p2p-connection-failure` | 0.6.15 修复了诊断日志 | 连接本身已成功（peers=1），**但消息路由仍然失败** |
| `clawnetd-outbox-no-fallback-delivery` | 0.6.15 加了 outbox 定时扫描 | 扫描在运行，**但投递仍然失败**（每次扫描都 `delivered: false`） |

关键区别：之前的 Issue 聚焦于"连接建立失败"和"outbox 不重试"。**本次的问题是连接已建立、重试也在运行，但消息仍然无法路由到目标 DID。**

---

## 2. 复现步骤

### 环境

- macOS（家用路由 NAT 后）
- Node.js v22
- `@claw-network/node` 2026.1.1（嵌入式模式）
- 目标节点：Bess（`bess.telagent.org`，公网节点）

### 步骤

```bash
# 1. 启动本地 TelAgent 节点（嵌入式 ClawNet 自动启动）
node --env-file=.env packages/node/dist/main.js

# 2. 确认 ClawNet 节点状态 — peers=1 说明已成功连接 bootstrap
curl http://127.0.0.1:9528/api/v1/node
# → {"data": {"peers": 1, "connections": 1, "synced": true, ...}}

# 3. 通过 TelAgent API 请求 Bess 的 peer profile（触发 profile-card push）
curl -k https://127.0.0.1:9443/api/v1/profile/did%3Aclaw%3Az4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs

# 4. 观察日志：消息入 outbox 但未投递
# [transport] sendProfileCard result: {"delivered":false}

# 5. 等待 30 秒（outbox sweep 周期），再次查询 — 仍然为 null
curl -k https://127.0.0.1:9443/api/v1/profile/did%3Aclaw%3Az4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs
# → {"data": null}
```

### 对照组

在同样条件下，从远程 Alex 节点（公网）执行相同操作：

```bash
curl https://alex.telagent.org/api/v1/profile/did%3Aclaw%3Az4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs
# → {"data": {"did": "did:claw:z4MnGw...", "nodeUrl": "https://bess.telagent.org", ...}}
```

Alex（公网） → Bess（公网）：**正常** — profile-card 即时交换成功。
本地（NAT） → Bess（公网）：**失败** — 消息永远卡在 outbox。

---

## 3. 日志分析

### 3.1 本地 ClawNet 节点状态

```json
{
  "did": "did:claw:zBkpYijx56swvPB65VDb8gUbUVk3nNyPdjdhNaoiyQh93",
  "peerId": "12D3KooWLaBiTsXnHnDQo4bW7pLUTGgJz56RQfU7hE4PxnssJdry",
  "synced": true,
  "blockHeight": 128136,
  "peers": 1,
  "connections": 1,
  "network": "devnet",
  "version": "2026.1.1"
}
```

注意：**peers=1, connections=1, synced=true** — 节点对 bootstrap 的连接完全正常。

### 3.2 消息发送日志

```
[profile-card] Pushing own profile card to did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs (nickname=(none), nodeUrl=https://127.0.0.1:9443)
[transport] sendProfileCard → did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs (topic=telagent/profile-card)
[2026-03-18T02:33:13.416Z] [INFO] message queued in outbox {
  messageId: 'msg_5c7566205910885544f466f7',
  targetDid: 'did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs',
  topic: 'telagent/profile-card'
}
[transport] sendProfileCard result: {"messageId":"msg_5c7566205910885544f466f7","delivered":false,"compressed":false,"encrypted":false}
```

关键信息：
- **`delivered: false`** — 消息未投递
- **`message queued in outbox`** — 消息入了 outbox 队列
- **无 `delivery failed` 或错误日志** — MessagingService 没有输出投递失败的具体原因

多次触发后，所有尝试结果相同 — 全部 `delivered: false`。

### 3.3 Mesh 日志

```
[mesh] aggressive phase complete — 1 peer connection(s), switching to watchdog
```

1 个 peer 连接成功建立（bootstrap），但目标 DID 的消息无法通过这个连接中继。

---

## 4. 根因推测

消息投递的预期路径：

```
本地节点 (NAT) ──P2P──► Bootstrap 节点 (公网) ──P2P──► Bess 节点 (公网)
     │                        │                           │
     ├─ peers: 1 ✅           ├─ 中继角色 ？              ├─ peers: ≥1 ✅
     └─ send() → outbox      └─ 转发消息 ？              └─ 收到消息 ？
```

### 可能原因 1：Bootstrap 未充当消息 relay

本地节点与 bootstrap 有 libp2p 连接，但 bootstrap 节点可能**没有将消息转发到目标 DID**。ClawNet 的 `messagingService.send()` 可能只尝试直连目标 DID 的 PeerId，而不通过已连接的 relay 节点中继。

如果 DID → PeerId 映射在本地 DHT 中不存在（因为从未直连过 Bess），node 无法确定目标 PeerId，也无法通过 relay 发信。

### 可能原因 2：Store-and-Forward 仅限直连 peers

`messagingService.send()` 在找不到目标 peer 的直连 connection 时，立即将消息入 outbox，**但 outbox sweep 在重试时可能同样只尝试直连**，而不尝试通过 relay/bootstrap 路由。

### 可能原因 3：DID-to-PeerId 解析失败

ClawNet messaging 需要将目标 DID 解析为 PeerId 才能发送。如果这个解析（通过 DHT 或 DID announce 协议）在 NAT 环境下失败，消息永远无法路由。已连接的 bootstrap 节点理论上应该能提供 DID→PeerId 映射，但是否实际参与了这个过程？

---

## 5. 期望行为

1. **已连接 bootstrap 的 NAT 节点应能成功投递消息**：连接 bootstrap 的意义就在于它是消息路由的入口，NAT 节点应能通过 bootstrap relay 消息到目标 DID
2. **outbox 重试应通过 relay 路径**：outbox sweep 不应仅尝试直连目标 peer，应同时尝试通过已连接的 relay 节点中继
3. **投递失败时应有具体错误日志**：当前 `delivered: false` 没有附带任何失败原因。建议在日志中输出：
   - 目标 DID 对应的 PeerId（是否已知？）
   - 尝试的投递路径（直连 / relay / DHT 查找？）
   - 失败原因（连接超时 / PeerId 未知 / relay 拒绝 / ...）

---

## 6. 建议改进

### 6.1 通过 Bootstrap 中继消息（核心修复）

```
messagingService.send(targetDid, topic, payload)
    │
    ├─ 目标 peer 已直连 → 直接投递
    │
    ├─ 目标 peer 未直连但 DID→PeerId 已知 → 通过 circuit-relay 中继
    │
    ├─ DID→PeerId 未知 → 通过 bootstrap 查询 DID announce → 获取 PeerId → 中继
    │
    └─ 以上均失败 → 入 outbox，等待 peer:connect 或 sweep 重试
```

### 6.2 增强 send() 返回信息

当前 `send()` 返回：
```json
{"messageId": "msg_xxx", "delivered": false}
```

建议增加：
```json
{
  "messageId": "msg_xxx",
  "delivered": false,
  "reason": "target_peer_not_found",        // 或 "relay_unavailable" / "dial_timeout" 等
  "targetPeerId": null,                     // DID→PeerId 解析结果
  "attemptedPaths": ["direct", "relay"],    // 尝试过的路径
  "queuedInOutbox": true
}
```

### 6.3 Outbox Sweep 日志增强

```
[outbox-sweep] Attempting delivery for 3 queued messages
[outbox-sweep] msg_xxx → did:claw:z4MnGw... → peerId=null (DID not resolved) → SKIP
[outbox-sweep] msg_yyy → did:claw:zBkpYi... → peerId=12D3KooW... → relay via bootstrap → DELIVERED
[outbox-sweep] Sweep complete: 1 delivered, 1 skipped, 1 expired
```

---

## 7. 网络拓扑参考

### 本地测试环境

```
本地 macOS (NAT 后)                     公网
┌─────────────────────┐         ┌──────────────────────┐
│ TelAgent Node       │         │ Alex (telagent.org)  │
│ ├─ API: :9443 (TLS) │         │ ├─ API: :443         │
│ └─ ClawNet: :9528   │         │ └─ ClawNet: :9528    │
│    ├─ peers: 1     ─┼────────►│    ├─ peers: 2       │
│    └─ PeerId: ...Jdry│        │    └─ PeerId: ...H76 │
└─────────────────────┘         └──────────────────────┘
         │ (无法直连)                        │ (P2P 直连)
         │                          ┌──────────────────────┐
         └───── ❌ 不可达 ──────────│ Bess (telagent.org)  │
                                    │ ├─ API: :443         │
                                    │ └─ ClawNet: :9528    │
                                    │    ├─ peers: 1       │
                                    │    └─ PeerId: ...    │
                                    └──────────────────────┘
```

- 本地 → Bootstrap：**已连接** ✅
- Bootstrap → Bess：**已连接** ✅（Alex 可以正常跟 Bess 通信）
- 本地 → Bess：**未连接** ❌（NAT 阻挡，且无 relay 路径）

**核心问题：本地节点通过 bootstrap 看到了网络，但 bootstrap 没有扮演消息中继角色。**

---

## 8. 关联 Issue

| Issue | 关系 |
|-------|------|
| [NAT 环境下 P2P 连接无法建立](clawnetd-nat-p2p-connection-failure.md) | 0.6.15 增强了诊断，连接现在可建成（peers=1），但本 issue 表明连接虽建成，消息路由仍失败 |
| [Outbox 无降级投递](clawnetd-outbox-no-fallback-delivery.md) | 0.6.15 加了 sweep 定时器，但 sweep 重试同样 `delivered: false` |
| [开放式 Relay 激励](clawnetd-open-relay-incentive.md) | 如果 bootstrap 不做 relay，需要其他 relay 节点 |
