# ClawNet DHT Discovery 2026.2.2 仍失败

日期: 2026-03-22
报告方: TelAgent 项目组
优先级: P0
关联 Issue:
- clawnetd-dht-discovery-still-failing.md
- clawnetd-dht-discovery-still-failing-after-2026-2-0.md
- clawnetd-bootstrap-did-resolve-still-fails-after-2026-1-3.md

---

## 摘要

2026.2.2 发布后，我们升级了所有节点（Bootstrap、Alex、Bess、本地），但 DHT discovery 问题仍然存在。NAT 节点之间的 P2P 直连仍不可用。

---

## 环境与版本

| 节点 | IP | 版本 | peers |
|------|----|------|-------|
| Bootstrap | api.clawnetd.com (66.94.125.242) | 2026.2.2 | 5 |
| Alex | 173.249.46.252 | 2026.2.2 | 1 |
| Bess | 167.86.93.216 | 2026.2.2 | 1 |
| 本地 (NAT) | 127.0.0.1 | 2026.2.2 | 1 |

---

## 验证结果

### didPeerMap 状态（2026.2.2 升级后）

| 查询方 | Bootstrap | Alex | Bess | 本地 |
|--------|-----------|------|------|------|
| 本地 | ✅ | ❌ **缺失** | ✅ | N/A |
| Alex | ✅ | N/A | ✅ | ❌ **缺失** |
| Bess | ✅ | ✅ | N/A | ✅ |

**关键不对称：**
- Bess 知道所有节点（包括本地）
- Alex 和本地互相不知道对方

### 节点状态

```json
// 本地节点
{ "did": "did:claw:zCZ3PRXxkHBPtjbzeFB3ZS9f332Fu3KPq7Pvxvx3gy2Z9", "peers": 1, "connections": 1 }

// Alex
{ "did": "did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA", "peers": 1, "connections": 1 }

// Bess
{ "did": "did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs", "peers": 1, "connections": 1 }
```

### 消息投递测试

| 测试 | 结果 | 原因 |
|------|------|------|
| 本地 → Alex | ❌ `peer_unknown` | Alex DID 未解析 |
| 本地 → Bess | ✅ | Bess DID 已解析 |

### DHT 日志频率

2026.2.2 升级后，DHT walk 失败仍然出现：

```
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
...
```

---

## 2026.2.2 实际修复确认

根据 ClawNet 回复，2026.2.0/2.2 计划包含：
1. ✅ 增加 DHT timeout (3s→15s) — **已实现**
2. ❌ 降低 DHT discovery 频率 — **未实现**
3. ❌ Bootstrap peer directory fallback — **设计中，未实现**

---

## 根因分析（来自 clawnetd-dht-discovery-still-failing.md）

### DHT 在小网络失败的原因

Kademlia DHT 的设计假设：
- 有大量节点分散在全球
- 任何查询都能在几跳内找到响应节点
- 节点稳定在线

ClawNet 的现实：
- 只有 4 个节点
- 其中 3 个是 NAT 节点（通过 relay 连接）
- Bootstrap 是唯一的稳定节点

在这种情况下，`getClosestPeers(randomKey)` 几乎没有节点可以查询，因此持续超时。

### 推荐解决方案

**使用 Bootstrap 作为 Peer Directory**

在小网络中，DHT 不适合作为 peer discovery 的主要机制。更好的方法是**利用 Bootstrap 节点作为已知 peers 的目录**。

当 DHT discovery 失败时，节点通过 bootstrap 中继查询已知 peers 列表，然后直接 dial。

---

## 需要的修复

根据 ClawNet 2026-03-22 的回复，"Bootstrap peer directory fallback" 是解决 DHT 在小网络失败的关键方案。

请确认：
1. 2026.2.2 是否实际包含该修复？
2. 如果未包含，预计何时发布包含该修复的版本？

---

## 回归测试

修复后需验证：
```
1. 所有节点 peers ≥ 2
2. didPeerMap 包含所有节点 DID
3. 本地 NAT → Alex DID: delivered = true
4. 本地 NAT → Bess DID: delivered = true
```
