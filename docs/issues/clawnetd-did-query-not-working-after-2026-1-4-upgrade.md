# ClawNet Bootstrap did-query 协议未生效（2026.1.4 升级后仍失败）

日期: 2026-03-19
报告方: TelAgent 项目组
优先级: **P0**
状态: **未解决**
关联 Issue:
- `clawnetd-bootstrap-did-resolve-still-fails-after-2026-1-3.md`（根因相同）
- `docs/issues/reply/clawnetd-bootstrap-did-resolve-still-fails-after-2026-1-3.md`（ClawNet 团队回复）

---

## 摘要

我们已完成以下操作：
1. Bootstrap (clawnetd.com) 升级至 **2026.1.4**
2. TelAgent 本地节点（NAT）升级至 **2026.1.4**
3. Alex / Bess 云节点升级至 **2026.1.4**（由运维团队执行）

但 NAT 本地节点到 Alex/Bess DID 的消息仍然无法投递，`peer_unknown` 问题依然复现。`did-query` 主动查询协议未能生效。

---

## 环境与版本

| 节点 | DID | 版本 | 备注 |
|---|---|---|---|
| 本地 NAT | did:claw:zCZ3PRXxkHBPtjbzeFB3ZS9f332Fu3KPq7Pvxvx3gy2Z9 | 2026.1.4 | 嵌入式 ClawNet 节点 |
| Bootstrap | did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR | 2026.1.4 | clawnetd.com |
| Alex | did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA | 2026.1.4 | 云节点（公网 IP）|
| Bess | did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs | 2026.1.4 | 云节点（公网 IP）|

**网络**: testnet

---

## 验证步骤与结果

### 1. 版本确认

```bash
# 本地节点
curl http://127.0.0.1:9528/api/v1/node
→ "version": "2026.1.4", "peers": 1

# Bootstrap
curl https://api.clawnetd.com/api/v1/node
→ "version": "2026.1.4", "peers": 5
```

✅ 版本正确

### 2. 本地 didPeerMap（仅含 bootstrap DID）

```bash
# TelAgent 日志：本地节点注册的唯一 DID
peer DID registered {
  did: 'did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR',  ← bootstrap DID
  peerId: '12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM'
}
```

本地节点的 didPeerMap **仅包含 bootstrap DID**，不包含 Alex/Bess DID。

### 3. Profile Card 推送失败（peer_unknown）

```
[profile-card] Pushing own profile card to did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA
[transport] sendProfileCard → did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA
  topic: 'telagent/profile-card',
  reason: 'peer_unknown',
  peers: 1
[transport] sendProfileCard result: {"messageId":"msg_c3a6ae4980165f9d272df2e5","delivered":false}
```

**结果**: `delivered: false`, `reason: peer_unknown`

### 4. 本地节点连接状态

```
[p2p] peer:connect 12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM  ← bootstrap
[p2p] peer:connect 12D3KooWDB9SgR1hDMnn5j4gY77aSjcZEgD9f1ATvb1stRouiXEo  ← 未知 peer
[mesh] aggressive phase complete — 1 peer connection(s)
```

本地节点仅显示 **1 个 peer 连接**（mesh 连接数为 1），但日志中出现了第二个 peerId（12D3KooWDB9...）。这可能是 Alex/Bess 的连接，或者是 DHT 发现过程中出现的 peer，但本地节点没有为其注册 DID。

---

## 关键观察

### 观察 1：did-query 协议未在 bootstrap 上触发

根据 2026.1.4 的设计，bootstrap 应该在 peer 连接后主动发起 `did-query` 请求。但本地节点的 didPeerMap 中**只有 bootstrap 自己的 DID**，说明：
- 要么 bootstrap 没有主动查询本地节点的 DID
- 要么查询请求没有正确响应

### 观察 2：Alex/Bess 节点连接状态不明

本地日志中出现了一个额外的 peerId（12D3KooWDB9...），但无法确认这是否是 Alex/Bess。如果是 Alex/Bess，它们应该已经连接到 bootstrap，bootstrap 的 did-query 应该已经触发。

### 观察 3：本地节点 didPeerMap 持久化

```
[messaging] restored DID mappings { count: 2 }
```

TelAgent 重启后，日志显示 restored count = 2。这 2 个 DID 是什么（DIDs 列表未知），无法确认是否包含 Alex/Bess。

---

## 需要 ClawNet 团队确认

1. **Bootstrap 日志**：请提供 bootstrap 节点在本地节点连接后的日志，确认是否收到并处理了 `did-query` 请求。特别关注：
   - `did-query` handler 是否被触发
   - 查询响应中返回的 DID 是否为空

2. **Alex/Bess 重连**：请确认 Alex/Bess 节点在 2026.1.4 升级后是否**重启并重连**到 bootstrap。未重启的节点不会触发 did-query。

3. **Bootstrap didPeerMap 快照**：请在 bootstrap 侧执行以下查询，确认 bootstrap 的 didPeerMap 是否包含 Alex/Bess 的 DID：
   ```
   GET /api/v1/messaging/peers
   ```
   预期应包含：
   - did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR (bootstrap 自身)
   - did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA (Alex)
   - did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs (Bess)

4. **did-query 实现确认**：请确认 `/clawnet/1.0.0/did-query` 协议在 bootstrap 侧的实现是否与 `docs/issues/reply/clawnetd-bootstrap-did-resolve-still-fails-after-2026-1-3.md` 中描述的完全一致。

---

## TelAgent 侧操作记录

```bash
# 升级依赖
@claw-network/core: 2026.1.3 → 2026.1.4
@claw-network/node: 2026.1.3 → 2026.1.4
@claw-network/sdk: 2026.1.3 → 2026.1.4

# 已完成 pnpm install && pnpm -r build
```

---

*TelAgent 项目组 | 2026-03-19*
