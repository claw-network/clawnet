# 上链实施任务清单

> 基于 `on-chain-plan.md` 审定方案，拆解为可逐步执行的开发任务。
> 每个任务包含：具体产出物、验收标准、预估工时、前置依赖。

## 状态标记

```
[ ] 未开始    [~] 进行中    [x] 已完成    [!] 阻塞
```

---

## Phase 0 — 基础设施搭建（2026 Q2 W1–W4，共 4 周）

> 目标：建立 `packages/contracts/` 工程，CI 流水线可运行全部合约测试。

### Sprint 0-A：项目初始化（W1）

- [ ] **T-0.1** 创建 `packages/contracts/` Hardhat 项目
  - 产出：`packages/contracts/package.json`, `hardhat.config.ts`, `tsconfig.json`
  - 依赖：`hardhat`, `@nomicfoundation/hardhat-toolbox`, `@openzeppelin/contracts-upgradeable`
  - 验收：`pnpm --filter contracts compile` 成功
  - 工时：0.5 天

- [ ] **T-0.2** 配置 Foundry 辅助环境（可选）
  - 产出：`foundry.toml`, `remappings.txt`
  - 验收：`forge build` 成功
  - 工时：0.5 天

- [ ] **T-0.3** 集成 monorepo 构建
  - 操作：
    1. 在 `pnpm-workspace.yaml` 确认 `packages/*` 已覆盖
    2. 在根 `package.json` 的 scripts 增加 `"contracts:compile"`, `"contracts:test"`
    3. 在 `tsconfig.base.json` 的 paths 增加 `"@claw-network/contracts": ["packages/contracts/typechain-types"]`
  - 验收：根目录 `pnpm run contracts:compile` 成功
  - 工时：0.5 天

- [ ] **T-0.4** 编写合约目录骨架
  - 创建空 `.sol` 文件（含 SPDX header + pragma）：
    ```
    contracts/ClawToken.sol
    contracts/ClawEscrow.sol
    contracts/ClawIdentity.sol
    contracts/ClawStaking.sol
    contracts/ClawDAO.sol
    contracts/ClawContracts.sol
    contracts/ClawReputation.sol
    contracts/ClawRouter.sol
    contracts/ParamRegistry.sol
    contracts/interfaces/IClawToken.sol
    contracts/interfaces/IClawEscrow.sol
    contracts/interfaces/IClawIdentity.sol
    contracts/interfaces/IClawStaking.sol
    contracts/interfaces/IClawReputation.sol
    contracts/libraries/Ed25519Verifier.sol
    contracts/libraries/ClawMerkle.sol
    ```
  - 验收：`forge build` / `hardhat compile` 无错误（空合约编译通过）
  - 工时：0.5 天

### Sprint 0-B：CI/CD 与开发工具（W2）

- [ ] **T-0.5** 配置 GitHub Actions CI
  - 产出：`.github/workflows/contracts.yml`
  - 步骤：install → compile → test → slither
  - 验收：PR 自动触发，全绿通过
  - 工时：1 天

- [ ] **T-0.6** 集成 Slither 静态分析
  - 安装 `slither-analyzer`
  - 创建 `packages/contracts/slither.config.json`
  - 验收：`slither .` 可在合约目录运行并生成报告
  - 工时：0.5 天

- [ ] **T-0.7** 配置 Hardhat Gas Reporter
  - 安装 `hardhat-gas-reporter`
  - 配置输出到 `gas-report.txt`
  - 验收：`pnpm --filter contracts test` 后生成 gas 报告
  - 工时：0.5 天

- [ ] **T-0.8** 配置测试覆盖率 (solidity-coverage)
  - 安装 `solidity-coverage`
  - 验收：`pnpm --filter contracts coverage` 生成 HTML 报告
  - 工时：0.5 天

### Sprint 0-C：OpenZeppelin + 部署基础（W3）

- [ ] **T-0.9** 编写 UUPS 代理部署工具函数
  - 产出：`scripts/deploy-helpers.ts`
  - 功能：`deployProxy(contractName, initArgs)` → 部署 UUPS 代理 + 实现
  - 验收：单元测试通过 — 部署一个简单的可升级合约并调用初始化
  - 工时：1 天

- [ ] **T-0.10** 编写多网络部署配置
  - 在 `hardhat.config.ts` 配置：
    - `hardhat` (本地)
    - `baseSepolia` (测试网)
    - `base` (主网，预留)
  - 产出：`.env.example` 含 `DEPLOYER_PRIVATE_KEY`, `BASE_SEPOLIA_RPC_URL`, `ETHERSCAN_API_KEY`
  - 验收：`npx hardhat --network baseSepolia status` 可连接
  - 工时：0.5 天

- [ ] **T-0.11** 编写合约验证脚本
  - 产出：`scripts/verify.ts`
  - 验收：可对 Base Sepolia 上的合约自动提交源码验证
  - 工时：0.5 天

### Sprint 0-D：Ed25519 兼容性研究（W4）

- [ ] **T-0.12** 调研 Base L2 Ed25519 预编译支持
  - 调研 EIP-7212 / 其他预编译在 Base 上的可用性
  - 产出：`docs/implementation/tasks/ed25519-research.md`
  - 内容：方案对比（预编译 / 纯 Solidity 库 / 链下验证+链上提交）
  - 推荐方案 + PoC 代码
  - 工时：2 天

- [ ] **T-0.13** 实现 Ed25519Verifier.sol（或确定链下验证方案）
  - 根据 T-0.12 结论实现
  - 如果用链下验证方案：编写 `verifyOffChain()` 辅助函数 + 签名提交逻辑
  - 验收：测试用例通过 — 用 `@noble/ed25519` 生成签名 → 合约验证
  - 工时：3 天

- [ ] **T-0.14** 编写 DID ↔ EVM Address 映射工具
  - 产出：`packages/contracts/scripts/did-to-address.ts`
  - 功能：`did:claw:z6Mk...` → Ed25519 公钥 → `keccak256(pubkey)[12:]` → EVM address
  - 在 `packages/core` 中也增加相同函数供 SDK 使用
  - 验收：与链下现有 DID 导出地址一致
  - 工时：1 天

### Phase 0 验收门槛

```
□ packages/contracts/ 编译成功
□ CI 流水线全绿（compile + test + slither）
□ Gas Reporter 生成报告
□ 覆盖率工具可用
□ UUPS 部署脚本可用
□ Ed25519 兼容方案确定并有 PoC
□ DID → EVM address 映射工具通过测试
```

---

## Phase 1 — P0 核心合约（2026 Q3 W1–W10，共 10 周）

> 目标：ClawToken + ClawEscrow + ClawIdentity + ClawStaking 完成开发、测试、部署测试网。

### Sprint 1-A：ClawToken.sol（W1–W2）

- [ ] **T-1.1** 实现 ClawToken.sol 核心逻辑
  - 继承：ERC20Upgradeable + AccessControlUpgradeable + UUPSUpgradeable + PausableUpgradeable
  - 功能：
    - `initialize(name, symbol, admin)`
    - `decimals() → 0`
    - `mint(to, amount)` — MINTER_ROLE
    - `burn(from, amount)` — BURNER_ROLE
    - `pause()` / `unpause()` — PAUSER_ROLE
  - 验收：合约编译通过
  - 工时：2 天
  - 前置：T-0.1

- [ ] **T-1.2** 编写 IClawToken.sol 接口
  - 供其他合约引用
  - 工时：0.5 天

- [ ] **T-1.3** 编写 ClawToken 单元测试
  - 文件：`test/ClawToken.test.ts`
  - 用例清单：
    - [ ] 初始化正确（name, symbol, decimals=0, admin 角色）
    - [ ] mint 权限控制（有/无 MINTER_ROLE）
    - [ ] burn 权限控制（有/无 BURNER_ROLE）
    - [ ] 普通 transfer 功能
    - [ ] approve + transferFrom
    - [ ] pause/unpause 阻止转账
    - [ ] 升级测试：部署 V1 → 升级到 V2 → 状态保留
    - [ ] 非 admin 不能升级
  - 验收：所有用例通过 + 覆盖率 > 95%
  - 工时：3 天
  - 前置：T-1.1

- [ ] **T-1.4** ClawToken 部署脚本
  - 文件：`scripts/deploy-token.ts`
  - 功能：部署 UUPS 代理 → 初始化 → 授予角色 → 验证
  - 验收：Hardhat 本地网络部署成功，打印合约地址
  - 工时：0.5 天
  - 前置：T-1.1, T-0.9

### Sprint 1-B：ClawEscrow.sol（W3–W5）

- [ ] **T-1.5** 实现 ClawEscrow.sol 核心逻辑
  - 继承：AccessControlUpgradeable + UUPSUpgradeable + ReentrancyGuardUpgradeable + PausableUpgradeable
  - 功能：
    - `initialize(tokenAddress, treasuryAddress, feeParams)`
    - `createEscrow(escrowId, beneficiary, arbiter, amount, expiresAt)`
      - 调用 token.transferFrom(depositor → escrow)
      - 计算并扣除手续费 → Treasury
    - `fund(escrowId, amount)` — 追加资金
    - `release(escrowId)` — 由 depositor 或 arbiter 调用
    - `refund(escrowId)` — 由 beneficiary 确认退款 或 arbiter 裁决
    - `expire(escrowId)` — 任何人可调用（只要过期）
    - `dispute(escrowId)` — depositor 或 beneficiary 发起
    - `resolve(escrowId, releaseToBeneficiary)` — 仅 arbiter
  - 状态机：`Active → Released | Refunded | Expired | Disputed`，`Disputed → Released | Refunded`
  - 手续费计算：
    ```
    fee = max(min_escrow_fee, ceil(amount * base_rate + amount * holding_rate * days))
    ```
    参数从 ParamRegistry 读取（暂用常量，Phase 2 接入）
  - 验收：合约编译通过
  - 工时：4 天
  - 前置：T-1.1

- [ ] **T-1.6** 编写 IClawEscrow.sol 接口
  - 工时：0.5 天

- [ ] **T-1.7** 编写 ClawEscrow 单元测试
  - 文件：`test/ClawEscrow.test.ts`
  - 用例清单：
    - [ ] 创建 escrow 成功（余额变化、事件、状态）
    - [ ] 创建 escrow — 金额不足 revert
    - [ ] 创建 escrow — 未 approve revert
    - [ ] 创建 escrow — escrowId 重复 revert
    - [ ] release — depositor 调用成功
    - [ ] release — arbiter 调用成功
    - [ ] release — 非授权方 revert
    - [ ] release — 非 Active 状态 revert
    - [ ] refund — 各场景
    - [ ] expire — 未到期 revert / 到期后成功
    - [ ] dispute — 状态切换正确
    - [ ] resolve — 仅 arbiter / 结果正确
    - [ ] fund — 追加资金正确
    - [ ] 手续费计算正确（多个金额样本）
    - [ ] pause 阻止所有非 view 操作
    - [ ] 重入攻击防护
    - [ ] 升级后状态保留
  - 验收：所有用例通过 + 覆盖率 > 95%
  - 工时：4 天
  - 前置：T-1.5

- [ ] **T-1.8** ClawEscrow 部署脚本
  - 文件：`scripts/deploy-escrow.ts`
  - 验收：Hardhat 本地部署成功，escrow 创建+释放 e2e 通过
  - 工时：0.5 天

### Sprint 1-C：ClawIdentity.sol（W5–W7）

- [ ] **T-1.9** 实现 ClawIdentity.sol 核心逻辑
  - 功能：
    - `registerDID(didHash, publicKey, purpose, evmAddress)`
      - 存储：`dids[didHash] = DIDRecord{...}`
      - 存储：`keys[didHash][keyHash] = KeyRecord{...}`
      - 事件：`DIDRegistered(didHash, evmAddress)`
      - 约束：didHash 不能重复注册
    - `rotateKey(didHash, newPublicKey, rotationProof)`
      - 验证 rotationProof（链下 Ed25519 签名验证 + 链上提交）
      - 旧 key 标记 revokedAt
      - 新 key 写入
      - 事件：`KeyRotated(didHash, oldKeyHash, newKeyHash)`
    - `revokeDID(didHash)` — 仅 controller
    - `addPlatformLink(didHash, linkHash)` — 仅 controller
    - `isActive(didHash)` → bool
    - `getActiveKey(didHash)` → bytes
    - `getController(didHash)` → address
  - 验收：合约编译通过
  - 工时：3 天
  - 前置：T-0.13

- [ ] **T-1.10** 编写 IClawIdentity.sol 接口
  - 工时：0.5 天

- [ ] **T-1.11** 编写 ClawIdentity 单元测试
  - 用例清单：
    - [ ] 注册 DID 成功（状态、事件）
    - [ ] 重复注册 revert
    - [ ] 密钥轮换成功（旧 key revoked、新 key active）
    - [ ] 轮换无效 proof revert
    - [ ] 非 controller 操作 revert
    - [ ] 撤销 DID → isActive = false
    - [ ] 添加平台链接 hash
    - [ ] 批量注册测试（迁移场景）
    - [ ] 升级后状态保留
  - 验收：覆盖率 > 95%
  - 工时：3 天
  - 前置：T-1.9

- [ ] **T-1.12** 编写批量 DID 注册脚本（迁移用）
  - 文件：`scripts/migrate-identities.ts`
  - 输入：JSON 文件 `[{ did, publicKey, evmAddress }]`
  - 功能：批量调用 `registerDID()` + 结果报告
  - 验收：1000 个 DID 本地批量注册成功
  - 工时：1 天

### Sprint 1-D：ClawStaking.sol（W7–W9）

- [ ] **T-1.13** 实现 ClawStaking.sol 核心逻辑
  - 功能：
    - `initialize(tokenAddress, minStake, unstakeCooldown, rewardPerEpoch, slashPerViolation)`
    - `stake(amount, nodeType)`
      - 调用 token.transferFrom(node → staking)
      - 检查 amount >= minStake
      - 记录 StakeInfo，加入 activeValidators
    - `requestUnstake()`
      - 设置 unstakeRequestAt = block.timestamp
      - 从 activeValidators 移除
    - `unstake()`
      - 检查 cooldown 已过
      - 退还 amount - slashed
    - `claimRewards()`
      - 转移 rewards 给节点
    - `slash(node, amount, reason)` — SLASHER_ROLE（DAO / 仲裁合约）
    - `distributeRewards(validators[], amounts[])` — DISTRIBUTOR_ROLE
    - `isActiveValidator(node)` → bool
    - `getStakeInfo(node)` → StakeInfo
    - 读取 minStake 等参数：暂用存储变量，Phase 2 接入 ParamRegistry
  - 验收：合约编译通过
  - 工时：4 天
  - 前置：T-1.1

- [ ] **T-1.14** 编写 IClawStaking.sol 接口
  - 工时：0.5 天

- [ ] **T-1.15** 编写 ClawStaking 单元测试
  - 用例清单：
    - [ ] 质押成功（余额转移、状态记录、加入活跃列表）
    - [ ] 低于最低质押 revert
    - [ ] 请求解押 → 从活跃列表移除
    - [ ] 冷却期内解押 revert
    - [ ] 冷却期后成功解押（退还正确金额）
    - [ ] slash — 正确扣减、事件
    - [ ] slash — 非 SLASHER_ROLE revert
    - [ ] slash 超过质押金额的处理
    - [ ] distributeRewards — 正确分发
    - [ ] claimRewards — 正确领取 + 清零
    - [ ] 升级后状态保留
  - 验收：覆盖率 > 95%
  - 工时：3 天
  - 前置：T-1.13

### Sprint 1-E：P0 测试网部署 + SDK 适配（W9–W10）

- [ ] **T-1.16** 编写一体化部署脚本
  - 文件：`scripts/deploy-all-p0.ts`
  - 步骤：
    1. 部署 ClawToken → 记录地址
    2. 部署 ClawEscrow(token, treasury) → 记录地址
    3. 部署 ClawIdentity → 记录地址
    4. 部署 ClawStaking(token, params) → 记录地址
    5. 授予角色：Escrow 获得 ClawToken 的 transferFrom 授权
    6. 授予角色：Staking 获得 ClawToken 的 transferFrom 授权
    7. 输出部署地址 JSON 文件
  - 验收：Hardhat 本地 + Base Sepolia 部署成功
  - 工时：2 天
  - 前置：T-1.1, T-1.5, T-1.9, T-1.13

- [ ] **T-1.17** Base Sepolia 测试网部署
  - 操作：
    1. 获取 Base Sepolia ETH（Faucet）
    2. 执行 `deploy-all-p0.ts --network baseSepolia`
    3. 验证所有合约源码（Etherscan）
    4. 记录合约地址到 `packages/contracts/deployments/baseSepolia.json`
  - 验收：所有 4 个合约部署成功 + 已验证
  - 工时：1 天

- [ ] **T-1.18** SDK 新增链上模式：WalletOnChainApi
  - 文件：`packages/sdk/src/wallet-onchain.ts`
  - 依赖：`viem` 或 `ethers@v6`
  - 实现 IWallet 接口：
    - `getBalance()` → 调用 ClawToken.balanceOf()
    - `transfer()` → 调用 ClawToken.transfer()
    - `createEscrow()` → approve + ClawEscrow.createEscrow()
    - `releaseEscrow()` → ClawEscrow.release()
    - `refundEscrow()` → ClawEscrow.refund()
    - `getEscrow()` → ClawEscrow.escrows(id)
  - 验收：链上模式与链下模式接口一致
  - 工时：3 天
  - 前置：T-1.16

- [ ] **T-1.19** SDK 新增链上模式：IdentityOnChainApi
  - 文件：`packages/sdk/src/identity-onchain.ts`
  - 实现：
    - `register()` → ClawIdentity.registerDID()
    - `rotateKey()` → ClawIdentity.rotateKey()
    - `resolve(did)` → 链上查 activeKey + IPFS 获取完整文档
    - `addPlatformLink()` → ClawIdentity.addPlatformLink()
  - 验收：DID 注册 + 查询链上链路通畅
  - 工时：2 天

- [ ] **T-1.20** SDK ClawNet 入口适配
  - 修改 `packages/sdk/src/index.ts`：
    - 新增 `onChain?: boolean` 配置项
    - 根据配置创建 OnChain / OffChain 适配器
    - 保持 API 接口完全不变
  - 验收：现有测试不受影响 + 新增 onChain 模式测试
  - 工时：1 天

- [ ] **T-1.21** P0 集成测试
  - 文件：`test/integration/p0-onchain.test.ts`
  - 场景：
    1. 部署全套 P0 合约
    2. SDK (onChain=true) 注册 DID
    3. SDK 获取余额 → mint → 转账
    4. SDK 创建 escrow → 释放 → 验证余额
    5. SDK 质押 → 查询状态 → 请求解押
  - 验收：全流程通过
  - 工时：2 天

### Phase 1 验收门槛

```
□ ClawToken.sol 测试覆盖率 > 95%，gas 报告生成
□ ClawEscrow.sol 测试覆盖率 > 95%，包含重入防护测试
□ ClawIdentity.sol 测试覆盖率 > 95%，DID 映射正确
□ ClawStaking.sol 测试覆盖率 > 95%，质押/slash 逻辑正确
□ Base Sepolia 4 个合约部署成功 + 源码验证
□ SDK onChain 模式可用（wallet + identity）
□ P0 集成测试全部通过
□ Slither 无 High/Medium 级别告警
```

---

## Phase 2 — P1 高级合约（2026 Q4 W1–W12，共 12 周）

> 目标：ClawDAO + ClawContracts + ClawReputation + ParamRegistry 完成开发，全部合约测试网部署，外部审计启动。

### Sprint 2-A：ParamRegistry.sol（W1）

- [ ] **T-2.1** 实现 ParamRegistry.sol
  - 功能：
    - 存储所有可治理参数（key-value uint256）
    - `setParam(bytes32 key, uint256 value)` — 仅 GOVERNOR_ROLE（ClawDAO）
    - `getParam(bytes32 key)` → uint256
    - `getParamWithDefault(bytes32 key, uint256 defaultValue)` → uint256
    - 预置参数 key 常量：
      ```
      MARKET_FEE_INFO, MARKET_FEE_TASK, MARKET_FEE_CAP,
      MARKET_MIN_FEE, MARKET_MAX_FEE,
      ESCROW_BASE_RATE, ESCROW_HOLDING_RATE, ESCROW_MIN_FEE,
      MIN_TRANSFER_AMOUNT, MIN_ESCROW_AMOUNT,
      MIN_NODE_STAKE, UNSTAKE_COOLDOWN,
      VALIDATOR_REWARD_RATE, SLASH_PER_VIOLATION,
      TRUST_DECAY_RATE, EPOCH_DURATION,
      PROPOSAL_THRESHOLD, VOTING_PERIOD, TIMELOCK_DELAY, QUORUM_BPS
      ```
  - 验收：合约编译通过
  - 工时：1.5 天

- [ ] **T-2.2** 编写 ParamRegistry 单元测试
  - 用例：设置/读取参数、权限控制、升级保留
  - 验收：覆盖率 > 95%
  - 工时：1 天

- [ ] **T-2.3** 重构 ClawEscrow / ClawStaking 接入 ParamRegistry
  - 修改手续费计算和质押参数从 ParamRegistry 读取
  - 验收：原有测试不受影响 + 参数变更测试通过
  - 工时：1 天

### Sprint 2-B：ClawDAO.sol（W2–W5）

- [ ] **T-2.4** 实现 ClawDAO.sol 核心逻辑
  - 功能：
    - `initialize(token, reputation, staking, paramRegistry, params)`
    - `propose(pType, descriptionHash, target, callData)` → proposalId
      - 检查提案者持有 Token >= proposalThreshold
      - 创建 Proposal，status = Discussion
    - `vote(proposalId, support)`
      - 计算投票权重：`√(tokenBalance) × (1 + trustScore/1000) × lockupMultiplier`
      - 检查投票期内
      - 记录投票，累加权重
    - `queue(proposalId)` — 投票通过后进入时间锁
    - `execute(proposalId)` — 时间锁到期后执行
    - `cancel(proposalId)` — 提案者可取消
    - `emergencyExecute(proposalId, signatures[])` — 5/9 多签
    - `getVotingPower(voter)` → uint256
    - 状态机：Discussion → Voting → Passed/Rejected → Timelocked → Executed
  - 验收：合约编译通过
  - 工时：6 天
  - 前置：T-2.1

- [ ] **T-2.5** 实现 TimeLock 逻辑
  - 可内嵌 ClawDAO 或单独合约
  - 功能：延迟执行 + 取消
  - 工时：2 天

- [ ] **T-2.6** 实现 EmergencyMultiSig 逻辑
  - 9 个 signer 地址，5/9 阈值
  - 可内嵌或独立
  - 工时：2 天

- [ ] **T-2.7** 编写 ClawDAO 单元测试
  - 用例清单：
    - [ ] 提案创建（各类型）
    - [ ] 提案门槛不足 revert
    - [ ] 投票权重计算正确（多个场景）
    - [ ] 投票 — 讨论期投票 revert / 投票期投票成功
    - [ ] 投票 — 重复投票 revert
    - [ ] 提案通过（forVotes > againstVotes + quorum 达标）
    - [ ] 提案未通过
    - [ ] 时间锁延迟执行
    - [ ] 时间锁未到期执行 revert
    - [ ] execute 调用目标合约的 callData
    - [ ] 参数修改提案 e2e（propose → vote → queue → execute → 参数生效）
    - [ ] 国库支出提案 e2e
    - [ ] 紧急多签执行
    - [ ] 闪电贷攻击防护（快照余额）
    - [ ] 升级后状态保留
  - 验收：覆盖率 > 95%
  - 工时：5 天
  - 前置：T-2.4

- [ ] **T-2.8** ClawDAO 部署脚本
  - 工时：1 天

### Sprint 2-C：ClawContracts.sol（W5–W8）

- [ ] **T-2.9** 实现 ClawContracts.sol 核心逻辑
  - 功能：
    - `createContract(contractId, provider, totalAmount, termsHash, deadline, milestoneAmounts[], milestoneDeadlines[])`
      - 自动创建对应 Escrow
    - `signContract(contractId)` — 双方都签后 status → Signed
    - `activateContract(contractId)` — 签署 + 资金到位后 → Active
    - `submitMilestone(contractId, index, deliverableHash)`
    - `approveMilestone(contractId, index)` — 释放该里程碑资金
    - `rejectMilestone(contractId, index, reasonHash)`
    - `completeContract(contractId)` — 所有里程碑 Approved 后
    - `disputeContract(contractId, evidenceHash)`
    - `terminateContract(contractId, reason)` — 双方协商或仲裁后
  - 与 ClawEscrow 的交互：
    - createContract 内部调用 ClawEscrow.createEscrow
    - approveMilestone 内部调用 ClawEscrow.release（部分金额）
  - 状态机严格校验
  - 验收：合约编译通过
  - 工时：6 天
  - 前置：T-1.5

- [ ] **T-2.10** 编写 ClawContracts 单元测试
  - 用例清单：
    - [ ] 创建合约（参数正确、Escrow 创建、事件）
    - [ ] 里程碑数量和金额之和 = totalAmount
    - [ ] 签署流程（单方签 → 双方签 → Active）
    - [ ] 提交里程碑（仅 provider）
    - [ ] 批准里程碑（仅 client / arbiter）→ 资金部分释放
    - [ ] 全部里程碑通过 → 合约完成
    - [ ] 争议 → 仲裁 → 释放/退款
    - [ ] 超时终止
    - [ ] 非法状态转换 revert
    - [ ] 升级后状态保留
  - 验收：覆盖率 > 95%
  - 工时：5 天
  - 前置：T-2.9

### Sprint 2-D：ClawReputation.sol（W8–W9）

- [ ] **T-2.11** 实现 ClawReputation.sol
  - 功能：
    - `anchorReputation(agentDIDHash, overallScore, dimensionScores[5], merkleRoot)` — ANCHOR_ROLE
    - `batchAnchorReputation(agentDIDHashes[], scores[], merkleRoots[])` — ANCHOR_ROLE
    - `recordReview(reviewHash, reviewerDIDHash, subjectDIDHash, txHash)` — ANCHOR_ROLE
    - `getReputation(agentDIDHash)` → (score, epoch)
    - `getSnapshotHistory(agentDIDHash, epoch)` → ReputationSnapshot
    - `verifyReview(reviewHash)` → ReviewAnchor
    - epoch 自动递增（基于 block.timestamp / epochDuration）
  - 验收：合约编译通过
  - 工时：3 天

- [ ] **T-2.12** 编写 ClawReputation 单元测试
  - 用例：锚定、批量锚定、查询、epoch 递增、权限控制
  - 验收：覆盖率 > 95%
  - 工时：2 天

- [ ] **T-2.13** 编写 Merkle 树工具
  - 文件：`packages/contracts/scripts/merkle-builder.ts`
  - 功能：给定评价列表 → 构建 Merkle 树 → 输出 root + proof
  - 验收：链下 proof → 链上验证通过
  - 工时：1.5 天

### Sprint 2-E：ClawRouter.sol + 跨模块集成（W9–W10）

- [ ] **T-2.14** 实现 ClawRouter.sol
  - 功能：
    - 注册/查询各模块合约地址
    - 统一入口（可选，用于前端 multicall 便利）
  - 工时：1.5 天

- [ ] **T-2.15** 跨模块集成测试
  - 文件：`test/integration/full-cycle.test.ts`
  - 场景：
    1. 注册 DID + 质押成为节点
    2. 发布任务 (链下) → 匹配 (链下) → 创建合约 (链上)
    3. 双方签署 → 里程碑提交 → 审批 → 资金释放
    4. 评价 → 信誉锚定
    5. DAO 提案修改手续费 → 投票 → 执行 → 验证新费率
  - 验收：全流程端到端通过
  - 工时：3 天
  - 前置：全部合约

- [ ] **T-2.16** 权限矩阵验证测试
  - 验证 on-chain-plan.md §11 权限矩阵中每个允许/禁止的调用
  - 工时：2 天

### Sprint 2-F：全量测试网部署 + SDK（W10–W11）

- [ ] **T-2.17** 编写完整部署脚本
  - 文件：`scripts/deploy-all.ts`
  - 按顺序部署 8 个合约 + 设置角色 + 初始化 ParamRegistry 默认参数
  - 输出：`deployments/<network>.json`
  - 工时：2 天

- [ ] **T-2.18** Base Sepolia 全量部署
  - 验收：8 个合约全部部署成功 + 源码验证
  - 工时：1 天

- [ ] **T-2.19** SDK 新增 DAO / Contracts / Reputation / Staking 链上适配
  - 新增文件：
    - `packages/sdk/src/dao-onchain.ts`
    - `packages/sdk/src/contracts-onchain.ts`
    - `packages/sdk/src/reputation-onchain.ts`
    - `packages/sdk/src/staking-onchain.ts`
  - 验收：SDK 完整 API onChain 模式可用
  - 工时：5 天

- [ ] **T-2.20** CLI 新增链上命令
  - 新增命令：
    - `claw dao propose / vote / execute`
    - `claw stake / unstake / claim-rewards`
    - `claw contract create / sign / milestone / complete`
  - 验收：CLI 命令可对测试网执行
  - 工时：3 天

### Sprint 2-G：安全审计准备（W11–W12）

- [ ] **T-2.21** 内部安全审计
  - 工具：Slither + Mythril + Aderyn
  - 修复所有 High / Medium 发现
  - 产出：`docs/implementation/tasks/internal-audit-report.md`
  - 工时：3 天

- [ ] **T-2.22** 编写审计文档包
  - 产出：
    - 合约架构图 + 权限说明
    - 关键业务逻辑说明
    - 已知风险和设计取舍清单
    - 测试覆盖率报告
  - 交付给外部审计公司
  - 工时：2 天

- [ ] **T-2.23** 联系外部审计公司（并行）
  - 提前 4-6 周预约
  - 预算：$80K–150K（8 个合约）
  - 工时：PM 负责

- [ ] **T-2.24** Bug Bounty 计划准备
  - 起草 Bug Bounty 规则、奖金等级
  - 注册 Immunefi 或自建
  - 工时：1 天

### Phase 2 验收门槛

```
□ ClawDAO.sol 投票权重正确，全流程 e2e 通过
□ ClawContracts.sol 里程碑结算 + 争议仲裁测试通过
□ ClawReputation.sol 批量锚定 + Merkle 验证通过
□ ParamRegistry.sol DAO 修改参数 e2e 通过
□ ClawRouter.sol 模块注册正确
□ 全量跨模块集成测试通过
□ Base Sepolia 8 个合约全部部署成功 + 已验证
□ SDK + CLI 链上模式完整可用
□ Slither 无 High/Medium 级别告警
□ 外部审计公司已签约
```

---

## Phase 3 — 迁移与主网上线（2027 Q1 W1–W8，共 8 周）

> 目标：数据迁移、双轨运行、切换到链上为 source of truth、正式上线。

### Sprint 3-A：外部审计 + 修复（W1–W3）

- [ ] **T-3.1** 配合外部审计
  - 响应审计方问题
  - 修复发现的所有漏洞
  - 重新测试受影响的合约
  - 工时：持续

- [ ] **T-3.2** 审计报告公示
  - 发布审计报告到 docs
  - 工时：0.5 天

### Sprint 3-B：迁移工具开发（W2–W4）

- [ ] **T-3.3** 编写余额快照导出工具
  - 文件：`scripts/snapshot-balances.ts`
  - 功能：连接链下节点 → 导出所有 DID → 余额 JSON
  - 验收：输出格式 `[{ did, address, balance }]`
  - 工时：1.5 天

- [ ] **T-3.4** 编写余额迁移脚本
  - 文件：`scripts/migrate-balances.ts`
  - 功能：
    1. 读取快照 JSON
    2. 验证所有 DID 已在 ClawIdentity 注册（有 EVM address）
    3. 批量 ClawToken.mint(address, balance)
    4. 验证：链上总量 = 链下总量
  - 验收：本地测试 1000 地址迁移成功
  - 工时：2 天
  - 前置：T-3.3, T-1.12

- [ ] **T-3.5** 编写 Escrow 迁移脚本
  - 文件：`scripts/migrate-escrows.ts`
  - 功能：导出 Active escrow → 链上重建
  - 验收：本地测试通过
  - 工时：1.5 天

- [ ] **T-3.6** 编写合约迁移脚本
  - 文件：`scripts/migrate-contracts.ts`
  - 功能：导出 Active service contracts → 链上重建
  - 验收：本地测试通过
  - 工时：1.5 天

- [ ] **T-3.7** 编写对账工具
  - 文件：`scripts/reconcile.ts`
  - 功能：对比链上 vs 链下每个地址的余额、escrow 状态、合约状态
  - 输出差异报告
  - 验收：全量对账 0 差异
  - 工时：2 天

### Sprint 3-C：双轨运行（W4–W6）

- [ ] **T-3.8** Node 节点适配双轨模式
  - 修改 `packages/node/`：
    - 链下事件处理保持不变
    - 新增：每笔关键操作同时写入链上
    - 新增：链上事件监听 → 更新本地状态
  - 配置项：`mode: 'offchain' | 'dual' | 'onchain'`
  - 验收：dual 模式下链上链下状态一致
  - 工时：5 天

- [ ] **T-3.9** 双轨运行监控仪表板
  - 产出：Grafana 面板 或 简单 CLI 工具
  - 监控：
    - 链上 vs 链下余额差异
    - 链上 vs 链下 Escrow 状态差异
    - 链上交易失败率
    - Gas 消耗统计
  - 工时：2 天

- [ ] **T-3.10** 双轨运行测试（2 周观察期）
  - 操作：
    1. 在测试网启动双轨模式
    2. 运行完整集成测试场景（clawnet scenarios 01-09）
    3. 每日对账
    4. 记录所有异常
  - 验收：连续 7 天无链上链下差异
  - 工时：持续

### Sprint 3-D：主网部署 + 切换（W6–W8）

- [ ] **T-3.11** 主网部署准备
  - 操作：
    1. 确认外部审计报告无 Critical/High 未修复
    2. 准备主网 deployer 多签钱包
    3. 准备足够 ETH (gas)
    4. 社区公示迁移计划 + 时间表
  - 工时：1 天

- [ ] **T-3.12** Base 主网部署
  - 执行 `deploy-all.ts --network base`
  - 验证所有合约源码
  - 记录地址到 `deployments/base.json`
  - 工时：1 天

- [ ] **T-3.13** 执行数据迁移
  - 步骤：
    1. 公告：链下系统进入维护窗口（暂停高价值操作）
    2. 执行 DID 迁移 (`migrate-identities.ts`)
    3. 执行余额迁移 (`migrate-balances.ts`)
    4. 执行 Escrow 迁移 (`migrate-escrows.ts`)
    5. 执行合约迁移 (`migrate-contracts.ts`)
    6. 全量对账 (`reconcile.ts`)
    7. 公告迁移完成
  - 验收：对账 0 差异
  - 工时：2 天（含测试+正式）

- [ ] **T-3.14** 切换 source of truth
  - 操作：
    1. 节点配置从 `dual` 切为 `onchain`
    2. SDK 默认 `onChain: true`
    3. 链下事件溯源降级为只读缓存
    4. 更新文档
  - 验收：所有操作走链上通路
  - 工时：1 天

- [ ] **T-3.15** Bug Bounty 正式启动
  - 发布到 Immunefi / 社区
  - 工时：0.5 天

- [ ] **T-3.16** 发布公告 + 更新文档
  - 更新：README, QUICKSTART, DEPLOYMENT, SDK_GUIDE
  - 新增：ON_CHAIN_GUIDE.md（链上操作指南）
  - 工时：1 天

### Phase 3 验收门槛

```
□ 外部审计完成，所有 Critical/High 已修复
□ 数据迁移成功，链上链下对账 0 差异
□ 双轨运行 7 天无异常
□ 主网 8 个合约部署成功 + 源码验证
□ 节点 onchain 模式稳定运行
□ SDK + CLI 默认走链上
□ Bug Bounty 已启动
□ 文档已更新
```

---

## 附录：任务依赖图

```
Phase 0                      Phase 1                           Phase 2                    Phase 3
────────                     ────────                          ────────                   ────────

T-0.1 (Hardhat)──┐
T-0.9 (Deploy)───┤
T-0.13(Ed25519)──┼──→ T-1.1 (Token)──→ T-1.3 (Test)
                 │    T-1.5 (Escrow)──→ T-1.7 (Test)───┐
                 │    T-1.9 (Identity)→ T-1.11(Test)    │
                 │    T-1.13(Staking)─→ T-1.15(Test)    │
                 │                                       │
                 │    T-1.16(Deploy P0)──────────────────┤
                 │    T-1.18(SDK Wallet OnChain)────┐    │
                 │    T-1.19(SDK Identity OnChain)──┤    │
                 │                                   │    │
                 │    T-1.21(P0 集成测试)────────────┘    │
                 │                                        │
                 └──→ T-2.1 (ParamRegistry)───────────────┼──→ T-2.3 (重构)
                      T-2.4 (DAO)────→ T-2.7 (Test)      │
                      T-2.9 (Contracts)→ T-2.10(Test)     │
                      T-2.11(Reputation)→ T-2.12(Test)    │
                      T-2.14(Router)                      │
                      T-2.15(集成测试)                     │
                      T-2.17(Deploy All)──────────────────┼──→ T-3.3 (快照)
                      T-2.21(内部审计)                     │    T-3.4 (迁移)
                                                           │    T-3.8 (双轨)
                                                           │    T-3.12(主网)
                                                           └──→ T-3.14(切换)
```

---

## 附录：工时汇总

| Phase | 合约开发 | 测试 | 部署/脚本 | SDK/CLI | 审计/安全 | 迁移 | 总计 |
|-------|---------|------|----------|---------|----------|------|------|
| Phase 0 | 4d | — | 3d | — | — | — | **~10d** |
| Phase 1 | 13d | 13d | 4d | 6d | — | 1d | **~40d** |
| Phase 2 | 22d | 15d | 4d | 8d | 6d | — | **~55d** |
| Phase 3 | — | — | 3d | — | 持续 | 14d | **~20d** |
| **总计** | **39d** | **28d** | **14d** | **14d** | **6d+** | **15d** | **~125d** |

> 按 2 名合约工程师 + 2 名后端工程师并行，预计 8–9 个月完成全部 Phase。

---

*最后更新: 2026年2月22日*
*状态: 待团队评审确认后启动 Phase 0*
