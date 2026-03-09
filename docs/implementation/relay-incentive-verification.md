# Relay 激励功能验证计划

> **状态**: 待实施  
> **日期**: 2026-03-09  
> **前置**: [relay-network-plan.md](relay-network-plan.md) Phase 3 实现完成  
> **关联**: [on-chain-plan.md](on-chain-plan.md), [economics.md](economics.md)

---

## 当前状态

Phase 3 已完成**链下证明生成 + 合约代码**，但尚未接入部署流水线和节点运行时：

| 组件 | 状态 | 说明 |
|------|------|------|
| `computeRelayReward()` 奖励公式 | ✅ 已实现 + 测试 | `packages/core/src/p2p/relay-reward.ts` |
| `RelayService.generatePeriodProof()` | ✅ 已实现 + 测试 | 证明生成 + co-sign 收集 |
| API: period-proof / confirm-contribution | ✅ 已实现 + 测试 | `packages/node/src/api/routes/relay.ts` |
| SDK: getPeriodProof / confirmContribution | ✅ 已实现 | `packages/sdk/src/relay.ts` |
| `ClawRelayReward.sol` 合约 | ✅ 已实现 + 测试 | 16 个 Hardhat 测试全部通过 |
| `deploy-relay-reward.ts` 部署脚本 | ✅ 已实现 | 独立 UUPS 代理部署 |
| deploy-all.ts 集成 | ❌ 未接入 | 合约未纳入统一部署流水线 |
| ContractProvider 加载 | ❌ 未接入 | 节点不加载 ClawRelayReward |
| 自动 claim 逻辑 | ❌ 未实现 | 无 RelayRewardService |
| 集成测试 | ❌ 未实现 | 无端到端验证 |

---

## 验证层级

### 第 1 层：单元测试 ✅ 已完成

| 测试文件 | 覆盖内容 | 测试数 |
|----------|----------|--------|
| `core/test/relay-reward.test.ts` | 公式计算、阈值、上限、peer 因子、uptime bonus、确认率 | 9 |
| `node/test/relay-service.test.ts` | per-peer 流量跟踪、证明生成、co-sign 收集、period 轮转 | 11 |
| `node/test/relay-api.test.ts` | GET/POST period-proof、POST confirm-contribution | 5 |
| `contracts/test/ClawRelayReward.test.ts` | claimReward、period 去重、自 relay 防护、peer 去重、阈值、上限、DAO 参数、暂停 | 16 |

### 第 2 层：集成到部署流水线

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

### 第 3 层：Node 服务层打通链上调用

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

### 第 4 层：Docker 集成测试

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

在 `scripts/integration-test.mjs` 中新增 relay-incentive scenario，或创建独立脚本 `scripts/scenario-relay-reward.mjs`：

```javascript
// 1. 部署合约 + mint 奖励池
// 2. Node B 通过 Node A relay 发送消息给 Node C
// 3. 等待 period 结束
// 4. 调用 POST /api/v1/relay/period-proof 生成 proof
// 5. 验证 proof.peerConfirmations.length >= 1
// 6. 验证链上 claimReward 交易成功
// 7. 验证 Node A 余额变化
// 8. 验证重复 claim 失败
```

---

## 实施顺序

```
第 2 层（部署流水线）  ──┐
                          ├──→  第 4 层（集成测试）
第 3 层（Node 服务层）  ──┘
```

第 2 层和第 3 层可并行开发：

- **第 2 层**：纯合约部署脚本改动，不依赖 node 代码
- **第 3 层**：需要 ContractProvider + daemon + handler 改动

两者合并后即可进行第 4 层集成测试。

---

## 风险与注意事项

| 风险 | 影响 | 缓解 |
|------|------|------|
| 奖励池 Token 耗尽 | relay 节点无法领取奖励 | 合约检查余额；DAO 定期充值；监控告警 |
| peer 离线无法 co-sign | 确认率低，奖励减少 | 降级策略：无 co-sign 部分不计奖励 |
| co-sign 协议增加网络开销 | 带宽增加 | 确认间隔 10 分钟，数据量 < 1KB/次 |
| 自动 claim gas 费用 | 节点需要 gas | 零 gas 链配置（Clique PoA） |
| Ed25519 签名链上验证 | EVM 无原生 Ed25519 | 当前链下验证 + 链上结构校验；未来可加预编译 |
