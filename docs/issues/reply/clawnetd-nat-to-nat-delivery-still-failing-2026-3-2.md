# 回复：ClawNet Bootstrap NAT-to-NAT Delivery Still Failing After 2026.3.2

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-nat-to-nat-delivery-still-failing-2026-3-2.md` |
| 优先级 | **P0** |
| 状态 | **部分修复** |
| 修复日期 | 2026-03-23 |
| 修复版本 | **2026.3.3** |

---

感谢 TelAgent 项目组的详细报告。你们正确指出了 30s/15s 超时仍然不足的问题。

---

## 1. 已修复内容（2026.3.3）

### P0-1: 超时增加到 60s

```typescript
// 改前
const DID_RESOLVE_TIMEOUT_MS = 15_000;   // 15s
const DID_QUERY_TIMEOUT_MS = 30_000;      // 30s

// 改后
const DID_RESOLVE_TIMEOUT_MS = 60_000;   // 60s
const DID_QUERY_TIMEOUT_MS = 60_000;      // 60s
```

### P1-3: Peer Directory NaN total 日志修复

```typescript
// 改前（日志格式错误，对象被误解析为 NaN）
this.log.info('...(peer has %d total, all already known)', { entries, total: this.didToPeerId.size });

// 改后（直接传数值）
this.log.info('...(total: %d, all already known)', this.didToPeerId.size);
```

---

## 2. 关于"更深层问题"的说明

TelAgent 团队问得很对：**60s 超时只是在掩盖症状，不是解决根本原因。**

我们分析了以下可能的深层根因：

### 可能性 A：Circuit Relay 带宽严重受限

NAT 节点通过 circuit relay 传输数据极慢，可能是因为：
- Relay 连接本身就是低带宽的（libp2p circuit relay v2 默认带宽限制）
- NAT 节点到 relay 节点的网络路径质量差
- Relay 节点负载过高

**调查方法**：在 Bootstrap 侧添加 relay 带宽监控日志。

### 可能性 B：writeBinaryStream 死锁模式残留

如果 `for await (yield data)` 模式存在于 relay 读取路径中：
- 远程消费完才返回（'drain' 事件）
- 双方同时等待对方发送+读取会死锁

**调查方法**：检查所有 `readStream` 调用点是否都使用了非阻塞写入模式。

### 可能性 C：Store-and-Forward Relay 模式缺失

当前 relay 机制要求两端同时在线，且 relay 路径必须存在。但 circuit relay 本身就不是为"存储-转发"消息传递设计的。

**建议**：Bootstrap 应该支持消息暂存和转发，类似 outbox 的设计，但由 Bootstrap 主动推送。

---

## 3. 当前 60s 超时的理由

增加超时到 60s 是为了：
1. **争取时间**：让慢速 NAT 节点有更多时间完成数据传输
2. **避免频繁超时**：减少因超时导致的投递失败日志
3. **为调查争取时间**：在找到根因之前，保证基本可用性

但这不解决根本问题。

---

## 4. 后续调查计划

| 优先级 | 调查项 | 预期产出 |
|--------|--------|----------|
| P1 | 添加 relay 带宽监控日志 | 确认是否是带宽问题 |
| P1 | 检查 `writeBinaryStream` 所有调用点 | 排除死锁残留 |
| P2 | 实现 Store-and-Forward Relay | 根本性解决方案 |

---

## 5. TelAgent 升级步骤

升级 `@claw-network/node` 到 `2026.3.3`：

```bash
npm install @claw-network/node@2026.3.3
# 或
pnpm update @claw-network/node@2026.3.3
```

重启节点后，观察超时日志是否减少：

```bash
# Bootstrap 端
journalctl -u clawnetd.service | grep "failed to handle DID"

# 本地节点端
grep "failed to handle DID" ~/.telagent/logs/*.log
```

如果 60s 后仍然大量超时，说明存在更深层的架构问题，需要进一步调查。

---

## 6. 附加信息

### 2026.3.3 commit

```
17b3071 fix(node): increase DID resolve/query timeouts to 60s for slow circuit relay
fix(logging): correct peer directory log format string to avoid NaN
```

### 当前超时配置

| Handler | 超时 | 备注 |
|---------|------|------|
| `handleDidResolve` | 60s | 2026.3.3 新增 |
| `handleDidQuery` | 60s | 2026.3 → 30s → 2026.3.3 → 60s |
| `handlePeerDirectory` | 30s | 2026.2.3 新增 |
| `handleInboundMessage` | 10s | 2026.3.2 新增 |
| `handleInboundDeliveryExternal` | 30s | ATTACHMENT_STREAM_TIMEOUT_MS |

---

*ClawNet 团队 | 2026-03-23*
