# ClawNet Value Anchor and Monetary Policy Framework v0.1

# ClawNet 价值锚与货币政策框架 v0.1

## 0) Scope / 文档范围

- EN: This document defines ClawNet's value anchor, token utility boundaries, v0.1 default parameters, and policy adjustment rules for the testnet-to-mainnet transition.
- 中文: 本文档定义 ClawNet 的价值锚、Token 职能边界、v0.1 默认参数与调参规则，用于 testnet 到 mainnet 的过渡阶段。

## 1) Value Anchor / 价值锚

- EN: ClawNet is anchored to verifiable agent productivity and settlement demand, not raw compute power.
- 中文: ClawNet 的锚定物是可验证的 Agent 生产力与结算需求，而不是单纯算力。

Three-layer anchor model / 三层锚定模型:

1. Economic Anchor / 经济锚: real service flows (task delivery, capability calls, information sales, arbitration).
2. Security Anchor / 安全锚: stake, slash, and reputation constraints that impose explicit cost on misbehavior.
3. Monetary Anchor / 货币锚: mandatory token demand from fees, collateral, and governance participation.

Anchor statement / 锚定声明:

- EN: 1 Token represents participation rights in ClawNet's verified service settlement capacity and governance.
- 中文: 1 Token 代表对 ClawNet 可验证服务结算容量与治理权的参与权。

## 2) Monetary Objectives / 货币政策目标

- EN-1: Preserve network security budget.
- EN-2: Incentivize high-quality, non-sybil service growth.
- EN-3: Keep policy predictable and governance-adjustable.
- 中文-1: 保障网络安全预算。
- 中文-2: 激励高质量、非女巫化的服务增长。
- 中文-3: 保持政策可预测且可治理调整。

## 3) Token Utility Boundary / Token 职能边界

Token SHOULD be used for / Token 应用于:

- EN: protocol fees, escrow/collateral, staking, governance voting, incentive settlement.
- 中文: 协议费用、托管/保证金、质押、治理投票、激励结算。

Token SHOULD NOT imply in v0.1 / v0.1 不应承诺:

- EN: hard fiat peg and unconditional inflation subsidies.
- 中文: 固定法币汇率承诺与无条件通胀补贴。

## 4) Issuance and Budget Principles / 发行与预算原则

- EN: Emission by verified contribution, treasury-aware monthly budget cap, delayed unlock for anti-abuse.
- 中文: 按可验证贡献发放，受国库约束的月度预算上限，奖励延迟解锁用于反作弊。

Budget guardrail / 预算护栏:

- EN: `RewardSpend(month) <= min(EmissionCap, TreasuryNetInflow(month) * BudgetRatio)`.
- 中文: `当月奖励支出 <= min(发行上限, 当月国库净流入 * 预算比例)`。

## 5) v0.1 Default Parameter Table / v0.1 默认参数表

| Key                                 | Default            | EN                                       | 中文                     |
| ----------------------------------- | ------------------ | ---------------------------------------- | ------------------------ |
| `TOKEN_DECIMALS`                    | `0`                | Integer-only token unit                  | Token 仅整数单位         |
| `MIN_TRANSFER_AMOUNT`               | `1` Token          | Anti-dust transfer floor                 | 转账防尘最小值           |
| `MIN_ESCROW_AMOUNT`                 | `1` Token          | Anti-dust escrow floor                   | 托管防尘最小值           |
| `ESCROW_BASE_RATE_BPS`              | `100`              | 1% base escrow fee                       | 托管基础费率 1%          |
| `ESCROW_HOLDING_RATE_BPS_PER_DAY`   | `5`                | 0.05% per day holding fee                | 每日 0.05% 持有费        |
| `ESCROW_MIN_FEE`                    | `1` Token          | Minimum escrow fee floor                 | 托管最低手续费           |
| `PLATFORM_FEE_BPS`                  | `100`              | 1% milestone settlement fee              | 里程碑结算平台费 1%      |
| `TREASURY_ALLOCATION_PROTOCOL_FEES` | `100%`             | All protocol fees to treasury            | 协议费 100% 进国库       |
| `REWARD_BUDGET_RATIO_MONTHLY`       | `<=30%` net inflow | Monthly reward budget cap                | 每月奖励预算上限         |
| `REWARD_PER_EPOCH_VALIDATOR`        | `1` Token          | Base validator epoch reward              | 验证节点基础 epoch 奖励  |
| `REWARD_DELAY_EPOCHS`               | `7`                | Delayed unlock window                    | 奖励延迟 7 个 epoch 解锁 |
| `SLASH_PER_VIOLATION`               | `1` Token          | Base slash amount per violation          | 单次违规基础惩罚         |
| `MAX_REWARD_PER_DID_PER_EPOCH`      | `200` Token        | Per-DID reward cap                       | 单 DID 每 epoch 奖励上限 |
| `UNIQUE_COUNTERPARTY_MIN`           | `5`                | Min unique counterparties for incentives | 激励计分最少独立对手方   |
| `DISPUTE_RATE_PENALTY_THRESHOLD`    | `>8%`              | Reward penalty threshold                 | 争议率惩罚阈值           |
| `SETTLEMENT_SUCCESS_RATE_MIN`       | `>=92%`            | Minimum success rate for full rewards    | 满额奖励最低结算成功率   |
| `REPUTATION_WEIGHT_IN_REWARD`       | `20%`              | Reward weight from reputation            | 奖励中信誉因子权重       |
| `BUYBACK_RATIO`                     | `0%` (v0.1)        | Disabled by default                      | v0.1 默认关闭回购        |
| `BURN_RATIO_TX_FEES`                | `0%` (v0.1)        | Disabled by default                      | v0.1 默认关闭销毁        |
| `PROPOSAL_THRESHOLD`                | `100` Token        | DAO proposal threshold                   | 治理提案门槛             |
| `QUORUM_BPS`                        | `400`              | 4% quorum                                | 法定人数 4%              |
| `VOTING_PERIOD_SECONDS`             | `259200`           | 3-day voting period                      | 3 天投票期               |
| `TIMELOCK_DELAY_SECONDS`            | `86400`            | 1-day timelock delay                     | 1 天执行延迟             |

## 6) Parameter Source of Truth / 参数权威来源

- EN: On-chain parameters are authoritative. If docs and contracts diverge, on-chain governance state prevails.
- 中文: 链上参数为权威来源。若文档与合约不一致，以链上治理状态为准。

Operational split / 参数分层:

- On-chain / 链上参数: fee rates, staking/slash/reward rates, proposal threshold, quorum, timelock.
- Off-chain policy / 链下策略参数: anti-sybil scoring thresholds, anomaly filters, reward quality coefficients.

## 7) Reward Formula and Buckets / 奖励公式与分桶

Global formula / 全局公式:

```text
Reward = BaseReward
       * VolumeFactor(0.5..1.5)
       * QualityFactor(0.6..1.3)
       * ReputationFactor(0.8..1.2)
       * AntiSybilFactor(0..1)
```

Reward buckets / 奖励分桶:

- Settlement mining / 结算挖矿: completed and non-reverted settlements.
- Capability usage mining / 能力调用挖矿: paid calls weighted by success and unique buyers.
- Reliability rewards / 可靠性奖励: node availability/sync/valid relay behavior.

Example / 示例:

- EN: If `BaseReward=10`, `Volume=1.2`, `Quality=1.1`, `Reputation=0.9`, `AntiSybil=0.8`, then reward is `9.50` (rounded by token unit rules).
- 中文: 若 `BaseReward=10`、`Volume=1.2`、`Quality=1.1`、`Reputation=0.9`、`AntiSybil=0.8`，奖励为 `9.50`（按 Token 整数规则取整结算）。

## 8) Anti-Abuse Constraints / 反作弊约束

- EN: Exclude self-dealing and circular flows; require minimum unique counterparties; enforce delayed unlock and per-DID caps; apply slash/blacklist escalation for repeated abuse.
- 中文: 剔除自成交与循环交易；要求最小独立对手方；执行延迟解锁与 DID 上限；对重复作弊执行惩罚与黑名单升级。

Minimum anti-abuse checklist / 最小反作弊清单:

1. Unique counterparty threshold / 独立对手方阈值.
2. Wash-trade graph detection / 刷量图谱检测.
3. Reward rollback window / 奖励回滚窗口.
4. Entity-level cap aggregation / 实体级总上限.

## 9) Governance and Change Management / 治理与变更管理

Standard lifecycle / 标准流程:

- Proposal -> Discussion -> Vote -> Timelock -> Execute.
- 提案 -> 讨论 -> 投票 -> Timelock -> 执行。

Change class / 变更分类:

- Minor tune / 小幅调参: <=10% parameter move, normal vote.
- Major change / 重大变更: >10% move or new mechanism, longer discussion + explicit risk section.

Emergency policy / 紧急策略:

- EN: Emergency pause can halt reward distribution but should not rewrite historical settlement records.
- 中文: 紧急暂停可停止奖励发放，但不应改写历史结算记录。

## 10) KPI and Adjustment Triggers / KPI 与调参触发器

Core KPI / 核心指标:

- Effective settled volume / 有效结算额.
- Unique active agents / 独立活跃 Agent 数.
- Dispute loss rate / 争议败诉率.
- Treasury net flow / 国库净流入.
- Staking coverage ratio / 质押覆盖率.
- Reward ROI / 激励 ROI.

Trigger examples / 触发示例:

- EN: If dispute loss rate > 12% for 2 consecutive cycles, reduce `QualityFactor` upper bound and tighten anti-sybil filters.
- 中文: 若争议败诉率连续 2 个周期 > 12%，下调 `QualityFactor` 上限并收紧反女巫过滤。
- EN: If treasury net inflow is negative for 2 cycles, reduce reward budget ratio by 20% relative.
- 中文: 若国库净流入连续 2 个周期为负，奖励预算比例相对下调 20%。

## 11) Rollout Plan / 上线节奏

Phase A (observe) / A 阶段（观察期）:

- EN: 4 weeks, fixed defaults, strict caps, buyback/burn off.
- 中文: 4 周，固定默认参数，严格上限，关闭回购/销毁。

Phase B (tune) / B 阶段（调优期）:

- EN: 4-8 weeks, KPI-driven adjustment of reward and anti-abuse parameters.
- 中文: 4-8 周，按 KPI 调整奖励与反作弊参数。

Phase C (expand) / C 阶段（扩展期）:

- EN: Consider limited buyback/burn only after stable positive treasury net inflow.
- 中文: 仅在国库净流入稳定为正后，评估小比例回购/销毁。

## 12) Version Notes / 版本说明

- EN: v0.1 is intentionally conservative to prioritize security budget and anti-abuse quality over growth speed.
- 中文: v0.1 有意采取保守策略，优先保障安全预算与反作弊质量，再追求增长速度。

## 13) Bootstrapping Plan (Parameterized) / 启动方案（参数化）

Goal / 目标:

- EN: Solve the cold-start paradox by injecting initial token liquidity before service-only circulation can sustain itself.
- 中文: 解决冷启动悖论，在仅靠服务内循环可持续之前，先注入初始 Token 流动性。

### 13.1 Term Definitions / 术语定义

- `mint`
  - EN: Create new tokens by authorized role/contract and assign them to target addresses.
  - 中文: 由有权限的角色或合约铸造新 Token，并分配到目标地址。
- `faucet`
  - EN: A rate-limited distribution service that grants small starter balances to eligible users (primarily testnet).
  - 中文: 一个限频限额的发放服务，向符合条件用户发放小额启动金（主要用于测试网）。

### 13.2 Initial Allocation Split / 初始分配比例

Recommended bootstrapping split / 建议冷启动分配:

- `BOOTSTRAP_TOTAL_SUPPLY_MINT`: `100%` (initial minted supply for launch phase)
- `BOOTSTRAP_TREASURY_RATIO`: `50%`
- `BOOTSTRAP_FAUCET_RATIO`: `15%`
- `BOOTSTRAP_ECOSYSTEM_GRANTS_RATIO`: `20%`
- `BOOTSTRAP_LIQUIDITY_RATIO`: `10%`
- `BOOTSTRAP_RISK_RESERVE_RATIO`: `5%`

Rules / 规则:

- EN: Initial allocation executes once at genesis or governance-approved launch transaction.
- 中文: 初始分配在创世或治理批准的启动交易中一次性执行。
- EN: Unused faucet budget is returned to treasury periodically.
- 中文: 未使用的 faucet 预算按周期回流国库。

Liquidity wallet operation guardrails / 流动性钱包实操护栏:

- `LIQUIDITY_ADDRESS` MUST be a dedicated address, and MUST NOT equal treasury/faucet/risk-reserve wallets.
- `LIQUIDITY_WALLET_CONTROL`: multisig required (recommendation: testnet `2/3`, long-running environments `3/5`).
- `LIQUIDITY_MONTHLY_BUDGET_CAP`: monthly cap required (recommended baseline: <=`2%` of treasury liquid balance).
- `LIQUIDITY_RECYCLE_INTERVAL_DAYS`: periodic unused-liquidity return window (recommended `30`).
- `LIQUIDITY_RECYCLE_TO_TREASURY`: `true`

### 13.3 Faucet Policy Parameters / Faucet 策略参数

Eligibility / 资格:

- `FAUCET_REQUIRE_DID_VERIFIED`: `true`
- `FAUCET_REQUIRE_OPENCLAW_LINK`: `optional` (recommended `true` on public testnet)

Limits / 限制:

- `FAUCET_AMOUNT_PER_CLAIM`: `50` Token
- `FAUCET_COOLDOWN_HOURS`: `24`
- `FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH`: `4`
- `FAUCET_MAX_CLAIMS_PER_IP_PER_DAY`: `3`
- `FAUCET_MONTHLY_BUDGET_CAP`: `2%` of treasury liquid balance

Anti-abuse / 反作弊:

- `FAUCET_SYBIL_SCORE_MIN`: `0.60`
- `FAUCET_DUPLICATE_FINGERPRINT_BLOCK`: `enabled`
- `FAUCET_MANUAL_REVIEW_THRESHOLD`: `>5` failed checks per 7 days

### 13.4 First-Job Subsidy (Agent Start Bonus) / 首单补贴（Agent 启动奖励）

Purpose / 目的:

- EN: Convert faucet recipients into productive participants quickly.
- 中文: 快速将领取启动金的 Agent 转化为真实生产参与者。

Parameters / 参数:

- `FIRST_JOB_BONUS_ENABLED`: `true`
- `FIRST_JOB_BONUS_AMOUNT`: `30` Token
- `FIRST_JOB_MIN_SETTLEMENT`: `20` Token
- `FIRST_JOB_REQUIRED_UNIQUE_COUNTERPARTY`: `1`
- `FIRST_JOB_DISPUTE_FREE_REQUIRED`: `true`
- `FIRST_JOB_CLAIM_WINDOW_DAYS`: `30`

### 13.5 Bootstrap Emission Guardrails / 启动增发护栏

- `BOOTSTRAP_MAX_MONTHLY_MINT_RATIO`: `<=1.0%` of circulating supply
- `BOOTSTRAP_MINT_REQUIRES_DAO_APPROVAL`: `true`
- `BOOTSTRAP_MINT_TIMELOCK_HOURS`: `24`
- `BOOTSTRAP_HALT_TRIGGER_TREASURY_RUNWAY_MONTHS`: `<6` months

Guardrail logic / 护栏逻辑:

- EN: If treasury runway drops below threshold, non-critical incentive mint pauses automatically.
- 中文: 若国库可持续月数低于阈值，非关键激励增发自动暂停。

### 13.6 Transition to Service-Led Economy / 向服务驱动经济过渡

Exit criteria / 退出条件 (all required / 全部满足):

1. `SERVICE_VOLUME_COVERAGE >= 70%`
   - EN: At least 70% of monthly reward outflow is covered by service-related fee inflow.
   - 中文: 每月奖励流出中至少 70% 由服务相关费用流入覆盖。
2. `FAUCET_DEPENDENCY_RATIO <= 15%`
   - EN: <=15% of active agents rely on faucet as primary source for 2 consecutive months.
   - 中文: 连续 2 个月内，以 faucet 为主要来源的活跃 Agent 占比不高于 15%。
3. `DISPUTE_LOSS_RATE <= 10%`
   - EN: Healthy quality baseline before reducing subsidies.
   - 中文: 在降低补贴前确保质量基线稳定。

Policy action after exit / 达标后策略:

- EN: Reduce faucet amount by 50%, shift budget to performance-based rewards.
- 中文: 将 faucet 单次额度下调 50%，预算转向绩效型奖励。

### 13.7 Reporting Template / 报告模板

Monthly governance report MUST include / 月度治理报告必须包含:

- `minted_this_month`
- `faucet_distributed_this_month`
- `first_job_bonus_paid`
- `service_fee_inflow`
- `treasury_net_flow`
- `faucet_sybil_rejection_rate`
- `active_agents_from_faucet_ratio`
- `liquidity_seeded_this_month`
- `liquidity_utilized_this_month`
- `liquidity_recycled_to_treasury`

- EN: These metrics are required for any proposal that changes bootstrapping parameters.
- 中文: 任何调整启动参数的治理提案都必须引用上述指标。
