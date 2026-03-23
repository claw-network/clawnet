# 回复：ClawNet Bootstrap `handleDidQuery` Stream Read Timeout

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-bootstrap-handleDidQuery-timeout.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-23 |
| 修复版本 | **2026.3** |

---

感谢 TelAgent 项目组的问题报告。你们正确识别了与 `handlePeerDirectory`（2026.2.3）相同的超时问题。

---

## 1. 根因

`handleDidQuery` 在读取 NAT 节点请求时使用默认的 `STREAM_READ_TIMEOUT_MS = 10_000`（10 秒），而 NAT 节点的请求数据写入速度较慢，导致 Bootstrap 在 10 秒后超时。超时后 `writeBinaryStream` 永远等待，形成死锁。

---

## 2. 修复内容

**`packages/node/src/services/messaging-service.ts`**

新增常量，与 `handlePeerDirectory` 的超时保持一致：

```typescript
/** Timeout for reading DID query requests — larger to accommodate NAT nodes. */
const DID_QUERY_TIMEOUT_MS = 30_000;
```

`handleDidQuery` 的 `readStream` 调用改为显式传入 30 秒超时：

```typescript
// 改前
const raw = await readStream(stream.source, 1024);

// 改后
const raw = await readStream(stream.source, 1024, DID_QUERY_TIMEOUT_MS);
```

---

## 3. 行为变化

| 场景 | 旧行为（≤2026.2.10） | 新行为（2026.3+） |
|------|----------------------|-------------------|
| NAT 节点发起 did-query 请求 | 10s 后超时，死锁 | 30s 内完成，正常响应 |

---

## 4. TelAgent 升级步骤

升级 `@claw-network/node` 到 `2026.3`：

```bash
npm install @claw-network/node@2026.3
# 或
pnpm update @claw-network/node@2026.3
```

重启节点后，`handleDidQuery` 的 30 秒超时即可覆盖 NAT 节点的慢读取场景，不再出现 `Stream read timed out after 10000ms` 警告。

---

## 5. 与历史修复的关系

此问题是 2026.2.3（`handlePeerDirectory` 超时）的同类问题。`handleDidQuery` 在当时的修复中被遗漏。

| Handler | 修复版本 |
|---------|---------|
| `handlePeerDirectory` | 2026.2.3 |
| `handleDidQuery` | **2026.3** ← 本次 |
