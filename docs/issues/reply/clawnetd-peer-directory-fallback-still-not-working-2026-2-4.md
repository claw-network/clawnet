# 回复：ClawNet Peer Directory Fallback 2026.2.4 仍不工作

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-peer-directory-fallback-still-not-working-2026-2-4.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-22 |
| 修复版本 | **2026.2.5** |

---

感谢 TelAgent 项目组提供详细的日志。我们确认了问题并已完成修复。

---

## 1. 根因确认

### 核心问题：fallback 调用条件错误

**关键观察**：本地节点日志**完全没有** peer directory fallback 相关日志。

**根因**：`amplify()` 中的 fallback 逻辑只在 `amplifyMesh() === 0` 时执行：

```typescript
// Before (buggy)
const n = await this.p2p?.amplifyMesh() ?? 0;
if (n > 0) {
  console.log(`[mesh] +${n} new peer(s) discovered via DHT walk`);
} else {
  // fallback 永远不会执行，因为 amplifyMesh 返回了 1（Bess）
}
```

**实际执行流程（2026.2.4）**：
1. `amplifyMesh()` Approach 1 从 peerStore 找到 Bess 并成功 dial → 返回 `1`
2. 因为 `n > 0`，fallback block 被跳过
3. 本地节点只知道 Bootstrap + Bess，**永远不知道 Alex 的 DID**

**为什么 Bess 出现在 didPeerMap**：Bess 是通过 `amplifyMesh()` Approach 1 从 peerStore 发现的（peerStore 在 DID 注册时记录了 Bess 的 peerId）。但这不影响 fallback 的根本问题。

---

## 2. 修复方案

### 始终执行 peer directory fallback

**核心改动**：peer directory fallback 应在**每次** `amplifyMesh()` 调用后执行，不管找到多少 peers。

**原因**：`fetchPeerDirectory()` 是安全的 —— 它只添加**新**的 DID→PeerId 映射，不会覆盖已有映射。即使 `amplifyMesh()` 找到了 Bess，我们仍然需要通过 fallback 学习 Alex 的 DID。

**改动 1**：`amplify()` — 始终调用 peer directory fallback

```typescript
// After (fixed)
const n = await this.p2p?.amplifyMesh() ?? 0;
if (n > 0) {
  console.log(`[mesh] +${n} new peer(s) discovered via DHT/peerStore`);
} else {
  console.log(`[mesh] amplify: no new peers discovered`);
}
// 始终执行 fallback
const connections = this.p2p?.getConnections() ?? [];
if (connections.length === 0) {
  console.log('[mesh] peer directory fallback: no connections available');
} else {
  for (const peerId of connections) {
    try {
      console.log(`[mesh] fetching peer directory from ${peerId.slice(0, 16)}…`);
      const learned = await this.messagingService?.fetchPeerDirectory(peerId) ?? 0;
      // ...
    }
  }
}
```

**改动 2**：`watchdog()` — 同样的修复

**改动 3**：增加详细日志
- `fetchPeerDirectory` 成功但无新条目时记录 info 级别日志
- `fetchPeerDirectory` 失败时记录 warn 级别日志（而不是 debug）

---

## 3. 状态表

| 检查项 | 状态 |
|--------|------|
| 根因分析完成 | ✅ |
| amplify() fallback 始终执行修复 | ✅ |
| watchdog() fallback 始终执行修复 | ✅ |
| 添加详细调试日志 | ✅ |
| 编译通过 | ✅ |
| 发布版本 2026.2.5 | ✅ |
| Bootstrap 已升级 | ✅ (运行中) |
| 回归测试通过 | ⏳ 待 TelAgent 验证 |

---

## 4. 回归测试验证

修复后请验证：

| 测试 | 预期结果 |
|------|----------|
| 本地节点日志 | 应显示 `fetching peer directory from bootstrap…` |
| 本地节点 didPeerMap | 包含至少 3 个 DID（Bootstrap、Alex、Bess） |
| 本地节点 peers | ≥ 2 |
| 本地 NAT → Alex DID | `delivered = true` |
| 本地 NAT → Bess DID | `delivered = true` |

---

## 5. 升级说明

所有节点需升级到 2026.2.5：

```bash
# Bootstrap 已自动升级到 2026.2.5
# TelAgent 各节点执行：
npm install @claw-network/node@2026.2.5
```

Bootstrap 升级命令（已执行）：
```bash
ssh root@66.94.125.242 "cd /opt/clawnet && git fetch origin tag node@2026.2.5 && git checkout node@2026.2.5 && pnpm install && pnpm build && systemctl restart clawnetd"
```
