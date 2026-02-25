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

- [x] **T-0.1** 创建 `packages/contracts/` Hardhat 项目
  - 产出：`packages/contracts/package.json`, `hardhat.config.ts`, `tsconfig.json`
  - 依赖：`hardhat`, `@nomicfoundation/hardhat-toolbox`, `@openzeppelin/contracts-upgradeable`
  - 验收：`pnpm --filter contracts compile` 成功
  - 工时：0.5 天

- [ ] **T-0.2** 配置 Foundry 辅助环境（可选）
  - 产出：`foundry.toml`, `remappings.txt`
  - 验收：`forge build` 成功
  - 工时：0.5 天

- [x] **T-0.3** 集成 monorepo 构建
  - 操作：
    1. 在 `pnpm-workspace.yaml` 确认 `packages/*` 已覆盖
    2. 在根 `package.json` 的 scripts 增加 `"contracts:compile"`, `"contracts:test"`
    3. 在 `tsconfig.base.json` 的 paths 增加 `"@claw-network/contracts": ["packages/contracts/typechain-types"]`
  - 验收：根目录 `pnpm run contracts:compile` 成功
  - 工时：0.5 天

- [x] **T-0.4** 编写合约目录骨架
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

- [x] **T-0.5** 配置 GitHub Actions CI
  - 产出：`.github/workflows/contracts.yml`
  - 步骤：install → compile → test → slither
  - 验收：PR 自动触发，全绿通过
  - 工时：1 天

- [x] **T-0.6** 集成 Slither 静态分析
  - 安装 `slither-analyzer`
  - 创建 `packages/contracts/slither.config.json`
  - 验收：`slither .` 可在合约目录运行并生成报告
  - 工时：0.5 天

- [x] **T-0.7** 配置 Hardhat Gas Reporter
  - 安装 `hardhat-gas-reporter`
  - 配置输出到 `gas-report.txt`
  - 验收：`pnpm --filter contracts test` 后生成 gas 报告
  - 工时：0.5 天

- [x] **T-0.8** 配置测试覆盖率 (solidity-coverage)
  - 安装 `solidity-coverage`
  - 验收：`pnpm --filter contracts coverage` 生成 HTML 报告
  - 工时：0.5 天

### Sprint 0-C：OpenZeppelin + 部署基础（W3）

- [x] **T-0.9** 编写 UUPS 代理部署工具函数
  - 产出：`scripts/deploy-helpers.ts`
  - 功能：`deployProxy(contractName, initArgs)` → 部署 UUPS 代理 + 实现
  - 验收：单元测试通过 — 部署一个简单的可升级合约并调用初始化
  - 工时：1 天

- [x] **T-0.10** 编写多网络部署配置
  - 在 `hardhat.config.ts` 配置：
    - `hardhat` (本地)
    - `clawnetDevnet` (本地 devnet，Reth/Geth PoA)
    - `clawnetTestnet` (ClawNet Chain 测试网)
    - `clawnetMainnet` (主网，预留)
  - 产出：`.env.example` 含 `DEPLOYER_PRIVATE_KEY`, `CLAWNET_RPC_URL`, `CHAIN_EXPLORER_API_KEY`
  - 验收：`npx hardhat --network clawnetDevnet status` 可连接
  - 工时：0.5 天

- [ ] **T-0.11** 编写合约验证脚本
  - 产出：`scripts/verify.ts`
  - 说明：无 Blockscout 链浏览器，改用 `cast` CLI + 本地源码验证方式
  - 功能：基于 `forge verify-contract` 或自定义脚本，从 ABI + bytecode 对比验证链上合约
  - 验收：可通过 `cast code <address> --rpc-url $RPC` 获取 bytecode 并与编译结果比较
  - 工时：0.5 天

### Sprint 0-D：链节点软件搭建 + Ed25519 预编译（W4）

- [x] **T-0.12** 搭建 ClawNet Chain 本地 devnet  ✅ geth v1.17 --dev mode, chainId 1337, infra/devnet/ 一键启动+部署
  - 基于 Reth (Rust) 或 Geth (Go) Fork 搭建独立 EVM 链
  - 配置：
    - 共识：PoA (Clique)，授权节点 = 本地开发节点
    - Gas 代币：Token（原生代币，非 ERC-20）
    - 出块时间：2 秒
    - 创世配置：预分配 Token 给开发账户
    - Ed25519 自定义预编译（如可行，在此阶段集成）
  - 产出：`infra/chain-devnet/` 配置文件 + docker-compose
    - `genesis.json` — 创世块配置（参考 `infra/chain-testnet/genesis.json` 模板）
    - `chain.toml` — Reth 链参数
    - `docker-compose.yml` — 单节点本地启动
  - 验收：本地链可启动，可部署合约 + 执行交易，零外部依赖
  - 工时：4 天

- [x] **T-0.12a** 部署 ClawNet Chain 3 节点测试网  ✅ Geth v1.13.15 Clique PoA, 3 validators, 9 contracts deployed
  - 基于 `infra/chain-testnet/` 配置文件，在 3 台云服务器上部署
  - 实际采用：Geth v1.13.15（Reth 不支持 Clique），evmVersion: london（非 cancun）
  - 服务器架构：
    - Server A (66.94.125.242): clawnetd.com — Validator #1 + Bootstrap + Caddy + Homepage
    - Server B (85.239.236.49): Contabo VPS S — Validator #2
    - Server C (85.239.235.67): Contabo VPS S — Validator #3
  - 实际部署步骤（详见 `infra/README.md`）：
    1. 生成 3 个 Validator 密钥 + Deployer 密钥 + Treasury 地址
    2. 构建 genesis.json（extradata 含 3 validator，alloc 预分配）
    3. Server A 先启动挖矿，等待稳定出块
    4. Server B/C 先 sync-only 模式同步到最新块，再切 mining 模式
    5. Caddy 配置 clawnetd.com / api.clawnetd.com / rpc.clawnetd.com
  - 关键经验教训（9 条，见 README §7 Lessons Learned）：
    - genesis 不可含 shanghaiTime（Clique 不兼容）
    - 新节点必须先 sync 再 mine（否则竞争分叉）
    - nodekey 必须保留（wipe 后 enode 会变）
    - 合约从 Server A localhost:8545 部署（非远程 RPC）
  - 配置文件（已更新至实际部署版）：
    - `infra/README.md` — 完整部署指南（~900 lines, Geth v1.13.15）
    - `infra/chain-testnet/genesis.json` — 创世块（chainId=7625, Clique, period=2s, 无 shanghaiTime）
    - `infra/chain-testnet/docker-compose.yml` — Server A compose (Geth)
    - `infra/chain-testnet/docker-compose.peer.yml` — Server B/C compose (Geth)
    - `infra/chain-testnet/docker-compose.sync.yml` — 新节点 sync-only 模式
    - `infra/chain-testnet/Caddyfile` — 反向代理 + API key auth
    - `infra/chain-testnet/.env.example` — 环境变量模板
    - `infra/chain-testnet/health-check.sh` — 健康检查 (Geth)
    - `infra/chain-testnet/setup-server.sh` — 服务器初始化 (Geth)
  - 验收：3 个 Validator 出块正常 ✅，RPC HTTPS 可访问 ✅，9 个合约部署成功 ✅
  - 工时：2 天
  - 前置：T-0.12
  - 月费：¥92（2× Contabo VPS S €5.99）

- [x] **T-0.13** 调研并实现 Ed25519 自定义预编译
  - 独立链可自由添加自定义预编译，无需 EIP 审批
  - 产出：`docs/implementation/tasks/ed25519-research.md`
  - 内容：方案对比（Reth 自定义预编译 / 纯 Solidity 库 / 链下验证+链上提交）
  - 推荐方案 + PoC 代码
  - 结论：采用方案 C（链下验证 + 链上提交），Phase 2 可升级到方案 A（Reth 预编译）
  - 工时：2 天

- [x] **T-0.14** 实现 Ed25519Verifier.sol（或确定链下验证方案）
  - 根据 T-0.13 结论实现
  - 实现内容：domain-separated payload builders (rotation/registration/link/revocation)
  - 预留 Phase 2 预编译 verify() 接口（地址 0x0100）
  - 验收：18 个测试通过（payload 确定性、链上链下一致性、域分离、预编译 stub）
  - 工时：3 天

- [x] **T-0.15** 编写 DID ↔ EVM Address 映射工具
  - 产出：`packages/contracts/scripts/did-address.ts`
  - 功能：did:claw: ↔ Ed25519 pubkey ↔ ClawNet native address ↔ EVM address ↔ didHash
  - 包含 base58 编解码、multibase 编解码、地址校验和验证
  - 验收：测试向量地址 `claw1K1Zon...` 精确匹配 ✅
  - 工时：1 天

### Phase 0 验收门槛

```
■ packages/contracts/ 编译成功
■ CI 流水线全绿（compile + test + slither）
■ Gas Reporter 生成报告
■ 覆盖率工具可用
■ UUPS 部署脚本可用
■ Ed25519 兼容方案确定并有 PoC（方案 C + Ed25519Verifier.sol 18 测试通过）
□ ClawNet Chain 本地 devnet 可启动 + 部署合约（零外部依赖）
■ ClawNet Chain 3 节点测试网上线（Geth v1.13.15 Clique PoA, rpc.clawnetd.com 可访问）
■ DID → EVM address 映射工具通过测试（test vector 精确匹配）
```

---

## Phase 1 — P0 核心合约（2026 Q3 W1–W10，共 10 周）

> 目标：ClawToken + ClawEscrow + ClawIdentity + ClawStaking 完成开发、测试、部署测试网。

### Sprint 1-A：ClawToken.sol（W1–W2）

- [x] **T-1.1** 实现 ClawToken.sol 核心逻辑
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

- [x] **T-1.2** 编写 IClawToken.sol 接口
  - 供其他合约引用
  - 工时：0.5 天

- [x] **T-1.3** 编写 ClawToken 单元测试
  - 文件：`test/ClawToken.test.ts`
  - 用例清单：
    - [x] 初始化正确（name, symbol, decimals=0, admin 角色）
    - [x] mint 权限控制（有/无 MINTER_ROLE）
    - [x] burn 权限控制（有/无 BURNER_ROLE）
    - [x] 普通 transfer 功能
    - [x] approve + transferFrom
    - [x] pause/unpause 阻止转账
    - [x] 升级测试：部署 V1 → 升级到 V2 → 状态保留
    - [x] 非 admin 不能升级
  - 验收：所有用例通过 + 覆盖率 > 95%
  - 工时：3 天
  - 前置：T-1.1

- [x] **T-1.4** ClawToken 部署脚本
  - 文件：`scripts/deploy-token.ts`
  - 功能：部署 UUPS 代理 → 初始化 → 授予角色 → 验证
  - 验收：Hardhat 本地网络部署成功，打印合约地址
  - 工时：0.5 天
  - 前置：T-1.1, T-0.9

### Sprint 1-B：ClawEscrow.sol（W3–W5）

- [x] **T-1.5** 实现 ClawEscrow.sol 核心逻辑
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

- [x] **T-1.6** 编写 IClawEscrow.sol 接口
  - 工时：0.5 天

- [x] **T-1.7** 编写 ClawEscrow 单元测试
  - 文件：`test/ClawEscrow.test.ts`
  - 用例清单：
    - [x] 创建 escrow 成功（余额变化、事件、状态）
    - [x] 创建 escrow — 金额不足 revert
    - [x] 创建 escrow — 未 approve revert
    - [x] 创建 escrow — escrowId 重复 revert
    - [x] release — depositor 调用成功
    - [x] release — arbiter 调用成功
    - [x] release — 非授权方 revert
    - [x] release — 非 Active 状态 revert
    - [x] refund — 各场景
    - [x] expire — 未到期 revert / 到期后成功
    - [x] dispute — 状态切换正确
    - [x] resolve — 仅 arbiter / 结果正确
    - [x] fund — 追加资金正确
    - [x] 手续费计算正确（多个金额样本）
    - [x] pause 阻止所有非 view 操作
    - [x] 重入攻击防护
    - [x] 升级后状态保留
  - 验收：所有用例通过 + 覆盖率 > 95%
  - 工时：4 天
  - 前置：T-1.5

- [x] **T-1.8** ClawEscrow 部署脚本
  - 文件：`scripts/deploy-escrow.ts`
  - 验收：Hardhat 本地部署成功，escrow 创建+释放 e2e 通过
  - 工时：0.5 天

### Sprint 1-C：ClawIdentity.sol（W5–W7）

- [x] **T-1.9** 实现 ClawIdentity.sol 核心逻辑
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

- [x] **T-1.10** 编写 IClawIdentity.sol 接口
  - 工时：0.5 天

- [x] **T-1.11** 编写 ClawIdentity 单元测试
  - 用例清单：
    - [x] 注册 DID 成功（状态、事件）
    - [x] 重复注册 revert
    - [x] 密钥轮换成功（旧 key revoked、新 key active）
    - [x] 轮换无效 proof revert
    - [x] 非 controller 操作 revert
    - [x] 撤销 DID → isActive = false
    - [x] 添加平台链接 hash
    - [x] 批量注册测试（迁移场景）
    - [x] 升级后状态保留
  - 验收：覆盖率 > 95%
  - 工时：3 天
  - 前置：T-1.9

- [x] **T-1.12** 编写批量 DID 注册脚本（迁移用）
  - 文件：`scripts/migrate-identities.ts`
  - 输入：JSON 文件 `[{ did, publicKey, evmAddress }]`
  - 功能：批量调用 `registerDID()` + 结果报告
  - 验收：1000 个 DID 本地批量注册成功
  - 工时：1 天

### Sprint 1-D：ClawStaking.sol（W7–W9）

- [x] **T-1.13** 实现 ClawStaking.sol 核心逻辑
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

- [x] **T-1.14** 编写 IClawStaking.sol 接口
  - 工时：0.5 天

- [x] **T-1.15** 编写 ClawStaking 单元测试
  - 用例清单：
    - [x] 质押成功（余额转移、状态记录、加入活跃列表）
    - [x] 低于最低质押 revert
    - [x] 请求解押 → 从活跃列表移除
    - [x] 冷却期内解押 revert
    - [x] 冷却期后成功解押（退还正确金额）
    - [x] slash — 正确扣减、事件
    - [x] slash — 非 SLASHER_ROLE revert
    - [x] slash 超过质押金额的处理
    - [x] distributeRewards — 正确分发
    - [x] claimRewards — 正确领取 + 清零
    - [x] 升级后状态保留
  - 验收：覆盖率 > 95%
  - 工时：3 天
  - 前置：T-1.13

### Sprint 1-E：P0 测试网部署 + SDK 适配（W9–W10）

- [x] **T-1.16** 编写一体化部署脚本
  - 文件：`scripts/deploy-all-p0.ts`
  - 步骤：
    1. 部署 ClawToken → 记录地址
    2. 部署 ClawEscrow(token, treasury) → 记录地址
    3. 部署 ClawIdentity → 记录地址
    4. 部署 ClawStaking(token, params) → 记录地址
    5. 授予角色：Staking 获得 ClawToken 的 MINTER_ROLE
    6. 用户需自行 approve Escrow/Staking 的 transferFrom
    7. 输出部署地址 JSON 文件到 `deployments/<network>.json`
  - 验收：Hardhat 本地部署成功，4 合约 + 角色授予 + JSON 输出 ✅
  - 工时：2 天
  - 前置：T-1.1, T-1.5, T-1.9, T-1.13

- [x] **T-1.17** ClawNet Chain 测试网部署  ✅ 与 T-2.18 合并完成，9 合约一次性部署
  - 说明：实际部署时 Phase 1 和 Phase 2 合约已全部就绪，使用 `deploy-all.ts` 一次性部署全部 9 个合约
  - 操作：
    1. 在 Server A 本地执行 `npx hardhat run scripts/deploy-all.ts --network clawnetTestnet`
    2. 9 个合约全部部署成功（proxy + impl），地址记录到 `deployments/clawnetTestnet.json`
    3. 角色授予：Staking → MINTER_ROLE, DAO → GOVERNOR_ROLE
    4. ParamRegistry 默认参数初始化
  - 验收：9 个合约部署成功 ✅，角色授予 ✅，地址记录 ✅
  - 工时：0.5 天（与 T-2.18 合并）
  - 前置：T-1.16, T-0.12a

- [x] **T-1.18** SDK 新增链上模式：WalletOnChainApi
  - 文件：`packages/sdk/src/wallet-onchain.ts`
  - 依赖：`ethers@v6`（peer dependency）
  - 实现方法：
    - `getBalance(address?)` → ClawToken.balanceOf()
    - `transfer(to, amount)` → ClawToken.transfer()
    - `createEscrow(id, beneficiary, arbiter, amount, expiresAt)` → approve + ClawEscrow.createEscrow()
    - `releaseEscrow(id)` → ClawEscrow.release()
    - `refundEscrow(id)` → ClawEscrow.refund()
    - `getEscrow(id)` → ClawEscrow.escrows(id)
    - `approveEscrow(amount)` / `escrowAllowance()`
  - 验收：SDK build 通过，现有 61 测试不受影响 ✅
  - 工时：3 天
  - 前置：T-1.16

- [x] **T-1.19** SDK 新增链上模式：IdentityOnChainApi
  - 文件：`packages/sdk/src/identity-onchain.ts`
  - 实现：
    - `register(didHash, publicKey, purpose?, evmAddress?)` → ClawIdentity.registerDID()
    - `rotateKey(didHash, newPublicKey, rotationProof?)` → ClawIdentity.rotateKey()
    - `resolve(didHash)` → isActive + getActiveKey + getController
    - `addPlatformLink(didHash, linkHash)` → ClawIdentity.addPlatformLink()
    - `revokeDID(didHash)` / `isActive()` / `getActiveKey()` / `getController()` / `getKeyRecord()` / `getPlatformLinks()` / `getDIDCount()`
  - 验收：SDK build 通过 ✅
  - 工时：2 天

- [x] **T-1.20** SDK ClawNet 入口适配
  - 修改 `packages/sdk/src/index.ts`：
    - 导出 WalletOnChainApi / IdentityOnChainApi / KeyPurpose / 相关类型
    - REST 模式（ClawNetClient）保持不变
    - 链上模式直接实例化 OnChainApi 类
  - 验收：SDK build 通过，现有 61 测试全部通过 ✅
  - 工时：1 天

- [x] **T-1.21** P0 集成测试
  - 文件：`test/integration/p0-onchain.test.ts`
  - 场景（24 用例，全部通过）：
    1. 部署全套 P0 合约 + 跨合约角色授予
    2. 注册 DID → 查询 controller / activeKey / didCount
    3. Mint 100,000 Token → 转账 10,000 → 验证余额
    4. 创建 escrow → 释放 → 验证余额变动
    5. 质押 → 查询状态 → 验证活跃列表 → 请求解押 → 冷却后解押
    6. 跨合约角色验证（MINTER_ROLE）
    7. 全周期：注册 Bob DID → Mint → 创建 escrow → Refund → Stake
  - 验收：224 passing (29s) — 200 单元测试 + 24 集成测试 ✅
  - 工时：2 天

### Phase 1 验收门槛

```
✅ ClawToken.sol 测试覆盖率 > 95%（100% Stmts, 100% Lines — 27 tests）
✅ ClawEscrow.sol 测试覆盖率 > 95%（100% Stmts, 98.84% Lines — 73 tests），包含重入防护测试
✅ ClawIdentity.sol 测试覆盖率 > 95%（100% Stmts, 100% Lines — 49 tests），DID 映射正确
✅ ClawStaking.sol 测试覆盖率 > 95%（51 tests），质押/slash 逻辑正确
✅ ClawNet Chain 测试网 9 个合约部署成功（与 T-2.18 合并一次性部署，地址见 deployments/clawnetTestnet.json）
✅ SDK onChain 模式可用（wallet + identity），ethers v6 peer dep，SDK build + 61 tests passing
✅ P0 集成测试全部通过（224 passing = 200 unit + 24 integration，29s）
✅ Slither v0.11.5 无 High/Medium 真实漏洞（4 Medium 为误报，详见 internal-audit-report.md）
```

---

## Phase 2 — P1 高级合约（2026 Q4 W1–W12，共 12 周）

> 目标：ClawDAO + ClawContracts + ClawReputation + ParamRegistry 完成开发，全部合约测试网部署，外部审计启动。

### Sprint 2-A：ParamRegistry.sol（W1）

- [x] **T-2.1** 实现 ParamRegistry.sol
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

- [x] **T-2.2** 编写 ParamRegistry 单元测试
  - 用例：设置/读取参数、批量设置、权限控制、20 个 key 常量、升级保留、边界值
  - 验收：35 个测试通过，覆盖率 > 95% ✅
  - 工时：1 天

- [x] **T-2.3** 重构 ClawEscrow / ClawStaking 接入 ParamRegistry
  - 新增 `setParamRegistry(address)` + 内部 getter 函数
  - Registry 设置时从 ParamRegistry 读取，回退到本地 storage
  - 验收：原有 124 测试全部通过 + 13 个集成测试通过 ✅
  - 全量 290 passing (34s)
  - 工时：1 天

### Sprint 2-B：ClawDAO.sol（W2–W5）

- [x] **T-2.4** 实现 ClawDAO.sol 核心逻辑  ✅ ~500 lines, split-struct, sqrt voting, EIP-191 multisig
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

- [x] **T-2.5** 实现 TimeLock 逻辑  ✅ 内嵌 ClawDAO (queue → timelock → execute)
  - 可内嵌 ClawDAO 或单独合约
  - 功能：延迟执行 + 取消
  - 工时：2 天

- [x] **T-2.6** 实现 EmergencyMultiSig 逻辑  ✅ 内嵌 ClawDAO, EIP-191 签名, 5/9 阈值
  - 9 个 signer 地址，5/9 阈值
  - 可内嵌或独立
  - 工时：2 天

- [x] **T-2.7** 编写 ClawDAO 单元测试  ✅ 59 tests passing
  - 用例清单：
    - [x] 提案创建（各类型）
    - [x] 提案门槛不足 revert
    - [x] 投票权重计算正确（多个场景）
    - [x] 投票 — 讨论期投票 revert / 投票期投票成功
    - [x] 投票 — 重复投票 revert
    - [x] 提案通过（forVotes > againstVotes + quorum 达标）
    - [x] 提案未通过
    - [x] 时间锁延迟执行
    - [x] 时间锁未到期执行 revert
    - [x] execute 调用目标合约的 callData
    - [x] 参数修改提案 e2e（propose → vote → queue → execute → 参数生效）
    - [x] 国库支出提案 e2e
    - [x] 紧急多签执行
    - [x] 闪电贷攻击防护（快照余额）
    - [x] 升级后状态保留
  - 验收：覆盖率 > 95%
  - 工时：5 天
  - 前置：T-2.4

- [x] **T-2.8** ClawDAO 部署脚本  ✅ deploy-dao.ts
  - 工时：1 天

### Sprint 2-C：ClawContracts.sol（W5–W8）

- [x] **T-2.9** 实现 ClawContracts.sol 核心逻辑 ✅
  - 功能：
    - `createContract(contractId, provider, totalAmount, termsHash, deadline, milestoneAmounts[], milestoneDeadlines[])`
      - 资金由 ClawContracts 直接托管（待 ClawEscrow 支持 partialRelease 后集成）
    - `signContract(contractId)` — 双方都签后 status → Signed
    - `activateContract(contractId)` — 签署 + 资金到位后 → Active
    - `submitMilestone(contractId, index, deliverableHash)`
    - `approveMilestone(contractId, index)` — 释放该里程碑资金
    - `rejectMilestone(contractId, index, reasonHash)`
    - `completeContract(contractId)` — 所有里程碑 Approved 后
    - `disputeContract(contractId, evidenceHash)`
    - `resolveDispute(contractId, resolution)` — FavorProvider/FavorClient/Resume
    - `terminateContract(contractId, reason)` — 双方协商或仲裁或超时后
    - `cancelContract(contractId)` — 签署前取消
  - 状态机严格校验（7 states × strict transitions）
  - 验收：合约编译通过 ✅
  - 工时：6 天
  - 前置：T-1.5

- [x] **T-2.10** 编写 ClawContracts 单元测试 ✅ (97 tests)
  - 用例清单：
    - [x] 创建合约（参数正确、事件、9 个边界 revert）
    - [x] 里程碑数量和金额之和 = totalAmount（6 个验证）
    - [x] 签署流程（单方签 → 双方签 → Signed，7 个用例）
    - [x] 激活（资金转移、fee 收取、6 个用例）
    - [x] 提交里程碑（仅 provider，含拒绝后重新提交）
    - [x] 批准里程碑（client / arbiter / ARBITER_ROLE）→ 资金释放
    - [x] 拒绝里程碑 + 事件
    - [x] 全部里程碑通过 → 合约完成
    - [x] 争议 → 仲裁（FavorProvider/FavorClient/Resume）
    - [x] 超时终止（任何人可触发）
    - [x] 签署前取消（Draft/Signed → Cancelled）
    - [x] 非法状态转换 revert（5 个场景）
    - [x] Full lifecycle E2E（2 个端到端场景）
    - [x] UUPS 升级后状态保留
    - [x] 边缘：单里程碑、零剩余、并发合约
  - 验收：97 tests passing ✅
  - 工时：5 天
  - 前置：T-2.9

### Sprint 2-D：ClawReputation.sol（W8–W9）

- [x] **T-2.11** 实现 ClawReputation.sol  ✅ 2025-07-22
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

- [x] **T-2.12** 编写 ClawReputation 单元测试  ✅ 59 tests
  - 用例：锚定、批量锚定、查询、epoch 递增、权限控制
  - 验收：覆盖率 > 95%
  - 工时：2 天

- [x] **T-2.13** 编写 Merkle 树工具  ✅ merkle-builder.ts
  - 文件：`packages/contracts/scripts/merkle-builder.ts`
  - 功能：给定评价列表 → 构建 Merkle 树 → 输出 root + proof
  - 验收：链下 proof → 链上验证通过
  - 工时：1.5 天

### Sprint 2-E：ClawRouter.sol + 跨模块集成（W9–W10）

- [x] **T-2.14** 实现 ClawRouter.sol ✅ ~220 lines, REGISTRAR_ROLE, 8 well-known keys, multicall/staticMulticall, batchRegister, UUPS
  - 功能：
    - 注册/查询各模块合约地址
    - 统一入口（可选，用于前端 multicall 便利）
  - 工时：1.5 天

- [x] **T-2.15** 跨模块集成测试 ✅ 5 scenarios, 15 tests passing, full E2E
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

- [x] **T-2.16** 权限矩阵验证测试 ✅ 36 tests, §11 matrix fully verified
  - 验证 on-chain-plan.md §11 权限矩阵中每个允许/禁止的调用
  - 工时：2 天

### Sprint 2-F：全量测试网部署 + SDK（W10–W11）

- [x] **T-2.17** 编写完整部署脚本 ✅ scripts/deploy-all.ts, 9 contracts in order, role grants, ParamRegistry defaults
  - 文件：`scripts/deploy-all.ts`
  - 按顺序部署 8 个合约 + 设置角色 + 初始化 ParamRegistry 默认参数
  - 输出：`deployments/<network>.json`
  - 工时：2 天

- [x] **T-2.18** ClawNet Chain 测试网全量部署  ✅ 9 contracts deployed to chainId 7625
  - 实际执行：在 Server A (66.94.125.242) 通过 localhost:8545 执行 `deploy-all.ts --network clawnetTestnet`
  - 部署结果（9 个合约，proxy + impl）：
    - ClawToken: `0xA98Cc076321aF8cC66A579b91643B5B98E316AA4`
    - ParamRegistry: `0x31cCc8480Ab7BCBd576a2B2b7203a58ee8494b16`
    - ClawEscrow: `0x5Ce7F1E92A65BeE1245dddbAC8e5F12bF79AC0F4`
    - ClawIdentity: `0xB59dEcd56C11a8a8F120ED7D9C3BAE16C5CA55E0`
    - ClawStaking: `0xbf3a9Cff2b37A7531c385A23288D73DbB4427dD2`
    - ClawReputation: `0x4358f0b43E6f88cbdfDc0055d56D17aF3d4FB343`
    - ClawDAO: `0xe3C7a659591EaA8E724505E00Bccbb743CB9948b`
    - ClawContracts: `0x8674249aC00a67b4B1F28475e46D043b50Ded028`
    - ClawRouter: `0x1dAC767bfaD7dBcD06ba52d1BB698429BbaFA11f`
  - 地址记录：`packages/contracts/deployments/clawnetTestnet.json`
  - 验收：9 个合约全部部署成功 ✅ + 角色授予 ✅ + ParamRegistry 初始化 ✅
  - 工时：0.5 天（与 T-1.17 合并）

- [x] **T-2.19** SDK 新增 DAO / Contracts / Reputation / Staking 链上适配 ✅ 4 adapters + readOnly + index exports
  - 新增文件：
    - `packages/sdk/src/dao-onchain.ts`
    - `packages/sdk/src/contracts-onchain.ts`
    - `packages/sdk/src/reputation-onchain.ts`
    - `packages/sdk/src/staking-onchain.ts`
  - 验收：SDK 完整 API onChain 模式可用
  - 工时：5 天

- [x] **T-2.20** CLI 新增链上命令 ✅ cli-onchain.ts, `clawnet onchain dao|stake|contract|reputation|balance`
  - 新增命令：
    - `claw dao propose / vote / execute`
    - `claw stake / unstake / claim-rewards`
    - `claw contract create / sign / milestone / complete`
  - 验收：CLI 命令可对测试网执行
  - 工时：3 天

### Sprint 2-G：安全审计准备（W11–W12）

- [x] **T-2.21** 内部安全审计  ✅ Slither v0.11.5: 0 High, 4 Medium(误报), 6 Low 已修复, 583 tests passing
  - 工具：Slither v0.11.5（Aderyn 不支持 Windows，Mythril 需 Docker — 建议 CI 中运行）
  - 修复内容：
    - `uninitialized-local`: ClawContracts `sum` 显式初始化为 0
    - `missing-zero-check`: ClawDAO `setReputationContract`/`setStakingContract` 添加零地址检查
    - `events-maths`: ClawDAO/ClawEscrow/ClawStaking initialize 添加参数事件
  - 4 个 Medium (`incorrect-equality`) 确认为误报 — 均为 `== 0` 零值检查
  - 17 个 Low（`timestamp` × 15 + `calls-loop` × 2）为设计如此
  - 产出：`docs/implementation/tasks/internal-audit-report.md`
  - 工时：0.5 天

- [x] **T-2.22** 编写审计文档包  ✅ 完整文档包（13 章 + 3 附录）
  - 产出：`docs/implementation/tasks/audit-documentation-pack.md`
    - 合约架构图（Mermaid）+ 依赖图 + 部署顺序
    - RBAC 权限矩阵（每合约角色 + 跨合约调用矩阵）
    - 完整接口规格（5 interface，全部函数签名）
    - 关键业务逻辑说明（Escrow/ServiceContract/DAO/Staking/Identity/Reputation）
    - 经济参数表（16 个可治理参数 + 默认值）
    - 已知风险（6 项）和设计取舍清单（6 项）
    - 升级安全说明
    - 测试覆盖率报告（583 tests, 96.95% stmts）
    - 构建运行指南 + 部署信息
    - 内部审计摘要引用
  - 工时：0.5 天

- [x] **T-2.23** 联系外部审计公司（并行）  ✅ GPT-5 AI 审计完成
  - 审计提示词：`docs/implementation/tasks/ai-audit-prompt.md`
  - 审计报告：`docs/implementation/tasks/external-audit-report-gpt5.md`
  - 方式：GPT-5 扮演外部审计公司，全量审计 9 合约

- [x] **T-2.24** Bug Bounty 计划准备  ✅ 完整 Bug Bounty 草案
  - 产出：`docs/implementation/tasks/bug-bounty-plan.md`
    - 4 级严重性 + 奖金等级（Critical $10K–$50K, High $5K–$10K, Medium $1K–$5K, Low $500–$1K）
    - 范围定义（9 合约 In Scope，SDK/Node/前端 Out of Scope）
    - 漏洞分类（Critical/High/Medium 优先级关注点）
    - 负责任披露规则 + 报告要求
    - 响应 SLA（24h 确认，3d 分级，7-14d 修复）
    - 法律安全港条款
    - 启动清单（Immunefi 注册、PGP 密钥、安全邮箱等）
    - 预算：$100K / 6 个月
  - 工时：0.3 天

### Phase 2 验收门槛

```
■ ClawDAO.sol 投票权重正确，全流程 e2e 通过（59 tests）
■ ClawContracts.sol 里程碑结算 + 争议仲裁测试通过（97 tests）
■ ClawReputation.sol 批量锚定 + Merkle 验证通过（59 tests）
■ ParamRegistry.sol DAO 修改参数 e2e 通过（35 tests）
■ ClawRouter.sol 模块注册正确
■ 全量跨模块集成测试通过（15 tests, 5 scenarios）
■ ClawNet Chain 测试网 9 个合约全部部署成功（chainId 7625, Geth v1.13.15 Clique PoA）
■ SDK + CLI 链上模式完整可用（4 adapters + CLI onchain commands）
■ Slither 无 High/Medium 真实漏洞（4 Medium 均为 == 0 误报，6 Low 已修复）
■ 审计文档包已完成（13 章 + 3 附录，可交付外部审计公司）
□ 外部审计公司已签约
```

---

## Phase 3 — 迁移与主网上线（2027 Q1 W1–W8，共 8 周）

> 目标：数据迁移、双轨运行、切换到链上为 source of truth、正式上线。

### Sprint 3-A：外部审计 + 修复（W1–W3）

- [x] **T-3.1** 配合外部审计  ✅ GPT-5 审计 10 项全部修复，583 tests passing
  - 审计报告：`docs/implementation/tasks/external-audit-report-gpt5.md`（10 findings: 1 Critical, 2 High, 4 Medium, 1 Low, 2 Info）
  - 修复内容（commit b3d4609）：
    - **C-01 Critical**: ClawToken 添加 ERC20VotesUpgradeable，ClawDAO.vote() 使用 getPastVotes(voter, snapshotBlock) 防闪电贷治理攻击
    - **H-01 High**: ClawIdentity.registerDID() 和 rotateKey() 添加 ECDSA 签名验证（proof-of-ownership）
    - **H-02 High**: ClawDAO 紧急多签阈值从 5/9 提升到 9/9
    - **M-01 Medium**: ClawEscrow 添加 disputeOpenedAt + forceResolveAfterTimeout()（7 天超时）
    - **M-02 Medium**: ClawEscrow.fund() 收取基于剩余持仓天数的增量费用
    - **M-03 Medium**: ClawRouter.multicall() 添加 MULTICALL_ROLE 权限门控
    - **M-04 Medium**: ClawDAO.setGovParams() 和 ParamRegistry._validateParamBounds() 添加参数边界校验
    - **I-01 Info**: ClawStaking 添加 getLockupMultiplier() 存根（返回 1x）
    - **I-02 Info**: security.md 文档更新，与代码变更对齐
  - 受影响合约：ClawToken, ClawDAO, ClawIdentity, ClawEscrow, ClawRouter, ParamRegistry, ClawStaking + 4 接口文件
  - 受影响测试：ClawDAO.test.ts, ClawEscrow.test.ts, ClawIdentity.test.ts + 3 集成测试文件
  - 验收：583 tests passing ✅，0 编译警告 ✅
  - 工时：2 天

- [x] **T-3.2** 审计报告公示  ✅ 已发布到 docs
  - 审计报告：`docs/implementation/tasks/external-audit-report-gpt5.md`（339 lines）
  - 工时：0.5 天

### Sprint 3-B：迁移工具开发（W2–W4）

- [x] **T-3.3** 编写余额快照导出工具  ✅
  - 文件：`scripts/snapshot-balances.ts`（155 行）
  - 功能：连接链下节点 SQLite → 导出所有 DID → 余额 JSON
  - 数据源：indexer.sqlite `did_cache` 表 + 链上 `token.balanceOf()`
  - 输出：`{ timestamp, network, chainId, entries: [{ didHash, controller, balance }], totalSupply, snapshotBalanceSum }`
  - 支持 BATCH_SIZE 并发查询、totalSupply 校验
  - 工时：1.5 天

- [x] **T-3.4** 编写余额迁移脚本  ✅
  - 文件：`scripts/migrate-balances.ts`（198 行）
  - 功能：
    1. 读取快照 JSON → 按地址去重
    2. 验证所有 DID 已在 ClawIdentity 注册（`getController(didHash)`）
    3. 逐地址 `ClawToken.mint(address, balance)`（deployer 需 MINTER_ROLE）
    4. 验证：链上 Δ totalSupply = 实际 mint 总量
  - 支持 DRY_RUN 模式、失败重试文件、migration receipt
  - 工时：2 天
  - 前置：T-3.3, T-1.12

- [x] **T-3.5** 编写 Escrow 迁移脚本  ✅
  - 文件：`scripts/migrate-escrows.ts`（240 行）
  - 功能：
    1. 导出 Active escrow（status=0）从 indexer.sqlite
    2. 读取链上 expiresAt 补充数据
    3. 临时将 escrow fee 设为 0 → 链上重建 → 恢复 fee
    4. 自动 mint + approve Token 给 deployer
  - 支持 EXPORT_ONLY / DRY_RUN 模式
  - 工时：1.5 天

- [x] **T-3.6** 编写合约迁移脚本  ✅
  - 文件：`scripts/migrate-contracts.ts`（290 行）
  - 功能：
    1. 导出 Signed/Active service contracts 从 indexer.sqlite
    2. 读取链上 milestone 数据
    3. 临时将 platformFeeBps 设为 0 → 链上重建 → 恢复 fee
    4. 自动 mint + approve Token 给 deployer
  - 支持 EXPORT_ONLY / DRY_RUN 模式
  - 工时：1.5 天

- [x] **T-3.7** 编写对账工具  ✅
  - 文件：`scripts/reconcile.ts`（310 行）
  - 功能：4 维对账
    1. DID 注册状态（链上 getController vs indexer did_cache）
    2. Token 余额（链上 balanceOf vs indexer 转账差额）
    3. Escrow 状态（链上 getEscrow vs indexer escrows）
    4. Service Contract 状态（链上 getContract vs indexer service_contracts）
  - 输出：JSON 差异报告 + 控制台摘要
  - 验收指标：全量对账 0 差异
  - 工时：2 天

### Sprint 3-C：Testnet 全业务验证（W2–W3）

- [ ] **T-3.8** Testnet 全场景集成测试
  - 在测试网（chainId 7625，3 台 Geth PoA + 3 台 ClawNet Node）上端到端跑通所有业务流程
  - 覆盖 `clawnet/scenarios/` 01–09 全部场景：
    1. Identity + Wallet（DID 注册、转账、余额查询）
    2. Info Market（信息市场发布、购买）
    3. Task Market（任务发布、申领、交付）
    4. Capability Market（能力市场）
    5. Service Contract（创建、签约、milestone、完成）
    6. Contract Dispute（争议、仲裁）
    7. DAO Governance（提案、投票、执行）
    8. Cross-node Sync（多节点 P2P 同步）
    9. Economic Cycle（完整经济循环）
  - 验收：全部 9 个场景通过，无链上异常
  - 工时：3 天

- [ ] **T-3.9** Testnet 稳定性观察
  - 持续运行 5–7 天，监控：
    - Geth 出块稳定（2s 间隔，无分叉）
    - Node REST API 响应正常
    - 链上交易成功率 100%
    - EventIndexer 索引无遗漏（indexer block == chain head）
    - P2P gossipsub 消息同步正常
  - 每日运行 `reconcile.ts`，确认链上链下 0 差异
  - 验收：连续 5 天无异常
  - 工时：5 天（含值班观察）

### Sprint 3-D：主网升级部署（W3–W4）

- [ ] **T-3.10** 主网基础设施准备
  - 操作：
    1. 确认外部审计报告无 Critical/High 未修复
    2. 准备主网 deployer 多签钱包（复用 `infra/testnet/multisig-soft-wallet/`）
    3. 准备 2 台新服务器环境（与现有 3 台一致：Geth v1.13.15 + Docker）
    4. 生成新 genesis.json（chainId 7626，5 Validator 地址）
    5. 配置 5 节点 Clique PoA 共识（3/5 签名出块）
  - 验收：5 台服务器就绪、genesis 配置确认
  - 工时：2 天

- [ ] **T-3.11** ClawNet 主网链启动
  - 操作：
    1. 5 台服务器初始化 Geth（`geth init genesis.json`）
    2. 配置 bootnodes + static-nodes.json
    3. 启动 Geth PoA 出块（`docker-compose.chain.yml`）
    4. 验证区块同步、Clique 签名轮转正常
    5. 配置 Caddy 反向代理（`rpc.clawnet.io` → 8545）
  - 验收：5 节点出块，区块高度一致，RPC 可达
  - 工时：1 天

- [ ] **T-3.12** 主网合约部署
  - 执行 `npx hardhat run scripts/deploy-all.ts --network clawnetMainnet`
  - 记录地址到 `deployments/clawnetMainnet.json`
  - 工时：0.5 天

- [ ] **T-3.13** 主网数据迁移
  - 步骤：
    1. 公告：暂停 testnet 高价值操作（维护窗口）
    2. Testnet 最终快照：`snapshot-balances.ts --network clawnetTestnet`
    3. DID 迁移：`migrate-identities.ts --network clawnetMainnet`
    4. 余额迁移：`migrate-balances.ts --network clawnetMainnet`
    5. Escrow 迁移：`migrate-escrows.ts --network clawnetMainnet`
    6. 合约迁移：`migrate-contracts.ts --network clawnetMainnet`
    7. 全量对账：`reconcile.ts --network clawnetMainnet`
  - 验收：对账 0 差异
  - 工时：1 天

- [ ] **T-3.14** 主网节点上线 + 切换
  - 操作：
    1. 5 台服务器部署 ClawNet Node（`packages/node`）
    2. 配置 `chain.rpcUrl` 指向主网 Geth（chainId 7626）
    3. 配置 `chain.contracts` 使用 `clawnetMainnet.json` 地址
    4. 测试网 3 台 Geth 停止出块（保留数据归档）
    5. DNS 切换：`rpc.clawnetd.com` → 主网 RPC
    6. 更新 SDK/CLI 默认 RPC 端点
  - 验收：5 节点主网运行，SDK/CLI 默认走主网
  - 工时：1 天

- [ ] **T-3.15** 发布公告 + 更新文档
  - 更新：README, QUICKSTART, DEPLOYMENT, SDK_GUIDE
  - 新增：MAINNET_MIGRATION.md（主网迁移记录）
  - 更新 `hardhat.config.ts` 主网配置
  - 工时：1 天

### Phase 3 验收门槛

```
■ 外部审计完成，所有 Critical/High 已修复（GPT-5 审计 10 findings 全部修复，583 tests passing）
■ 迁移工具开发完成：snapshot-balances / migrate-balances / migrate-escrows / migrate-contracts / reconcile（5 脚本共 ~1190 行）
□ Testnet 全场景（01–09）通过
□ Testnet 稳定运行 5 天，每日对账 0 差异
□ 主网 5 节点 Geth PoA 出块正常（chainId 7626）
□ 主网 9 个合约部署成功
□ 主网数据迁移完成，对账 0 差异
□ 5 台 ClawNet Node 主网运行
□ SDK + CLI 默认走主网
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
                      T-2.17(Deploy All)──────────────────┼──→ T-3.3 (快照工具)
                      T-2.21(内部审计)                     │    T-3.4 (迁移工具)
                                                           │
                                            T-3.8 (Testnet 全场景)──→ T-3.9 (稳定观察)
                                               │                           │
                                               └───────────────────────────┤
                                                                           ▼
                                            T-3.10(主网基础设施)──→ T-3.11(主网链启动)
                                               │                      │
                                               └──→ T-3.12(合约部署)──→ T-3.13(数据迁移)
                                                                           │
                                                                      T-3.14(节点切换)
                                                                           │
                                                                      T-3.15(文档发布)
```

---

## 附录：工时汇总

| Phase | 合约开发 | 测试 | 部署/脚本 | SDK/CLI | 审计/安全 | 迁移/运维 | 总计 |
|-------|---------|------|----------|---------|----------|----------|------|
| Phase 0 | 4d | — | 5d | — | — | — | **~12d** |
| Phase 1 | 13d | 13d | 4d | 6d | — | 1d | **~40d** |
| Phase 2 | 22d | 15d | 4d | 8d | 6d | — | **~55d** |
| Phase 3 | — | — | 3d | — | 持续 | 11.5d | **~17d** |
| **总计** | **39d** | **28d** | **16d** | **14d** | **6d+** | **12.5d** | **~124d** |

> 按 2 名合约工程师 + 2 名后端工程师并行，预计 8–9 个月完成全部 Phase。

---

*最后更新: 2026年2月25日*
*状态: Phase 0–2 全部完成。Phase 3 Sprint 3-A（审计修复 ✅）+ Sprint 3-B（迁移工具 ✅）已完成。下一步：Sprint 3-C Testnet 全业务验证 → Sprint 3-D 主网升级部署（testnet 3 台 + 2 台新服务器 → 5 节点主网 PoA）。*
