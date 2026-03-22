# ClawNet Peer Directory Fallback 2026.2.5 仍不工作

日期: 2026-03-22
报告方: TelAgent 项目组
优先级: P0
关联 Issue:
- clawnetd-peer-directory-fallback-still-not-working-2026-2-4.md
- clawnetd-bootstrap-peer-directory-fallback-not-working-2026-2-3.md

---

## 摘要

2026.2.5 已部署到所有节点。fallback 调用逻辑已修复（总是执行），但 `fetchPeerDirectory()` 仍然没有返回新 DID。本地节点 didPeerMap 仍然只有 2 个 DID。

---

## 环境与版本

| 节点 | IP | 版本 | peers |
|------|----|------|-------|
| Bootstrap | 66.94.125.242 | 2026.2.5 | 4 |
| Alex | 173.249.46.252 | 2026.2.5 | 1 |
| Bess | 167.86.93.216 | 2026.2.5 | 1 |
| 本地 (NAT) | 127.0.0.1 | 2026.2.5 | 1 |

---

## 验证结果

### Bootstrap didPeerMap（正确，有 8 个 DID）

```json
{
  "did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA": "12D3KooWHB5qEnnoTAT8n7ZtLAQgpDDioLgDQcviF6okoyZo8H76", // Alex
  "did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs": "12D3KooWDB9SgR1hDMnn5j4gY77aSjcZEgD9f1ATvb1stRouiXEo", // Bess
  "did:claw:zCZ3PRXxkHBPtjbzeFB3ZS9f332Fu3KPq7Pvxvx3gy2Z9": "12D3KooWMNQZAfYTU5fP9VW4smnuCwjsXMJY51UK4zHzJwCaryH5"  // 本地
}
```

### 本地节点 didPeerMap（仍然只有 2 个 DID）

```json
{
  "did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR": "12D3KooWQn...", // Bootstrap
  "did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs": "12D3KooWDB9..."  // Bess
}
```

### 本地节点日志

```
[mesh] +1 new peer(s) discovered via DHT/peerStore
[mesh] fetching peer directory from 12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM…
```

**日志显示 fallback 确实被触发了**，但 `fetchPeerDirectory()` 没有返回新 DID。

---

## 根因分析

### fetchPeerDirectory() 调用成功但返回空

从日志看，`fetchPeerDirectory()` 被调用了，但返回后 didPeerMap 没有增加新条目。这说明：

1. **Bootstrap 的 peer directory 请求处理可能仍然超时**
2. **Bootstrap 返回的 DID 列表与本地已有重复**（因为本地已有 Bootstrap 和 Bess）
3. **stream 传输失败但被静默处理**

### 可能的修复方向

1. **增加 `fetchPeerDirectory()` 的详细错误日志**
   - 记录请求是否发送成功
   - 记录 Bootstrap 响应内容（即使是空或超时）

2. **在 Bootstrap 侧主动推送 peer directory**
   - 避免 NAT 节点拉取的 stream 超时问题
   - 当 Bootstrap 发现新 DID 时，主动广播到所有已连接节点

3. **增加 peer directory 请求的重试逻辑**
   - 一次失败后等待几秒重试
   - 最多重试 3 次

---

## 需要的 ClawNet 修复

1. **在 `fetchPeerDirectory()` 添加详细日志**
   - 记录发送请求前、收到响应后、解析结果后的状态
   - 区分"超时返回空"和"正常返回空"

2. **考虑改用 push 模式**
   - Bootstrap 定期广播完整 peer directory
   - NAT 节点只需接收，不需要主动拉取

3. **在 Bootstrap 侧记录 peer directory 请求日志**
   - 确认是否收到 NAT 节点的 peer directory 请求
   - 确认处理结果是什么

---

## 回归测试

修复后需验证：
```
1. 本地节点 didPeerMap 应包含至少 3 个 DID（Bootstrap、Alex、Bess）
2. 本地节点日志应显示 fetchPeerDirectory 成功返回新条目
3. Bootstrap 日志应显示处理了 peer directory 请求
```
