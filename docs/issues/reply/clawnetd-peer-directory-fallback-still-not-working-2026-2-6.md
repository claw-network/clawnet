# 回复：ClawNet Peer Directory Fallback 2026.2.6 仍不工作

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-peer-directory-fallback-still-not-working-2026-2-6.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-22 |
| 修复版本 | **2026.2.7** |

---

感谢 TelAgent 项目组深入分析。你们正确识别了根本原因：**NAT 穿透问题使 pull 模型对 NAT 节点不可行**。

---

## 1. 根因确认

### Pull 模型死锁

```
NAT 节点                    Bootstrap
    │                           │
    │ newStream(PROTO_PEER_DIR) │
    │────────── stream ─────────▶│
    │ writeBinaryStream(request) │ (等待 Bootstrap 读取)
    │─────── wrote request ──────▶│
    │                           │ readStream() ← 30s 超时
    │                           │ (仍然等待读完 256 bytes)
    │◀───── write blocked ───────│ writeBinaryStream
    │  (等待响应)                 │ (等待读完请求)
    │        ↓                   │        ↓
    │   DEADLOCK            30s 后超时
```

**`writeBinaryStream` 的问题**：
- 使用 `for await (yield data)()` 模式
- 每次 `sink.write()` 返回 `false`（buffer 满）时，等待 `'drain'` 事件
- `'drain'` 只在 Bootstrap 的 `readStream` 读完数据后才触发
- `readStream` 在等请求数据，`writeBinaryStream` 在等 `readStream` 读完 → **死锁**

---

## 2. 修复方案

### 修复 1：非阻塞写（消除死锁）

**文件**：`packages/node/src/services/messaging-service.ts`

`handlePeerDirectory` 改为直接使用 `stream.sink()` 而非 `writeBinaryStream`：

```typescript
// Before (deadlock)
await writeBinaryStream(stream.sink, jsonBytes);
await stream.close();

// After (non-blocking)
const writePromise = stream.sink((async function* () {
  yield jsonBytes;
})());
writePromise.then(() => stream.close()).catch(() => {});
```

`stream.sink()` 立即返回，不等待远程消费，从根本上消除死锁。

### 修复 2：Bootstrap Push 模型（核心修复）

**问题**：即使消除死锁，NAT 节点的 pull 请求仍不可靠。

**解决方案**：改用 **Bootstrap 主动推送** 模型。

**改动**：

1. **60 秒定时推送**：Bootstrap 每 60 秒向所有已连接节点推送完整 peer directory

```typescript
private startPeerDirectoryPush(): void {
  if (!this.isBootstrap) return;
  const push = () => {
    for (const peerId of this.p2p.getConnections()) {
      void this.pushPeerDirectory(peerId);
    }
  };
  push();
  this.peerDirectoryPushTimer = setInterval(push, PEER_DIRECTORY_PUSH_INTERVAL_MS);
}
```

2. **连接时立即推送**：新节点连接时，Bootstrap 立即推送完整 peer directory

```typescript
// onPeerConnected (Bootstrap)
void this.pushPeerDirectory(peerId);
```

3. **推送方法**：`pushPeerDirectory(peerId)` 打开 stream，直接写 JSON，不等待响应

```typescript
private async pushPeerDirectory(peerId: string): Promise<void> {
  const stream = await this.p2p.newStream(peerId, PROTO_PEER_DIRECTORY);
  const jsonBytes = new TextEncoder().encode(JSON.stringify([...this.didToPeerId.entries()]));
  // Non-blocking write + fire-and-forget close
  stream.sink((async function* () { yield jsonBytes; })())
    .then(() => stream.close())
    .catch(() => {});
}
```

### 为什么 Push 对 NAT 有效

NAT 节点到 Bootstrap 的连接是**出站连接**。通过 Circuit Relay，这个连接是双向的——Bootstrap 可以在这个已有连接上打开新的 stream 向 NAT 节点推送数据。不需要 NAT 节点接受入站连接。

---

## 3. 状态表

| 检查项 | 状态 |
|--------|------|
| 根因分析完成 | ✅ |
| handlePeerDirectory 非阻塞写 | ✅ |
| Bootstrap 60s 定时推送 | ✅ |
| Bootstrap 新连接时立即推送 | ✅ |
| 编译通过 | ✅ |
| 发布版本 2026.2.7 | ✅ |
| Bootstrap 已升级 | ✅ (运行中) |
| 回归测试通过 | ⏳ 待 TelAgent 验证 |

---

## 4. 回归测试验证

修复后请验证：

| 测试 | 预期结果 |
|------|----------|
| Bootstrap 日志 | 应显示 `pushed peer directory to 12D3KooW… (8 entries)` |
| 本地节点 didPeerMap | 包含至少 3 个 DID（Bootstrap、Alex、Bess） |
| 本地节点 peers | ≥ 2 |
| 本地 NAT → Alex DID | `delivered = true` |
| 本地 NAT → Bess DID | `delivered = true` |

---

## 5. 升级说明

```bash
# Bootstrap 已自动升级到 2026.2.7
# TelAgent 各节点：
npm install @claw-network/node@2026.2.7
```
