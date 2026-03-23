# NAT-to-NAT 消息投递分析：根因与系统性改进建议

日期: 2026-03-23
报告方: TelAgent 项目组
优先级: **P0**
状态: **分析报告**

---

## 摘要

在升级到 2026.3（修复 `handleDidQuery` 10s 超时问题）后，我们对 NAT-to-NAT 消息投递进行了深入分析。发现了一个**三层嵌套的投递失败链**，涉及：①直接连接失败（NAT 穿透超时）、②中继投递逻辑缺陷（中继自身被跳过）、③Bootstrap Peer Directory 只能同步已连接 peers 的信息。

本 issue 记录完整的根因分析，并提出系统性改进建议。

---

## 日志证据

### 关键时间线（本地 NAT 节点启动）

```
13:14:44  [p2p] peer:connect 12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM  ← Bootstrap
13:14:56  [INFO] peer DID registered { Bootstrap DID, peerId: 12D3KooWQn... }            ← Bootstrap DID 注册成功
13:15:07  [INFO] fetchPeerDirectory received 9 entries — no new entries (NaN total)       ← Peer Directory 9个条目，但无 Alex
13:15:32  [WARN] direct delivery failed { peerId: 12D3KooWHB5..., targetDid: Alex, category: 'timeout' }
           [mesh] aggressive phase complete — 1 peer connection(s)                            ← 仅 Bootstrap 1个连接
```

### 关键观察

1. **DID 查询超时已修复** ✅ — 不再出现 `failed to handle DID query { timeout }` 警告
2. **直接投递失败（timeout）** — Alex 的 peer ID 在本地 `didToPeerId` map 中存在（从 9 个 restored DID mappings 中获得），但连接超时
3. **Peer Directory 无 Alex** — Bootstrap 的 peer directory 返回 9 个条目，但其中没有 Alex（DID: `z8MifVfD...`）
4. **仅 1 个 peer 连接** — mesh aggressive phase 完成时只有 Bootstrap 连接，没有 NAT peers

---

## 根因分析：三层嵌套失败链

### 第一层：直接连接失败（NAT 穿透超时）

```
[WARN] direct delivery failed {
  peerId: '12D3KooWHB5qEnnoTAT8n7ZtLAQgpDDioLgDQcviF6okoyZo8H76',  ← Alex 的 peer ID
  targetDid: 'did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA',
  category: 'timeout'
}
```

**原因**: 本地 NAT 节点尝试直接 dial Alex 的 peer ID，但两个 NAT 节点之间的 UDP hole punch 失败。这是 NAT 穿透的固有问题，不在本 issue 范围内（属于 libp2p dcutr 机制）。

---

### 第二层：中继投递逻辑缺陷（关键发现）

当直接投递失败后，`send()` 调用 `tryDeliverViaRelay()`：

```typescript
// ClawNet packages/node/src/services/messaging-service.ts (第 1554-1598 行)
private async tryDeliverViaRelay(targetPeerId, targetDid, ...): Promise<boolean> {
  const connectedPeers = this.p2p.getConnections();  // [Bootstrap peerId]
  for (const relayPeerId of connectedPeers) {
    if (relayPeerId === targetPeerId) continue;  // ← 跳过目标自身！
    const relayMultiaddr = `/p2p/${relayPeerId}/p2p-circuit/p2p/${targetPeerId}`;
    stream = await this.p2p.newStreamMultiaddr(relayMultiaddr, PROTO_DM);
    // ...
  }
}
```

**问题链**：

1. 本地节点只有 **1 个 connected peer**：Bootstrap 自身
2. Alex 的 `targetPeerId` = `12D3KooWHB5q...`（Alex 的 peer ID）
3. `connectedPeers` = `[12D3KooWQn...（Bootstrap 的 peer ID）]`
4. 循环检查：`relayPeerId(12D3KooWQn...) === targetPeerId(12D3KooWHB5...)` → **不相等**
5. 理论上应该通过 Bootstrap relay，但实际未执行 relay

**核心问题**：`connectedPeers` 返回的是**与本地节点直接连接的 peer IDs**。本地节点只连接到 Bootstrap，所以 `connectedPeers = [Bootstrap_peerId]`。Alex 不是直接连接的 peer，所以循环尝试通过 Bootstrap relay 到 Alex：

```
relayMultiaddr = /p2p/Bootstrap_peerId/p2p-circuit/p2p/Alex_peerId
```

这构造是正确的，但 **`newStreamMultiaddr` 可能超时或失败**。失败后没有日志（代码只有 catch 中的一般性错误处理），导致静默失败。

**验证**：日志中没有 `tryDeliverViaRelay` 的任何输出（既无成功也无失败），说明要么 relay stream 操作挂起直到 node 被 kill，要么跳过了整个路径。

---

### 第三层：Bootstrap Peer Directory 无法同步未连接的 NAT peers

```
[INFO] fetchPeerDirectory received 9 entries from 12D3KooWQnQQNGBG
[messaging] peer directory: no new entries (peer has NaN total, all already known)
```

关键发现：**Alex 不在 Bootstrap 的 peer directory 中**。这说明 Alex 当前**未连接到 Bootstrap**。

**可能的解释**：
- Alex（云节点）可能已离线或重启
- Alex 的 ClawNet 进程可能崩溃
- Alex 和 Bootstrap 之间的连接已超时断开

这解释了为什么 `fetchPeerDirectory` 返回 9 个条目但其中没有 Alex — Bootstrap 只同步**当前已连接**的 peers。

---

### 投递失败完整路径

```
本地节点尝试发送消息给 Alex：
  1. didToPeerId.get(Alex_DID) → 存在（从 persisted storage 恢复的 9 个映射之一）
     └→ Alex_peerId = 12D3KooWHB5qEnnoTAT8n7ZtLAQgpDDioLgDQcviF6okoyZo8H76

  2. deliverDirect(Alex_peerId) → TIMEOUT（NAT hole punch 失败）

  3. isStalePeerMapping(Alex_DID) → false（TTL 30 分钟，映射太新不重新解析）
     └→ 跳过 resolveDidViaPeers

  4. tryDeliverViaRelay(Alex_peerId)：
     ├→ connectedPeers = [Bootstrap_peerId]
     ├→ relayPeerId = Bootstrap_peerId
     ├→ relayMultiaddr = /p2p/Bootstrap_peerId/p2p-circuit/p2p/Alex_peerId
     ├→ newStreamMultiaddr(...) → 失败（Alex 未连接 Bootstrap，relay 路径不通）
     └→ 返回 false

  5. → 消息进入 outbox 队列
```

---

## 系统性问题分析

### 问题 A：Stale Peer ID 导致误投

本地 `didToPeerId` 中有 Alex 的 peer ID，但这个映射是**过期的**（Alex 可能已断开连接）。直接投递时使用这个过期映射，导致超时。

**建议**：在直接投递失败后，应立即触发 `resolveDidViaPeers` 重新解析，而不是等待 TTL 过期。

当前逻辑：
```typescript
if (this.isStalePeerMapping(targetDid)) {
  // 重新解析 — 只有映射超过 30 分钟才执行
  const resolved = await this.resolveDidViaPeers(targetDid);
}
```

**改进建议**：直接投递失败本身应触发重新解析，而不是依赖 TTL 判断：
```typescript
const delivered = await this.deliverDirect(peerId, ...);
if (!delivered) {
  // 立即重新解析（不管映射是否 stale）
  const resolved = await this.resolveDidViaPeers(targetDid);
  if (resolved) {
    // 使用新解析的 peer ID 重试
  }
}
```

### 问题 B：Relay 投递无专门日志

`tryDeliverViaRelay` 失败时只有通用的 `catch (err)` 处理，没有针对性的日志输出。无法区分：
- Relay 连接超时
- Relay 路径不存在（目标未连接 relay）
- Relay 协议错误

**建议**：在 `tryDeliverViaRelay` 的 catch 中添加详细的错误分类日志。

### 问题 C：Outbox 队列后无告警

消息进入 outbox 后静默存储，直到下次 `sweepOutbox`（30 秒间隔）才会重试。如果 Alex 一直未连接，用户看不到任何投递失败指示。

**建议**：首次 outbox 存储时输出 `INFO` 级别日志（而非 `DEBUG`），让运维可见消息未送达。

### 问题 D：Peer Directory 的 NaN total 问题

```
[messaging] peer directory: no new entries (peer has NaN total, all already known)
```

`NaN total` 表明 Bootstrap 返回的 peer directory 中 `total` 字段无效。这可能是 Bootstrap peer store 中 peers 数量为 0 或统计逻辑问题。

**建议**：检查 Bootstrap 的 `getPeerDirectory()` 返回值，确认 `total` 字段计算逻辑。

---

## 改进建议优先级

### P0（立即修复）

1. **直接投递失败后强制重新解析**
   - 不依赖 `isStalePeerMapping`
   - 直接投递失败 = 触发 `resolveDidViaPeers` 的信号

2. **Relay 投递添加详细日志**
   - 区分：超时 / 路径不存在 / 协议错误
   - 输出 relay multiaddr 便于调试

3. **Outbox 首次入队输出 INFO 日志**
   - `message queued in outbox` 改为 `info` 级别

### P1（重要但不紧急）

4. **Peer Directory NaN total 调查**
   - 确认 Bootstrap 的 peer store 状态
   - Alex 是否实际连接着 Bootstrap

5. **长连接 Keep-Alive for NAT peers**
   - NAT 节点连接 Bootstrap 后，定期发送 heartbeat
   - 防止连接因超时被关闭

### P2（架构改进）

6. **Store-and-Forward Relay 模式**
   - 当 relay 路径不存在时，Bootstrap 暂存消息
   - Alex 重连后 Bootstrap 主动推送（类似 outbox sweep）
   - 这需要 Bootstrap 侧支持 outbox 持久化

---

## 验证方法

### 1. 确认 Alex 当前连接状态

```bash
# 在 Bootstrap 侧（或通过 API）
curl https://api.clawnetd.com/api/v1/messaging/peers | jq '.data | length'
# 预期：如果 Alex 在线，应包含 Alex 的 DID
```

### 2. 确认 relay 路径是否可达

在本地节点触发一次发送后，检查 Bootstrap 日志是否有：
- `handleDeliveryAuth` 被调用
- `handleDeliveryExternal` 被调用

### 3. 完整投递链路追踪

在本地节点添加临时日志，确认：
```
deliverDirect() failed → resolveDidViaPeers() triggered → tryDeliverViaRelay() called → result
```

---

## 结论

NAT-to-NAT 消息投递失败是一个**三层嵌套问题**：
1. **直接连接** — NAT 穿透超时（预期行为）
2. **Relay 路径** — Alex 未连接 Bootstrap 导致 relay 不可达
3. **Stale mapping** — 重新解析被 TTL 阻止

核心改进方向：**直接投递失败应立即触发重新解析**，而不是等待 30 分钟 TTL。

---

*TelAgent 项目组 | 2026-03-23*
