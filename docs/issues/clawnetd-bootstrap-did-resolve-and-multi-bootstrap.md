# ClawNet Bootstrap: DID Resolve 无响应 & 多 Bootstrap 地址被丢弃

**日期**: 2026-03-18
**报告人**: TelAgent 项目组
**严重度**: 高 — NAT 节点完全无法通过 bootstrap 进行 DID 解析，导致跨节点消息投递失败
**ClawNet 版本**: 2026.1.2
**涉及组件**: `packages/node/src/index.ts`, `packages/node/src/services/messaging-service.ts`

---

## 问题概述

TelAgent NAT 节点通过 clawnetd.com bootstrap 连接到 P2P 网络后，无法解析其他节点（Alex/Bess）的
DID→PeerId 映射，导致消息永远 `peer_unknown`，无法投递。

此问题包含两个子问题：

1. **Bootstrap DID Resolve 无响应**：bootstrap 节点不响应 `/clawnet/1.0.0/did-resolve` 协议请求
2. **多 Bootstrap 地址被覆盖**：`resolveBootstrapMultiaddrs()` 会丢弃非默认 bootstrap 地址

---

## 问题 1: Bootstrap DID Resolve 无响应

### 现象

NAT 节点（Local）通过唯一连接的 peer（bootstrap at clawnetd.com）发送 DID resolve 请求，
但 bootstrap **不响应**，请求在 5 秒后超时，`resolveDidViaPeers()` 返回 null。

### 复现步骤

1. 启动本地 TelAgent 节点（NAT 环境，嵌入式 ClawNet）
2. 本地 ClawNet 连接到 bootstrap（`/dns4/clawnetd.com/tcp/9527`）— peers=1 ✓
3. Alex 节点（173.249.46.252）也连接到同一 bootstrap — peers=2 ✓
4. Alex 启动时通过 `announceDidToPeer()` 向 bootstrap 宣告自己的 DID — 静默完成（无错误日志）
5. 本地节点尝试发送消息到 Alex 的 DID
6. `messaging-service.send()` → `resolveDidViaPeers('did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA')`
7. 向 bootstrap 打开 `/clawnet/1.0.0/did-resolve` stream → **无响应** → 超时
8. 消息队列到 outbox，reason: `peer_unknown`

### 调试日志

```
[DEBUG-RESOLVE] resolveDidViaPeers called {
  targetDid: 'did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA',
  connectedPeers: 1,
  peers: [ '12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM' ]
}
// → 无 response 日志、无 error 日志 → 外层 timeout 后返回 null

[INFO] message queued in outbox {
  messageId: 'msg_481bbb9825d4d68b5d038161',
  targetDid: 'did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA',
  topic: 'telagent/profile-card',
  reason: 'peer_unknown',
  peers: 1
}
```

### 验证矩阵

| 源 | 目标 | 方式 | 结果 |
|---|---|---|---|
| Local → Bootstrap DID | 直接连接 | delivered: **true** ✓ |
| Alex → Bess DID | 直接连接（peers 互连） | delivered: **true** ✓ |
| Local → Alex DID | 通过 bootstrap resolve | delivered: **false** ✗ |
| Alex → Local DID | 通过 bootstrap resolve | delivered: **false** ✗ |

### 可能原因

1. Bootstrap 的 `handleDidResolve` 中存在阻塞或异常（如 rate limit、stream 被对端关闭）
2. `announceDidToPeer()` 到 bootstrap 静默失败，bootstrap 从未收到 Alex 的 DID 宣告
3. Bootstrap 版本虽然标记为 2026.1.2，但实际 deployed binary 缺少 DID resolve handler

### Bootstrap 信息

```
GET https://api.clawnetd.com/api/v1/node
→ { peerId: "12D3KooWQnQQNGBG5yhuhiaxwcHmksDYy9ZbMiC8uoJp4D6oB5QM",
     did: "did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR",
     version: "2026.1.2", peers: 5 }
```

### 建议修复

1. **在 bootstrap 上添加 DID resolve 调试日志**，确认 handler 是否注册
2. 检查 bootstrap deploy 是否确实包含 `handleDidResolve` 代码
3. 为 `announceDidToPeer()` 添加失败日志（当前 catch 静默吞掉所有错误）

---

## 问题 2: `resolveBootstrapMultiaddrs()` 覆盖所有 Bootstrap 地址

### 现象

当 `--bootstrap` 同时包含默认地址（`/dns4/clawnetd.com/tcp/9527`）和自定义 peer 地址时，
`resolveBootstrapMultiaddrs()` 返回值**替换了整个 bootstrap 数组**，丢弃自定义 peer 地址。

### 代码位置

`packages/node/src/index.ts` 约 220-228 行：

```typescript
const isDefaultBootstrap = p2pConfig.bootstrap?.some(
  addr => addr.startsWith(BOOTSTRAP_MULTIADDR),
) ?? false;
if (isDefaultBootstrap) {
  console.log('[clawnetd] Resolving bootstrap PeerId from API…');
  p2pConfig.bootstrap = await resolveBootstrapMultiaddrs();  // ← BUG: 覆盖整个数组
  console.log(`[clawnetd] Bootstrap resolved: ${p2pConfig.bootstrap[0]}`);
}
```

### 复现

```bash
# systemd ExecStart 包含两个 bootstrap：
--bootstrap /dns4/clawnetd.com/tcp/9527 \
--bootstrap /ip4/167.86.93.216/tcp/9527/p2p/12D3KooWDB9SgR1hDMnn5j4gY77aSjcZEgD9f1ATvb1stRouiXEo

# 实际效果：
# p2pConfig.bootstrap = ['/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWQnQQ...']
# Bess 地址被丢弃！节点只连接到 bootstrap，不连接 Bess
```

### 修复方案

已在本地修复并部署到 Alex/Bess（`packages/node/dist/index.js`）：

```typescript
if (isDefaultBootstrap) {
  console.log('[clawnetd] Resolving bootstrap PeerId from API…');
  const resolved = await resolveBootstrapMultiaddrs();
  // 保留非默认 bootstrap 条目（如显式 peer 地址）
  const custom = (p2pConfig.bootstrap ?? []).filter(
    addr => !addr.startsWith(BOOTSTRAP_MULTIADDR),
  );
  p2pConfig.bootstrap = [...resolved, ...custom];
  console.log(`[clawnetd] Bootstrap resolved: ${p2pConfig.bootstrap.join(', ')}`);
}
```

### 相关问题: `persisted.p2p?.bootstrap` 未使用

同一文件中，`listen` 有 persisted 降级但 `bootstrap` 没有：

```typescript
listen: this.config.p2p?.listen ?? persisted.p2p?.listen ?? DEFAULT_P2P_CONFIG.listen,
bootstrap: this.config.p2p?.bootstrap ?? DEFAULT_P2P_CONFIG.bootstrap,
//         ↑ 缺少 persisted.p2p?.bootstrap
```

建议修复为：

```typescript
bootstrap: this.config.p2p?.bootstrap ?? persisted.p2p?.bootstrap ?? DEFAULT_P2P_CONFIG.bootstrap,
```

---

## 当前状态

| 项目 | 状态 |
|---|---|
| 问题 2（多 bootstrap 被覆盖） | ✅ 已修复并部署到 Alex/Bess |
| Alex ↔ Bess 直接通信 | ✅ 正常（peers=2, delivered=true） |
| Local → Alex 通过 bootstrap | ❌ Bootstrap 不响应 DID resolve |
| Bootstrap 部署验证 | ⬜ **需要 ClawNet 团队检查** |

### 需要 ClawNet 团队的操作

1. **检查 bootstrap 节点** (`clawnetd.com`) 的 `handleDidResolve` 是否注册并正常工作
2. **确认 bootstrap 部署版本**是否完整包含 2026.1.2 的所有 messaging-service 代码
3. **合并问题 2 的修复**到 ClawNet 主分支（diff 仅 ~8 行）
4. 建议为 `announceDidToPeer()` 添加失败日志，方便排查
