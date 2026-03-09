# Relay 激励功能验证计划

> **状态**: ✅ 全部实现  
> **日期**: 2026-03-09  
> **前置**: [relay-network-plan.md](relay-network-plan.md) Phase 3 实现完成  
> **关联**: [on-chain-plan.md](on-chain-plan.md), [economics.md](economics.md)

---

## 当前状态

所有 4 层验证已完成。代码已实现、单元测试通过、部署流水线集成、节点服务层打通、集成测试脚本就绪。

| 组件 | 状态 | 说明 |
|------|------|------|
| `computeRelayReward()` 奖励公式 | ✅ 已实现 + 测试 | `packages/core/src/p2p/relay-reward.ts` |
| `RelayService.generatePeriodProof()` | ✅ 已实现 + 测试 | 证明生成 + co-sign 收集 |
| API: period-proof / confirm-contribution | ✅ 已实现 + 测试 | `packages/node/src/api/routes/relay.ts` |
| SDK: getPeriodProof / confirmContribution | ✅ 已实现 | `packages/sdk/src/relay.ts` |
| `ClawRelayReward.sol` 合约 | ✅ 已实现 + 测试 | 16 个 Hardhat 测试全部通过 |
| `deploy-relay-reward.ts` 部署脚本 | ✅ 已实现 | 独立 UUPS 代理部署 |
| deploy-all.ts 集成 | ✅ 已接入 | 第 10 个合约，MINTER_ROLE 已授予 |
| ContractProvider 加载 | ✅ 已接入 | `relayReward` 可选 accessor |
| RelayRewardService | ✅ 已实现 | claim / status / preview 三个方法 |
| API: reward/status / claim / preview | ✅ 已实现 | 3 个新端点 |
| Indexer: RewardClaimed 事件 | ✅ 已实现 | `relay_rewards` 表 + materialize |
| bootstrap-mint 奖励池 | ✅ 已接入 | `RELAY_REWARD_POOL_AMOUNT` 配置 |
| Docker 集成测试 | ✅ 已实现 | `scenario-relay-reward.mjs` + compose |

### 修改文件清单

| 层级 | 文件 | 改动 |
|------|------|------|
| L2 | `packages/contracts/scripts/deploy-all.ts` | 第 10 个合约部署 + MINTER_ROLE |
| L2 | `packages/contracts/scripts/bootstrap-mint.ts` | 奖励池 Token mint |
| L2 | `infra/testnet/.env.example` | RELAY_REWARD_* 环境变量 |
| L2 | `infra/mainnet/.env.example` | RELAY_REWARD_* 环境变量 |
| L3 | `packages/node/src/services/chain-config.ts` | relayReward 可选字段 |
| L3 | `packages/node/src/services/contract-provider.ts` | relayReward accessor |
| L3 | `packages/node/src/services/relay-reward-service.ts` | 新文件：RelayRewardService |
| L3 | `packages/node/src/api/types.ts` | RuntimeContext 增加 relayRewardService |
| L3 | `packages/node/src/api/server.ts` | relayRewardService 注入 |
| L3 | `packages/node/src/api/routes/relay.ts` | 3 个 reward 端点 |
| L3 | `packages/node/src/indexer/store.ts` | relay_rewards 表 |
| L3 | `packages/node/src/indexer/indexer.ts` | materializeRelayReward() |
| L3 | `packages/node/src/indexer/query.ts` | getRelayRewards() |
| L3 | `packages/node/src/indexer/index.ts` | 导出更新 |
| L4 | `scripts/scenario-relay-reward.mjs` | 8 场景集成测试 |
| L4 | `scripts/setup-relay-test.sh` | 一键部署 + 配置生成 |
| L4 | `docker-compose.relay-test.yml` | Besu + 3 节点 + 链配置 |

---

## 验证层级

### 第 1 层：单元测试 ✅ 已完成 (Phase 1-3)

| 测试文件 | 覆盖内容 | 测试数 |
|----------|----------|--------|
| `core/test/relay-reward.test.ts` | 公式计算、阈值、上限、peer 因子、uptime bonus、确认率 | 9 |
| `node/test/relay-service.test.ts` | per-peer 流量跟踪、证明生成、co-sign 收集、period 轮转 | 11 |
| `node/test/relay-api.test.ts` | GET/POST period-proof、POST confirm-contribution | 5 |
| `contracts/test/ClawRelayReward.test.ts` | claimReward、period 去重、自 relay 防护、peer 去重、阈值、上限、DAO 参数、暂停 | 16 |

### 第 2 层：集成到部署流水线 ✅ 已完成

将 ClawRelayReward 合约纳入现有部署体系，使其可在 testnet/mainnet 上部署。

#### 2.1 deploy-all.ts 添加第 10 个合约

**文件**: `packages/contracts/scripts/deploy-all.ts`

```typescript
// 10. ClawRelayReward — 依赖 ClawToken
const RewardFactory = await ethers.getContractFactory('ClawRelayReward');
const rewardProxy = await upgrades.deployProxy(
  RewardFactory,
  [tokenAddress, baseRate, maxPerPeriod, minBytes, minPeers, attachmentWeightBps],
  { kind: 'uups', initializer: 'initialize' },
);
```

新环境变量（均有默认值）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RELAY_REWARD_BASE_RATE` | 100 | 基础奖励率（Token/周期） |
| `RELAY_REWARD_MAX_PER_PERIOD` | 1000 | 单节点单周期上限 |
| `RELAY_REWARD_MIN_BYTES` | 1000000 | 最低确认字节数（1 MB） |
| `RELAY_REWARD_MIN_PEERS` | 1 | 最低确认 peer 数 |
| `RELAY_REWARD_ATTACHMENT_WEIGHT_BPS` | 3000 | 附件流量权重（0.3x） |

#### 2.2 bootstrap-mint 初始化奖励池

**文件**: `packages/contracts/scripts/bootstrap-mint.ts`

部署后 mint 初始 Token 到 ClawRelayReward 合约地址，作为奖励池：

```typescript
// Mint to relay reward pool
const rewardPoolAmount = 100_000; // configurable via RELAY_REWARD_POOL_AMOUNT
await token.mint(rewardAddress, rewardPoolAmount);
```

#### 2.3 contracts.json 记录地址

部署完成后 `contracts.json` 自动写入：

```json
{
  "ClawRelayReward": {
    "proxy": "0x...",
    "impl": "0x..."
  }
}
```

#### 2.4 .env.example 更新

在 `infra/testnet/.env.example` 和 `infra/mainnet/.env.example` 添加：

```env
# ── Relay Reward (可选，有默认值) ────────────────────────────────
RELAY_REWARD_BASE_RATE=100
RELAY_REWARD_MAX_PER_PERIOD=1000
RELAY_REWARD_POOL_AMOUNT=100000
```

### 第 3 层：Node 服务层打通链上调用 ✅ 已完成

实现完整的**自动 claim 闭环**：relay 节点自动收集证明、调用合约、获取奖励。

#### 3.1 ContractProvider 注册 ABI

**文件**: `packages/node/src/services/contract-provider.ts`

```typescript
getRelayReward(): ClawRelayReward {
  return this.getContract('ClawRelayReward');
}
```

#### 3.2 daemon 启动注入 signProof

**文件**: 节点 daemon 启动逻辑

用节点 Ed25519 私钥实现 `signProof` 回调：

```typescript
const signProof = async (data: Uint8Array): Promise<string> => {
  return signBase58(nodePrivateKey, data);
};
// 注入到 RuntimeContext
```

#### 3.3 peer 端自动响应 co-sign

注册 `onRelayConfirm` handler：被 relay 的节点收到确认请求后，验证本地流量记录，签名确认：

```typescript
p2pNode.onRelayConfirm(async (request, fromPeer) => {
  const localTraffic = relayService.getLocalTrafficFrom(fromPeer);
  // 偏差 > 20% → 拒绝
  if (Math.abs(request.bytesRelayed - localTraffic) / localTraffic > 0.2) {
    return { accepted: false, ... };
  }
  const signature = await signBase58(nodePrivateKey, confirmPayload);
  return { peerDid: localDid, bytesConfirmed: localTraffic, ..., signature, accepted: true };
});
```

#### 3.4 自动 claim 服务

新建 `RelayRewardService` 或扩展 `RelayService`：

```
每个 period 结束后 (1 小时):
1. generatePeriodProof() → 收集 co-sign + 生成签名证明
2. computeRelayReward() → 计算奖励金额
3. 调用合约 claimReward() → 链上领取
4. 记录 claim 结果到日志 / 状态
```

#### 3.5 Indexer 监听 RewardClaimed 事件

**文件**: `packages/node/src/indexer/`

```typescript
// 监听 RewardClaimed(relayDidHash, periodId, rewardAmount, ...)
// 写入 SQLite relay_rewards 表
```

### 第 4 层：Docker 集成测试 ✅ 已完成

在 Docker testnet（3 节点）中做端到端验证。

#### 测试场景

```
┌─────────────────────────────────────────────────────────────┐
│  Docker Testnet (3 nodes + chain + contracts)                │
│                                                              │
│  1. 部署合约 (含 ClawRelayReward)                            │
│  2. mint 奖励池 Token 到合约                                 │
│  3. Node A 作为 relay — 公网                                 │
│  4. Node B、C 通过 Node A 转发消息                           │
│  5. 等待 1 个 period                                         │
│  6. Node A 自动收集 B、C 的 co-sign                          │
│  7. Node A 生成 proof → 调用合约 claimReward()               │
│                                                              │
│  验证:                                                       │
│  ✓ Node A 余额增加（Token transfer 成功）                    │
│  ✓ RewardClaimed 事件被 indexer 记录                         │
│  ✓ GET /api/v1/relay/period-proof 返回有效 proof              │
│  ✓ 重复 claim 同一 period 被合约拒绝                         │
│  ✓ 低于 minBytes 阈值不发奖励                                │
│  ✓ 自 relay（Node A relay 自己）被合约拒绝                   │
│  ✓ co-sign 偏差 > 20% 时 peer 拒绝签名                      │
│  ✓ 奖励金额不超过 maxRewardPerPeriod                         │
└─────────────────────────────────────────────────────────────┘
```

#### 测试脚本

独立脚本 `scripts/scenario-relay-reward.mjs`，8 个场景覆盖：

| 场景 | 内容 | 需要链 |
|------|------|--------|
| 1. Relay Service Layer | stats, health, access, peers, drain, discover, scores | ❌ |
| 2. Period Proof | 生成 proof, 获取 proof, confirm-contribution, 多节点 proof | ❌ |
| 3. Reward Status & Preview | 合约状态, 奖励预览, 池余额检查 | ✅ |
| 4. Reward Claim Flow | 提交 claim, 重复 claim 拒绝, 池余额变化 | ✅ |
| 5. Cross-Node Consistency | 多节点 relay 端点, 链上状态一致性 | 部分 |
| 6. Edge Cases | 缺失字段拒绝, 无链时错误码 | ❌ |
| 7. Indexer | lastClaimedPeriod, totalDistributed | ✅ |
| 8. Reward Params | 参数合理性验证 | ✅ |

**运行方式**:

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

## 实施顺序

```
第 1 层（单元测试）    ✅
第 2 层（部署流水线）  ✅ ──┐
                             ├──→  第 4 层（集成测试） ✅
第 3 层（Node 服务层）  ✅ ──┘
```

所有层级已完成。

---

## 风险与注意事项

| 风险 | 影响 | 缓解 |
|------|------|------|
| 奖励池 Token 耗尽 | relay 节点无法领取奖励 | 合约检查余额；DAO 定期充值；监控告警 |
| peer 离线无法 co-sign | 确认率低，奖励减少 | 降级策略：无 co-sign 部分不计奖励 |
| co-sign 协议增加网络开销 | 带宽增加 | 确认间隔 10 分钟，数据量 < 1KB/次 |
| 自动 claim gas 费用 | 节点需要 gas | 零 gas 链配置（Clique PoA） |
| Ed25519 签名链上验证 | EVM 无原生 Ed25519 | 当前链下验证 + 链上结构校验；未来可加预编译 |
