# 回复：ClawNet Peer Directory Fallback 2026.2.5 仍不工作

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-peer-directory-fallback-still-not-working-2026-2-5.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-22 |
| 修复版本 | **2026.2.6** |

---

感谢 TelAgent 项目组提供详细的日志。我们确认了问题并已完成修复。

---

## 1. 根因确认

### 日志缺失问题

日志显示 `[mesh] fetching peer directory from 12D3KooWQn…` 但**完全没有后续日志**（无成功、无失败）。这说明：

1. `fetchPeerDirectory` 没有返回（函数挂起）
2. 或者 amplify 的 catch 块静默吞掉了异常

**核心问题**：`fetchPeerDirectory` 没有任何超时保护。如果 `newStream` 或 `readStream` 挂起，调用会永远等待，导致 fallback 失效但不产生任何可见错误。

---

## 2. 修复方案

### 修复 1：添加整体超时保护

`fetchPeerDirectory` 现在有 20 秒的整体超时，防止挂起：

```typescript
const raw = await Promise.race([
  readStream(stream.source, 8192, DID_RESOLVE_TIMEOUT_MS),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('fetchPeerDirectory: stream read timeout')), 20_000),
  ),
]);
```

### 修复 2：重试逻辑（最多 3 次）

```typescript
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  // ... fetch logic ...
  if (attempt < MAX_RETRIES) {
    await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * attempt));
  }
}
```

重试间隔：2s → 4s → 6s（指数退避）

### 修复 3：详细日志

每次调用都记录：
- 第几次尝试
- 收到多少条目
- 哪些是新条目，哪些是已知的
- 失败原因

---

## 3. 状态表

| 检查项 | 状态 |
|--------|------|
| 根因分析完成 | ✅ |
| fetchPeerDirectory 超时保护 | ✅ |
| 重试逻辑（3 次 + 退避） | ✅ |
| 详细日志（每次尝试） | ✅ |
| 编译通过 | ✅ |
| 发布版本 2026.2.6 | ✅ |
| Bootstrap 已升级 | ✅ (运行中) |
| 回归测试通过 | ⏳ 待 TelAgent 验证 |

---

## 4. 回归测试验证

修复后请验证日志中应出现：

```
[messaging] fetchPeerDirectory attempt 1/3 to 12D3KooWQn…
[messaging] fetchPeerDirectory received 8 entries from 12D3KooWQn…
[messaging] peer directory learned X new mapping(s)
```

| 测试 | 预期结果 |
|------|----------|
| 本地节点 didPeerMap | 包含至少 3 个 DID（Bootstrap、Alex、Bess） |
| 本地节点 peers | ≥ 2 |
| 本地 NAT → Alex DID | `delivered = true` |
| 本地 NAT → Bess DID | `delivered = true` |

---

## 5. 升级说明

```bash
# Bootstrap 已自动升级到 2026.2.6
# TelAgent 各节点：
npm install @claw-network/node@2026.2.6
```
