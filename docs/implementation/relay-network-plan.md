# 开放式 Relay 网络 + 激励机制实施计划

> **状态**: 规划文档  
> **日期**: 2026-03-09  
> **来源**: TelagentNode 团队协作请求 + ClawNet 内部补充  
> **关联**: [economics.md](economics.md), [scaling-plan.md](scaling-plan.md), [p2p-spec.md](p2p-spec.md), [on-chain-plan.md](on-chain-plan.md)  
> **原始需求**: [clawnetd-open-relay-incentive.md](../issues/clawnetd-open-relay-incentive.md)

---

## 概述

当前 ClawNet P2P 网络中所有节点默认启用 `circuitRelayServer()`（`enableCircuitRelay: true`），但缺乏精细化配置、流量统计、节点发现、安全防护和激励机制。本文档在 TelagentNode 团队提出的 4 项功能基础上，补充 8 项加固特性，形成完整的去中心化 relay 网络实施计划。

### 目标架构

```
Node A (NAT)        Relay X (公网)       Relay Y (公网)       Node B (NAT)
    │                    │                   │                    │
    │   ┌── 健康探测 + 质量评分 ─ 选最优 relay ──┐               │
    │   │                                        │               │
    ├───┤── circuit-relay ──►X◄─── relay ────────┤───────────────┤
    │   │                                        │               │
    │   └── circuit-relay ──►Y◄─── relay ────────┘               │
    │                    │                   │                    │
    │              per-peer 限流          per-peer 限流           │
    │              流量统计              流量统计                  │
    │                    │                   │                    │
    │                    └─────┬─────────────┘                    │
    │                          ▼                                  │
    │           链上 RelayRewardPool 合约                         │
    │           双向签名贡献证明 → 按公式分配奖励                 │
```

---

## 功能清单

### 来自 TelagentNode 提案（原始 4 项）

| # | 功能 | 阶段 |
|---|------|------|
| F1 | 开放式 Relay 精细化配置 | Phase 1 |
| F2 | Relay 节点 DHT 发现 | Phase 2 |
| F3 | Relay 流量统计 & 上报 API | Phase 1 |
| F4 | Relay 奖励 Proof 生成 | Phase 3 |

### ClawNet 内部补充（8 项加固特性）

| # | 功能 | 阶段 |
|---|------|------|
| F5 | Relay 节点健康探测 & 质量评分 | Phase 2 |
| F6 | Relay DoS 防护（per-peer 限流） | Phase 1 |
| F7 | Relay 黑名单/白名单访问控制 | Phase 1 |
| F8 | Attachment Relay 流量分类统计 | Phase 1 |
| F9 | Relay 节点自我诊断 API | Phase 1 |
| F10 | 双向签名贡献证明（co-sign 升级为必选） | Phase 3 |
| F11 | 奖励公式增加"被服务方确认"因子 | Phase 3 |
| F12 | Graceful Relay 迁移（优雅下线） | Phase 2 |

---

## Phase 1：基础能力（F1 + F3 + F6 + F7 + F8 + F9）

> **优先级最高** — TelagentNode 正在实现 DID-based Remote Access，依赖 relay 网络更健壮。

### F1：开放式 Relay 精细化配置

**现状**：`packages/core/src/p2p/config.ts` 中 `enableCircuitRelay: boolean` 只有开/关，无资源限制。`circuitRelayServer()` 使用 libp2p 默认参数。

**改动范围**：

1. **`packages/core/src/p2p/config.ts`** — 扩展 `P2PConfig` 接口：

```typescript
export interface RelayConfig {
  /** 是否启用 circuit-relay-v2 server。Default: true */
  enabled: boolean;
  /** 最大同时 relay 连接数。Default: 64 */
  maxCircuits: number;
  /** 单连接最大 relay 带宽 (bytes/sec)。Default: 1048576 (1 MB/s) */
  maxBandwidthBps: number;
  /** Relay 预留 TTL（秒）。Default: 3600 */
  reservationTtlSec: number;
  /** 单连接最大数据量 (bytes)。Default: 10485760 (10 MB) */
  maxCircuitBytes: number;
}

export interface P2PConfig {
  // ...existing fields...
  /** Relay server 精细化配置。覆盖 enableCircuitRelay 的简单布尔值 */
  relay?: RelayConfig;
}
```

2. **`packages/core/src/p2p/node.ts`** — 将 `circuitRelayServer()` 调用改为传入配置参数：

```typescript
if (relayConfig.enabled) {
  services.circuitRelay = circuitRelayServer({
    reservations: {
      maxReservations: relayConfig.maxCircuits,
      defaultDurationLimit: relayConfig.reservationTtlSec,
      defaultDataLimit: BigInt(relayConfig.maxCircuitBytes),
    },
  });
}
```

3. **`packages/node/src/config/`** — 支持环境变量映射：

```
CLAWNET_RELAY_ENABLED=true
CLAWNET_RELAY_MAX_CIRCUITS=128
CLAWNET_RELAY_MAX_BANDWIDTH_BPS=10485760
CLAWNET_RELAY_RESERVATION_TTL_SEC=3600
CLAWNET_RELAY_MAX_CIRCUIT_BYTES=10485760
```

4. **默认值策略**：
   - 普通节点默认 `maxCircuits: 64`
   - Bootstrap 节点维持 `BOOTSTRAP_P2P_CONFIG` 中的高限值（`maxCircuits: 256`）
   - 向后兼容：`enableCircuitRelay: true` 等价于 `relay.enabled: true` + 默认参数

### F3：Relay 流量统计 & 上报 API

**改动范围**：

1. **`packages/node/src/services/relay-service.ts`**（新建）— Relay 服务核心：

```typescript
export interface RelayStats {
  relayEnabled: boolean;
  totalCircuitsServed: number;
  activeCircuits: number;
  totalBytesRelayed: number;
  totalMessagesRelayed: number;
  /** Attachment relay 流量（F8：分类统计） */
  totalAttachmentBytesRelayed: number;
  uptimeSeconds: number;
  periodStats: {
    periodStart: number;    // Unix timestamp (秒)
    periodEnd: number;
    bytesRelayed: number;
    attachmentBytesRelayed: number;
    circuitsServed: number;
    uniquePeersServed: number;
  };
}

export class RelayService {
  /** 获取当前 relay 节点统计 */
  getStats(): RelayStats;

  /** 重置周期统计（由定时器或外部调用触发） */
  rotatePeriod(): void;
}
```

2. **数据采集方式**：监听 libp2p `circuit-relay-v2` 的内部事件。libp2p v2 relay server 会在 reservation 创建/关闭时触发事件，通过 `libp2p.addEventListener('relay:circuit:open' | 'relay:circuit:close', ...)` 捕获。字节数统计需要包装 relay stream 的读写方法做计数。

3. **`packages/node/src/api/routes/relay.ts`**（新建）— REST 路由：

```
GET /api/v1/relay/stats    → RelayStats
```

认证要求：需 API Key（同其他管理端点）。

4. **`packages/sdk/src/relay.ts`**（新建）— SDK 方法：

```typescript
export class RelayApi {
  async getStats(): Promise<RelayStats>;
}
```

5. **`packages/sdk/src/index.ts`** — 导出 `RelayApi`，挂载到 `ClawNetClient.relay`。

### F6：Relay DoS 防护（per-peer 限流）

**动机**：relay 节点暴露公网后，单个恶意 peer 可以通过大量 relay 连接耗尽资源。

**改动范围**：

1. **`packages/core/src/p2p/config.ts`** — 在 `RelayConfig` 中添加：

```typescript
export interface RelayConfig {
  // ...existing fields...
  /** 单个 peer 最大同时 relay 连接数。Default: 4 */
  maxCircuitsPerPeer: number;
  /** 单个 peer 每分钟最大新建连接数。Default: 10 */
  maxReservationsPerPeerPerMin: number;
}
```

2. **`packages/node/src/services/relay-service.ts`** — 实现 per-peer 连接追踪：

```typescript
// Map<PeerId, { activeCircuits: number, recentReservations: timestamp[] }>
private peerCircuitMap = new Map<string, PeerCircuitState>();
```

- 当新的 relay 请求到达时检查 per-peer 限制
- 超出限制时拒绝请求并记录日志
- 定期清理过期的速率计数器

3. **异常流量自动断开**：当单个 peer 在 60 秒内的连续 relay 请求超过 `maxReservationsPerPeerPerMin * 3` 时，临时 ban 该 peer 10 分钟。

### F7：Relay 黑名单/白名单访问控制

**改动范围**：

1. **`packages/core/src/p2p/config.ts`** — 在 `RelayConfig` 中添加：

```typescript
export interface RelayConfig {
  // ...existing fields...
  /** 访问控制模式。Default: 'open' */
  accessMode: 'open' | 'whitelist' | 'blacklist';
  /** 白名单/黑名单 DID 列表 */
  accessList: string[];
}
```

2. **`packages/node/src/services/relay-service.ts`** — relay 请求到达时校验 peer DID：

```typescript
private checkAccess(peerId: string): boolean {
  if (this.config.accessMode === 'open') return true;
  const peerDid = this.resolvePeerDid(peerId);
  if (this.config.accessMode === 'whitelist') {
    return this.config.accessList.includes(peerDid);
  }
  // blacklist
  return !this.config.accessList.includes(peerDid);
}
```

3. **运行时管理 API**（管理端点，需 API Key）：

```
POST /api/v1/relay/access   { action: 'add' | 'remove', did: string }
GET  /api/v1/relay/access   → { mode, list }
```

4. **持久化**：access list 存入 LevelDB `relay:access:*`，重启后恢复。

### F8：Attachment Relay 流量分类统计

**动机**：P2P 二进制附件传输（已实现，`/clawnet/1.0.0/attachment` 协议）可能产生大量流量。在 relay 统计和未来的奖励计算中需要区分 messaging relay 和 attachment relay，防止大文件传输被用来刷量获取不成比例的奖励。

**改动范围**：

1. **`packages/node/src/services/relay-service.ts`** — 流量分类：

- 在 relay stream 打开时通过协议标识（`/clawnet/1.0.0/attachment` vs `/clawnet/1.0.0/messages`）分类计数
- `RelayStats` 中的 `totalAttachmentBytesRelayed` 和 `periodStats.attachmentBytesRelayed` 单独记录

2. **奖励权重**（Phase 3 使用）：

```
messagingBytes   → 权重 1.0（正常消息，高价值 relay）
attachmentBytes  → 权重 0.3（大文件，低单位价值，防刷量）
```

### F9：Relay 节点自我诊断 API

**动机**：节点运营者需要快速判断自己的节点是否真的在有效提供 relay 服务。

**改动范围**：

1. **`packages/node/src/api/routes/relay.ts`** — 新增端点：

```
GET /api/v1/relay/health → RelayHealthInfo
```

2. **返回数据结构**：

```typescript
export interface RelayHealthInfo {
  /** relay 是否启用 */
  relayEnabled: boolean;
  /** autoNAT 检测结果：public / private / unknown */
  natStatus: 'public' | 'private' | 'unknown';
  /** 节点的公网地址（如果有） */
  publicAddresses: string[];
  /** 是否可被外部连接（autoNAT 确认） */
  isReachable: boolean;
  /** 当前 relay 负载 */
  load: {
    activeCircuits: number;
    maxCircuits: number;
    utilizationPercent: number;
    bandwidthUsedBps: number;
    maxBandwidthBps: number;
  };
  /** 诊断建议（如果有问题） */
  warnings: string[];
}
```

3. **实现**：从 libp2p 的 `autoNAT` 服务获取 NAT 状态，从 `addressManager` 获取公网地址，从 `RelayService` 获取负载数据。

4. **诊断规则**：
   - `natStatus === 'private'` → warning: "节点在 NAT 后面，无法作为有效 relay"
   - `utilizationPercent > 90` → warning: "relay 负载过高，考虑增加 maxCircuits 或限制连接"
   - `publicAddresses.length === 0` → warning: "未检测到公网地址"

---

## Phase 2：发现与优化（F2 + F5 + F12）

> 依赖 Phase 1 的统计基础设施。

### F2：Relay 节点 DHT 发现

**方案**：采用 TelagentNode 建议的 **方案 A（DHT Provider 记录）**，同时保留 bootstrap 作为降级路径。

**改动范围**：

1. **`packages/core/src/p2p/node.ts`** — Relay 节点在 DHT 中 provide 自定义 CID：

```typescript
// 用固定前缀 + 网络标识生成 relay provider CID
const RELAY_PROVIDER_KEY = '/clawnet/relay-providers/v1';

// Relay 节点启动后定期 provide
async advertiseAsRelay(): Promise<void> {
  const cid = CID.create(1, 0x55, multihash.encode(
    new TextEncoder().encode(RELAY_PROVIDER_KEY), 'sha2-256'
  ));
  await this.libp2p.contentRouting.provide(cid);
  // 每 30 分钟重新 provide
}
```

2. **NAT 后节点查找 relay**：

```typescript
async discoverRelayNodes(): Promise<PeerInfo[]> {
  const relayPeers: PeerInfo[] = [];
  for await (const provider of this.libp2p.contentRouting.findProviders(relayCid)) {
    relayPeers.push(provider);
    if (relayPeers.length >= 10) break; // 最多收集 10 个候选
  }
  return relayPeers;
}
```

3. **降级路径**：如果 DHT 查找在 15 秒内未找到任何 relay 节点，回退到 bootstrap 节点的 relay。

### F5：Relay 节点健康探测 & 质量评分

**动机**：仅发现 relay 节点不够，需要选择"最优"的 relay。

**改动范围**：

1. **`packages/core/src/p2p/relay-scorer.ts`**（新建）— Relay 质量评分器：

```typescript
export interface RelayScore {
  peerId: string;
  latencyMs: number;          // ping 延迟
  availableCapacity: number;  // 剩余可用 circuit 数
  successRate: number;        // 历史连接成功率
  score: number;              // 综合评分
}

export class RelayScorer {
  /** 对候选 relay 列表进行健康探测并评分 */
  async scoreRelays(candidates: PeerInfo[]): Promise<RelayScore[]>;

  /** 选择最优 relay */
  async selectBestRelay(candidates: PeerInfo[]): Promise<PeerInfo | null>;
}
```

2. **评分公式**：

```
score = (1 / latencyMs) × 100
      × successRate
      × min(availableCapacity / maxCapacity, 1.0)
```

3. **探测机制**：
   - 使用 libp2p `ping` 服务测量 RTT
   - 通过自定义协议 `/clawnet/1.0.0/relay-info` 查询 relay 节点的负载信息
   - 本地缓存评分结果，TTL 5 分钟，避免频繁探测

4. **`/clawnet/1.0.0/relay-info` 协议**（relay 节点侧）：

```typescript
// Relay 节点响应健康探测请求
interface RelayInfoResponse {
  activeCircuits: number;
  maxCircuits: number;
  uptimeSeconds: number;
}
```

### F12：Graceful Relay 迁移（优雅下线）

**动机**：relay 节点关闭时，正在使用它的 NAT 后节点会突然断开。需要优雅迁移机制。

**改动范围**：

1. **`packages/core/src/p2p/node.ts`** — 在 `stop()` 流程中添加 relay 迁移步骤：

```typescript
async stopRelay(): Promise<void> {
  // 1. 停止接受新的 relay 请求（标记为 draining）
  this.relayDraining = true;

  // 2. 通知所有当前使用本节点 relay 的 peer
  for (const circuit of this.activeCircuits) {
    await this.notifyRelayMigration(circuit.peerId, {
      reason: 'shutdown',
      suggestedRelays: await this.discoverRelayNodes(),
      gracePeriodSec: 30,
    });
  }

  // 3. 等待 grace period 让 peer 迁移
  await delay(30_000);

  // 4. 关闭剩余连接
  await this.circuitRelay.stop();
}
```

2. **NAT 后节点处理迁移通知**：

```typescript
// 收到 relay-migration 通知后
onRelayMigration(notification: RelayMigrationNotice): void {
  // 1. 从建议列表或 DHT 中选择新的 relay
  // 2. 建立新的 relay 连接
  // 3. 关闭旧连接
}
```

3. **通知协议**：`/clawnet/1.0.0/relay-migration`

```typescript
interface RelayMigrationNotice {
  reason: 'shutdown' | 'overload' | 'maintenance';
  suggestedRelays: string[];   // 建议的替代 relay multiaddr
  gracePeriodSec: number;
}
```

---

## Phase 3：激励层（F4 + F10 + F11）

> 依赖 Phase 1 的统计数据 + Phase 2 的节点发现。

### F4：Relay 奖励 Proof 生成

**改动范围**：

1. **`packages/node/src/services/relay-service.ts`** — 生成周期贡献证明：

```typescript
export interface RelayPeriodProof {
  relayDid: string;
  periodId: number;
  periodStart: number;
  periodEnd: number;
  bytesRelayed: number;
  attachmentBytesRelayed: number;
  circuitsServed: number;
  uniquePeersServed: number;
  /** 被 relay 的 peer 的 co-sign 列表（F10：必选） */
  peerConfirmations: PeerConfirmation[];
  /** relay 节点自身签名 */
  relaySignature: string;
}

export interface PeerConfirmation {
  peerDid: string;
  bytesConfirmed: number;
  circuitsConfirmed: number;
  signature: string;
}
```

2. **API 端点**：

```
GET /api/v1/relay/period-proof           → RelayPeriodProof
POST /api/v1/relay/confirm-contribution  → 被 relay 的 peer 确认贡献
```

3. **SDK 方法**：

```typescript
export class RelayApi {
  async getStats(): Promise<RelayStats>;
  async getPeriodProof(): Promise<RelayPeriodProof>;
  async confirmContribution(params: ConfirmContributionParams): Promise<void>;
}
```

### F10：双向签名贡献证明（co-sign 升级为必选）

**动机**：单节点自签 proof 可以伪造流量数据。将 co-sign 从"可选增强"升级为必选。

**设计**：

1. **Relay 流量确认协议** `/clawnet/1.0.0/relay-confirm`：

```
定期（每 10 分钟）：
Relay Node → Served Peer: "你在过去 10 分钟使用了我 X bytes relay，请确认"
Served Peer → Relay Node: { peerDid, bytesConfirmed, signature }
```

2. **确认逻辑**：
   - 被 relay 的 peer 本地也记录自己通过 relay 传输的字节数
   - 如果 relay 节点声称的字节数与 peer 本地记录偏差 > 20%，拒绝签名
   - peer 签名使用自己的 DID Ed25519 私钥

3. **合约验证**：
   - `claimReward()` 时必须提交至少 `min(uniquePeersServed, 3)` 个 peer confirmation
   - 合约验证每个 confirmation 的签名有效性
   - 无有效 co-sign 的 proof 不发放奖励

4. **降级策略**：
   - 如果 peer 离线无法 co-sign → 该部分流量不计入奖励（宁缺勿滥）
   - 未来可引入 Oracle 节点作为第三方见证

### F11：奖励公式增加"被服务方确认"因子

**原始公式**（TelagentNode 提出）：

```
rewardAmount = baseRate
    × log2(1 + bytesRelayed / 1GB)
    × min(uniquePeers / 10, 3.0)
    × uptimeBonus
```

**改进公式**：

```
confirmedBytes = Σ(peerConfirmations[i].bytesConfirmed)  // 只计被确认的流量
weightedBytes  = messagingConfirmedBytes × 1.0
               + attachmentConfirmedBytes × 0.3           // F8: 附件流量降权

rewardAmount = baseRate
    × log2(1 + weightedBytes / 1GB)                       // 对数缩减
    × min(confirmedUniquePeers / 10, 3.0)                  // 确认的唯一 peer 数
    × uptimeBonus                                          // 连续在线加成
    × confirmationRatio                                    // 确认率加成
```

**参数说明**：

| 参数 | 计算方式 | 说明 |
|------|----------|------|
| `baseRate` | DAO ParamRegistry 可调 | 基础奖励率（Token/周期） |
| `weightedBytes` | messaging × 1.0 + attachment × 0.3 | 分类加权字节数 |
| `confirmedUniquePeers` | co-sign 确认的唯一 peer 数 | 防 Sybil |
| `uptimeBonus` | `min(consecutivePeriods / 30, 1.5)` | 连续 30 个周期在线获 1.5x |
| `confirmationRatio` | `confirmedBytes / claimedBytes`（0~1） | 确认率越高奖励越多 |

**防作弊增强**：

| 攻击向量 | 防御机制 |
|----------|----------|
| 伪造流量数据 | co-sign 必选：被服务方必须确认，自签不计 |
| Sybil 攻击（伪造多 peer） | uniquePeers 必须有链上注册的 DID + 最低 stake |
| 大文件刷量 | attachment 流量权重 0.3，messaging 权重 1.0 |
| 自己 relay 自己 | relay 节点不得为自己的 DID 中继（合约层校验） |
| 单节点超额奖励 | 单节点单周期奖励上限 = `baseRate × 10` |

---

## 链上合约：RelayRewardPool

> TelagentNode 团队可在其侧实现合约，以下为 ClawNet 建议的合约接口设计。

### 合约接口

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRelayRewardPool {
    struct PeerConfirmation {
        bytes32 peerDidHash;
        uint256 bytesConfirmed;
        uint256 circuitsConfirmed;
        bytes signature;
    }

    /// @notice Relay 节点提交贡献证明并领取奖励
    /// @param relayDidHash relay 节点 DID 的 keccak256 哈希
    /// @param periodId 周期 ID（单调递增）
    /// @param messagingBytesRelayed 消息 relay 流量
    /// @param attachmentBytesRelayed 附件 relay 流量
    /// @param circuitsServed relay 连接数
    /// @param confirmations 被 relay 的 peer 的确认签名列表
    /// @param relaySignature relay 节点对以上数据的签名
    function claimReward(
        bytes32 relayDidHash,
        uint256 periodId,
        uint256 messagingBytesRelayed,
        uint256 attachmentBytesRelayed,
        uint256 circuitsServed,
        PeerConfirmation[] calldata confirmations,
        bytes calldata relaySignature
    ) external returns (uint256 rewardAmount);

    /// @notice 查询当前奖励参数
    function getRewardParams() external view returns (
        uint256 baseRate,
        uint256 maxRewardPerPeriod,
        uint256 minBytesThreshold,
        uint256 minPeersThreshold,
        uint256 attachmentWeightBps  // 3000 = 0.3x
    );

    /// @notice 查询 relay 节点的 claim 历史
    function getClaimHistory(bytes32 relayDidHash)
        external view returns (uint256[] memory periodIds, uint256[] memory amounts);

    /// @notice DAO 调整奖励参数
    function setRewardParams(
        uint256 baseRate,
        uint256 maxRewardPerPeriod,
        uint256 minBytesThreshold,
        uint256 minPeersThreshold,
        uint256 attachmentWeightBps
    ) external; // onlyRole(DAO_ROLE)

    event RewardClaimed(
        bytes32 indexed relayDidHash,
        uint256 indexed periodId,
        uint256 rewardAmount,
        uint256 confirmedBytes,
        uint256 confirmedPeers
    );
}
```

### 合约安全约束

| 约束 | 说明 |
|------|------|
| 周期去重 | `lastClaimedPeriod[relayDid]` 必须 < `periodId` |
| 最低门槛 | `confirmedBytes >= minBytesThreshold && confirmedPeers >= minPeersThreshold` |
| 单周期上限 | `rewardAmount <= maxRewardPerPeriod` |
| 签名验证 | `relaySignature` 必须对应链上注册的 DID（通过 ClawIdentity 合约） |
| co-sign 验证 | 每个 `PeerConfirmation.signature` 必须对应链上注册的 DID |
| 自 relay 防护 | `relayDidHash != peerDidHash` 对每个 confirmation |
| UUPS 升级 | 合约使用 OZ UUPS 代理模式，与现有合约一致 |

---

## 实施路线 & 改动范围总结

### Phase 1（基础能力）

| 包 | 文件 | 改动 |
|----|------|------|
| `core` | `src/p2p/config.ts` | 扩展 `RelayConfig` 接口 |
| `core` | `src/p2p/node.ts` | 精细化 `circuitRelayServer()` 参数 |
| `node` | `src/config/` | 环境变量映射 relay 配置 |
| `node` | `src/services/relay-service.ts`（新建） | 流量统计、per-peer 限流、黑白名单、自诊断 |
| `node` | `src/api/routes/relay.ts`（新建） | REST 端点：stats, health, access |
| `sdk` | `src/relay.ts`（新建） | `RelayApi` 类 |
| `sdk` | `src/index.ts` | 导出 `RelayApi` |

### Phase 2（发现与优化）

| 包 | 文件 | 改动 |
|----|------|------|
| `core` | `src/p2p/node.ts` | DHT relay provider 广播 + 查找 |
| `core` | `src/p2p/relay-scorer.ts`（新建） | 质量评分器 |
| `core` | `src/p2p/node.ts` | Graceful shutdown relay 迁移 |
| `node` | `src/services/relay-service.ts` | relay-info / relay-migration 协议处理 |

### Phase 3（激励层）

| 包 | 文件 | 改动 |
|----|------|------|
| `node` | `src/services/relay-service.ts` | period proof 生成 + co-sign 收集 |
| `node` | `src/api/routes/relay.ts` | period-proof + confirm-contribution 端点 |
| `sdk` | `src/relay.ts` | `getPeriodProof()`, `confirmContribution()` |
| `contracts` | `contracts/ClawRelayReward.sol`（新建） | RelayRewardPool 合约 |
| `contracts` | `scripts/deploy-relay-reward.ts`（新建） | 部署脚本 |

---

## 验收标准

### Phase 1

- [x] clawnetd 支持 `relay.*` 配置项（yaml + 环境变量），可配置 maxCircuits / maxBandwidth / reservationTtl 等
- [x] `GET /api/v1/relay/stats` 返回准确的流量统计（含 attachment 分类）
- [x] `GET /api/v1/relay/health` 返回节点 NAT 状态、公网地址、relay 负载
- [x] per-peer 连接限流正常工作，超限 peer 被拒绝并记录日志
- [x] relay 黑名单/白名单可通过 API 管理，重启后持久化
- [x] NAT 后节点可通过非 bootstrap 的 relay 节点完成通信
- [x] SDK 新增 `relay.getStats()` 方法

### Phase 2

- [x] relay 节点通过 DHT 广播自身为 relay provider
- [x] NAT 后节点能通过 DHT 发现 relay 节点列表
- [x] 质量评分器根据延迟/负载/成功率选择最优 relay
- [x] relay 节点 graceful shutdown 时通知使用者迁移，无突断
- [x] DHT 查找失败时自动降级到 bootstrap relay

### Phase 3

- [ ] `relay.getPeriodProof()` 返回带 co-sign 的周期贡献证明
- [ ] relay-confirm 协议正常工作，被 relay 的 peer 定期确认流量
- [ ] 合约 `claimReward()` 验证 relay 签名 + peer co-sign
- [ ] 合约执行分类加权奖励公式
- [ ] 合约拒绝：重复 claim / 低于门槛 / 超过上限 / 自 relay
- [ ] 奖励参数可通过 DAO 调整

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| libp2p circuit-relay-v2 不暴露足够的内部事件用于流量统计 | F3 实现困难 | 通过包装 relay stream 做计数；必要时 fork relay 模块 |
| DHT 在小网络中 provide/findProviders 延迟较高 | F2 发现慢 | 保留 bootstrap 降级；DHT provide 间隔 30 分钟 |
| peer 离线无法 co-sign | F10 确认率低 | 降级策略：无 co-sign 部分不计奖励；引入 Oracle 节点 |
| 奖励池 token 不足 | F4 无法持续 | 合约检查余额；DAO 定期充值；告警机制 |
| per-peer 限流误伤合法高频用户 | F6 服务质量下降 | 限额可配置；提供白名单机制（F7）豁免 |
| co-sign 协议增加网络开销 | F10 带宽增加 | 确认间隔 10 分钟，数据量小（< 1KB/次） |

---

## 与现有文档的关系

| 文档 | 关系 |
|------|------|
| [economics.md](economics.md) § 4 Node Incentives | relay reward 是 node incentive 的扩展，需保持 public treasury 分配一致 |
| [scaling-plan.md](scaling-plan.md) § 1 P2P 层 | scaling plan 已提到"部署 5-10 个 relay 节点"，本方案替代为开放式 relay |
| [p2p-spec.md](p2p-spec.md) | 新增协议：`/clawnet/1.0.0/relay-info`, `/clawnet/1.0.0/relay-confirm`, `/clawnet/1.0.0/relay-migration` |
| [on-chain-plan.md](on-chain-plan.md) § 10 Staking | relay reward 合约与 staking 合约共享 DID → EVM address 映射 |
