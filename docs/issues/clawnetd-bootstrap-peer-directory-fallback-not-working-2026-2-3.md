# ClawNet Bootstrap Peer Directory Fallback 2026.2.3 仍有问题

日期: 2026-03-22
报告方: TelAgent 项目组
优先级: P0
关联 Issue:
- clawnetd-dht-discovery-still-failing-after-2026-2-2.md
- clawnetd-dht-discovery-still-failing-after-2026-2-0.md
- clawnetd-dht-discovery-still-failing.md

---

## 摘要

2026.2.3 实现了 Bootstrap Peer Directory Fallback 机制。Bootstrap 节点正确收集了所有节点的 DID，但 NAT 节点（Alex、Bess、本地）仍然无法通过该机制发现彼此，每个节点仍然只有 1 个 peer（bootstrap）。

---

## 环境与版本

| 节点 | IP | 版本 | peers | didPeerMap 数量 |
|------|----|------|-------|-----------------|
| Bootstrap | 66.94.125.242 | 2026.2.3 | 5 | 8 个 DID |
| Alex | 173.249.46.252 | 2026.2.3 | 1 | 未知 |
| Bess | 167.86.93.216 | 2026.2.3 | 1 | 未知 |
| 本地 (NAT) | 127.0.0.1 | 2026.2.3 | 1 | 2 个 DID |

---

## 验证结果

### Bootstrap didPeerMap（正确）

```json
{
  "did:claw:zDJENUefmNU5oHYgJ9KQhbpwVxEUKXKRd7aLQUkyBnjBv": "12D3KooWN7b...",
  "did:claw:z6tor6XFy7EYf6GJrqknsgjvEHZxoZbC1KQQkLBvmNyXn": "12D3KooWFiB...",
  "did:claw:z7ToozkCFGsnkJB5HDub6J7cN5EKAxcr4CHfPiazcLkFw": "12D3KooWGHA...",
  "did:claw:z79iwz9WY5WB5kLDgYLKmM52f9YdJYh4SsAhoWKkTGEkx": "12D3KooWFy6...",
  "did:claw:zBkpYijx56swvPB65VDb8gUbUVk3nNyPdjdhNaoiyQh93": "12D3KooWLaB...",
  "did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA": "12D3KooWHB5...", // Alex
  "did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs": "12D3KooWDB9...", // Bess
  "did:claw:zCZ3PRXxkHBPtjbzeFB3ZS9f332Fu3KPq7Pvxvx3gy2Z9": "12D3KooWMNQ..." // 本地
}
```

### 本地节点 didPeerMap（缺失 Alex）

```json
{
  "did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR": "12D3KooWQn...", // Bootstrap
  "did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs": "12D3KooWDB9..."  // Bess
}
```

**关键问题：** 本地节点只收录了 Bootstrap 和 Bess 的 DID，**缺少 Alex 的 DID**。

### 本地节点日志

```
[p2p] peer:connect 12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM
[p2p] connection:open peer=12D3KooWQnQQNGBG… addr=/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWQnQQNGBG…
[info] peer DID registered { did: 'did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR', peerId: '12D3KooWQnQQNGBG…' }
```

**没有看到 peer directory fallback 被触发的日志。**

---

## 根因分析

### Bootstrap Peer Directory 协议已实现

根据 2026.2.3 回复，Bootstrap 已实现 `/clawnet/1.0.0/peer-directory` 协议并返回所有已知 DID。

### NAT 节点 fallback 未触发

问题可能在于：
1. `amplify()` 或 `watchdog()` 中的 fallback 逻辑未正确调用 `fetchPeerDirectory()`
2. `fetchPeerDirectory()` 返回的映射未正确写入本地 didPeerMap
3. fallback 触发条件不对（可能仍在等待 DHT 超时）

---

## 需要的 ClawNet 修复

1. **确认 `fetchPeerDirectory()` 是否被调用** — 添加日志确认 fallback 路径执行
2. **确认 Bootstrap `/clawnet/1.0.0/peer-directory` 协议是否被正确处理** — 日志显示 `failed to handle peer directory { error: 'Stream read timed out after 10000ms' }`
3. **确认 didPeerMap 更新逻辑** — 即使获取到 peer directory，本地 didPeerMap 也未更新

---

## 错误日志

### Bootstrap 日志

```
[p2p] peer:discovery 12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM
[p2p] peer:connect 12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM
[p2p] connection:open peer=12D3KooWQnQQNGBG… addr=/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWQnQQNGBG…
[mesh] aggressive phase complete — 5 peer connection(s), switching to watchdog
```

### 本地节点日志

```
[p2p] peer:connect 12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM
[p2p] connection:open peer=12D3KooWQnQQNGBG… addr=/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWQnQQNGBG…
[info] peer DID registered { did: 'did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR', ... }
```

---

## 回归测试

修复后需验证：
```
1. 本地节点 didPeerMap 应包含至少 3 个 DID（Bootstrap、Alex、Bess）
2. 本地节点 peers 应 ≥ 2
3. 本地 NAT → Alex DID: delivered = true
4. 本地 NAT → Bess DID: delivered = true
```
