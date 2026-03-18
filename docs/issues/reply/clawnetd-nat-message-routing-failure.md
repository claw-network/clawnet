# 回复：NAT 节点 P2P 消息路由失败 — 有连接但消息无法中继到目标 DID

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-nat-message-routing-failure.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-18 |
| 修复版本 | **2026.1.2** (已发布至 npm + PyPI + GitHub Packages) |

---

## 1. 根因确认

TelAgent 的诊断方向完全正确。我们确认了 **三个级联故障**，导致 NAT 节点即使有 bootstrap 连接也无法投递任何 P2P 消息：

### 1.1 DID 解析只返回 PeerId，不返回地址

`DidResolveResponse` 的 FlatBuffer 定义只有 3 个字段：`did`、`peerId`、`found`。

NAT 节点通过 bootstrap 成功解析了目标 DID → PeerId，但 **不知道目标 peer 的任何 multiaddr**。libp2p 在 `peerStore` 中没有这个 peer 的地址记录，因此永远无法发起 dial。

```
resolveDidViaPeers("did:claw:z4MnGw...")
  → 收到: { peerId: "12D3KooW...", found: true }
  → 缺少: multiaddrs（目标 peer 在哪里？不知道）
  → 结果: peerStore 中没有地址，dial 无法发起
```

### 1.2 Outbox 遇到未知 PeerId 直接放弃

`flushOutboxForDid()` 的逻辑：

```typescript
const peerId = this.didToPeerId.get(targetDid);
if (!peerId) return 0;  // ← 直接返回 0，不尝试重新解析
```

如果首次 send 时 DID→PeerId 映射不在内存缓存中，outbox sweep 会在每个周期（30s）都跳过这个 DID，**永远不会重试解析**。

### 1.3 Circuit Relay 从未在消息路径中使用

`circuitRelayTransport()` 在 libp2p 启动时已正确加载，但 `messagingService.send()` 和 `deliverDirect()` 从未构建 relay 路径。消息投递只走直连：

1. 查 `peerStore` 有没有目标地址 → 没有
2. 投递失败 → 入 outbox
3. Outbox sweep → PeerId 未知 → `return 0`
4. 消息永远卡在 outbox

**这就是 Issue 中描述的"连接已建立、重试在运行、但消息仍然无法路由"的完整链条。**

---

## 2. 已完成的修复

### 2.1 增强 DID 解析 — 返回 multiaddrs

**包**: `@claw-network/protocol`

`DidResolveResponse` 新增第 4 个字段 `multiaddrs?: string[]`，FlatBuffer 编解码同步更新（向后兼容，旧版本解码遇到新字段会安全忽略）。

**包**: `@claw-network/core`

`P2PNode` 新增两个方法：

| 方法 | 作用 |
|------|------|
| `getPeerAddresses(peerId)` | 从 peerStore 查询 peer 的已知 multiaddrs |
| `addPeerAddresses(peerId, multiaddrs)` | 通过 `peerStore.merge()` 存储 peer 地址 |

**包**: `@claw-network/node`

`handleDidResolve()` 现在在响应中附带目标 peer 的 multiaddrs。`resolveDidViaPeers()` 收到响应后自动将地址存入 peerStore：

```
resolveDidViaPeers("did:claw:z4MnGw...")
  → 收到: { peerId: "12D3KooW...", found: true, multiaddrs: ["/ip4/1.2.3.4/tcp/9527/p2p/12D3KooW..."] }
  → peerStore.merge() 存储地址
  → 后续 dial 可以直接找到目标
```

### 2.2 Outbox 重新解析未知 DID

`flushOutboxForDid()` 不再在 PeerId 未知时直接 `return 0`，改为：

1. **PeerId 未知** → 调用 `resolveDidViaPeers()` 重新解析 → 解析成功则继续投递
2. **连续 5 次投递失败** → 重新解析 DID（地址可能已变）→ 刷新 peerStore 后重试

```
flushOutboxForDid("did:claw:z4MnGw...")
  → peerId 未知
  → resolveDidViaPeers() → 获得 peerId + multiaddrs
  → peerStore 已有地址 → 尝试 deliverDirect()
  → 投递成功 ✅
```

### 2.3 Relay 路径回退

新增 `tryDeliverViaRelay()` 方法。当直连投递失败时，遍历当前已连接的 peers，构建 circuit-relay 路径尝试中继：

```
send("did:claw:z4MnGw...", topic, payload)
  ├─ resolveDidViaPeers() → 获得 peerId + multiaddrs
  ├─ deliverDirect() → 失败（NAT 阻断）
  ├─ tryDeliverViaRelay()
  │    ├─ 遍历已连接 peers（如 bootstrap）
  │    ├─ 构建 /p2p/<bootstrap>/p2p-circuit/p2p/<target>
  │    ├─ peerStore.merge() 存储 relay 地址
  │    └─ deliverDirect() 通过 relay → 成功 ✅
  └─ 以上均失败 → 入 outbox（下次 sweep 重试）
```

这解决了 Issue 中指出的核心问题：**bootstrap 现在可以扮演消息中继角色**。

### 2.4 增强日志

| 场景 | 旧行为 | 新行为 |
|------|--------|--------|
| 投递失败 | 无日志 | 输出 `category`（no_address / timeout / connection_refused / unknown） |
| Outbox sweep | 仅 `delivered: N` | 输出 `totalFailed`, `totalResolved`, `reResolved` |
| 消息入 outbox | 仅 `queued in outbox` | 附加 `reason`（peerId_unknown / direct_failed / relay_failed）和 `peers` 数量 |
| Relay 尝试 | 不存在 | 输出 relay peer 和目标，以及成功/失败结果 |

---

## 3. 升级指南

### 3.1 升级命令

```bash
# npm
npm install @claw-network/node@2026.1.2 @claw-network/core@2026.1.2 @claw-network/protocol@2026.1.2

# 或 pnpm
pnpm add @claw-network/node@2026.1.2 @claw-network/core@2026.1.2 @claw-network/protocol@2026.1.2

# Python SDK（如果使用）
pip install clawnet-sdk==2026.1.2
```

### 3.2 无需代码修改

此修复完全在内部实现，**不需要 TelAgent 侧做任何代码修改**：

- `messagingService.send()` 的调用签名和返回类型不变
- `delivered: false / true` 语义不变
- FlatBuffer 协议向后兼容（旧版节点可以与新版节点通信）

### 3.3 验证方法

升级后在 NAT 环境重新执行 Issue 中的复现步骤：

```bash
# 1. 启动节点，确认 peers=1
curl http://127.0.0.1:9528/api/v1/node
# → {"data": {"peers": 1, "version": "2026.1.2", ...}}

# 2. 发送消息到公网节点
# 观察日志应出现以下新输出之一：

# 场景 A：直连成功（公网环境）
# [messaging] delivered to did:claw:z4MnGw... via direct

# 场景 B：relay 投递成功（NAT 环境）
# [messaging] relay delivery attempt via 12D3KooWQnQQ... → 12D3KooW... succeeded
# [messaging] delivered to did:claw:z4MnGw... via relay

# 场景 C：需要 outbox 重试（暂时不可达）
# [messaging] message queued in outbox { reason: "relay_failed", peers: 1, ... }
# [outbox-sweep] re-resolved did:claw:z4MnGw... → peerId=12D3KooW...
# [outbox-sweep] delivered 1, failed 0, re-resolved 1
```

### 3.4 需要关注的日志

如果升级后仍然出现 `delivered: false`，请提供以下日志：

1. **启动阶段**: 是否出现 `Imported API key from CLAW_API_KEY` 或 `connection:open` 日志
2. **发送阶段**: `[messaging]` 前缀的日志（新增 category、reason 字段）
3. **Outbox sweep**: `[outbox-sweep]` 的 `totalResolved` / `reResolved` 计数
4. **Relay 尝试**: 是否出现 `relay delivery attempt` 日志，以及后续的 succeeded/failed

---

## 4. 对 Issue 中建议的回应

| Issue 建议 | 状态 | 说明 |
|-----------|------|------|
| 6.1 通过 Bootstrap 中继消息 | ✅ 已实现 | `tryDeliverViaRelay()` 通过 circuit-relay 中继 |
| 6.2 增强 send() 返回信息 | ⏭️ 暂缓 | 内部日志已增强；修改 API 返回结构属 breaking change，留待下一个 major 版本 |
| 6.3 Outbox Sweep 日志增强 | ✅ 已实现 | sweep 现在输出 delivered/failed/re-resolved 统计 |

关于 6.2：我们评估后认为直接修改 `send()` 返回结构会影响 TelAgent 和其他消费者的现有代码。目前新增的详细日志已经能满足诊断需求。如果 TelAgent 确实需要程序化获取投递原因（而非日志），我们可以在后续版本通过新增可选字段的方式引入，不影响现有代码。

---

## 5. 版本对照

| Issue | 引入版本 | 修复版本 | 状态 |
|-------|---------|---------|------|
| bootstrap 空配置 | 初始 | 0.6.15 | ✅ 关闭 |
| P2P 连接诊断缺失 | 初始 | 0.6.15 | ✅ 关闭 |
| Outbox sweep 不重试 | 初始 | 0.6.15 | ✅ 关闭 |
| Bootstrap PeerId 不匹配 | 初始 | 0.6.16 | ✅ 关闭 |
| **NAT 消息路由失败（本次）** | 初始 | **2026.1.2** | **✅ 关闭** |

至此，TelAgent 团队报告的 NAT 节点通信问题的完整链条（连接建立 → PeerId 解析 → 地址发现 → 消息路由 → outbox 重试）均已修复。

---

## 6. 附加修复：API Key 自动导入

在调试过程中我们还发现了一个相关问题：`CLAW_API_KEY` 环境变量设置后，服务端仍返回 401 "No API keys configured"。

**根因**: `ApiKeyStore` 是 SQLite 存储，`CLAW_API_KEY` 环境变量从未被导入到数据库中。

**修复**: 节点启动时自动检测 `CLAW_API_KEY` 环境变量，如果存在且长度 ≥ 32，自动导入到 SqliteStore（幂等，已存在则跳过）。

此修复同样包含在 2026.1.2 中，TelAgent 如果通过环境变量配置 API Key，升级后无需额外操作。
