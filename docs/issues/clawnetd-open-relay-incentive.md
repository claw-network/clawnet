# ClawNet 团队协作请求：开放式 Relay 网络 + Relay 激励机制

| 字段 | 值 |
| --- | --- |
| 优先级 | **P2 — 网络去中心化 & 激励机制** |
| 提出方 | TelagentNode 团队 |
| 提出日期 | 2026-03-09 |
| 影响范围 | 所有 NAT 后面的节点通信质量 + 网络可用性 |
| 当前版本 | clawnetd v0.4.1+, @claw-network/sdk v0.4.1+ |

---

## 1. 问题背景

### 1.1 当前 Relay 架构

目前 ClawNet P2P 网络中，**仅 bootstrap 节点**（`@clawnetd.com`）运行 `@libp2p/circuit-relay-v2` 服务端：

```
Node A (NAT)                 Bootstrap Node              Node B (NAT)
    │                       (clawnetd.com)                    │
    │                            │                            │
    ├── circuit-relay ──────────►│◄────── circuit-relay ──────┤
    │                            │                            │
    │   （所有 relay 流量         │                            │
    │    集中在 bootstrap）       │                            │
```

这个架构有以下局限：

| 问题 | 影响 |
|------|------|
| **单点瓶颈** | 所有 NAT 后节点的 relay 流量都经过同一个 bootstrap 节点，带宽和 CPU 集中承压 |
| **单点故障** | bootstrap 节点宕机 → 所有 NAT 后节点无法 relay |
| **地理延迟** | bootstrap 可能在某个地区，其他地区的 relay 延迟偏高 |
| **无扩展激励** | 第三方运行 clawnetd 节点无法参与 relay 贡献，也没有动力运行公网节点 |

### 1.2 期望架构

让 **任何运行 clawnetd 的节点都可以选择成为 relay 节点**，形成去中心化 relay 网络，并通过 token 奖励激励节点提供 relay 服务：

```
Node A (NAT)        Relay Node X        Relay Node Y        Node B (NAT)
    │              (任何公网节点)       (任何公网节点)            │
    │                    │                   │                  │
    │   ┌─ 自动选择最优 relay ───────────────────┐              │
    │   │                                        │              │
    ├───┤─── circuit-relay ──►Relay X◄── relay ──┤──────────────┤
    │   │                                        │              │
    │   └─── circuit-relay ──►Relay Y◄── relay ──┘              │
    │                    │                   │                  │
    │                    ▼                   ▼                  │
    │              记录 relay 流量         记录 relay 流量        │
    │                    │                   │                  │
    │                    └─────┬─────────────┘                  │
    │                          ▼                                │
    │                  链上 RelayReward 合约                     │
    │                  按贡献分配奖励 token                      │
```

**核心优势**：

- **去中心化 relay**：多个 relay 节点分担流量，消除单点故障
- **地理就近**：NAT 后节点可选择延迟最低的 relay 节点
- **激励机制**：relay 节点获得 token 奖励，激励更多人运行公网节点
- **自然扩展**：用户量增长 → relay 需求增加 → 奖励吸引更多 relay 节点 → 网络更强

---

## 2. 期望 ClawNet 提供的能力

### 2.1 功能一：开放式 Relay 角色（clawnetd 配置）

**需求**：允许任意 clawnetd 节点通过配置启用 relay server 角色。

**期望配置**：

```yaml
# clawnetd config.yaml
relay:
  enabled: true              # 是否启用 circuit-relay-v2 server
  maxCircuits: 128           # 最大同时 relay 连接数
  maxBandwidthBps: 10485760  # 最大 relay 带宽 (10 MB/s)
  reservationTtlSec: 3600   # relay 预留 TTL
```

**或环境变量**：

```bash
CLAWNET_RELAY_ENABLED=true
CLAWNET_RELAY_MAX_CIRCUITS=128
CLAWNET_RELAY_MAX_BANDWIDTH_BPS=10485760
```

**技术要点**：
- libp2p `@libp2p/circuit-relay-v2` 已支持在任意节点启用 server 角色，只需在 `p2p/config.ts` 中根据配置条件添加 `circuitRelayServer()` 组件
- 需确保 relay 节点有公网 IP 或至少可被 autoNAT 确认为 "public"
- Bootstrap 节点继续默认启用 relay（行为不变）

### 2.2 功能二：Relay 节点 DHT 发现

**需求**：其他节点能够通过 DHT 或协议自动发现可用的 relay 节点。

**方案 A（推荐）：扩展 DHT Provider 记录**

```
1. Relay 节点在 DHT 中发布自己为 "relay-provider"
2. NAT 后节点查询 DHT 获取可用 relay 节点列表
3. 按延迟、负载等指标选择最优 relay
```

libp2p 原生支持通过 `identify` 协议和 `relay` 地址广播实现，但目前 clawnetd 可能没有开放这个能力。

**方案 B：通过 bootstrap 节点发布 relay 列表**

```
1. Relay 节点定期向 bootstrap 上报自己的 relay 状态
2. Bootstrap 维护 relay 节点列表
3. 新节点连入时获取 relay 列表
```

### 2.3 功能三：Relay 流量统计 & 上报

**需求**：clawnetd 记录每个 relay session 的流量统计，作为奖励依据。

**期望 API**：

```typescript
// GET /api/v1/relay/stats
interface RelayStats {
  relayEnabled: boolean;
  totalCircuitsServed: number;       // 累计 relay 连接数
  activeCircuits: number;            // 当前活跃连接数
  totalBytesRelayed: number;         // 累计 relay 流量（字节）
  totalMessagesRelayed: number;      // 累计 relay 消息数
  uptimeSeconds: number;             // relay 服务运行时间
  periodStats: {                     // 周期性统计（用于奖励计算）
    periodStart: number;             // 统计周期起始时间
    periodEnd: number;
    bytesRelayed: number;
    circuitsServed: number;
    uniquePeersServed: number;       // 服务的唯一 peer 数
  };
}
```

**期望 SDK 接口**：

```typescript
// @claw-network/sdk
const stats = await claw.relay.getStats();
console.log(stats.totalBytesRelayed);

// 获取周期统计（用于链上提交）
const periodProof = await claw.relay.getPeriodProof();
// { periodStart, periodEnd, bytesRelayed, circuitsServed, signature }
// signature: relay 节点用自己的 key 对统计数据签名，防篡改
```

### 2.4 功能四：Relay 奖励 Proof 生成

**需求**：relay 节点能生成可验证的 relay 贡献证明，供链上合约验证。

**流程**：

```
Relay Node                            Chain
    │                                   │
    ├── getPeriodProof() ──────────────►│
    │   { period, bytes, circuits,      │
    │     uniquePeers, signature }      │
    │                                   │
    │   claimRelayReward(proof) ───────►│ 合约验证签名
    │                                   │ 检查重放保护
    │                                   │ 计算奖励金额
    │◄──── RelayRewardClaimed event ────┤ 发放 token
```

**防作弊设计要点**：

| 机制 | 说明 |
|------|------|
| **签名验证** | relay proof 必须由 relay 节点的 DID key 签名，合约验证签名对应链上注册的 DID |
| **周期去重** | 每个 relay 节点每个周期只能 claim 一次（合约记录 `lastClaimedPeriod`） |
| **最低门槛** | 低于一定流量/连接数不发放奖励（防止空跑） |
| **上限封顶** | 单节点单周期奖励有上限（防止恶意刷量） |
| **双向验证（可选增强）** | 被 relay 的节点可以 co-sign 证明（更强的防伪证） |

---

## 3. 链上合约建议

### 3.1 RelayRewardPool 合约

TelagentNode 团队可以在 telagent 侧实现奖励合约，但需要 clawnetd 提供上述统计和 proof 数据：

```
// 伪代码 — 合约接口
interface IRelayRewardPool {
    // Relay 节点提交贡献证明并领取奖励
    claimReward(
        relayDid: bytes32,       // relay 节点 DID hash
        periodId: uint256,       // 周期 ID
        bytesRelayed: uint256,   // relay 流量
        circuitsServed: uint256, // relay 连接数
        uniquePeers: uint256,    // 服务的唯一 peer 数
        signature: bytes         // relay 节点签名
    ) → uint256 rewardAmount;

    // 查询奖励信息
    getRewardRate() → uint256;   // 当前奖励率
    getPendingReward(relayDid: bytes32) → uint256;
    getClaimHistory(relayDid: bytes32) → ClaimRecord[];
}
```

**奖励公式建议**（可调整）：

```
rewardAmount = baseRate
    × log2(1 + bytesRelayed / 1GB)
    × min(uniquePeers / 10, 3.0)
    × uptimeBonus
```

- 对数缩减：防止大流量节点获得不成比例的奖励
- uniquePeers 加权：奖励服务更多不同 peer 的节点（真正有用的 relay）
- uptime 加成：长期稳定运行的节点获得额外奖励

---

## 4. 实现优先级建议

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **阶段 1** | clawnetd 开放 relay 配置（`relay.enabled`） + relay stats API | 无 |
| **阶段 2** | Relay 节点 DHT 发现 + NAT 后节点自动选择 relay | 阶段 1 |
| **阶段 3** | Relay period proof 生成 + 签名 | 阶段 1 |
| **阶段 4** | RelayRewardPool 合约部署 + claim 流程 | 阶段 3 |

> **阶段 1 对 telagent 最紧急**：我们正在实现 "通过 DID 连接任意 NAT 后节点" 的功能（API Proxy over P2P），需要 relay 网络更健壮。如果 relay 角色可以开放给所有 clawnetd 节点，网络可用性会大幅提升。

---

## 5. 验收标准

1. ✅ clawnetd 新增 `relay.enabled` 配置项，非 bootstrap 节点也可以启用 relay server
2. ✅ `GET /api/v1/relay/stats` 返回 relay 流量统计数据
3. ✅ NAT 后节点可以通过非 bootstrap 的 relay 节点完成通信
4. ✅ SDK 新增 `relay.getStats()` 方法
5. ✅ （阶段 3）`relay.getPeriodProof()` 返回签名的周期贡献证明

---

## 6. 与 TelAgent 当前规划的关联

TelAgent 正在实现 **DID-based Remote Access**（通过 DID 连接 NAT 后节点）：

```
用户输入 DID → 网关节点转发 API 请求 → ClawNet P2P → 目标节点
```

这依赖 ClawNet P2P 网络的 relay 能力：
- **无 relay 网络**：仅 bootstrap 节点做 relay，单点瓶颈
- **开放 relay + 激励**：更多节点参与 relay → 网络更快更稳定 → DID 连接体验更好

开放式 relay 和激励机制是 ClawNet 网络走向真正去中心化的关键一步。
