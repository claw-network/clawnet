# ClawNet：NAT 环境下 P2P 连接无法建立 — peer:discovery 成功但 peer:connect 从未发生

| 字段 | 值 |
| --- | --- |
| 优先级 | **P0 — 阻塞所有 NAT 后节点的 P2P 消息投递** |
| 提出方 | TelAgent 团队 |
| 提出日期 | 2026-03-17 |
| 影响范围 | 所有在 NAT / 家庭网络 / 企业防火墙后面运行的嵌入式或独立 clawnetd 节点 |
| `@claw-network/node` 版本 | 0.6.14 |
| `@claw-network/core` 版本 | 0.6.14 |
| 发现场景 | TelAgent 本地开发 (macOS, 家用路由 NAT)，嵌入式 ClawNetNode |

---

## 1. 问题描述

在 NAT 后面的嵌入式 ClawNet 节点，**bootstrap peer 可以被发现，但 libp2p 连接从未建立成功**。导致：

- 所有 P2P 消息（`telagent/envelope`、`telagent/profile-card` 等）永远卡在 outbox
- `MessagingService` 的 outbox flush 仅在 `peer:connect` 时触发，所以消息永远不会投递
- 对端节点无法收到任何消息

网络表现：
- TCP 直连 `clawnetd.com:9527` **成功**（`nc -z -w5 clawnetd.com 9527` → succeeded）
- DNS 解析 `clawnetd.com` **正常**（→ `66.94.125.242`）
- 但 libp2p 层面的连接握手/协议协商**始终失败**，没有任何 `peer:connect` 事件

---

## 2. 复现步骤

### 环境
- macOS (任何家用路由 NAT 后面的机器)
- Node.js v22
- `@claw-network/node` v0.6.14

### 步骤

```bash
# 1. 以嵌入式模式启动，确保 bootstrap 配置正确
const node = new ClawNetNode({
  dataDir: '/path/to/data',
  passphrase: 'xxx',
  api: { host: '127.0.0.1', port: 9528, enabled: true },
  p2p: { bootstrap: DEFAULT_P2P_CONFIG.bootstrap },
});
await node.start();

# 2. 等待 2~3 分钟

# 3. 检查节点状态
curl http://127.0.0.1:9528/api/v1/node
# → peers: 0, connections: 0
```

### 日志

```
[p2p] peer:discovery 12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW   ← bootstrap 发现成功
[mesh] aggressive phase complete — 0 peer connection(s), switching to watchdog  ← 但连接从未建立
```

关键特征：**有 `peer:discovery` 日志，但没有任何 `peer:connect` 日志。**

---

## 3. 根因分析

### 3.1 NAT 穿透链路推测

```
本地节点 (NAT后)              Bootstrap (公网)
    │                             │
    ├─ TCP connect :9527 ────────►│  ← TCP 层面成功
    │                             │
    ├─ libp2p noise handshake ───►│  ← 可能在这一步失败？
    │                             │
    ├─ yamux multiplex ──────────►│  ← 或这一步？
    │                             │
    ├─ identify protocol ────────►│
    │                             │
    └─ GossipSub mesh join ──────►│
```

### 3.2 可能的原因

| 可能原因 | 说明 |
|----------|------|
| **Noise 握手超时** | NAT 设备可能对 TCP 连接做了某种干扰（DPI、SPI），导致 Noise handshake 超时 |
| **yamux stream negotiation 失败** | libp2p v3 的 yamux 实现可能有兼容性问题 |
| **缺少 circuit-relay-v2 client 配置** | NAT 后的节点可能需要显式启用 relay client 才能通过 bootstrap 中继连接 |
| **AutoNAT 判定后放弃拨号** | 如果 AutoNAT 判定本节点不可公开访问，可能错误地放弃了 outbound 连接 |
| **bootstrap 节点在 v0.6.14 变更了连接管理策略** | 可能新版本限制了入站连接数或连接行为 |

### 3.3 日志分析

目前 P2PNode 在连接失败时**没有输出任何错误日志**，只有 discovery 和 mesh 的摘要日志。建议至少在以下位置加日志：

- `this.libp2p.addEventListener('connection:open', ...)` → 连接建立
- `this.libp2p.addEventListener('connection:close', ...)` → 连接断开
- dial 失败时打印错误原因

---

## 4. 诊断信息

### 本地节点 config.yaml（修复前）

```yaml
v: 1
network: devnet
p2p:
  listen:
    - /ip4/0.0.0.0/tcp/9527
  bootstrap: []    # ← 空！导致完全孤立
```

### 修复后（通过构造参数传入 bootstrap）

bootstrap 列表正确传入后，`peer:discovery` 成功出现，但 `peer:connect` 仍然没有。

### ClawNet 状态

```json
{
  "did": "did:claw:zCZ3PRXxkHBPtjbzeFB3ZS9f332Fu3KPq7Pvxvx3gy2Z9",
  "peerId": "12D3KooWMNQZAfYTU5fP9VW4smnuCwjsXMJY51UK4zHzJwCaryH5",
  "synced": true,
  "blockHeight": 67019,
  "peers": 0,
  "connections": 0,
  "network": "devnet",
  "version": "0.6.14"
}
```

### 网络连通性

```bash
$ dig +short clawnetd.com
66.94.125.242

$ nc -z -w5 clawnetd.com 9527
Connection to clawnetd.com port 9527 [tcp/*] succeeded!
```

---

## 5. 期望行为

1. NAT 后面的节点应该能通过 **outbound TCP** 与 bootstrap 节点建立 libp2p 连接
2. 如果直连不行，应通过 **circuit-relay-v2** 中继建立连接
3. 连接建立后，outbox 中的消息应正常 flush 和投递
4. 连接失败时应有**明确的错误日志**供排查

---

## 6. 建议的排查方向

1. **增加连接生命周期日志**：在 `P2PNode` 中监听 `connection:open`、`connection:close`、`peer:connect`、`peer:disconnect` 事件并打印，带上远端 PeerId 和失败原因
2. **检查 dial 错误**：在 mesh amplifier 或 bootstrap dial 的 catch 中打印具体 Error 信息
3. **确认 NAT 穿透组件启用**：确认 `enableCircuitRelay`、`enableAutoNAT`、`enableDcutr` 在 `DEFAULT_P2P_CONFIG` 中均为 true，且 bootstrap 节点运行了 relay server
4. **测试用例**：在 CI 中添加"两个节点通过 relay 连接并互发消息"的集成测试

---

## 7. TelAgent 侧已做的规避

| 修改 | 目的 |
|------|------|
| `ManagedClawNetNode` 构造时显式传入 `p2p: { bootstrap: DEFAULT_P2P_CONFIG.bootstrap }` | 防止 `config.yaml` 中空 bootstrap 列表覆盖默认值 |
| `pushOwnProfileCard` 移除 nickname 空检查 | 始终发送 profile card 触发双向 P2P 交换 |
| `GET /api/v1/profile/:did` 返回 200+null 替代 404 | 消除浏览器控制台噪音 |
