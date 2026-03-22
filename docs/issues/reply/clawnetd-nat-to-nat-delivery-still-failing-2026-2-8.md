# 回复：ClawNet NAT → NAT 消息投递 2026.2.8 仍失败

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-nat-to-nat-delivery-still-failing-2026-2-8.md` |
| 优先级 | **P1** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-22 |
| 修复版本 | **2026.2.9** |

---

感谢 TelAgent 项目组详细的日志。问题确认并已修复。

---

## 1. 根因确认

### 核心 Bug：`tryDeliverViaRelay` 从未通过 relay 拨号

**之前的实现（错误）**：

```typescript
// tryDeliverViaRelay() 中：
const relayAddr = `/p2p/${relayPeerId}/p2p-circuit/p2p/${targetPeerId}`;
await this.p2p.addPeerAddresses(targetPeerId, [relayAddr]); // 仅存储到 peerStore
const ok = await this.deliverDirect(targetPeerId, ...);     // ❌ 直接拨号！
```

**问题**：`deliverDirect(targetPeerId, ...)` 内部调用 `newStream(targetPeerId, PROTO_DM)`，而 `newStream` 总是使用 `dialProtocol('/p2p/' + peerId)` — **直接拨号**，完全忽略了 peerStore 中存储的 relay 地址。

```
结果：
NAT A → dialProtocol(/p2p/B) → 尝试直连 B → B 无法接受入站 → 超时
```

---

## 2. 修复方案

### 修复 1：`P2PNode.newStreamMultiaddr()` (core)

新增方法接受完整 multiaddr 字符串（支持 `/p2p-circuit/` relay 路径）：

```typescript
// packages/core/src/p2p/node.ts
async newStreamMultiaddr(multiaddrStr: string, protocol: string): Promise<StreamDuplex> {
  const rawStream = await this.node.dialProtocol(multiaddr(multiaddrStr), protocol);
  return adaptStream(rawStream);
}
```

### 修复 2：`tryDeliverViaRelay` 直接使用 relay multiaddr

```typescript
// packages/node/src/services/messaging-service.ts
// 直接使用 /p2p/relayPeerId/p2p-circuit/p2p/targetPeerId 拨号
const relayMultiaddr = `/p2p/${relayPeerId}/p2p-circuit/p2p/${targetPeerId}`;
stream = await this.p2p.newStreamMultiaddr(relayMultiaddr, PROTO_DM);

// 发送消息
await writeBinaryStream(stream.sink, bytes);
await stream.close();
```

### 为什么这样有效

```
NAT A (连接了 Bootstrap/Relay)                    NAT B (连接了 Bootstrap/Relay)
        │                                                    │
        │  dialProtocol(/p2p/relay/p2p-circuit/p2p/B)       │
        ├──────────────────────────────────────────────────▶│
        │                  Bootstrap/Relay                     │
        │                    转发 stream                      │
        │◀──────────────────────────────────────────────────┤
        │                                                    │
```

Bootstrap 作为 circuit relay：NAT A 通过已有的出站连接向 relay 发送数据，relay 通过 NAT B 的出站连接将数据推送给 B。NAT 节点不需要接受入站连接。

---

## 3. 状态表

| 检查项 | 状态 |
|--------|------|
| 根因分析完成 | ✅ |
| P2PNode.newStreamMultiaddr() | ✅ |
| tryDeliverViaRelay relay multiaddr 拨号 | ✅ |
| 编译通过 | ✅ |
| 发布版本 2026.2.9 | ✅ |
| Bootstrap 已升级 | ✅ (运行中) |
| 回归测试通过 | ⏳ 待 TelAgent 验证 |

---

## 4. 回归测试验证

修复后请验证：

| 测试 | 预期结果 |
|------|----------|
| NAT A → NAT B 消息 | `delivered = true`（通过 circuit relay） |
| Bootstrap 日志 | 应显示 `message delivered via relay` |
| 无 `direct delivery failed` 超时错误 | — |

---

## 5. 升级说明

```bash
# Bootstrap 已自动升级到 2026.2.9
# TelAgent 各节点：
npm install @claw-network/node@2026.2.9
```
