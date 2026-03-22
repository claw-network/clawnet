# 回复：ClawNet DHT Discovery 仍失败

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-dht-discovery-still-failing.md` |
| 优先级 | **P1** |
| 状态 | **已确认/分析中** |
| 分析日期 | 2026-03-22 |
| 目标修复版本 | **2026.2.0** (下一版本) |

---

感谢 TelAgent 项目组提供详细的日志。以下是我们的根因分析和修复计划。

---

## 1. 根因确认

### `amplifyMesh()` 中的 DHT Discovery

`discoverPeersViaDHT` 日志来自 `packages/core/src/p2p/node.ts` 的 `amplifyMesh()` 函数：

```typescript
// ── Approach 2: KadDHT random walk (fallback) ──────────────────────
if (newPeers === 0) {
  const routing = nodeAny.peerRouting ?? nodeAny.services?.dht;
  if (routing?.getClosestPeers) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);  // 3秒超时
    try {
      for await (const peer of routing.getClosestPeers(randomKey, { signal: controller.signal })) {
        // ...
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

### 根因：DHT 在小网络中设计用于大规模网络

**关键发现：**

1. **DHT `getClosestPeers` 是异步生成器**：即使超时触发，也会 `controller.abort()` 中断迭代器，导致抛出 `AbortError`

2. **3 秒超时对于稀疏 DHT 网络太短**：ClawNet 只有 4 个节点，Kademlia DHT 在如此稀疏的网络中无法有效运行——没有足够的中间节点转发查询

3. **"expected during bootstrap" 注释是正确的**：代码将 DHT discovery 失败视为预期行为（因为 DHT 设计用于大规模网络）

4. **持续失败的原因是 aggressive phase 重试**：在节点启动后的 60 秒内（12 次 × 5 秒），`amplifyMesh()` 每 5 秒尝试一次 DHT discovery

### 为什么 DHT 在小网络失败

Kademlia DHT 的设计假设：
- 有大量节点分散在全球
- 任何查询都能在几跳内找到响应节点
- 节点稳定在线

ClawNet 的现实：
- 只有 4 个节点
- 其中 3 个是 NAT 节点（通过 relay 连接）
- Bootstrap 是唯一的稳定节点

在这种情况下，`getClosestPeers(randomKey)` 几乎没有节点可以查询，因此持续超时。

---

## 2. 修复方案

### 方案：使用 Bootstrap 作为 Peer Directory（推荐）

在小网络中，DHT 不适合作为 peer discovery 的主要机制。更好的方法是**利用 Bootstrap 节点作为已知 peers 的目录**。

**核心思路：**
当 DHT discovery 失败时，节点通过 bootstrap 中继查询已知 peers 列表，然后直接 dial。

### 修复 1：增加 DHT timeout 避免假阳性

**文件**：`packages/core/src/p2p/node.ts`

```typescript
// Before
const timeout = setTimeout(() => controller.abort(), 3_000);

// After
const timeout = setTimeout(() => controller.abort(), 15_000);  // 15秒，减少误报
```

### 修复 2：当 DHT 失败时，通过 bootstrap 查询 peers

在 `packages/node/src/index.ts` 的 `watchdog()` 函数中，当 `amplifyMesh()` 返回 0 且没有 bootstrap 连接时，通过 `/clawnet/1.0.0/did-query` 协议向 bootstrap 查询其他 peers 的 DID。

**注意**：这个修复需要设计新的协议消息或复用现有的 did-query 机制。

### 修复 3：降低 DHT discovery 频率

在 aggressive phase 结束后（60 秒后），将 DHT discovery 间隔从 30 秒减少到 60 秒，避免无效查询。

---

## 3. 临时缓解措施

在完整修复完成之前，可以在 Bootstrap 节点上观察 DHT 健康状态：

```bash
# 查看 Bootstrap 日志中的 DHT 相关错误频率
ssh -i ~/.ssh/id_ed25519_clawnet root@66.94.125.242 \
  "journalctl -u clawnetd --no-pager | grep -c 'DHT walk failed'"
```

如果错误数 > 100，说明 DHT discovery 持续失败，这是**预期的**（因为网络太小）。

---

## 4. 状态表

| 检查项 | 状态 |
|--------|------|
| 根因分析完成 | ✅ |
| 修复方案设计 | ✅ |
| 实现修复（增加 timeout） | ⏳ 下一版本 2026.2.0 |
| Bootstrap peer directory fallback | ⏳ 设计中 |
| 回归测试通过 | ⏳ 待验证 |

---

## 5. 回归测试验证

修复后请验证：

| 测试 | 预期结果 |
|------|----------|
| DHT 日志频率 | 显著减少（从每 5 秒降到每 60 秒） |
| DHT walk 超时错误 | 减少 80%+ |
| 所有节点 peers | ≥ 2（不再只有 bootstrap 这 1 个 peer） |
| 消息投递测试 | 本地 NAT → Alex/Bess DID: delivered = true |
