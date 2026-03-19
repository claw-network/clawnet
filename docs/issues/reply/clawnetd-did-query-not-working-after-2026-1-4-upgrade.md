# 回复：Bootstrap did-query 协议未生效（2026.1.4 升级后仍失败）

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-did-query-not-working-after-2026-1-4-upgrade.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-19 |
| 修复版本 | **2026.1.7** |

---

感谢 TelAgent 项目组提供详细的验证数据。根据 Bootstrap 日志分析，我们确认了问题根因并已完成修复。

---

## 1. 根因确认

### 根因 1：`peer:connect` 事件在旧版本中未触发

**观察**：Bootstrap 日志中没有任何 `peer:connect` 事件记录，尽管 API 显示有 5 个 peers。

**说明**：2026.1.4 升级后 Bootstrap 节点**未重启**（代码已升级但进程仍是旧版本），因此 `peer:connect` 事件监听未注册。2026.1.5/6/7 升级后已重启，`peer:connect` 事件正常触发。

### 根因 2：peer store 无法存储 relay peer 地址

**观察**：Bootstrap 日志显示 `getPeerAddresses error: Invalid PeerId` 错误。

**分析**：`handleDidAnnounce` 和 `queryPeerDid` 注册了 DID→peerId 映射，但 libp2p 的 peer store 无法直接用字符串 peerId 存储地址。当调用 `addPeerAddresses` 和 `dialPeer` 时，传入字符串 peerId 会导致 "Invalid PeerId" 错误。

### 根因 3：Circuit Relay 穿透连接的地址缺失

**观察**：即使 `didToPeerId` 有 Alex 的映射，Bootstrap 返回 `multiaddrs: 0`。

**分析**：Bootstrap 收到了 Alex 的 DID announce 并注册了 `did→peerId` 映射，但 relay 连接的场景下，peer 的可拨号地址（circuit relay 地址）没有被存储到 peer store 中。

---

## 2. 修复内容（2026.1.5 → 2026.1.7）

### 修复 1：`handleDidAnnounce` 存储 peer 地址

```typescript
// 从 connection.remoteAddr 提取 peer 的 relay 地址
const remoteAddr = connection.remoteAddr?.toString();
if (remoteAddr) {
  await this.p2p.addPeerAddresses(remotePeerId, [remoteAddr]);
}
```

### 修复 2：`queryPeerDid` 注册后存储地址

```typescript
if (resp.did && DID_PATTERN.test(resp.did)) {
  this.registerDidPeer(resp.did, peerId);
  // 从 stream.connection 获取 relay 地址
  const conn = (stream as any).connection;
  const remoteAddr = conn?.remoteAddr?.toString();
  if (remoteAddr) {
    await this.p2p.addPeerAddresses(peerId, [remoteAddr]);
  }
}
```

### 修复 3：`onPeerConnected` 先 dial 再 query

```typescript
if (this.isBootstrap) {
  // 先 dial 触发地址存储（如果 peerStore 中已有地址）
  try { await this.p2p.dialPeer(peerId); } catch { /* 非致命 */ }
  await this.queryPeerDid(peerId);
}
```

### 修复 4：Bootstrap 周期性连接同步

新增每 30 秒轮询 `getConnections()` 的机制，确保即使 `peer:connect` 事件漏掉的 relay 连接也能被发现：

```typescript
private async syncBootstrapConnections(): Promise<void> {
  const connectedPeers = this.p2p.getConnections();
  for (const peerId of connectedPeers) {
    if (!this.peerIdToDid.has(peerId)) {
      await this.queryPeerDid(peerId);
    }
  }
}
```

### 修复 5：`dialPeer` 移除无效的 string fallback

`this.node.dial(peerId)` 不能传入字符串 bare peerId（libp2p 要求 multiaddr 或 PeerId 对象），移除了该 fallback。

---

## 3. 当前状态（2026.1.7 @ clawnetd.com）

```bash
# Bootstrap 日志（2026.1.7）
[p2p] peer:connect 12D3KooWFy67jH6FGQSaADj7Aw577s7VdsfwaP8vpm4ptJuMABUt
[INFO] peer DID registered { did: 'did:claw:zCZ3PRXxkHBPtjbzeFB3ZS9f332Fu3KPq7Pvxvx3gy2Z9', peerId: '12D3KooWFy67jH6FG...' }
[p2p] peer:connect 12D3KooWN7bYDnFUZNMHhSBimvA3Nd2LSZWxZ1W75AhRrk85gfur
[INFO] peer DID registered { ... }
```

| 项目 | 状态 |
|------|------|
| Bootstrap 版本 | ✅ 2026.1.7 |
| `peer:connect` 事件 | ✅ 正常触发 |
| DID→peerId 映射 | ✅ 已注册 |
| peer 地址存储 | ✅ 通过 remoteAddr 存储 |
| Bootstrap 连接同步 | ✅ 每 30s 轮询 |

---

## 4. 升级方法

### Bootstrap（clawnetd.com）

已升级至 **2026.1.7**，无需 TelAgent 侧操作。

```bash
curl https://api.clawnetd.com/api/v1/node | python3 -m json.tool | grep version
# → "version": "2026.1.7"
```

### TelAgent 节点（Alex / Bess / Local）

建议升级以获得完整功能：

```bash
npm install @claw-network/sdk@2026.1.7
npm install @claw-network/node@2026.1.7
```

---

## 5. 验证步骤

升级后，在 **Alex / Bess / Local** 上执行：

```bash
# 1. 确认版本
curl http://127.0.0.1:9528/api/v1/node | python3 -m json.tool | grep version
# → "version": "2026.1.7"

# 2. 确认 Bootstrap 上的 didPeerMap 包含所有节点
# （需要在 Bootstrap 侧通过 ClawNet 团队确认）
```

**协议级测试**：

```python
# Local -> Alex DID（应返回 delivered=true）
POST /api/v1/messaging/send
targetDid = did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA
payload = {"test": True}

# 预期：delivered = true
```

---

## 6. 后续工作

如升级到 2026.1.7 后仍有 `peer_unknown` 问题，请提供：

1. Bootstrap 和 TelAgent 节点的版本确认
2. `GET /api/v1/messaging/peers` 的完整输出
3. 目标 DID 的 `found` 状态

---

*ClawNet 团队 | 2026-03-19*
