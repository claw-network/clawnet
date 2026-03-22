# ClawNet Peer Directory Fallback 2026.2.6 仍不工作

日期: 2026-03-22
报告方: TelAgent 项目组
优先级: P0
关联 Issue:
- clawnetd-peer-directory-fallback-still-not-working-2026-2-5.md
- clawnetd-peer-directory-fallback-still-not-working-2026-2-4.md

---

## 摘要

2026.2.6 已部署到所有节点。超时和重试机制已添加，但 `fetchPeerDirectory()` 仍然无法获取 Bootstrap 的 peer directory。NAT 穿透问题是根本原因。

---

## 环境与版本

| 节点 | IP | 版本 | peers |
|------|----|------|-------|
| Bootstrap | 66.94.125.242 | 2026.2.6 | 3 |
| Alex | 173.249.46.252 | 2026.2.6 | 1 |
| Bess | 167.86.93.216 | 2026.2.6 | 1 |
| 本地 (NAT) | 127.0.0.1 | 2026.2.6 | 1 |

---

## 验证结果

### Bootstrap didPeerMap（正确，有 8 个 DID）

```json
{
  "did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA": "12D3KooWHB5...", // Alex
  "did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs": "12D3KooWDB9...", // Bess
  "did:claw:zCZ3PRXxkHBPtjbzeFB3ZS9f332Fu3KPq7Pvxvx3gy2Z9": "12D3KooWMNQ..."  // 本地
}
```

### 本地节点 didPeerMap（仍然只有 2 个 DID）

```json
{
  "did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR": "12D3KooWQn...", // Bootstrap
  "did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs": "12D3KooWDB9..."  // Bess
}
```

---

## 根因分析

### fetchPeerDirectory() 对 NAT 节点不可行

即使添加了 20 秒超时和 3 次重试，`fetchPeerDirectory()` 仍然无法工作。根本原因：

1. **NAT 节点无法接受入站连接** - Bootstrap 无法主动打开 stream 到 NAT 节点
2. **stream 协议需要双向通信** - NAT 节点发起请求，Bootstrap 响应。但 NAT 节点的响应通道也受限于 relay
3. **Circuit Relay v2 的限制** - relay 连接是单向的，数据传输依赖 bootstrap 中继

### Bootstrap 有 3 个 peers 但 NAT 节点仍然只有 1 个

- Bootstrap 连接到 Alex、Bess、本地（通过 relay）
- 但 NAT 节点之间无法直接通信
- fetchPeerDirectory 需要从 Bootstrap 获取其他 NAT 节点的 DID，但这依赖 stream 传输

---

## 需要的修复方案

### 方案 1：Bootstrap 主动广播 peer directory（推荐）

当 Bootstrap 上的 peer directory 更新时，主动推送到所有已连接节点：

```typescript
// Bootstrap 定期广播
for (const peerId of connectedPeers) {
  await this.messagingService?.pushPeerDirectory(peerId);
}
```

**优点**：不依赖 NAT 节点发起请求

### 方案 2：使用 DID Query 协议

Bootstrap 已实现 `/clawnet/1.0.0/did-query` 协议。复用此协议让 NAT 节点查询特定 DID：

```typescript
// NAT 节点查询特定 DID
const peerId = await this.messagingService?.resolveDid("did:claw:zAlex...");
```

**优点**：利用已有的 did-query 机制

### 方案 3：使用消息队列

当 NAT 节点发送消息到 Bootstrap 时，Bootstrap 在响应中附加 peer directory：

```typescript
// 消息响应包含 peer directory
interface MessageResponse {
  delivered: boolean;
  peerDirectory?: Map<string, string>; // 可选的 peer directory
}
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
