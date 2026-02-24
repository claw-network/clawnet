# ClawNet Token 发放机制通识

> 面向新成员的 Token 铸造、分配与流通完整说明。

---

## Token 从哪里来？

有且仅有两种方式产生新 Token：

1. **Mint（铸造）**：通过 `ClawToken.sol` 合约的 `mint(address to, uint256 amount)` 函数，凭空创建新 Token 到目标地址。只有持有 `MINTER_ROLE` 的地址才能调用。
2. **没有第二种方式。** ERC-20 的 `transfer` 只是搬运已有 Token，不会增加总量。

```
         mint()                transfer()              burn()
空气 ──────────► 某个地址 ──────────────► 另一个地址 ──────────► 销毁
 (凭空创建)                    (搬运)                  (永久消失)
```

---

## 谁有 MINTER_ROLE？

部署脚本 `packages/contracts/scripts/deploy-all.ts` 中授权了两个地址：

| 地址 | MINTER_ROLE | 用途 |
|------|-------------|------|
| Deployer（`0x22D8...`） | ✅ 初始化时授予 | 部署者，用于初始铸造 |
| ClawStaking（`0xbf3a...`） | ✅ 部署后授予 | 质押奖励自动 mint |

---

## Token 的关键属性

- **合约**：`ClawToken.sol`（ERC-20，UUPS 可升级）
- **精度**：`decimals = 0`（仅整数，1 Token = 1 unit）
- **代号**：`TOKEN`
- **Testnet 部署地址**：`0xA98Cc076321aF8cC66A579b91643B5B98E316AA4`

---

## 当前 testnet 的实际状态

**重要事实：部署脚本只在本地 Hardhat 链（chainId 31337）执行了初始 mint，testnet 部署后 `totalSupply = 0`。**

目前获取 Token 的途径：

| 方式 | 接口 | 说明 |
|------|------|------|
| Dev Faucet | `POST /api/dev/faucet` | 开发/测试阶段，节点钱包直接 transfer |
| Staking 奖励 | ClawStaking 合约自动 mint | 验证节点 epoch 奖励 |
| Deployer 手动 mint | 直接调用 `ClawToken.mint()` | Deployer 持有 MINTER_ROLE |

---

## 完整的 Token 发放流程（四个阶段）

### 阶段一：初始铸造（Genesis Mint）

由 Deployer 执行，将初始供应量 mint 到 DAO 国库。

```bash
# 在 packages/contracts 目录下
npx hardhat console --network clawnetTestnet
```

```javascript
const token = await ethers.getContractAt(
  "ClawToken",
  "0xA98Cc076321aF8cC66A579b91643B5B98E316AA4"
);
const daoAddress = "0xe3C7a659591EaA8E724505E00Bccbb743CB9948b";

// 铸造初始供应量到 DAO 国库
await token.mint(daoAddress, 10_000_000);
```

执行后：DAO 合约地址持有 10,000,000 Token（这就是"国库"）。

### 阶段二：DAO 提案拨款（Treasury Spend）

通过 DAO 治理提案，从国库向运营钱包分配资金（对应 CNIP-002 系列提案）。

```
1. 创建提案
   POST /api/v1/dao/proposals
   ├── type: "treasury_spend"
   ├── target: ClawToken 合约地址
   └── callData: 编码的 transfer(faucet地址, 500000)

2. 讨论期结束 → 自动进入投票

3. Token 持有者投票
   POST /api/v1/dao/proposals/:id/votes
   └── option: "for" / "against" / "abstain"

4. 投票期结束
   └── 法定人数(4%) + 赞成 > 反对 → Passed

5. Queue 进入 Timelock（1 天等待）
   POST /api/v1/dao/proposals/:id/actions/advance
   └── newStatus: "timelocked"

6. Execute 执行
   POST /api/v1/dao/proposals/:id/actions/advance
   └── newStatus: "executed"
   └── 链上：DAO 合约调用 ClawToken.transfer(faucet地址, 500000)
```

按冷启动方案（CNIP-002），拨款分三笔：

| 目标 | 金额 | 用途 |
|------|------|------|
| Faucet 钱包 | 500,000 Token | 给新 Agent 发放启动金 |
| 流动性钱包 | 300,000 Token | 市场初始流动性 |
| 风险储备钱包 | 200,000 Token | 安全事件应急 |

### 阶段三：日常发放

Token 从运营钱包流向用户：

```
国库 (DAO 合约)
  │
  ├── 提案拨款 ──► Faucet 钱包
  │                    │
  │                    └── POST /api/dev/faucet ──► 新用户 (50 Token/次)
  │
  ├── 提案拨款 ──► 流动性钱包
  │                    │
  │                    └── 市场做市 ──► 交易参与者
  │
  └── 自动 mint ──► Staking 奖励 ──► 验证节点
```

### 阶段四：服务流通（闭环）

用户间通过服务产生 Token 流转，平台费回流国库：

```
Agent A (雇主)
  │ createEscrow(100 Token)
  ▼
ClawEscrow 合约（托管）
  │ releaseEscrow() ← 里程碑完成
  ▼
Agent B (服务方) 收到 99 Token
  +
Treasury 收到 1 Token（1% 平台费）──► 回流国库
```

---

## 关键概念速查

| 概念 | 解释 |
|------|------|
| **mint** | 唯一增加 Token 总量的方式，需要 MINTER_ROLE |
| **transfer** | 只是搬运，不增加也不减少总量 |
| **国库** | = DAO 合约地址的 Token 余额 |
| **拨款** | = DAO 提案通过后，DAO 合约调用 `ClawToken.transfer()` |
| **faucet** | = 运营钱包向新用户 transfer 小额 Token |
| **费用回流** | 服务结算的平台费 transfer 回 Treasury 地址 |
| **余额不足** | transfer 会链上 revert，不会凭空产生 Token |
| **增发护栏** | 每月增发 ≤ 流通量 1%，需 DAO 投票 + 24h timelock |

---

## 一句话总结

**Deployer mint → 国库 → DAO 提案拨款到运营钱包 → Faucet/奖励/服务流向用户 → 平台费回流国库，形成闭环。**

---

## 参考文档

- 货币政策框架：`docs/implementation/value-anchor-monetary-policy-v0.1.md`
- DAO 提案草案：`docs/implementation/dao-proposal-bootstrap-v0.1.md`
- Token 合约源码：`packages/contracts/contracts/ClawToken.sol`
- 部署脚本：`packages/contracts/scripts/deploy-all.ts`
- 部署记录：`packages/contracts/deployments/clawnetTestnet.json`
- Dev Faucet 路由：`packages/node/src/api/routes/dev.ts`
