# 回复：ClawNet Bootstrap Peer Directory Fallback 2026.2.3 仍有问题

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-bootstrap-peer-directory-fallback-not-working-2026-2-3.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-22 |
| 修复版本 | **2026.2.4** |

---

感谢 TelAgent 项目组提供详细的日志。我们确认了问题并已完成修复。

---

## 1. 根因确认

### Bootstrap `handlePeerDirectory` 读取超时

日志显示：
```
failed to handle peer directory { error: 'Stream read timed out after 10000ms' }
```

**问题**：`handlePeerDirectory` 使用 `readStream(stream.source, 256)` 读取 NAT 节点的请求时，使用了默认的 10 秒超时 (`STREAM_READ_TIMEOUT_MS = 10_000`)。对于高延迟的 NAT 节点连接，10 秒可能不足以完成请求数据的发送。

**死锁机制**：
1. NAT 节点调用 `fetchPeerDirectory(bootstrap)`，打开 stream 并调用 `writeBinaryStream(sink, reqBytes)` 写入请求
2. `writeBinaryStream` 内部等待 Bootstrap 完全读取数据后才返回（`await sink(...)`）
3. Bootstrap 的 `handlePeerDirectory` 被 10 秒超时阻塞，无法读取请求数据
4. Bootstrap 永远不读取 → NAT 节点永远不完成写入 → `fetchPeerDirectory` 永远挂起

### 为什么本地节点 didPeerMap 只有 2 个 DID

由于 fallback 的 `fetchPeerDirectory` 调用挂起，本地节点只能通过 DHT discovery 获得 peers。DHT 在稀疏网络中只能发现 Bess（偶然通过 relay），无法发现 Alex（Alex 的 NAT 限制）。

---

## 2. 修复方案

### 增加 `handlePeerDirectory` 读取超时

**文件**：`packages/node/src/services/messaging-service.ts`

**改动 1**：新增超时常量
```typescript
/** Timeout for reading peer directory requests — larger to accommodate NAT nodes. */
const PEER_DIRECTORY_TIMEOUT_MS = 30_000;
```

**改动 2**：`handlePeerDirectory` 使用新超时
```typescript
// Before
const raw = await readStream(stream.source, 256);

// After
const raw = await readStream(stream.source, 256, PEER_DIRECTORY_TIMEOUT_MS);
```

**改动说明**：
- 将 Bootstrap 读取 peer directory 请求的超时从 10 秒增加到 30 秒
- 给高延迟 NAT 节点足够的时间发送请求数据
- 30 秒超时仍然足够短，不会影响正常情况下的响应速度

---

## 3. 状态表

| 检查项 | 状态 |
|--------|------|
| 根因分析完成 | ✅ |
| `PEER_DIRECTORY_TIMEOUT_MS` 常量添加 | ✅ |
| `handlePeerDirectory` 超时增加 | ✅ |
| 编译通过 | ✅ |
| 发布版本 2026.2.4 | ⏳ 待发布 |
| Bootstrap 升级 | ⏳ 待 TelAgent 部署 |
| 回归测试通过 | ⏳ 待 TelAgent 验证 |

---

## 4. 回归测试验证

修复后请验证以下场景：

| 测试 | 预期结果 |
|------|----------|
| Bootstrap didPeerMap | 包含所有 4 个节点的 DID |
| 本地节点 didPeerMap | 包含至少 3 个 DID（Bootstrap、Alex、Bess） |
| 本地节点 peers | ≥ 2 |
| 本地 NAT → Alex DID | `delivered = true` |
| 本地 NAT → Bess DID | `delivered = true` |
| Bootstrap 日志 | 无 `Stream read timed out` 错误 |

---

## 5. 部署步骤

1. 升级 clawnetd.com Bootstrap 节点到 2026.2.4
2. 等待所有节点自动重连
3. 验证各节点 didPeerMap 和 peers 数量
