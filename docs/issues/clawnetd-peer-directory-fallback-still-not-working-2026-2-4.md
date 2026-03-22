# ClawNet Peer Directory Fallback 2026.2.4 仍不工作

日期: 2026-03-22
报告方: TelAgent 项目组
优先级: P0
关联 Issue:
- clawnetd-bootstrap-peer-directory-fallback-not-working-2026-2-3.md
- clawnetd-dht-discovery-still-failing-after-2026-2-2.md

---

## 摘要

2026.2.4 已部署到所有节点，但 peer directory fallback 仍然不工作。Bootstrap 有所有节点的 DID，但 NAT 节点（本地、Alex、Bess）的 didPeerMap 仍然缺失大多数节点的 DID。

---

## 环境与版本

| 节点 | IP | 版本 | peers |
|------|----|------|-------|
| Bootstrap | 66.94.125.242 | 2026.2.4 | 5 |
| Alex | 173.249.46.252 | 2026.2.4 | 1 |
| Bess | 167.86.93.216 | 2026.2.4 | 1 |
| 本地 (NAT) | 127.0.0.1 | 2026.2.4 | 1 |

---

## 验证结果

### Bootstrap didPeerMap（正确，有 8 个 DID）

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

### 本地节点 didPeerMap（仍然只有 2 个 DID）

```json
{
  "did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR": "12D3KooWQn...", // Bootstrap
  "did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs": "12D3KooWDB9..."  // Bess
}
```

**关键问题：** 本地节点只收录了 Bootstrap 和 Bess 的 DID，**缺失 Alex 的 DID**，也没有本地自己的 DID（因为没有自引用）。

### 本地节点日志

```
[p2p] peer:connect 12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM
[p2p] connection:open peer=12D3KooWQnQQNGBG… addr=/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWQnQQNGBG…
[info] peer DID registered { did: 'did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR', peerId: '12D3KooWQnQQNGBG…' }
```

**没有看到 peer directory fallback 被触发的日志。**

---

## 根因分析

### 问题 1：NAT 节点到 Bootstrap 的请求超时

即使 Bootstrap 读取超时增加到 30 秒，NAT 节点发送 peer directory 请求时仍然可能超时：

1. NAT 节点调用 `fetchPeerDirectory(bootstrap)`
2. 打开 stream 并写入请求数据
3. `writeBinaryStream` 等待 Bootstrap 完全读取
4. 如果 Bootstrap 30 秒仍未完成读取，NAT 节点的写入也会超时

### 问题 2：peer directory fallback 调用链可能未触发

从本地节点日志看，没有看到任何 `peer directory` 相关的日志。这说明 `fetchPeerDirectory()` 可能：
1. 从未被调用（fallback 条件未满足）
2. 调用后超时/失败但未记录错误

---

## 需要的 ClawNet 修复

1. **在 NAT 节点侧添加 peer directory 请求超时**

   `fetchPeerDirectory()` 需要在 NAT 节点侧也设置超时，避免无限等待：

   ```typescript
   const PEER_DIRECTORY_REQUEST_TIMEOUT_MS = 60_000; // NAT 节点侧 60 秒超时
   ```

2. **添加详细的调试日志**

   在 `fetchPeerDirectory()` 调用前后添加日志：

   ```typescript
   console.log('[p2p] fetchPeerDirectory: starting');
   try {
     const result = await fetchPeerDirectory(bootstrap);
     console.log('[p2p] fetchPeerDirectory: success', result);
   } catch (e) {
     console.log('[p2p] fetchPeerDirectory: failed', e);
   }
   ```

3. **考虑替代方案：Bootstrap 主动推送**

   当 Bootstrap 收到新节点连接时，主动向所有已连接节点广播 peer directory 更新，而不是等待 NAT 节点拉取。

---

## 错误日志

### 本地节点

```
# 没有 peer directory 相关日志
# 节点只连接了 bootstrap
[p2p] peer:connect 12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM
[p2p] connection:open peer=12D3KooWQnQQNGBG… addr=/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWQnQQNGBG…
```

### Bootstrap

```
# 没有看到 peer directory 请求处理的日志
# Bootstrap 有 5 个连接，知道所有 8 个 DID
```

---

## 回归测试

修复后需验证：
```
1. 本地节点 didPeerMap 应包含至少 3 个 DID（Bootstrap、Alex、Bess）
2. 本地节点 peers 应 ≥ 2
3. 本地 NAT → Alex DID: delivered = true
4. 本地 NAT → Bess DID: delivered = true
5. 本地节点日志应显示 fetchPeerDirectory 调用
```
