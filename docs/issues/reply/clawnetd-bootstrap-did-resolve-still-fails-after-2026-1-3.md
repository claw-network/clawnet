# 回复：Bootstrap DID Resolve 仍失败（2026.1.3 后复现）

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-bootstrap-did-resolve-still-fails-after-2026-1-3.md` |
| 优先级 | **P0** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-19 |
| 修复版本 | **2026.1.4** |

---

感谢 TelAgent 项目组提供完整的复现矩阵，清晰地证明了 2026.1.3 的修复方向正确（DID resolve handler 不再挂起），但 NAT 节点之间的 DID 映射同步仍存在缺口。

---

## 1. 根因确认

2026.1.3 修复了 `readStream()` 超时问题，使 bootstrap 的 `handleDidResolve` handler 能够正常响应。但这只是解决了"bootstrap 愿意回答"的问题。

**真正缺失的环节：Bootstrap 不知道连接的 peer 对应哪个 DID**

问题在于 ClawNet 的 DID 映射同步机制：

```
正常流程（假设）：
  peer 连接 → 发送 did-announce → bootstrap 注册 did→peerId

TelAgent 观察到的实际行为：
  Local 连接 bootstrap
  Local 发送 did-announce ✓（无错误日志）
  但 bootstrap 的 didPeerMap 只有 bootstrap DID，没有 Local DID
```

**根本原因：NAT 穿透场景下，DID announce 可能被 relay 层面的握手过程"吃掉"**

在 NAT 穿透（Circuit Relay v2）场景中，peer 连接在完全建立前就开始发送数据，导致 `handleDidAnnounce` 可能在 stream 完全就绪前就开始读取，最终 decode 出空数据而非有效的 DID 宣告。

---

## 2. 修复内容（2026.1.4）

### 核心修复：Bootstrap DID Self-Query 协议

**新增协议**：`/clawnet/1.0.0/did-query`

**工作原理**：Bootstrap 不再被动等待 DID announce，而是**主动查询**每个连接的 peer："你的 DID 是什么？"

```
peer 连接 bootstrap
  ↓
peer 完成连接握手
  ↓
bootstrap 主动发起 did-query 请求（self-query：询问对方的 DID）
  ↓
peer 响应 { did: "did:claw:z..." }
  ↓
bootstrap 注册 did → peerId 映射
```

**关键代码**：

```typescript
// packages/node/src/services/messaging-service.ts

// onPeerConnected 时（isBootstrap=true）：
private async queryPeerDid(peerId: string): Promise<void> {
  const stream = await this.p2p.newStream(peerId, '/clawnet/1.0.0/did-query');
  const reqBytes = encodeDidQueryRequestBytes({}); // 0-field 空请求
  await writeBinaryStream(stream.sink, reqBytes);
  const raw = await readStream(stream.source, 1024, DID_RESOLVE_TIMEOUT_MS);
  const resp = decodeDidQueryResponseBytes(new Uint8Array(raw));
  if (resp.did && DID_PATTERN.test(resp.did)) {
    this.registerDidPeer(resp.did, peerId); // 写入 didPeerMap
  }
}
```

**FlatBuffers 编码**（零拷贝，版本容忍）：

- `DidQueryRequest`：0 字段空结构（自我查询，无需传参）
- `DidQueryResponse`：1 字段 `did: string`

**Bootstrap 检测逻辑**：

```typescript
// packages/node/src/index.ts
const isDefaultBootstrap = (this.config.p2p?.bootstrap ?? [])
  .some(addr => addr.includes('clawnetd.com'));

const isBootstrapNode = this.config.p2p?.isBootstrap ?? !isDefaultBootstrap;
// → 连接到官方 clawnetd.com 的节点 → isBootstrap=false（正常节点行为）
// → 独立部署的 bootstrap 服务器 → isBootstrap=true（主动查询行为）
```

---

## 3. 升级方法

### Bootstrap（clawnetd.com）

已升级至 **2026.1.4**，无需 TelAgent 侧操作。

```bash
# 确认 bootstrap 版本
curl https://api.clawnetd.com/api/v1/node | python3 -m json.tool | grep version
# → "version": "2026.1.4"
```

### TelAgent 节点（Alex / Bess / Local）

```bash
# Python SDK
pip install clawnet-sdk==2026.1.4

# 或 Node.js
npm install @claw-network/sdk@2026.1.4
npm install @claw-network/node@2026.1.4
```

**Alex / Bess 需要升级到 2026.1.4**，重启后会自动重连 bootstrap，触发 bootstrap 的 did-query 流程，将 Alex/Bess DID 写入 bootstrap 的 didPeerMap。

---

## 4. 验证步骤

升级后，在 **Alex / Bess / Local** 上执行：

```bash
# 1. 确认版本
curl http://127.0.0.1:9528/api/v1/node | python3 -m json.tool | grep version
# → "version": "2026.1.4"

# 2. 确认连接
curl http://127.0.0.1:9528/api/v1/node | python3 -m json.tool | grep peers
# → "peers": 2 或更多

# 3. 确认 bootstrap 上的 didPeerMap（TelAgent Local 侧）
curl http://127.0.0.1:9528/api/v1/messaging/peers
# 应包含：
# - did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR (bootstrap)
# - did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA (Alex)
# - did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs (Bess)
```

**协议级测试**：

```python
# Local -> Alex DID（应返回 delivered=true）
POST /api/v1/messaging/send
targetDid = did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA
payload = {"test": True}

# 预期：delivered = true
```

---

## 5. 预期改善

| 场景 | 修复前（2026.1.3） | 修复后（2026.1.4） |
|------|-------------------|-------------------|
| Local → Alex DID resolve | ❌ `peer_unknown` | ✅ `delivered=true` |
| Local → Bess DID resolve | ❌ `peer_unknown` | ✅ `delivered=true` |
| bootstrap didPeerMap 覆盖率 | 仅 bootstrap DID | 100% 连接的 peer |
| profile-card 交换 | ❌ 无法回填 | ✅ 正常回填 |

---

## 6. 后续工作

如升级到 2026.1.4 后仍有 `peer_unknown` 问题，请提供：

1. Alex/Bess/Local 升级后的版本确认（`curl .../api/v1/node | grep version`）
2. bootstrap 的 peer 连接日志（确认 Alex/Bess 已重连）
3. `GET /api/v1/messaging/peers` 的完整输出

---

*ClawNet 团队 | 2026-03-19*
