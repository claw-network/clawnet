# 回复：ClawNet DHT Discovery 2026.2.2 仍失败

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-dht-discovery-still-failing-after-2026-2-2.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-22 |
| 修复版本 | **2026.2.3** |

---

感谢 TelAgent 项目组提供详细的日志。我们确认了问题并已实现完整的修复方案。

---

## 1. 根因确认

### DHT Peer Discovery 在小网络中根本不工作

**问题**：`amplifyMesh()` 中的 DHT `getClosestPeers` 在只有 4 个节点的网络中持续超时。增加 timeout 和降低频率只是减少了失败次数，并没有解决根本问题。

**根本原因**：Kademlia DHT 设计用于大规模 P2P 网络，假设有大量节点分散在全球。在只有 4 个节点（且其中 3 个是 NAT 节点）的网络中，DHT 无法找到足够的中间节点转发查询。

### 为什么之前修复不充分

| 版本 | 修复内容 | 问题 |
|------|----------|------|
| 2026.2.0 | DHT timeout 3s→15s | 仍无法解决 DHT 在稀疏网络中的根本问题 |
| 2026.2.1 | aggressive interval 5s→15s | 仍无法解决 DHT 在稀疏网络中的根本问题 |
| **2026.2.3** | **Bootstrap Peer Directory Fallback** | **绕过 DHT，使用 Bootstrap 作为 peer directory** |

---

## 2. 修复方案：Bootstrap Peer Directory Fallback

### 核心思路

当 DHT peer discovery 失败时，节点通过 Bootstrap 查询已知 peers 的 DID→PeerId 映射列表，然后直接 dial。

### 新增协议：`/clawnet/1.0.0/peer-directory`

**请求格式**：空（复用 `DidQueryRequest` 的空 struct）

**响应格式**：JSON 数组 `[[did, peerId], ...]`

### 工作流程

```
节点 A (不知道节点 B 的 DID)
    │
    │ amplifyMesh() → DHT getClosestPeers() → 超时返回 0
    │
    ▼
fetchPeerDirectory(Bootstrap)
    │
    ▼
Bootstrap 返回: [["did:claw:zAlex...", "12D3KooW..."], ["did:claw:zBess...", "12D3KooW..."]]
    │
    ▼
节点 A 更新本地 didToPeerId 和 peerIdToDid 映射
    │
    ▼
节点 A 尝试 dial 新发现的 peers
```

### 实现位置

- **`packages/node/src/services/messaging-service.ts`**：
  - `PROTO_PEER_DIRECTORY` 常量
  - `handlePeerDirectory()`：Bootstrap 处理请求，返回所有已知 DID→PeerId 映射
  - `fetchPeerDirectory()`：客户端获取并学习 Bootstrap 的映射

- **`packages/node/src/index.ts`**：
  - `amplify()`：当 `amplifyMesh()` 返回 0 时，调用 `fetchPeerDirectory()` 作为 fallback
  - `watchdog()`：同样的 fallback 逻辑

---

## 3. 回归测试验证

修复后请验证以下场景：

| 测试 | 预期结果 |
|------|----------|
| 所有节点 peers | ≥ 2 |
| Bootstrap didPeerMap | 包含所有 4 个节点的 DID |
| 本地 NAT → Alex DID | `delivered = true` |
| 本地 NAT → Bess DID | `delivered = true` |
| Alex → 本地 NAT | `delivered = true` |
| Bess → 本地 NAT | `delivered = true` |

---

## 4. 状态表

| 检查项 | 状态 |
|--------|------|
| 根因分析完成 | ✅ |
| Bootstrap Peer Directory 协议实现 | ✅ |
| amplify() fallback 集成 | ✅ |
| watchdog() fallback 集成 | ✅ |
| 编译通过 | ✅ |
| 发布版本 2026.2.3 | ✅ |
| Bootstrap 已升级 | ✅ (当前运行 2026.2.3) |
| 回归测试通过 | ⏳ 待 TelAgent 验证 |
