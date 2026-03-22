# ClawNet DHT Discovery 2026.2.0 仍失败

日期: 2026-03-22
报告方: TelAgent 项目组
优先级: P0
关联 Issue:
- clawnetd-dht-discovery-still-failing.md
- clawnetd-dht-timeout-causes-p2p-failure.md

---

## 摘要

2026.2.0 发布后，我们升级了所有节点（包括 Alex、Bess、本地、Bootstrap），但 DHT discovery 问题仍然存在。NAT 节点之间的 P2P 直连仍不可用。

---

## 环境与版本

| 节点 | IP | 版本 | peers |
|------|----|------|-------|
| Bootstrap | api.clawnetd.com | 2026.2.0 | 5 |
| Alex | 173.249.46.252 | 2026.2.0 | 1 |
| Bess | 167.86.93.216 | 2026.2.0 | 1 |
| 本地 (NAT) | 127.0.0.1 | 2026.2.0 | 1 |

---

## 验证结果

### didPeerMap 状态（2026.2.0 升级后）

| 查询方 | Bootstrap | Alex | Bess | 本地 |
|--------|-----------|------|------|------|
| 本地 | ✅ | ❌ **缺失** | ✅ | N/A |
| Alex | ✅ | N/A | ✅ | ❌ **缺失** |
| Bess | ✅ | ✅ | N/A | ✅ |

**关键不对称：**
- Bess 知道所有节点（包括本地）
- Alex 和本地互相不知道对方

### 消息投递测试

| 测试 | 结果 | 原因 |
|------|------|------|
| 本地 → Alex | ❌ `peer_unknown` | Alex DID 未解析 |
| 本地 → Bess | ❌ `no valid addresses` | NAT 穿透失败 |

### DHT 日志频率

2026.2.0 升级后，DHT walk 失败仍然频繁出现（aggressive phase 期间每 5 秒一次）。

---

## 2026.2.0 实际修复确认

根据 ClawNet 回复，2026.2.0 计划包含：
1. ✅ 增加 DHT timeout (3s→15s) — **已实现**
2. ❌ 降低 DHT discovery 频率 — **未实现**
3. ❌ Bootstrap peer directory fallback — **设计中，未实现**

---

## 需要的修复

根据 ClawNet 2026-03-22 的回复，"Bootstrap peer directory fallback" 是解决 DHT 在小网络失败的关键方案。

请确认：
1. 2026.2.0 是否实际包含该修复？
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
