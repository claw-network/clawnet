# 开放式 Relay 网络 + 激励机制实现回复

> **回复方**: ClawNet 团队
> **接收方**: TelagentNode 团队
> **日期**: 2026-03-09
> **关联文档**: `docs/issues/clawnetd-open-relay-incentive.md`
> **实施计划**: `docs/implementation/relay-network-plan.md`
> **验证计划**: `docs/implementation/relay-incentive-verification.md`
> **涉及包**: `@claw-network/core`, `@claw-network/node`, `@claw-network/sdk`, `@claw-network/contracts`
> **发布版本**: **v0.6.0**（已发布至 npm）

---

## ⚠️ 请升级依赖到 v0.6.0

本次开放式 Relay 网络 + 激励机制所有功能已随 **v0.6.0** 一并发布到 npm，请尽快升级：

```bash
pnpm add @claw-network/sdk@0.6.0
# 或
npm install @claw-network/sdk@0.6.0
```

如果同时使用了 core / node 包：

```bash
pnpm add @claw-network/core@0.6.0 @claw-network/node@0.6.0 @claw-network/sdk@0.6.0
```

v0.6.0 新增的 `client.relay` 命名空间在旧版本中**不存在**，必须升级后才能使用本文档描述的所有 relay API。

---

## 状态：全部 4 项功能 + 8 项加固特性已实现 ✅

需求文档提出的 4 项功能（F1–F4）全部采纳并实现，ClawNet 团队在此基础上补充了 8 项加固特性（F5–F12），按 3 个 Phase 完成。全部编译通过，测试通过。

| Phase | 内容 | 状态 |
|-------|------|------|
| **Phase 1** | F1 开放式 Relay 配置 + F3 流量统计 API + F6 DoS 防护 + F7 黑白名单 + F8 附件分类统计 + F9 自诊断 | ✅ |
| **Phase 2** | F2 DHT Relay 发现 + F5 质量评分 + F12 优雅下线迁移 | ✅ |
| **Phase 3** | F4 奖励 Proof 生成 + F10 双向签名（co-sign）+ F11 改进奖励公式 + 链上合约 | ✅ |

---

## 一、功能一：开放式 Relay 配置（F1）

### 实现方式

任意 clawnetd 节点均可通过配置启用/关闭 relay server，并设置资源限制。

### 配置接口

**环境变量**（与需求文档 §2.1 对应）：

```bash
CLAWNET_RELAY_ENABLED=true
CLAWNET_RELAY_MAX_CIRCUITS=128
CLAWNET_RELAY_MAX_BANDWIDTH_BPS=10485760
CLAWNET_RELAY_RESERVATION_TTL_SEC=3600
CLAWNET_RELAY_MAX_CIRCUIT_BYTES=10485760
```

**config.yaml**：

```yaml
p2p:
  relay:
    enabled: true
    maxCircuits: 128
    maxBandwidthBps: 10485760
    reservationTtlSec: 3600
    maxCircuitBytes: 10485760
    maxCircuitsPerPeer: 4
    maxReservationsPerPeerPerMin: 10
    accessMode: open          # open / whitelist / blacklist
    accessList: []
```

### 默认值

| 参数 | 普通节点默认值 | Bootstrap 节点默认值 |
|------|---------------|---------------------|
| `maxCircuits` | 64 | 256 |
| `maxBandwidthBps` | 1 MB/s | 10 MB/s |
| `reservationTtlSec` | 3600 (1h) | 3600 (1h) |
| `maxCircuitBytes` | 10 MB | 10 MB |
| `maxCircuitsPerPeer` | 4 | 8 |
| `maxReservationsPerPeerPerMin` | 10 | 20 |
| `accessMode` | `open` | `open` |

**向后兼容**：已有的 `enableCircuitRelay: true` 配置等价于 `relay.enabled: true` + 默认参数，无需修改现有配置。

### 改动文件

| 文件 | 改动 |
|------|------|
| `packages/core/src/p2p/config.ts` | 新增 `RelayConfig` 接口、`DEFAULT_RELAY_CONFIG`、`BOOTSTRAP_RELAY_CONFIG`、`resolveRelayConfig()` |
| `packages/core/src/p2p/node.ts` | `circuitRelayServer()` 改为传入精细化参数 |
| `packages/node/src/daemon.ts` | 环境变量 → relay 配置映射 |

---

## 二、功能二：Relay 节点 DHT 发现（F2）

### 实现方式

采纳需求文档推荐的 **方案 A（DHT Provider 记录）**。

### 工作原理

```
Relay 节点                              DHT                         NAT 后节点
    │                                     │                              │
    ├── provide(RELAY_PROVIDER_KEY) ─────►│                              │
    │   （每 30 分钟刷新一次）               │                              │
    │                                     │                              │
    │                                     │◄── findProviders() ──────────┤
    │                                     │──► [Relay X, Relay Y, ...] ──►│
    │                                     │                              │
    │                                     │                    选择最优 relay
    │                                     │                    （见 F5 评分）
```

**DHT Key**: `/clawnet/relay-providers/v1`（CID 编码后 provide 到 KadDHT）

**降级路径**：DHT 查找 15 秒超时后，自动回退到 bootstrap 节点的 relay。

### API

```
GET /api/v1/relay/discover → { relays: string[], count: number }
```

### SDK

```typescript
const discovery = await client.relay.discover();
// { relays: ["12D3KooW...", "12D3KooW..."], count: 2 }
```

---

## 三、功能三：Relay 流量统计 & 上报 API（F3）

### `GET /api/v1/relay/stats`

返回数据结构与需求文档 §2.3 一致，额外增加了附件分类统计（F8）：

```json
{
  "data": {
    "relayEnabled": true,
    "totalCircuitsServed": 156,
    "activeCircuits": 3,
    "totalBytesRelayed": 524288000,
    "totalMessagesRelayed": 4280,
    "totalAttachmentBytesRelayed": 104857600,
    "uptimeSeconds": 86400,
    "periodStats": {
      "periodStart": 1741392000,
      "periodEnd": 1741395600,
      "bytesRelayed": 10485760,
      "attachmentBytesRelayed": 2097152,
      "circuitsServed": 12,
      "uniquePeersServed": 5
    }
  }
}
```

**统计周期**：1 小时，与 unix 时间戳对齐，自动轮转。

### SDK

```typescript
const stats = await client.relay.getStats();
console.log(stats.totalBytesRelayed);
console.log(stats.periodStats.uniquePeersServed);
```

---

## 四、功能四：Relay 奖励 Proof 生成（F4）

### Proof 结构

```typescript
interface RelayPeriodProof {
  relayDid: string;
  periodId: number;
  periodStart: number;
  periodEnd: number;
  bytesRelayed: number;
  attachmentBytesRelayed: number;
  circuitsServed: number;
  uniquePeersServed: number;
  peerConfirmations: PeerConfirmation[];  // co-sign 列表（F10：必选）
  relaySignature: string;                 // relay 节点 Ed25519 签名
}

interface PeerConfirmation {
  peerDid: string;
  bytesConfirmed: number;
  circuitsConfirmed: number;
  signature: string;                      // peer Ed25519 签名
}
```

### API

```
GET  /api/v1/relay/period-proof         → 获取上一次生成的 proof（无则 null）
POST /api/v1/relay/period-proof         → 触发新 proof 生成（需 relayDid）
POST /api/v1/relay/confirm-contribution → 被 relay 的 peer 确认贡献
```

### SDK

```typescript
// 获取上次 proof
const proof = await client.relay.getPeriodProof();

// 触发生成新 proof
const newProof = await client.relay.generatePeriodProof('did:claw:zRelay...');

// 被 relay 的 peer 确认贡献
await client.relay.confirmContribution({
  peerDid: 'did:claw:zPeer...',
  bytesConfirmed: 5242880,
  circuitsConfirmed: 3,
  signature: '<ed25519-base58-signature>',
});
```

### Proof 生成流程

```
1. RelayService 收集当前周期的 per-peer 流量数据
2. 向每个被 relay 的 peer 发送 /clawnet/1.0.0/relay-confirm 请求
3. Peer 比对本地记录（偏差 > 20% → 拒绝签名）
4. 收集 PeerConfirmation 列表
5. 快照并轮转周期统计
6. 用 relay 节点 DID 私钥签名完整 proof
```

### 防作弊机制（与需求文档 §2.4 对应 + 增强）

| 机制 | 实现方式 |
|------|---------|
| **签名验证** | relay proof 用 DID Ed25519 私钥签名 |
| **周期去重** | 合约强制 `periodId > lastClaimedPeriod`（单调递增） |
| **最低门槛** | `minBytesThreshold` (默认 1 MB) + `minPeersThreshold` (默认 1) |
| **上限封顶** | `maxRewardPerPeriod` 默认 1000 Token |
| **双向验证** | co-sign 从"可选增强"升级为 **必选**：合约要求至少 `minPeersThreshold` 个 peer confirmation |
| **自 relay 防护** | 合约校验每个 `peerDidHash != relayDidHash` |
| **peer 去重** | 合约校验 confirmations 中无重复 peer |

---

## 五、ClawNet 补充的加固特性（F5–F12）

### F5：Relay 质量评分

NAT 后节点发现 relay 后，自动评分选最优：

```typescript
const scores = await client.relay.getScores();
// scores: [{ peerId, latencyMs, availableCapacity, maxCapacity, successRate, score }, ...]
```

**评分维度**：延迟（ping RTT）、可用容量、历史成功率。结果缓存 5 分钟。

通过 `/clawnet/1.0.0/relay-info` 协议查询 relay 节点当前负载。

### F6：Relay DoS 防护

| 限制 | 默认值 | 说明 |
|------|--------|------|
| `maxCircuitsPerPeer` | 4 | 单 peer 最大同时 relay 连接 |
| `maxReservationsPerPeerPerMin` | 10 | 单 peer 每分钟最大新建连接 |
| 自动 ban | 3× 超限 → 10 分钟 ban | 防止暴力资源耗尽 |

### F7：Relay 黑名单/白名单

```
GET  /api/v1/relay/access                    → 查看当前模式和列表
POST /api/v1/relay/access { mode: "whitelist" }  → 切换到白名单模式
POST /api/v1/relay/access { action: "add", did: "did:claw:z..." }  → 添加到列表
POST /api/v1/relay/access { action: "remove", did: "did:claw:z..." }  → 从列表移除
```

### F8：Attachment Relay 流量分类统计

P2P 附件传输（`/clawnet/1.0.0/attachment`）的 relay 流量单独统计：

- `totalAttachmentBytesRelayed`（累计）
- `periodStats.attachmentBytesRelayed`（周期内）
- 奖励计算时权重 0.3x（防止大文件刷量）

### F9：Relay 节点自诊断

```
GET /api/v1/relay/health
```

```json
{
  "data": {
    "relayEnabled": true,
    "natStatus": "public",
    "publicAddresses": ["/ip4/66.94.125.242/tcp/9527"],
    "isReachable": true,
    "load": {
      "activeCircuits": 3,
      "maxCircuits": 64,
      "utilizationPercent": 4.7
    },
    "warnings": []
  }
}
```

**自动告警**：
- `natStatus === 'private'` → "节点在 NAT 后面，无法作为有效 relay"
- `utilizationPercent > 90` → "relay 负载过高"
- `publicAddresses.length === 0` → "未检测到公网地址"

### F10：双向签名贡献证明（co-sign 必选）

P2P 协议 `/clawnet/1.0.0/relay-confirm`：

```
每 period 结束时:
Relay Node → Served Peer: "你在过去 1 小时使用了我 X bytes relay，请确认"
Served Peer：比对本地记录
  偏差 ≤ 20% → 签名确认 { peerDid, bytesConfirmed, signature }
  偏差 > 20% → 拒绝签名
```

### F11：改进奖励公式

在需求文档 §3.1 建议的公式基础上增加了分类加权和确认率因子：

```
confirmedBytes = Σ(peerConfirmations[i].bytesConfirmed)
weightedBytes  = messagingConfirmedBytes × 1.0
               + attachmentConfirmedBytes × 0.3

rewardAmount = baseRate
    × log₂(1 + weightedBytes / 1 GiB)      // 对数缩减
    × min(confirmedUniquePeers / 10, 3.0)   // peer 因子（封顶 3x）
    × min(consecutivePeriods / 30, 1.5)     // 连续在线加成（封顶 1.5x）
    × (confirmedBytes / claimedBytes)        // 确认率（0~1）

rewardAmount = floor(min(rawReward, maxRewardPerPeriod))
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `baseRate` | 100 Token/周期 | DAO 可调 |
| `attachmentWeight` | 0.3 | 附件流量降权 |
| `maxRewardPerPeriod` | 1000 Token | 单节点单周期上限 |
| `minBytesThreshold` | 1 MB | 最低确认字节数 |
| `minPeersThreshold` | 1 | 最低确认 peer 数 |

### F12：优雅下线迁移

Relay 节点关闭时不突断现有连接：

```
POST /api/v1/relay/drain { enable: true }
```

1. 停止接受新 relay 请求
2. 通过 `/clawnet/1.0.0/relay-migration` 协议通知使用者迁移
3. 等待 grace period (30s)
4. 关闭剩余连接

---

## 六、链上合约：ClawRelayReward

已实现完整的 UUPS 可升级合约，部署流水线已打通。

### 合约接口

```solidity
// 核心方法
function claimReward(
    bytes32 relayDidHash,
    uint256 periodId,
    uint256 messagingBytesRelayed,
    uint256 attachmentBytesRelayed,
    uint256 circuitsServed,
    uint256 rewardAmount,
    PeerConfirmation[] calldata confirmations
) external returns (uint256 actualReward);

// 查询方法
function getRewardParams() external view returns (...);
function getClaimHistory(bytes32 relayDidHash) external view returns (...);
function getClaimCount(bytes32 relayDidHash) external view returns (uint256);
function poolBalance() external view returns (uint256);

// 管理方法（DAO_ROLE）
function setRewardParams(...) external;
```

### 合约安全约束

| 约束 | 说明 |
|------|------|
| 周期去重 | `lastClaimedPeriod[relayDid] < periodId` 强制单调递增 |
| Peer 最低门槛 | `confirmations.length >= minPeersThreshold` |
| 自 relay 防护 | `relayDidHash != peerDidHash` 每个 confirmation 校验 |
| peer 去重 | confirmation 列表中不允许重复 peer |
| 字节门槛 | `totalConfirmedBytes >= minBytesThreshold` |
| 奖励上限 | `actualReward = min(rewardAmount, maxRewardPerPeriod)` |
| 池余额检查 | 奖励不超过合约持有 Token 余额 |
| 暂停开关 | `PAUSER_ROLE` 可紧急暂停 |
| UUPS 升级 | `DEFAULT_ADMIN_ROLE` 控制 |

### 部署集成

- `ClawRelayReward` 已纳入 `deploy-all.ts` 作为第 10 个合约
- `bootstrap-mint.ts` 自动 mint 奖励池 Token 到合约地址
- 地址写入 `contracts.json`
- 环境变量（均有默认值）：

```bash
RELAY_REWARD_BASE_RATE=100
RELAY_REWARD_MAX_PER_PERIOD=1000
RELAY_REWARD_MIN_BYTES=1000000      # 1 MB
RELAY_REWARD_MIN_PEERS=1
RELAY_REWARD_ATTACHMENT_WEIGHT_BPS=3000  # 0.3x
RELAY_REWARD_POOL_AMOUNT=100000     # 初始奖励池
```

### Node 服务层自动 Claim

`RelayRewardService` 实现了自动 claim 闭环：

```
每个 period 结束后 (1 小时):
1. generatePeriodProof() → 收集 co-sign + 生成签名证明
2. computeRelayReward() → 计算奖励金额
3. 调用合约 claimReward() → 链上领取
4. Indexer 监听 RewardClaimed 事件 → 写入 SQLite relay_rewards 表
```

### Reward API

```
GET  /api/v1/relay/reward/status   → 奖励池状态、参数、历史
POST /api/v1/relay/reward/claim    → 手动触发 claim
GET  /api/v1/relay/reward/preview  → 预估奖励（不 claim）
```

---

## 七、完整 REST API 端点一览

所有端点挂载在 `/api/v1/relay/` 下，需 `X-Api-Key` 或 `Authorization: Bearer` 认证。

| 方法 | 端点 | 功能 | Phase |
|------|------|------|-------|
| `GET` | `/stats` | Relay 流量统计 | 1 |
| `GET` | `/health` | 自诊断（NAT 状态、负载、告警） | 1 |
| `GET` | `/access` | 黑白名单查看 | 1 |
| `POST` | `/access` | 黑白名单管理 | 1 |
| `GET` | `/discover` | DHT 发现 relay 节点 | 2 |
| `GET` | `/scores` | Relay 质量评分 | 2 |
| `GET` | `/peers` | 当前使用本节点 relay 的 peer 列表 | 2 |
| `POST` | `/drain` | 启停优雅下线模式 | 2 |
| `GET` | `/period-proof` | 获取上次生成的 proof | 3 |
| `POST` | `/period-proof` | 触发新 proof 生成 | 3 |
| `POST` | `/confirm-contribution` | Peer 确认 relay 贡献 | 3 |
| `GET` | `/reward/status` | 奖励池状态 + 参数 | 3 |
| `POST` | `/reward/claim` | 手动 claim 奖励 | 3 |
| `GET` | `/reward/preview` | 预估奖励 | 3 |

---

## 八、SDK 新增方法

`@claw-network/sdk` 新增 `RelayApi` 类，挂载在 `client.relay`：

```typescript
import { ClawNetClient } from '@claw-network/sdk';

const client = new ClawNetClient({ baseUrl: 'http://localhost:9528', apiKey: '...' });

// Phase 1：统计 + 健康 + 访问控制
const stats = await client.relay.getStats();
const health = await client.relay.getHealth();
const access = await client.relay.getAccess();
await client.relay.updateAccess({ mode: 'whitelist' });
await client.relay.updateAccess({ action: 'add', did: 'did:claw:z...' });

// Phase 2：发现 + 评分 + Peer 管理
const relays = await client.relay.discover();
const scores = await client.relay.getScores();
const peers = await client.relay.getPeers();
await client.relay.setDrain(true);  // 开始优雅下线

// Phase 3：Proof + 奖励
const proof = await client.relay.getPeriodProof();
const newProof = await client.relay.generatePeriodProof('did:claw:zRelay...');
await client.relay.confirmContribution({
  peerDid: 'did:claw:zPeer...',
  bytesConfirmed: 5242880,
  circuitsConfirmed: 3,
  signature: '<sig>',
});

// 奖励
const status = await client.relay.getRewardStatus();
const preview = await client.relay.previewReward();
const claim = await client.relay.claimReward();
```

### TypeScript 类型导出

```typescript
import type {
  RelayStats,
  RelayHealthInfo,
  RelayAccessInfo,
  RelayScore,
  RelayPeriodProof,
  PeerConfirmation,
  // ... 共 15+ 类型
} from '@claw-network/sdk';
```

---

## 九、新增 P2P 协议

| 协议 ID | 用途 | Phase |
|---------|------|-------|
| `/clawnet/1.0.0/relay-info` | 查询 relay 节点负载信息（评分用） | 2 |
| `/clawnet/1.0.0/relay-confirm` | 定期确认 relay 流量（co-sign） | 3 |
| `/clawnet/1.0.0/relay-migration` | 优雅下线通知迁移 | 2 |

---

## 十、验证结果

| 检查项 | 结果 |
|--------|------|
| `pnpm build`（全部 9 包） | ✅ 编译通过 |
| `@claw-network/core` | ✅ 70 测试通过（含 relay-reward 9 个 + relay-scorer 测试） |
| `@claw-network/node` | ✅ 284 测试通过（含 relay-service 11 个 + relay-api 5 个） |
| `@claw-network/contracts` | ✅ 599 测试通过（含 ClawRelayReward 16 个） |

### 测试覆盖

| 测试文件 | 测试数 | 覆盖内容 |
|----------|--------|---------|
| `core/test/relay-reward.test.ts` | 9 | 公式计算、阈值、上限、peer 因子、uptime bonus、确认率 |
| `core/test/relay-scorer.test.ts` | 若干 | 评分排序、缓存 TTL、并行探测 |
| `node/test/relay-service.test.ts` | 11 | per-peer 限流、ban、统计、period 轮转、访问控制、健康检查 |
| `node/test/relay-api.test.ts` | 5 | HTTP 端点 stats/health/access/discover/scores |
| `contracts/test/ClawRelayReward.test.ts` | 16 | claim 流程、周期去重、自 relay 防护、peer 去重、阈值、上限、DAO 参数、暂停 |

### Docker 集成测试

`scripts/scenario-relay-reward.mjs` 提供 8 个场景的端到端验证：

```bash
# 仅 P2P 层（无链）
docker compose -f docker-compose.testnet.yml up --build -d
node scripts/scenario-relay-reward.mjs --verbose

# 完整 e2e（含链 + 合约）
docker compose -f docker-compose.relay-test.yml up --build -d
./scripts/setup-relay-test.sh
node scripts/scenario-relay-reward.mjs --verbose
```

---

## 十一、变更文件清单

共 59 个文件，+7224 行代码。

### Core P2P 层

| 文件 | 改动 |
|------|------|
| `packages/core/src/p2p/config.ts` | `RelayConfig` 接口、默认配置、bootstrap 配置、`resolveRelayConfig()` |
| `packages/core/src/p2p/node.ts` | 精细化 `circuitRelayServer()`、DHT relay 发现/广播、relay-info / relay-confirm / relay-migration 3 个协议处理 |
| `packages/core/src/p2p/relay-reward.ts` | `computeRelayReward()` 公式、`RewardInput` / `RewardParams` / `RewardResult` 类型 |
| `packages/core/src/p2p/relay-scorer.ts` | `RelayScorer` 类、`RelayScore` 类型、缓存 + 并行探测 |
| `packages/core/src/p2p/index.ts` | 导出更新 |

### Node 服务层

| 文件 | 改动 |
|------|------|
| `packages/node/src/services/relay-service.ts` | **新建** — 统计、per-peer 限流/ban、黑白名单、健康诊断、period proof 生成、co-sign 收集、drain |
| `packages/node/src/services/relay-reward-service.ts` | **新建** — 链上 claim 闭环（claimReward / getStatus / preview） |
| `packages/node/src/services/contract-provider.ts` | `relayReward` 可选 accessor |
| `packages/node/src/services/chain-config.ts` | `relayReward` 地址字段 |
| `packages/node/src/api/routes/relay.ts` | **新建** — 14 个 REST 端点 |
| `packages/node/src/api/types.ts` | RuntimeContext 增加 relayService / relayRewardService / relayScorer / signProof |
| `packages/node/src/api/server.ts` | 挂载 `/api/v1/relay` 路由 |
| `packages/node/src/index.ts` | RelayService / RelayRewardService / RelayScorer 生命周期管理 |
| `packages/node/src/daemon.ts` | relay 配置解析、signProof 注入 |
| `packages/node/src/indexer/store.ts` | `relay_rewards` 表 |
| `packages/node/src/indexer/indexer.ts` | `RewardClaimed` 事件物化 |
| `packages/node/src/indexer/query.ts` | `getRelayRewards()` 查询 |

### SDK

| 文件 | 改动 |
|------|------|
| `packages/sdk/src/relay.ts` | **新建** — `RelayApi` 类 + 15+ 类型 |
| `packages/sdk/src/index.ts` | 导出 RelayApi 及类型 |

### 合约

| 文件 | 改动 |
|------|------|
| `packages/contracts/contracts/ClawRelayReward.sol` | **新建** — UUPS 可升级合约，341 行 |
| `packages/contracts/scripts/deploy-all.ts` | 第 10 个合约部署 + MINTER_ROLE |
| `packages/contracts/scripts/deploy-relay-reward.ts` | **新建** — 独立部署脚本 |
| `packages/contracts/scripts/bootstrap-mint.ts` | 奖励池 Token mint |

### 集成测试

| 文件 | 改动 |
|------|------|
| `docker-compose.relay-test.yml` | **新建** — Besu + 3 节点测试环境 |
| `scripts/scenario-relay-reward.mjs` | **新建** — 8 场景 e2e 测试 |
| `scripts/setup-relay-test.sh` | **新建** — 一键部署 + 配置生成 |

---

## 十二、需求文档验收标准对照

| 验收标准 | 对应功能 | 状态 |
|----------|---------|------|
| ① clawnetd 新增 `relay.enabled` 配置项，非 bootstrap 节点也可以启用 relay server | F1 | ✅ |
| ② `GET /api/v1/relay/stats` 返回 relay 流量统计数据 | F3 | ✅ |
| ③ NAT 后节点可以通过非 bootstrap 的 relay 节点完成通信 | F1 + F2 | ✅ |
| ④ SDK 新增 `relay.getStats()` 方法 | F3 SDK | ✅ |
| ⑤ `relay.getPeriodProof()` 返回签名的周期贡献证明 | F4 | ✅ |

---

## 十三、TelagentNode 侧对接指南

### 1. 启用 relay 节点

TelagentNode 运行的 clawnetd 只需添加环境变量即可成为 relay 节点：

```bash
# 在 clawnetd 启动环境中增加
CLAWNET_RELAY_ENABLED=true
CLAWNET_RELAY_MAX_CIRCUITS=128
```

通过 `GET /api/v1/relay/health` 验证：`natStatus` 应为 `public`，`isReachable` 应为 `true`。

### 2. DID-based Remote Access 集成

需求文档 §6 提到的 **DID-based Remote Access** 场景：

```
用户输入 DID → 网关节点
    │
    ├── relay.discover()         → 获取可用 relay 节点列表
    ├── relay.getScores()        → 选择最优 relay
    └── P2P 连接（via best relay）→ 目标节点
```

现在有多个 relay 节点可选，不再依赖单一 bootstrap 节点。

### 3. 奖励 Claim（如果 TelagentNode 侧有自己的 RelayRewardPool 合约）

ClawNet 已提供了完整的 `ClawRelayReward` 合约。如果 TelagentNode 团队希望使用自己的合约：

```typescript
// 获取 proof 数据
const proof = await client.relay.generatePeriodProof(relayDid);

// proof 中包含:
// - relayDid, periodId, bytesRelayed, attachmentBytesRelayed
// - circuitsServed, uniquePeersServed
// - peerConfirmations (co-sign 列表)
// - relaySignature

// 提交到 TelagentNode 自己的合约
await telagentContract.claimReward(
  keccak256(proof.relayDid),
  proof.periodId,
  proof.bytesRelayed,
  proof.attachmentBytesRelayed,
  proof.circuitsServed,
  computedRewardAmount,
  proof.peerConfirmations.map(c => ({
    peerDidHash: keccak256(c.peerDid),
    bytesConfirmed: c.bytesConfirmed,
    circuitsConfirmed: c.circuitsConfirmed,
    signature: c.signature,
  })),
  proof.relaySignature
);
```

### 4. SDK 升级

```bash
pnpm add @claw-network/sdk@0.6.0
```

升级后 `client.relay` 命名空间下的所有方法立即可用。

---

## 十四、已知限制 & 后续计划

| 限制 | 说明 | 计划 |
|------|------|------|
| Ed25519 签名链上验证 | 当前合约存储签名供审计，不做链上验证（EVM 无原生 Ed25519） | 待 precompile 支持后升级 |
| relay 统计不跨重启持久化 | RelayService 重启后计数器归零 | 后续可增加 SQLite 持久化 |
| 访问控制使用 peerId | 暂未解析为 DID（DID→PeerId 映射在 relay 请求时可能不可用） | 待 DID 解析链路完善后升级 |
| 自动 claim 无重试 | 链上 claim 失败不自动重试 | 后续可增加指数退避重试 |

---

如有疑问或需要调整接口设计，请随时沟通。
