# ClawNet DHT Discovery 仍失败

日期: 2026-03-22
报告方: TelAgent 项目组
优先级: P0
关联 Issue:
- clawnetd-dht-timeout-causes-p2p-failure.md
- clawnetd-bootstrap-did-resolve-still-fails-after-2026-1-3.md

---

## 摘要

2026.1.9 修复了 `provideRelayOnce` 超时问题，但 `discoverPeersViaDHT` 仍然持续失败，导致 P2P mesh 网络无法形成。

---

## 环境与版本

| 节点 | IP | 版本 | peers |
|------|----|------|-------|
| Bootstrap | api.clawnetd.com | 2026.1.9 | 5 |
| Alex | 173.249.46.252 | 2026.1.9 | 1 |
| Bess | 167.86.93.216 | 2026.1.9 | 1 |
| 本地 (NAT) | 127.0.0.1 | 2026.1.9 | 1 |

---

## 2026.1.9 修复确认

### provideRelayOnce 超时修复 ✅

```
provideRelayOnce: DHT provide failed (The operation was aborted due to timeout)
```

**2026.1.9 之前**：每 30 分钟失败一次，持续 9+ 小时
**2026.1.9 之后**：该日志完全消失

结论：`provideRelayOnce` 超时修复有效。

---

## DHT Discovery 问题

### Bootstrap 日志

```
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
...
```

**持续失败，间隔约 5 秒一次。**

### 本地节点日志

```
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
[p2p] discoverPeersViaDHT: DHT walk failed (This operation was aborted) — expected during bootstrap
...
[mesh] aggressive phase complete — 1 peer connection(s), switching to watchdog
```

### 影响

- 节点只能连接 bootstrap，无法发现其他 peers
- P2P mesh 网络无法形成
- 所有节点只有 1 个 peer 连接

---

## 消息投递测试结果

### 2026.1.9 升级后

| 测试 | 结果 | 原因 |
|------|------|------|
| 本地 → Alex | ❌ `delivered: false` | `peer_unknown`（Alex DID 未解析） |
| 本地 → Bess | ❌ `delivered: false` | `direct delivery failed: no valid addresses` |

### didPeerMap 状态

| 查询方 | Bootstrap | Alex | Bess | 本地 |
|--------|-----------|------|------|------|
| Bootstrap | ✅ | ❌ | ❌ | ❌ |
| 本地 | ✅ | ❌ | ✅ | N/A |
| Alex | ✅ | N/A | ✅ | ❌ |
| Bess | ✅ | ✅ | N/A | ✅ |

---

## 根因分析

`discoverPeersViaDHT` 函数虽然有 3 秒超时保护，但 DHT walk 操作本身持续超时，说明：

1. **DHT 网络不健康** — 找不到任何 closest peers
2. **libp2p DHT 实现问题** — `getClosestPeers` 持续 abort
3. **可能的网络分区** — NAT 节点与公网节点之间存在网络隔离

---

## 需要的 ClawNet 修复

1. **调查 DHT walk 持续超时的原因**
   - 是网络问题还是 DHT 实现 bug？
   - 是否需要增加 DHT bucket refresh interval？

2. **提供 fallback discovery 机制**
   - 当 DHT 不可用时，通过 bootstrap 中继发现 peers

3. **回归测试**
   ```
   所有节点 peers > 1
   didPeerMap 包含所有节点 DID
   本地 NAT → Alex DID: delivered = true
   本地 NAT → Bess DID: delivered = true
   ```

---

## 修复进度

| 检查项 | 状态 |
|--------|------|
| provideRelayOnce 超时修复 | ✅ 完成 (2026.1.9) |
| DHT discovery 修复 | ⏳ 待确认 |
