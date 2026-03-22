# ClawNet DHT 超时导致 P2P 基础设施完全损坏

日期: 2026-03-22
报告方: TelAgent 项目组
优先级: P0
关联 Issue:
- clawnetd-bootstrap-did-resolve-still-fails-after-2026-1-3.md

---

## 摘要

ClawNet 的 DHT (Distributed Hash Table) 因持续超时导致整个 P2P 基础设施完全损坏：
- Circuit Relay 地址分发失败 (`provideRelayOnce: DHT provide failed`)
- Peer discovery 失败 (`discoverPeersViaDHT: DHT walk failed`)
- NAT 穿透完全不可用

这不是 TelAgent 的问题，是 ClawNet 的 DHT 超时 bug。

---

## 环境与版本

| 节点 | IP | 版本 | peers | connections |
|------|----|------|-------|-------------|
| Bootstrap | api.clawnetd.com | 2026.1.4 | 5 | 5 |
| Alex | 173.249.46.252 | 2026.1.4 | 1 | 1 |
| Bess | 167.86.93.216 | 2026.1.4 | 1 | 1 |
| 本地 (NAT) | 127.0.0.1 | 2026.1.7 | 1 | 1 |

---

## 关键日志

### Bootstrap (api.clawnetd.com) — ClawNet 日志

```
[p2p] provideRelayOnce: DHT provide failed (The operation was aborted due to timeout) — non-fatal during bootstrap
```

**每 30 分钟失败一次，持续 9+ 小时未恢复。**

```
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
```

### 本地节点 (NAT) — ClawNet 日志

```
[2026-03-22T03:16:09.423Z] [INFO] peer DID registered {
  did: 'did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR',
  peerId: '12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM'
}
```

```
[2026-03-22T03:16:44.805Z] [WARN] direct delivery failed {
  peerId: '12D3KooWDB9SgR1hDMnn5j4gY77aSjcZEgD9f1ATvb1stRouiXEo',
  targetDid: 'did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs',
  category: 'timeout',
  error: 'The operation was aborted due to timeout'
}
```

```
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
```

```
[mesh] aggressive phase complete — 1 peer connection(s), switching to watchdog
```

---

## didPeerMap 状态

| 查询方 | Bootstrap | Alex | Bess | 本地 NAT |
|--------|-----------|------|------|----------|
| 本地 NAT | ✅ | ❌ | ✅ | N/A |
| Alex | ✅ | N/A | ✅ | ❌ |
| Bess | ✅ | ✅ | N/A | ✅ |

**关键不对称：**
- Local 知道 Bess，不知道 Alex
- Alex 知道 Bess，不知道 Local
- Bess 知道 Alex 和 Local

这表明 did-query 协议因 DHT 超时而出现随机性。

---

## 消息投递测试

### 本地 → Alex DID

```json
{
  "delivered": false,
  "messageId": "msg_c01d64ac5b01895ccd50f1ba"
}
```

本地日志: `peer_unknown`

### 本地 → Bess DID

```json
{
  "delivered": false
}
```

本地日志: `direct delivery failed: The dial request has no valid addresses`

---

## 根因分析

### 1. DHT 超时导致 Circuit Relay 完全不可用

```
provideRelayOnce: DHT provide failed (The operation was aborted due to timeout)
```

- Bootstrap 尝试通过 DHT 分发中继地址
- DHT provide 操作超时
- 结果：所有 NAT 节点都无法获取中继地址

### 2. DHT 超时导致 Peer Discovery 失败

```
discoverPeersViaDHT: DHT walk failed (This operation was aborted)
```

- 节点通过 DHT 发现其他 peers
- DHT walk 操作超时
- 结果：节点只能连接 bootstrap，无法形成 mesh 网络

### 3. did-query 协议因 DHT 超时而出现随机性

- DHT 超时导致 DID 解析不对称
- 不同的节点在不同时间点查询得到不同结果
- 这是 did-query 协议的问题，不是 TelAgent 的问题

---

## 影响

- NAT 节点无法通过 bootstrap 解析其他 NAT 节点的 DID
- 消息投递完全失败（peer_unknown 或 no valid addresses）
- 所有节点只能连接 bootstrap，无法形成 P2P mesh 网络
- profile-card 交换不可用

---

## 需要的 ClawNet 修复

1. **修复 DHT timeout 机制**
   - DHT provide 操作不应无限超时
   - 需要超时重试逻辑或更短的超时时间

2. **验证修复后的回归测试**
   ```
   本地 NAT -> Alex DID: delivered = true
   本地 NAT -> Bess DID: delivered = true
   Alex -> 本地 NAT: delivered = true
   Bess -> 本地 NAT: delivered = true
   ```

3. **提供 Bootstrap 上的 DHT 健康指标**
   - DHT provide 成功率
   - DHT query 延迟

---

## 修复进度

暂无。
