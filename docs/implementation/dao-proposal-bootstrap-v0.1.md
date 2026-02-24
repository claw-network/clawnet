# DAO Proposal Draft: Bootstrapping Parameters v0.1

# DAO 提案草案：冷启动参数 v0.1

## Purpose / 目的

- EN: This draft maps `value-anchor-monetary-policy-v0.1.md` into a directly votable DAO proposal bundle.
- 中文: 本草案将 `value-anchor-monetary-policy-v0.1.md` 映射为可直接投票的 DAO 提案组合。

## Proposal Bundle Overview / 提案组合概览

Because on-chain and off-chain parameters are mixed, use a 3-proposal bundle:
由于参数同时包含链上与链下部分，采用 3 个提案的组合执行。

1. `CNIP-001` ParameterChange (Executable) / 参数调整（可执行）
2. `CNIP-002` TreasurySpend (Executable) / 国库拨款（可执行）
3. `CNIP-003` Signal (Non-executable policy adoption) / 策略确认（信号提案）

---

## CNIP-001 (Executable) / 可执行参数提案

### Metadata / 元数据

- `type`: `parameter_change`
- `title`: `Adopt ClawNet v0.1 monetary baseline parameters`
- `target`: `ParamRegistry`
- `function`: `setBatchParams(bytes32[] keys, uint256[] values)`

### Parameters to Set / 待设置参数

| Param Key               |    Value | Notes            |
| ----------------------- | -------: | ---------------- |
| `MIN_TRANSFER_AMOUNT`   |      `1` | anti-dust / 防尘 |
| `MIN_ESCROW_AMOUNT`     |      `1` | anti-dust / 防尘 |
| `ESCROW_BASE_RATE`      |    `100` | bps              |
| `ESCROW_HOLDING_RATE`   |      `5` | bps/day          |
| `ESCROW_MIN_FEE`        |      `1` | Token            |
| `VALIDATOR_REWARD_RATE` |      `1` | Token/epoch      |
| `SLASH_PER_VIOLATION`   |      `1` | Token            |
| `PROPOSAL_THRESHOLD`    |    `100` | Token            |
| `VOTING_PERIOD`         | `259200` | seconds          |
| `TIMELOCK_DELAY`        |  `86400` | seconds          |
| `QUORUM_BPS`            |    `400` | 4%               |

### Rationale / 动机

- EN: Align core governance and fee controls with conservative v0.1 defaults.
- 中文: 将核心治理与费率参数对齐到 v0.1 保守默认值。

### Calldata Encoding (Ethers) / Calldata 编码（Ethers）

```ts
import { ethers } from 'ethers';

const iface = new ethers.Interface(['function setBatchParams(bytes32[] keys, uint256[] values)']);

const K = (s: string) => ethers.keccak256(ethers.toUtf8Bytes(s));

const keys = [
  K('MIN_TRANSFER_AMOUNT'),
  K('MIN_ESCROW_AMOUNT'),
  K('ESCROW_BASE_RATE'),
  K('ESCROW_HOLDING_RATE'),
  K('ESCROW_MIN_FEE'),
  K('VALIDATOR_REWARD_RATE'),
  K('SLASH_PER_VIOLATION'),
  K('PROPOSAL_THRESHOLD'),
  K('VOTING_PERIOD'),
  K('TIMELOCK_DELAY'),
  K('QUORUM_BPS'),
];

const values = [1, 1, 100, 5, 1, 1, 1, 100, 259200, 86400, 400];

const callData = iface.encodeFunctionData('setBatchParams', [keys, values]);
console.log(callData);
```

### Propose Payload (Node/SDK style) / 提案请求体（Node/SDK 风格）

```json
{
  "type": "parameter_change",
  "description": "CNIP-001: Adopt v0.1 monetary baseline params",
  "target": "<PARAM_REGISTRY_ADDRESS>",
  "callData": "<ENCODED_SET_BATCH_PARAMS_CALLDATA>"
}
```

---

## CNIP-002 (Executable) / 可执行国库拨款提案

### Metadata / 元数据

- `type`: `treasury_spend`
- `title`: `Seed faucet and bootstrap liquidity wallet`
- `target`: `ClawToken`
- `function`: `transfer(address to, uint256 amount)` (called by DAO treasury holder)

### Suggested Transfer Plan / 建议拨款方案

| Destination                     | Amount (Token) | Purpose                                 |
| ------------------------------- | -------------: | --------------------------------------- |
| `<FAUCET_VAULT_ADDRESS>`        |       `500000` | faucet budget / 启动金预算              |
| `<BOOTSTRAP_LIQUIDITY_ADDRESS>` |       `300000` | market bootstrap liquidity / 流动性启动 |
| `<RISK_RESERVE_ADDRESS>`        |       `200000` | incident reserve / 风险储备             |

Note / 说明:

- EN: If DAO can execute only one call per proposal, submit one proposal per destination (CNIP-002A/B/C).
- 中文: 若 DAO 每提案仅支持一次调用，请拆分为三笔提案（CNIP-002A/B/C）。

### Propose Payload Example / 请求体示例

```json
{
  "type": "treasury_spend",
  "description": "CNIP-002A: Transfer faucet budget",
  "target": "<TOKEN_ADDRESS>",
  "callData": "<ENCODED_TOKEN_TRANSFER_CALLDATA>"
}
```

Encoding helper / 编码示例:

```ts
const tokenIface = new ethers.Interface(['function transfer(address to, uint256 amount)']);
const callData = tokenIface.encodeFunctionData('transfer', ['<FAUCET_VAULT_ADDRESS>', 500000]);
```

---

## CNIP-003 (Signal) / 信号提案（链下策略确认）

### Metadata / 元数据

- `type`: `signal`
- `title`: `Adopt faucet and anti-sybil operating policy v0.1`
- `target`: `0x0000000000000000000000000000000000000000`
- `callData`: `0x`

### Policy Commitments / 策略承诺

Adopt these off-chain policy parameters as governance commitments:
将下列链下策略参数作为治理承诺执行：

| Key                                   | Value                        |
| ------------------------------------- | ---------------------------- |
| `FAUCET_AMOUNT_PER_CLAIM`             | `50` Token                   |
| `FAUCET_COOLDOWN_HOURS`               | `24`                         |
| `FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH` | `4`                          |
| `FAUCET_MAX_CLAIMS_PER_IP_PER_DAY`    | `3`                          |
| `FAUCET_MONTHLY_BUDGET_CAP`           | `2% treasury liquid balance` |
| `FAUCET_SYBIL_SCORE_MIN`              | `0.60`                       |
| `FIRST_JOB_BONUS_AMOUNT`              | `30` Token                   |
| `FIRST_JOB_MIN_SETTLEMENT`            | `20` Token                   |
| `BOOTSTRAP_MAX_MONTHLY_MINT_RATIO`    | `<=1.0% circulating supply`  |

### Accountability / 责任追踪

- EN: Require monthly publication of the metrics listed in `value-anchor-monetary-policy-v0.1.md` section 13.7.
- 中文: 要求每月披露 `value-anchor-monetary-policy-v0.1.md` 第 13.7 节指标。

---

## Voting and Execution Checklist / 投票与执行检查清单

Before proposal submission / 提案前:

1. Confirm addresses for `ParamRegistry`, `ClawToken`, faucet/liquidity/reserve wallets.
2. Recompute callData and verify function selectors.
3. Simulate execution on testnet fork.

After passing / 通过后:

1. Queue and execute `CNIP-001`.
2. Queue and execute `CNIP-002` (or A/B/C split).
3. Record and publish `CNIP-003` governance commitment in ops docs.

Rollback guard / 回滚护栏:

- EN: If treasury net flow remains negative for 2 consecutive cycles, submit emergency parameter proposal reducing reward budget ratio by 20% relative.
- 中文: 若国库净流入连续 2 个周期为负，发起紧急参数提案，将奖励预算比例相对下调 20%。

---

## Draft Description Template / 提案描述模板

Use this text body in governance UI or API descriptions:
可将以下正文用于治理 UI 或 API 的 description 字段。

```md
## CNIP Bundle: Bootstrapping Parameters v0.1

### Why

To resolve the cold-start paradox and align incentives with verifiable agent productivity.

### What Changes

1. Set v0.1 on-chain baseline parameters in ParamRegistry.
2. Allocate bootstrap treasury budgets for faucet/liquidity/reserve.
3. Adopt off-chain faucet and anti-sybil operating policy by governance signal.

### Risk Controls

- Monthly reward budget cap tied to treasury net inflow.
- Faucet anti-sybil thresholds and DID/IP rate limits.
- KPI-triggered tightening if dispute or treasury metrics deteriorate.

### Success Metrics

- Higher service-paid volume coverage.
- Lower faucet dependency ratio.
- Stable or improving treasury net flow.
```

---

## Testnet Filled Version (chainId 7625) / 已填充测试网版本（chainId 7625）

Source of truth / 地址来源:

- `packages/contracts/deployments/clawnetTestnet.json`

Resolved contract addresses / 已解析合约地址:

- `PARAM_REGISTRY_ADDRESS`: `0x31cCc8480Ab7BCBd576a2B2b7203a58ee8494b16`
- `TOKEN_ADDRESS`: `0xA98Cc076321aF8cC66A579b91643B5B98E316AA4`
- `DAO_ADDRESS`: `0xe3C7a659591EaA8E724505E00Bccbb743CB9948b`
- `TREASURY_ADDRESS` (escrow/protocol fee receiver): `0x838C5c42918CEbb88a7B9E867c4646F225AA3ba0`

Resolved operational addresses from `localdev` / 来自 `localdev` 的运营地址:

- `DEPLOYER_ADDRESS`: `0x22D8C1C06610137091EfeCB948aEE263EeeE0590`
- `FAUCET_VAULT` (temporary): `0x22D8C1C06610137091EfeCB948aEE263EeeE0590`
- `BOOTSTRAP_LIQUIDITY` (temporary): `0x838C5c42918CEbb88a7B9E867c4646F225AA3ba0`
- `RISK_RESERVE` (temporary): `0x838C5c42918CEbb88a7B9E867c4646F225AA3ba0`

Note / 说明:

- EN: Current testnet config does not define dedicated faucet/liquidity/reserve wallets. The addresses above are temporary mappings derived from genesis/deployment records and should be replaced by dedicated multisigs in the next governance cycle.
- 中文: 当前 testnet 配置未定义专用 faucet/liquidity/reserve 钱包。以上为根据创世与部署记录得到的临时映射，建议在下一治理周期替换为专用多签地址。

### CNIP-001 Testnet Payload / CNIP-001 测试网请求体

```json
{
  "type": "parameter_change",
  "description": "CNIP-001: Adopt v0.1 monetary baseline params (chainId=7625)",
  "target": "0x31cCc8480Ab7BCBd576a2B2b7203a58ee8494b16",
  "callData": "<ENCODED_setBatchParams_CALLDATA>",
  "notes": {
    "keys": [
      "MIN_TRANSFER_AMOUNT",
      "MIN_ESCROW_AMOUNT",
      "ESCROW_BASE_RATE",
      "ESCROW_HOLDING_RATE",
      "ESCROW_MIN_FEE",
      "VALIDATOR_REWARD_RATE",
      "SLASH_PER_VIOLATION",
      "PROPOSAL_THRESHOLD",
      "VOTING_PERIOD",
      "TIMELOCK_DELAY",
      "QUORUM_BPS"
    ],
    "values": [1, 1, 100, 5, 1, 1, 1, 100, 259200, 86400, 400]
  }
}
```

### CNIP-002 Testnet Payloads (Split A/B/C) / CNIP-002 测试网请求体（拆分 A/B/C）

CNIP-002A (faucet vault) / 发放 faucet 预算:

```json
{
  "type": "treasury_spend",
  "description": "CNIP-002A: Seed faucet budget (chainId=7625)",
  "target": "0xA98Cc076321aF8cC66A579b91643B5B98E316AA4",
  "callData": "<ENCODED_transfer(0x22D8C1C06610137091EfeCB948aEE263EeeE0590,500000)>"
}
```

CNIP-002B (bootstrap liquidity) / 发放流动性预算:

```json
{
  "type": "treasury_spend",
  "description": "CNIP-002B: Seed bootstrap liquidity budget (chainId=7625)",
  "target": "0xA98Cc076321aF8cC66A579b91643B5B98E316AA4",
  "callData": "<ENCODED_transfer(0x838C5c42918CEbb88a7B9E867c4646F225AA3ba0,300000)>"
}
```

CNIP-002C (risk reserve) / 发放风险储备预算:

```json
{
  "type": "treasury_spend",
  "description": "CNIP-002C: Seed risk reserve budget (chainId=7625)",
  "target": "0xA98Cc076321aF8cC66A579b91643B5B98E316AA4",
  "callData": "<ENCODED_transfer(0x838C5c42918CEbb88a7B9E867c4646F225AA3ba0,200000)>"
}
```

### CNIP-003 Testnet Payload / CNIP-003 测试网请求体

```json
{
  "type": "signal",
  "description": "CNIP-003: Adopt faucet and anti-sybil operating policy v0.1 (chainId=7625)",
  "target": "0x0000000000000000000000000000000000000000",
  "callData": "0x"
}
```

### Final Pre-Vote Checklist / 投票前最终检查

1. Confirm DAO treasury token balance can cover CNIP-002A/B/C total amount (`1,000,000` Token).
2. Confirm temporary vault mapping (`FAUCET_VAULT=0x22D8...`, `BOOTSTRAP_LIQUIDITY=0x838C...`, `RISK_RESERVE=0x838C...`) or replace with dedicated multisigs.
3. Re-encode calldata with exact addresses and verify on testnet fork.
4. Publish risk disclosure including pause conditions from `value-anchor-monetary-policy-v0.1.md` section 13.5.
