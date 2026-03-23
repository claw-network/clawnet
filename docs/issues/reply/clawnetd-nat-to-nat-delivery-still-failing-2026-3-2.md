# 回复：NAT-to-NAT 消息投递仍然失败（2026.3.2）— Circuit Relay 数据传输效率问题

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-nat-to-nat-delivery-still-failing-2026-3-2.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-23 |
| 修复版本 | **2026.3.4** |

---

感谢 TelAgent 项目组的详细分析。你们正确指出了"60s 超时只是掩盖症状，不是解决根本原因"。

经过深入调查，我们发现了真正的根本原因并实施了修复。

---

## 1. 根本原因分析

### 根本原因：writeBinaryStream 阻塞模式导致死锁

**问题代码** (`messaging-service.ts`)：

```typescript
async function writeBinaryStream(sink, data) {
  await sink(  // ← 阻塞等待 drain 事件
    (async function* () { yield data; })(),
  );
}
```

`await sink(...)` 会阻塞直到远程消费完数据并触发 'drain' 事件。问题链条：

1. 发送端调用 `await writeBinaryStream(stream.sink, data)` → 阻塞等待 drain
2. 接收端 `readStream` 设置 60s 超时
3. 如果 circuit relay 传输极慢，接收端在 60s 后超时放弃读取
4. 接收端关闭流，但发送端仍阻塞在 `await sink(...)`
5. **死锁**：发送端永远等待 drain，接收端已放弃

### 次要问题：resolveDidViaPeers 静默失败

当所有 peer 都无法解析 DID 时，`resolveDidViaPeers()` 返回 `null` 但**没有任何日志**。无法区分失败发生在解析阶段还是后续投递阶段。

---

## 2. 修复内容（2026.3.4）

### P0-1：Fire-and-forget 写入改为非阻塞模式

**修改的函数**（18+ 处调用点）：

| 函数 | 修改 |
|------|------|
| `deliverDirect` | 改为非阻塞 |
| `tryDeliverViaRelay` | 改为非阻塞 |
| `deliverAttachment` | 改为非阻塞 |
| `sendDelegatedMsg` | 改为非阻塞 |
| `sendDeliveryReceipt` | 改为非阻塞 |
| `announceDidToPeer` | 改为非阻塞 |
| `handleInboundDeliveryAuth` | 改为非阻塞 |
| `handleInboundDeliveryExternal` | 改为非阻塞 |
| `handleDidResolve` | 改为非阻塞 |
| `handleDidQuery` | 改为非阻塞 |

**新的非阻塞辅助函数**：

```typescript
function writeBinaryStreamNonBlocking(
  sink, data, stream, onError?
): void {
  const writePromise = sink((async function* () { yield data; })());
  writePromise.then(() => stream.close()).catch((err) => {
    try { stream.close(); } catch { /* ignore */ }
    if (onError) onError(err);
  });
}
```

**关键区别**：
- 阻塞版本：`await writeBinaryStream()` → 等待 drain → 等待期间无法取消
- 非阻塞版本：立即返回，`.then()` 处理关闭，错误传到 `onError` 回调

### P1-1：resolveDidViaPeers 添加失败日志

```typescript
// 改前（静默失败）
} catch {
  return null;
}

// 改后（有日志）
} catch (err) {
  this.log.warn('[messaging] DID resolution failed for %s via %d peer(s): %s',
    targetDid, connectedPeers.length, err.message);
  return null;
}
```

### P1-2：tryDeliverViaRelay 添加无 relay peers 日志

```typescript
if (connectedPeers.length === 0) {
  this.log.info('[messaging] no relay peers available (not connected to any peer)');
  return false;
}
```

---

## 3. 保留阻塞的调用点（request-response 模式）

以下 5 处保持阻塞，因为它们需要等待响应：

| 函数 | 原因 |
|------|------|
| `queryPeerDid` | 写 DID query 请求 → 读 DID query 响应 |
| `fetchAttachment` | 写 attachment 请求 → 读 attachment 数据 |
| `requestDeliveryAuth` | 写 auth 请求 → 读 auth 响应 |
| `fetchPeerDirectory` | 写 directory 请求 → 读 directory 数据 |
| `resolveDidViaPeers` | 写 resolve 请求 → 读 resolve 响应 |

这些模式的重构需要更复杂的异步控制流，将在后续版本中处理。

---

## 4. 行为变化

| 场景 | 旧行为（≤2026.3.3） | 新行为（2026.3.4+） |
|------|---------------------|---------------------|
| 发送直接消息（deliverDirect） | 阻塞等待 drain，可能死锁 | 非阻塞，立即返回 |
| 发送 relay 消息（tryDeliverViaRelay） | 阻塞等待 drain，可能死锁 | 非阻塞，立即返回 |
| DID 解析失败 | 静默返回 null | 输出 WARN 日志 |
| 无 relay peers 可用 | 静默返回 false | 输出 INFO 日志 |
| 发送附件（deliverAttachment） | 阻塞等待 drain，可能死锁 | 非阻塞，立即返回 |

---

## 5. TelAgent 升级步骤

升级 `@claw-network/node` 到 `2026.3.4`：

```bash
npm install @claw-network/node@2026.3.4
# 或
pnpm update @claw-network/node@2026.3.4
```

---

## 6. 验证方法

### 检查服务器日志

```bash
# Bootstrap 端
journalctl -u clawnetd.service | grep "DID resolution failed"
journalctl -u clawnetd.service | grep "no relay peers"

# 应该看到新的 WARN 和 INFO 日志，而不是之前的静默失败
```

### NAT-to-NAT 消息测试

1. 启动两个 NAT 节点
2. 节点 A 发送消息到节点 B
3. 观察日志中是否还有 `Stream read timed out` 或死锁迹象

---

## 7. 关于更深层架构问题的说明

虽然本次修复解决了阻塞死锁问题，但 circuit relay 本身不适合作为主要消息通道的根本问题仍然存在：

1. **Relay 带宽限制**：circuit relay 设计用于穿透 NAT，不是大量数据传输
2. **Store-and-Forward 缺失**：如果目标不在线，消息无法送达

后续版本将考虑实现 Store-and-Forward Relay 模式作为根本性解决方案。

---

## 8. 2026.3.4 Commit

```
89ecf4f fix(node): make fire-and-forget message writes non-blocking to prevent sender deadlock
fix(logging): add warn log when resolveDidViaPeers fails silently
fix(logging): add info log when no relay peers available for delivery
```

---

*ClawNet 团队 | 2026-03-23*
