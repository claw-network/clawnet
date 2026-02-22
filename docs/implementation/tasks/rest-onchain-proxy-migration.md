# REST → On-Chain Proxy 迁移实施计划

> **状态**: Draft  
> **创建日期**: 2026-02-23  
> **目标**: 将 REST API 层改造为链上合约的薄代理（thin proxy），实现"真相在链上"的架构目标，同时保持对外 API 兼容性。

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [架构目标](#2-架构目标)
3. [当前架构分析](#3-当前架构分析)
4. [目标架构](#4-目标架构)
5. [模块逐一迁移方案](#5-模块逐一迁移方案)
6. [实施阶段](#6-实施阶段)
7. [SDK 改造](#7-sdk-改造)
8. [测试策略](#8-测试策略)
9. [迁移检查清单](#9-迁移检查清单)
10. [风险与缓解](#10-风险与缓解)
11. [不在范围内](#11-不在范围内)
12. [文档更新计划](#12-文档更新计划)

---

## 1. 背景与动机

当前 SDK (`packages/sdk/src`) 存在两套并行 API：

| 模式 | 实现方式 | 文件示例 |
|------|---------|---------|
| **REST（off-chain）** | 通过 `HttpClient` 调用节点 HTTP API（端口 9528） | `wallet.ts`, `identity.ts`, `dao.ts` 等 |
| **On-chain（已删除）** | 通过 `ethers.js` 直接调用 Solidity 智能合约 | ~~`wallet-onchain.ts`~~, ~~`identity-onchain.ts`~~ 等（已废弃删除） |

**问题**：
- 两套 API 方法签名不一致，维护成本高
- REST 模式下数据的真实性依赖于节点实现，缺乏链级信任
- Python SDK 和所有示例代码只覆盖 REST，无法享受链上保障
- 无法直接删除 REST（Markets、Node 等模块只有 REST，且批量查询依赖 REST）

**决策**：REST API 保留对外接口不变，内部实现改为调用链上合约。REST 成为链上合约的薄代理层。

---

## 2. 架构目标

- **G1 — 真相在链上**：所有写操作（转账、注册 DID、创建合约等）最终提交到链上合约
- **G2 — API 兼容**：`ClawNetClient` / Python `ClawNetClient` 的使用方式完全不变
- **G3 — 渐进迁移**：按模块逐步切换，每个模块独立可测试、可回滚
- **G4 — 保留 REST 查询优势**：批量列表/分页/历史记录等通过节点内 event indexer 提供，REST 继续提供这些链上合约无法高效支持的查询
- **G5 — SDK 只暴露 REST，链上逻辑下沉到 Node**：SDK 不包含任何链上合约调用类（`ethers.js` 不是 SDK 的依赖）。所有链上交互由 Node 服务层在内部完成——SDK 消费者只需调用 REST API，无感知底层是链上还是链下。已删除全部 6 个 `*-onchain.ts` 文件及 `cli-onchain.ts`。详见 [§7 SDK 清理](#7-sdk-清理)

---

## 3. 当前架构分析

### 3.1 文件映射

**SDK 当前状态**（已完成清理）：

| SDK REST 文件 | 说明 |
|--------------|------|
| `wallet.ts` | `WalletApi` — REST 客户端 |
| `identity.ts` | `IdentityApi` — REST 客户端 |
| `reputation.ts` | `ReputationApi` — REST 客户端 |
| `contracts.ts` | `ContractsApi` — REST 客户端 |
| `dao.ts` | `DaoApi` — REST 客户端 |
| `markets.ts` | `MarketsApi` — 纯 REST（无链上对应） |
| `node.ts` | `NodeApi` — 纯 REST（无链上对应） |

> 6 个 `*-onchain.ts` 文件及 `cli-onchain.ts` 已删除。链上合约交互由 Node 服务层（`packages/node/src/services/`）负责。

**Node 服务层（待新建）**：

| Node 服务文件 | 对应 Solidity 合约 | 说明 |
|--------------|-------------------|------|
| `services/wallet-service.ts` | `ClawToken.sol` + `ClawEscrow.sol` | REST 写路由 → 链上调用 |
| `services/identity-service.ts` | `ClawIdentity.sol` | REST 写路由 → 链上调用 |
| `services/reputation-service.ts` | `ClawReputation.sol` | REST 写路由 → 链上调用 |
| `services/contracts-service.ts` | `ClawContracts.sol` | REST 写路由 → 链上调用 |
| `services/dao-service.ts` | `ClawDAO.sol` | REST 写路由 → 链上调用 |
| `services/staking-service.ts` | `ClawStaking.sol` | REST 写路由 → 链上调用 |

### 3.2 各模块缺口总表

| 模块 | REST 独有功能（on-chain 缺失） | 需要的解决方案 |
|------|------|------|
| **Identity** | `listCapabilities()`, `registerCapability()` | 方案 A: 链上新合约; 方案 B: 链下 P2P 保留 |
| **Wallet** | `getHistory(...)`, `fundEscrow()`, `expireEscrow()` | event indexer + 补封装 |
| **Reputation** | `getReviews(did, {limit, offset})` — 分页列表 | event indexer |
| **Contracts** | `list({status, party, limit, offset})`, `settlement()` | event indexer + 评估 settle |
| **DAO** | `listProposals()`, `getVotes()` 批量, `delegate/revoke/getDelegations`, `getTreasury/deposit`, `listTimelock`, `getParams` | event indexer + 合约 ABI 扩展 |

---

## 4. 目标架构

```
┌─────────────────────────────────────────────────────┐
│                 外部调用者                            │
│  (SDK ClawNetClient / Python SDK / curl / Agent)     │
└───────────────────────┬─────────────────────────────┘
                        │  HTTP REST (端口 9528)
                        ▼
┌─────────────────────────────────────────────────────┐
│              Node REST API Layer                     │
│              (packages/node/src/api/server.ts)       │
│                                                     │
│  ┌─────────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ 写操作路由   │  │ 读操作路由 │  │ 纯 P2P 路由  │  │
│  │ POST /api/* │  │ GET /api/* │  │ Markets/Node │  │
│  └──────┬──────┘  └─────┬─────┘  └──────────────┘  │
│         │               │                           │
│         ▼               ▼                           │
│  ┌────────────┐  ┌─────────────┐                    │
│  │ Chain      │  │ Event       │                    │
│  │ Service    │  │ Indexer     │                    │
│  │ (ethers)   │  │ (本地 DB)   │                    │
│  └──────┬─────┘  └──────┬──────┘                    │
└─────────┼───────────────┼───────────────────────────┘
          │               │
          ▼               │ (监听链上 events 回填)
   ┌──────────────┐       │
   │  EVM Chain   │───────┘
   │  (Contracts) │
   └──────────────┘
```

### 4.1 核心原则

| 原则 | 说明 |
|------|------|
| **写操作 → 链上** | 所有 POST 端点内部调用 Node chain service（ethers.js），等待 tx receipt 后返回 |
| **读操作 → indexer 优先，链上兜底** | `GET /api/wallet/balance` 可直接调链上 view；分页/列表类走 indexer |
| **Event indexer 是节点内部组件** | 监听链上 events，写入本地 SQLite/LevelDB，为 REST 查询提供分页能力 |
| **SDK 不变** | `HttpClient` + `*Api` 类保持不变，消费者无感知。SDK 不包含任何 ethers.js 依赖 |

---

## 5. 模块逐一迁移方案

### 5.1 Identity 模块

#### 写操作迁移

| REST 端点 | 当前实现 | 迁移后实现 |
|-----------|---------|-----------|
| `POST /api/identity` (注册) | 节点本地创建 event → P2P 广播 | Node `IdentityService` 调用 `ClawIdentity.registerDID()` → 返回 txHash |

#### 读操作迁移

| REST 端点 | 迁移后实现 |
|-----------|-----------|
| `GET /api/identity` | 链上 `getActiveKey()` + `getController()` 组合 |
| `GET /api/identity/:did` | 链上 `resolve()` — Node `IdentityService` 调用 |
| `GET /api/identity/capabilities` | **保留 P2P/链下** — Capability 是 Verifiable Credential，不适合全量上链 |
| `POST /api/identity/capabilities` | **保留 P2P/链下** |

#### 待实施项

- [ ] **Node 层**: 在 `packages/node/src/api/server.ts` 中，identity 写操作路由内部调用 `IdentityService`（ethers.js → `ClawIdentity.sol`）
- [ ] **Capability 决策**: Capability 凭证保持链下 P2P 存储，不迁移到链上（体量大、更新频繁，不适合链上存储）
- [ ] **Indexer**: 监听 `DIDRegistered`, `KeyRotated`, `DIDRevoked` 事件，维护本地 DID 缓存

---

### 5.2 Wallet 模块

#### 写操作迁移

| REST 端点 | 迁移后实现 |
|-----------|-----------|
| `POST /api/wallet/transfer` | Node `WalletService` 调用 `ClawToken.transfer()` |
| `POST /api/wallet/escrow` | Node `WalletService` 调用 `ClawEscrow.createEscrow()` |
| `POST /api/wallet/escrow/:id/release` | Node `WalletService` 调用 `ClawEscrow.release()` |
| `POST /api/wallet/escrow/:id/fund` | Node `WalletService` 调用 `ClawEscrow.fund()` |
| `POST /api/wallet/escrow/:id/refund` | Node `WalletService` 调用 `ClawEscrow.refund()` |
| `POST /api/wallet/escrow/:id/expire` | Node `WalletService` 调用 `ClawEscrow.expire()` |

#### 读操作迁移

| REST 端点 | 迁移后实现 |
|-----------|-----------|
| `GET /api/wallet/balance` | **链上直接调用** `ClawToken.balanceOf()` |
| `GET /api/wallet/balance?did=xxx` | 需要 DID → address 映射（通过 `ClawIdentity.getController()` 解析） |
| `GET /api/wallet/history` | **Event indexer** — 监听 `Transfer` events 建立本地交易历史表 |
| `GET /api/wallet/escrow/:id` | **链上直接调用** `ClawEscrow.escrows()` |

#### 待实施项

- [ ] **Node `WalletService`**: 实现全部钱包写操作（transfer, escrow CRUD），包括 `fundEscrow()` 和 `expireEscrow()`
- [ ] **Node 层**: balance 查询增加 DID → address 解析逻辑 (`did` 参数通过 `ClawIdentity.getController()` 转换为 `address`)
- [ ] **Indexer**: 监听 `Transfer`, `EscrowCreated`, `EscrowReleased`, `EscrowRefunded`, `EscrowExpired` 事件

---

### 5.3 Reputation 模块

#### 写操作迁移

| REST 端点 | 迁移后实现 |
|-----------|-----------|
| `POST /api/reputation/record` | `ClawReputation.recordReview()` + `anchorReputation()` |

#### 读操作迁移

| REST 端点 | 迁移后实现 |
|-----------|-----------|
| `GET /api/reputation/:did` | 链上 `getReputation()` + `getLatestSnapshot()` 组合 |
| `GET /api/reputation/:did/reviews` | **Event indexer** — 监听 `ReviewRecorded` 事件建立 review 列表 |

#### 待实施项

- [ ] **Node `ReputationService`**: record 路由调用 `ClawReputation.recordReview()` + `anchorReputation()`
- [ ] **Indexer**: 监听 `ReputationAnchored`, `ReviewRecorded` 事件，维护可搜索的 review 列表
- [ ] **Indexer 查询**: 支持按 `subjectDIDHash` 分页查询 reviews

---

### 5.4 Contracts（服务合约）模块

#### 写操作迁移

| REST 端点 | 迁移后实现 |
|-----------|-----------|
| `POST /api/contracts` | Node `ContractsService` 调用 `ClawContracts.createContract()` |
| `POST /api/contracts/:id/sign` | Node `ContractsService` 调用 `ClawContracts.signContract()` |
| `POST /api/contracts/:id/fund` | Node `ContractsService` 调用 `ClawContracts.activateContract()` (含 token approve) |
| `POST /api/contracts/:id/complete` | Node `ContractsService` 调用 `ClawContracts.completeContract()` |
| `POST /api/contracts/:id/milestones/:mid/complete` | Node `ContractsService` 调用 `ClawContracts.submitMilestone()` |
| `POST /api/contracts/:id/milestones/:mid/approve` | Node `ContractsService` 调用 `ClawContracts.approveMilestone()` |
| `POST /api/contracts/:id/milestones/:mid/reject` | Node `ContractsService` 调用 `ClawContracts.rejectMilestone()` |
| `POST /api/contracts/:id/dispute` | Node `ContractsService` 调用 `ClawContracts.disputeContract()` |
| `POST /api/contracts/:id/dispute/resolve` | Node `ContractsService` 调用 `ClawContracts.resolveDispute()` |
| `POST /api/contracts/:id/settlement` | **评估**: 可能由 `completeContract` 隐含，或需在 Solidity 合约中新增 |

#### 读操作迁移

| REST 端点 | 迁移后实现 |
|-----------|-----------|
| `GET /api/contracts/:id` | 链上 `getContract()` + `getMilestones()` |
| `GET /api/contracts?status=&party=` | **Event indexer** — 监听 `ContractCreated`, `ContractStatusChanged` 事件 |

#### 待实施项

- [ ] **评估 `settlement`**: 确认 `ClawContracts.sol` 是否有独立 settle 方法，或由 `completeContract` 自动处理
- [ ] **Indexer**: 监听合约生命周期事件，建立可筛选的合约列表
- [ ] **Indexer 查询**: 支持 `status`, `party` 筛选 + `limit/offset` 分页

---

### 5.5 DAO 模块

#### 写操作迁移

| REST 端点 | 迁移后实现 |
|-----------|-----------|
| `POST /api/dao/proposals` | Node `DaoService` 调用 `ClawDAO.propose()` |
| `POST /api/dao/proposals/:id/advance` | Node `DaoService` 映射到 `queue()` 或 `execute()` (根据 target status) |
| `POST /api/dao/vote` | Node `DaoService` 调用 `ClawDAO.vote()` |
| `POST /api/dao/delegate` | **需在 Solidity 合约中新增 delegation 功能，或使用 ERC-20 votes 的 `delegate()`** |
| `POST /api/dao/delegate/revoke` | 同上 |
| `POST /api/dao/treasury/deposit` | **需评估是否通过 ClawToken.transfer() 到 DAO 地址实现** |
| `POST /api/dao/timelock/:id/execute` | Node `DaoService` 调用 `ClawDAO.execute()` |
| `POST /api/dao/timelock/:id/cancel` | Node `DaoService` 调用 `ClawDAO.cancel()` |

#### 读操作迁移

| REST 端点 | 迁移后实现 |
|-----------|-----------|
| `GET /api/dao/proposals` | **Indexer** — 监听 `ProposalCreated` 事件 |
| `GET /api/dao/proposals/:id` | 链上 `getProposal()` |
| `GET /api/dao/proposals/:id/votes` | **Indexer** — 监听 `VoteCast` 事件聚合 |
| `GET /api/dao/delegations/:did` | **需新增**: 链上 or indexer |
| `GET /api/dao/treasury` | 链上 `ClawToken.balanceOf(daoAddress)` + indexer 历史 |
| `GET /api/dao/timelock` | **Indexer** — 监听 `ProposalQueued` 事件 |
| `GET /api/dao/params` | **需新增**: Solidity view 函数 or `ParamRegistry.sol` |

#### 待实施项

- [ ] **Solidity 评估**: `ClawDAO.sol` 是否已有 delegation 逻辑；如果没有，需新增 `delegate(address)` + `undelegate()` + `getDelegatee()` 方法
- [ ] **Solidity 评估**: `ParamRegistry.sol` 是否已暴露 DAO 治理参数的 view 函数
- [ ] **Node `DaoService`**: 新增 `advanceProposal()` 适配方法（内部判断 status → 调 `queue()` 或 `execute()`）
- [ ] **Indexer**: 监听 `ProposalCreated`, `VoteCast`, `ProposalQueued`, `ProposalExecuted` 事件

---

## 6. 实施阶段

### Phase 0 — 基础设施搭建 (Week 1-2)

| 任务 | 文件/包 | 说明 |
|------|--------|------|
| **P0.0** SDK 清理（已完成 ✅） | `packages/sdk/src/` | 删除 6 个 `*-onchain.ts` 文件及 `cli-onchain.ts`；清除 `index.ts` 中 on-chain 导出；移除 `cli.ts` 中 `onchain` 子命令。详见 [§7 SDK 清理](#7-sdk-清理) |
| **P0.1** 设计 Node 层 chain service 抽象 | `packages/node/src/services/` | 创建 `ChainProvider` 抽象类/接口，封装 ethers Provider + Signer 管理 |
| **P0.2** 配置管理 | `packages/node/src/config.ts` | 新增链上配置项：RPC URL、合约地址表、Signer 密钥路径 |
| **P0.3** Event Indexer 核心 | `packages/node/src/indexer/` | 实现基于 ethers.js `provider.on('block', ...)` 的事件监听 + SQLite 存储 |
| **P0.4** Indexer 通用查询 | `packages/node/src/indexer/query.ts` | 分页、筛选的通用查询层 |

#### 配置文件格式（新增）

```yaml
# clawnetd.yaml
chain:
  rpcUrl: "https://rpc.clawnetd.com"
  chainId: 31337
  contracts:
    token: "0x..."
    escrow: "0x..."
    identity: "0x..."
    reputation: "0x..."
    contracts: "0x..."
    dao: "0x..."
    staking: "0x..."
    paramRegistry: "0x..."
  signer:
    # 节点用于签名链上交易的方式
    type: "keyfile"  # keyfile | env | hardware
    path: "./keystore/node-key.json"
```

#### Event Indexer 存储 Schema（初始设计）

```sql
-- 通用事件表
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  block       INTEGER NOT NULL,
  tx_hash     TEXT NOT NULL,
  log_index   INTEGER NOT NULL,
  contract    TEXT NOT NULL,      -- 合约地址
  event_name  TEXT NOT NULL,      -- 事件名称
  args        TEXT NOT NULL,      -- JSON-encoded 参数
  timestamp   INTEGER NOT NULL,   -- 区块时间戳
  UNIQUE(tx_hash, log_index)
);

-- Wallet 交易历史视图
CREATE TABLE wallet_transfers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  block       INTEGER NOT NULL,
  tx_hash     TEXT NOT NULL,
  from_addr   TEXT NOT NULL,
  to_addr     TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  timestamp   INTEGER NOT NULL
);

-- Contracts 列表
CREATE TABLE service_contracts (
  contract_id TEXT PRIMARY KEY,
  client      TEXT NOT NULL,
  provider    TEXT NOT NULL,
  status      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- DAO Proposals
CREATE TABLE proposals (
  proposal_id INTEGER PRIMARY KEY,
  proposer    TEXT NOT NULL,
  p_type      INTEGER NOT NULL,
  status      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- DAO Votes
CREATE TABLE votes (
  proposal_id INTEGER NOT NULL,
  voter       TEXT NOT NULL,
  support     INTEGER NOT NULL,
  weight      TEXT NOT NULL,
  timestamp   INTEGER NOT NULL,
  PRIMARY KEY(proposal_id, voter)
);

-- Reputation Reviews
CREATE TABLE reviews (
  review_hash      TEXT PRIMARY KEY,
  reviewer_did     TEXT NOT NULL,
  subject_did      TEXT NOT NULL,
  related_tx_hash  TEXT NOT NULL,
  timestamp        INTEGER NOT NULL
);
```

---

### Phase 1 — Wallet 模块迁移 (Week 3-4)

Wallet 是最核心、最简单的模块，先迁移可以建立信心和模式。

| 任务 | 说明 |
|------|------|
| **P1.1** Node `WalletService` 实现 | 实现全部钱包写操作（transfer, escrow CRUD），直接通过 ethers.js 调用 `ClawToken.sol` / `ClawEscrow.sol` |
| **P1.2** Node wallet 路由改造 | `POST /api/wallet/transfer` 内部调用 `WalletService.transfer()` |
| **P1.3** Node escrow 路由改造 | 所有 escrow POST 路由调用 `WalletService.*` |
| **P1.4** Balance 读操作改造 | `GET /api/wallet/balance` 调用 `ClawToken.balanceOf()`；DID 参数通过 `ClawIdentity.getController()` 解析 |
| **P1.5** History indexer | 实现 `Transfer` event 监听 → `wallet_transfers` 表 |
| **P1.6** History 查询路由 | `GET /api/wallet/history` 从 indexer 查询 |
| **P1.7** 集成测试 | 端到端：SDK → REST → 链上合约 → indexer → 查询验证 |

---

### Phase 2 — Identity 模块迁移 (Week 5-6)

| 任务 | 说明 |
|------|------|
| **P2.1** Node identity 写路由改造 | 注册/密钥轮换/吊销操作调用 Node `IdentityService`（ethers.js → `ClawIdentity.sol`） |
| **P2.2** Identity 读操作改造 | `resolve()` 调链上 `getActiveKey()` + `getController()` |
| **P2.3** Capability 保留 | Capability CRUD 路由保持现有 P2P/链下逻辑不变 |
| **P2.4** DID indexer | 监听 `DIDRegistered`, `KeyRotated`, `DIDRevoked` → 本地 DID 缓存 |
| **P2.5** 集成测试 | |

---

### Phase 3 — Reputation 模块迁移 (Week 7-8)

| 任务 | 说明 |
|------|------|
| **P3.1** Node reputation 写路由改造 | `record` 路由调用 Node `ReputationService`（ethers.js → `ClawReputation.sol`） |
| **P3.2** Profile 读操作 | `getProfile` 调链上 `getReputation()` + `getLatestSnapshot()` |
| **P3.3** Reviews indexer | 监听 `ReviewRecorded` → `reviews` 表 |
| **P3.4** Reviews 分页查询 | `GET /api/reputation/:did/reviews` 从 indexer 按 `subject_did` 分页返回 |
| **P3.5** 集成测试 | |

---

### Phase 4 — Contracts 模块迁移 (Week 9-10)

| 任务 | 说明 |
|------|------|
| **P4.1** 评估 `settlement` | 确认 `ClawContracts.sol` 中 settle 逻辑 → 决定是否需新增合约方法 |
| **P4.2** Node contracts 写路由改造 | 所有生命周期/里程碑/争议路由调用 Node `ContractsService`（ethers.js → `ClawContracts.sol`） |
| **P4.3** 单合约读操作 | `GET /api/contracts/:id` 调链上 `getContract()` + `getMilestones()` |
| **P4.4** Contracts indexer | 监听合约生命周期事件 → `service_contracts` 表 |
| **P4.5** 列表查询 | `GET /api/contracts` 从 indexer 支持 `status/party/limit/offset` |
| **P4.6** 集成测试 | |

---

### Phase 5 — DAO 模块迁移 (Week 11-13)

DAO 是最复杂的模块，需要先确认 Solidity 合约是否支持 delegation 等特性。

| 任务 | 说明 |
|------|------|
| **P5.1** Solidity 审计 | 审计 `ClawDAO.sol` + `ParamRegistry.sol`，确认 delegation / treasury / params 的实现状态 |
| **P5.2** 合约补齐（如需要） | 若 delegation 缺失 → 在 `ClawDAO.sol` 新增 `delegate()`/`undelegate()`；或考虑 OpenZeppelin `ERC20Votes` 模式 |
| **P5.3** Node `DaoService` 扩展 | 新增 `advanceProposal()` 适配（status → queue/execute 映射） |
| **P5.4** Node DAO 写路由改造 | proposals/vote/delegation/treasury/timelock 路由改调链上 |
| **P5.5** DAO indexer | 监听所有 DAO events → `proposals` + `votes` 表 |
| **P5.6** 列表 / 聚合查询 | proposals 列表、votes 聚合、delegations 查询从 indexer 读取 |
| **P5.7** Treasury 读操作 | `GET /api/dao/treasury` = `ClawToken.balanceOf(daoAddress)` + indexer 历史 |
| **P5.8** Params 读操作 | `GET /api/dao/params` = `ParamRegistry` view functions |
| **P5.9** 集成测试 | |

---

### Phase 6 — 清理与收尾 (Week 14-15)

| 任务 | 说明 |
|------|------|
| **P6.1** 文档更新 | 按 [§12 文档更新计划](#12-文档更新计划) 中的完整清单逐一更新所有受影响文档 |
| **P6.2** Examples 更新 | 示例代码无需改动（REST 接口没变），但更新注释说明底层走链上 |
| **P6.3** Python SDK | 无需改动（REST 接口不变） |
| **P6.4** CI/CD | 集成测试中加入链上回归测试 (hardhat local node) |
| **P6.5** 性能基准 | 所有迁移后的路由做延迟/吞吐量基准测试，与迁移前对比 |

---

## 7. SDK 清理

既然 REST API 是链上合约的薄代理，SDK 只需 REST 客户端类——所有链上合约交互由 Node 服务层在内部完成。SDK 不再包含 `ethers.js` 依赖或任何直接的合约调用代码。

### 7.1 已删除文件（✅ 已完成）

| 已删除的 SDK 文件 | 原导出 | 说明 |
|------------------|--------|------|
| `wallet-onchain.ts` | `WalletOnChainApi`, `OnChainWalletConfig` | 链上逻辑移至 Node `WalletService` |
| `identity-onchain.ts` | `IdentityOnChainApi`, `OnChainIdentityConfig`, `KeyPurpose` 等 | 链上逻辑移至 Node `IdentityService` |
| `reputation-onchain.ts` | `ReputationOnChainApi`, `OnChainReputationConfig`, `ReputationDimension` 等 | 链上逻辑移至 Node `ReputationService` |
| `contracts-onchain.ts` | `ContractsOnChainApi`, `OnChainContractsConfig`, `ContractStatus` 等 | 链上逻辑移至 Node `ContractsService` |
| `dao-onchain.ts` | `DaoOnChainApi`, `OnChainDaoConfig`, `ProposalType` 等 | 链上逻辑移至 Node `DaoService` |
| `staking-onchain.ts` | `StakingOnChainApi`, `OnChainStakingConfig`, `NodeType` 等 | 链上逻辑移至 Node `StakingService` |

### 7.2 已删除 CLI 文件（✅ 已完成）

| 已删除文件 | 说明 |
|-----------|------|
| `cli-onchain.ts` | `clawnet onchain` 子命令已移除；所有操作通过 REST CLI 命令完成 |

`cli.ts` 中的 `onchain` 子命令分发和帮助文本已同步清除。

### 7.3 index.ts 清理（✅ 已完成）

移除了全部 on-chain API 导出（原 37 行 re-export），更新 JSDoc 模块文档。

**清理后的 index.ts 导出结构**：
```typescript
// ── REST APIs ────────────────────────────────────────────────────────────
export { HttpClient, HttpClientConfig, RequestOptions, ClawNetError } from './http.js';
export { NodeApi } from './node.js';
export { IdentityApi } from './identity.js';
export { WalletApi } from './wallet.js';
export { ReputationApi } from './reputation.js';
export { MarketsApi, ... } from './markets.js';
export { ContractsApi } from './contracts.js';
export { DaoApi } from './dao.js';

// ── Shared types ─────────────────────────────────────────────────────────
export * from './types.js';
```

> `types.ts` 已包含所有域类型的 REST 友好定义（字符串联合类型而非数字枚举），如 `ContractStatus`, `DaoProposalType`, `DaoProposalStatus`, `DaoVoteOption` 等。原 onchain 文件中的数字枚举是 Solidity ABI 特定的，SDK 消费者不需要。

### 7.4 SDK 保留部分（无需改动）

- `WalletApi`, `IdentityApi`, `ReputationApi`, `ContractsApi`, `DaoApi` — REST 客户端
- `MarketsApi` — 纯 REST（无链上对应）
- `NodeApi` — 纯 REST（无链上对应）
- `HttpClient`, `ClawNetClient` — 基础设施
- `types.ts` — 全部共享类型

---

## 8. 测试策略

### 8.1 单元测试

| 层 | 测试重点 | 工具 |
|----|---------|------|
| SDK REST 类 | HTTP mock → 验证请求格式和响应解析 | vitest + MSW 或手写 mock（现有测试保留） |
| Node chain service | ethers mock → 验证合约调用参数 | vitest + hardhat ethers mock |
| Node 路由 | 路由 → chain service mock → 验证转发逻辑 | vitest |
| Indexer | 模拟 events → 验证 DB 写入和查询 | vitest + in-memory SQLite |

### 8.2 集成测试

```
Hardhat Local Node (chainId 31337)
      ↑
  部署全套合约 (ClawToken, ClawEscrow, ClawIdentity, ...)
      ↑
  启动 clawnetd (连接 hardhat RPC)
      ↑
  SDK ClawNetClient → REST → Node → 链上合约 → Indexer → 查询验证
```

每个 Phase 完成后运行对应模块的集成测试。

### 8.3 现有测试迁移

| 现有测试文件 | 处理方式 |
|-------------|---------|
| `test/wallet.test.ts` | **保留** — 测试 SDK REST 层的 HTTP 封装逻辑 |
| `test/identity.test.ts` | **保留** |
| `test/reputation.test.ts` | **保留** |
| `test/contracts.test.ts` | **保留** |
| `test/markets.test.ts` | **保留** — Markets 不涉及此次迁移 |
| `test/node.test.ts` | **保留** — Node 不涉及此次迁移 |
| `test/http.test.ts` | **保留** |
| *(Node 新增)* `test/services/*.test.ts` | **新增** — Node chain service 的单元测试 |
| *(Node 新增)* `test/integration/chain-*.test.ts` | **新增** — REST → 链上全链路集成测试 |

---

## 9. 迁移检查清单

每个模块迁移完成后，需满足以下所有条件：

- [ ] 所有 POST（写操作）路由内部调用链上合约
- [ ] 所有 GET（读操作）路由从链上 view 或 indexer 获取数据
- [ ] REST 接口的请求/响应格式与迁移前**完全一致**（JSON schema 不变）
- [ ] 现有 SDK 单元测试全部通过
- [ ] 新增 Node chain service 单元测试覆盖所有新逻辑
- [ ] 集成测试通过（SDK → REST → 链 → 查询完整链路）
- [ ] `clawnet/scenarios/` 中对应场景测试通过
- [ ] 无 TypeScript 编译错误
- [ ] 无 ESLint 警告

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **链上交易延迟** | REST 响应时间从 <50ms 变为 ~2-15s（等 tx receipt） | 提供 async 模式：POST 立即返回 txHash，GET `/api/tx/:hash/status` 查询结果；或使用本地 hardhat/anvil 快速出块 |
| **Indexer 数据滞后** | 批量查询结果可能落后最新区块 1-2 块 | 返回 `lastIndexedBlock` 字段，SDK 可选择等待 indexer 同步 |
| **Signer 密钥管理** | 节点需要持有链上交易签名密钥 | 支持 keyfile / 环境变量 / KMS 多种模式，生产环境推荐 KMS |
| **Gas 费用** | 每笔写操作产生 gas 费 | 评估 L2 部署（如 Arbitrum/Base），或使用 gasless relay (ERC-2771) |
| **合约升级** | 合约 ABI 变化可能导致 SDK 不兼容 | 使用 UUPS 代理模式（当前已在用），ABI 向后兼容 |
| **事件重组 (reorg)** | Indexer 可能索引到被回滚的事件 | Indexer 维护 `finalized` 标记，12 个区块确认后才标记 finalized |

---

## 11. 不在范围内

以下内容**不在本次迁移范围内**，保持现有实现不变：

| 模块/功能 | 原因 |
|-----------|------|
| **Markets** (`markets.ts`) | 纯 P2P 链下逻辑，无对应链上合约 |
| **Node** (`node.ts`) | P2P 网络层，不涉及链上状态 |
| **Staking** | 已经只有 on-chain 实现，无需迁移 |
| **Python SDK** (`sdk-python`) | REST 接口不变，Python SDK 自动兼容 |
| **CLI** (`packages/cli`) | 通过 REST 调用，无需改动 |
| **Identity Capabilities** | 保持链下 P2P 存储 |

---

## 12. 文档更新计划

本次迁移影响 **27 份文档**，按优先级分为 P0（必须在对应 Phase 完成时同步更新）、P1（在模块迁移或 Phase 6 收尾期更新）、P2（可延后到下一迭代）三档。

### 12.1 影响总览

| # | 文件 | 优先级 | 影响程度 | 对应 Phase | 主要变更原因 |
|---|------|:------:|:--------:|:----------:|-------------|
| 1 | `docs/implementation/protocol-spec.md` | **P0** | 重大 | Phase 0 | 系统模型从纯 event-sourced → 链上混合；finality / validation / reducer 机制变更 |
| 2 | `docs/implementation/storage-spec.md` | **P0** | 重大 | Phase 0 | 新增 Event Indexer (SQLite)；LevelDB 从 source of truth 降为缓存 |
| 3 | `docs/implementation/security.md` | **P0** | 重大 | Phase 0 | 新增智能合约威胁面（重入、闪电贷、合约升级等） |
| 4 | `docs/implementation/testing-plan.md` | **P0** | 重大 | Phase 0 | 新增合约测试、Indexer 测试、链上集成测试 |
| 5 | `docs/implementation/rollout.md` | **P0** | 重大 | Phase 0 | 新增链部署阶段、合约部署、数据迁移 |
| 6 | `docs/implementation/economics.md` | **P1** | 中等 | Phase 1 | 费用 / 奖励机制改为链上执行；需说明 gas 费与协议费关系 |
| 7 | `docs/implementation/on-chain-plan.md` | **P1** | 中等 | Phase 0 | 架构图缺少 REST 薄代理模式和 Indexer；SDK 双模式策略需与本计划对齐 |
| 8 | `docs/implementation/README.md` | **P1** | 中等 | Phase 0 | 索引需新增迁移任务引用；Review Checklist 需修正 P2P 重建状态的表述 |
| 9 | `docs/ARCHITECTURE.md` | **P1** | 重大 | Phase 6 | 核心架构图、数据流图、技术栈表、去中心化路线图均需修订 |
| 10 | `docs/IMPLEMENTATION.md` | **P1** | 中高 | Phase 6 | 组件架构新增 On-Chain Service + Indexer；依赖关系图 / 代码结构需更新 |
| 11 | `docs/DECENTRALIZATION.md` | **P1** | 中高 | Phase 6 | 五阶段去中心化路线图提前；数据层架构从 IPFS → EVM Chain |
| 12 | `docs/DEPLOYMENT.md` | **P1** | 中高 | Phase 6 | 新增链配置、Docker 环境变量、生产安全、Indexer 存储、故障排查 |
| 13 | `docs/WALLET.md` | **P1** | 中等 | Phase 1 | 架构层引入 EVM Chain；交易 / Escrow 状态映射到链上 |
| 14 | `docs/SERVICE_CONTRACTS.md` | **P1** | 中等 | Phase 4 | 合约生命周期由 ClawContracts.sol 在链上执行 |
| 15 | `docs/DAO.md` | **P1** | 中等 | Phase 5 | Proposals / 投票 / 国库 / 委托 / 参数全部改为链上 |
| 16 | `docs/FAQ.md` | **P1** | 中等 | Phase 6 | "Is ClawNet a blockchain?" 回答需修正；共识、数据库、Escrow 描述变更 |
| 17 | `docs/API_REFERENCE.md` | **P1** | 中等 | Phase 6 | 延迟说明、txHash 语义、`source` 参数、新增字段 |
| 18 | `docs/AGENT_RUNTIME.md` | **P1** | 中等 | Phase 6 | 架构图缺少链层；配置文件缺少 `chain:` 区块 |
| 19 | `docs/IDENTITY.md` | **P2** | 中低 | Phase 2 | DID 注册改为链上；Capabilities 保持链下（需明确说明） |
| 20 | `docs/REPUTATION.md` | **P2** | 中低 | Phase 3 | record / anchor 改为链上；Review 存储改为 Indexer |
| 21 | `docs/SDK_GUIDE.md` | **P2** | 低中 | Phase 6 | 添加薄代理架构说明；文档化新错误码 |
| 22 | `docs/QUICKSTART.md` | **P2** | 低中 | Phase 6 | 守护进程启动需链配置；状态响应新增链相关字段 |
| 23 | `docs/OPENCLAW_INTEGRATION.md` | **P2** | 低中 | Phase 6 | 部署架构图缺少链层 |
| 24 | `docs/SMART_CONTRACTS.md` | **P2** | 中等 | Phase 4 | 协议内合约逻辑现由 Solidity 执行；代码示例需更新 |
| 25 | `docs/DOCS_INVENTORY.md` | **P2** | 低 | Phase 6 | 新增本迁移任务文档条目 |
| 26 | `docs/api/openapi.yaml` | **P2** | 低 | Phase 6 | `blockHeight` 语义说明；write 响应 txHash 为 EVM 交易哈希 |
| 27 | `packages/sdk/README.md` | **P2** | 低 | Phase 6 | 可选：添加链上结算说明 |

### 12.2 P0 文档——逐项变更详情

以下 5 份文档属于 **Spec Freeze 范围内的规范文件**，必须在 Phase 0 基础设施搭建时同步更新，否则后续实施会与规范矛盾。

#### 12.2.1 `docs/implementation/protocol-spec.md`

| 章节 | 当前描述 | 需变更为 |
|------|---------|----------|
| §1 System Model | "The protocol is event-sourced. Nodes store an append-only event log and derive state via deterministic reducers." | 新增"混合模型"段落：链上模块 (Wallet / Identity / Reputation / Contracts / DAO) 以 EVM 链为 state source of truth；链下模块 (Markets / Node) 保持 event-sourced P2P 模型 |
| §5 Event Envelope | 所有操作均产生 protocol event | 区分：写操作现产生 EVM 交易（非 protocol event）；event envelope 仅用于 P2P 链下操作 |
| §7 Replay Protection | "Each issuer maintains a monotonic nonce" | 链上操作的 replay protection 由 EVM 交易 nonce 处理；协议 nonce 仅用于链下 event types |
| §10 Validation Pipeline | 6 步本地验证流水线 | 新增"链上验证路径"段落：Schema → ethers.js → EVM contract → tx receipt → indexer |
| §11 Reducers and State | "State is derived solely from validated events" | 链上模块的 state 来自合约 view functions + Indexer；Reducers 仅用于链下模块 |
| §12 Finality | "observed from N distinct peers" + FINALITY_TIERS | 链上模块使用 EVM 区块确认作为 finality；peer-count finality 仅用于链下模块 |

#### 12.2.2 `docs/implementation/storage-spec.md`

| 章节 | 当前描述 | 需变更为 |
|------|---------|----------|
| §1 Storage Engine | "Default: LevelDB" with append-only log + KV indexes | 新增双存储模型：LevelDB（链下 event 数据）+ SQLite（Event Indexer，链上事件缓存） |
| §2 Directory Layout | `~/.clawnet/{config,keystore,data}` | 新增 `~/.clawnet/indexer/` 目录（SQLite 数据库文件） |
| §3 Key Prefixes | `ev:`, `st:`, `ix:` 用于所有模块 | 说明链上模块的余额 / 合约 / 身份等不再存储在 LevelDB 中 |
| §4 Event Log | "Full nodes MUST NOT garbage collect confirmed events" | 链上模块的 EVM chain 即为不可变日志；本地 event log 为可选缓存 |
| §5 State Snapshots | 周期性快照机制 | Snapshot 仅用于链下模块；链上模块直接查合约 state |
| §7 Indexes | "External indexers are optional and non-authoritative" | Event Indexer 现为节点核心组件，负责 REST 列表 / 历史查询，非 optional |

#### 12.2.3 `docs/implementation/security.md`

| 章节 | 当前描述 | 需新增 |
|------|---------|--------|
| §1 Threats | 仅覆盖 P2P 层威胁 | 新增整个"智能合约威胁"子节：重入攻击、闪电贷治理攻击、前端运行 (front-running)、合约升级攻击、Oracle 操纵 |
| §2 Mitigations | "Indexer outputs are non-authoritative" | 新增链上缓解措施：ReentrancyGuard、checks-effects-interactions 模式、UUPS 升级安全、Timelock 治理、Pausable 紧急暂停 |
| §4 Audit Plan | "Smart contract audit if on-chain components are used" | 改为明确要求：3 轮外部审计（参照 on-chain-plan.md §13）；Slither / Mythril / Aderyn 静态分析集成 CI |
| §6 Security Testing | 仅 P2P 级别测试 | 新增：Foundry fuzz 测试、闪电贷攻击模拟、合约升级安全测试 |
| *(新增)* | — | 新增 §7 "Event Indexer 安全"：Indexer 完整性校验、reorg 处理、数据一致性审计 |

#### 12.2.4 `docs/implementation/testing-plan.md`

| 章节 | 当前描述 | 需新增 |
|------|---------|--------|
| §1 Unit Tests | 仅链下 reducer 测试 | 新增：Solidity 合约单元测试（每个合约）、Indexer event 解析测试、DID → address 映射测试 |
| §2 Integration Tests | 仅 P2P 集成 | 新增：REST → on-chain 代理全链路测试、Indexer 一致性测试（链上事件 = 索引数据）、hardhat local node 集成测试 |
| §3 Performance Tests | 仅吞吐量 / 延迟 | 新增：链上交易吞吐量、Indexer 同步延迟、REST 读写延迟对比（迁移前 vs 后） |
| §4 Adversarial Tests | 仅 P2P 攻击 | 新增：重入攻击测试、闪电贷治理测试、front-running 测试、合约升级安全测试 |
| §6 Exit Criteria | "Deterministic state across 10+ nodes" | 新增：链上 state = Indexer state = REST 响应；合约 100% 行覆盖率 |

#### 12.2.5 `docs/implementation/rollout.md`

| 阶段 | 当前描述 | 需新增 |
|------|---------|--------|
| §1 Alpha | "Single-node MVP" | 新增：本地 devnet (hardhat) 链启动、全套合约部署、Indexer 验证 |
| §2 Beta (Testnet) | 多节点测试 | 新增：ClawNet Chain testnet 部署、合约部署上线、双轨验证（链上 vs 链下比对）、余额迁移演练 |
| §3 Mainnet | 生产上线 | 新增：合约部署顺序、余额快照 + 链上迁移、双轨运行期、source-of-truth 切换、链下废弃 |
| §4 Upgrade Strategy | 版本升级 | 新增：UUPS 代理升级流程、Timelock 治理审批、Pausable 紧急暂停、ABI 向后兼容规则 |

### 12.3 P1 文档——逐项变更详情

#### 12.3.1 `docs/implementation/economics.md`

- **§2.1–2.3 费用章节**：说明协议费由合约在链上自动扣除（`ClawEscrow` release 时 auto-deduct）；新增"EVM gas 费 vs 协议费"关系说明
- **§4 节点激励**：验证者奖励改为 `ClawStaking.distributeRewards()` 链上分发
- **§5 Slashing**：惩罚改为 `ClawStaking.slash()` 链上执行

#### 12.3.2 `docs/implementation/on-chain-plan.md`

- **§2 核心原则**：新增交叉引用到本迁移计划文档
- **§3 目标架构图**：补充 REST 薄代理模式和 Event Indexer 组件
- **SDK 适配章节**（W2, I3, R3, C2 等）：将"SDK 策略模式双适配器"方案更新为"REST 代理模式——SDK 不变，Node 内部路由到链上"

#### 12.3.3 `docs/implementation/README.md`

- **索引列表**：新增 `tasks/rest-onchain-proxy-migration.md` 条目
- **Review Checklist**：将"P2P sync can fully reconstruct state without trusted indexers"修改为区分链上 / 链下模块的状态来源

#### 12.3.4 `docs/ARCHITECTURE.md`

- **核心架构图**：基础设施层的"可选：区块链锚定层"改为"必选：EVM Chain（写操作 source of truth）"
- **数据流架构**：写操作路径改为 `SDK → REST → Node On-Chain Service → EVM Chain`；读操作 `SDK → REST → Chain view / Event Indexer`
- **技术栈表**：区块链从"Ethereum (可选)"改为"ClawNet EVM Chain (必选)"
- **去中心化路线图**：Phase 表与时间线与 `DECENTRALIZATION.md` 对齐

#### 12.3.5 `docs/IMPLEMENTATION.md`

- **组件架构**：HTTP API Server 下新增组件"On-Chain Service Layer"（ethers.js → EVM）+ "Event Indexer"（SQLite）
- **依赖关系图**：更新为 `HTTP API → On-Chain Services → EVM / Indexer → Protocol Layer (P2P-only)`
- **代码结构**：新增 `packages/node/src/services/` 和 `packages/node/src/indexer/` 目录说明

#### 12.3.6 `docs/DECENTRALIZATION.md`

- **Phase 1 架构**："引导数据库(可替换)"部分改为 EVM Chain
- **Phase 2 数据迁移**：`交易记录 → IPFS + Filecoin` 改为 `交易记录 → EVM Chain + Event Indexer`
- **时间线**：反映链上迁移在 Phase 1 期间已完成，早于原计划

#### 12.3.7 `docs/DEPLOYMENT.md`

- **新增章节**："链配置 (Chain Configuration)"— RPC URL、Chain ID、合约地址、Signer 管理
- **Docker 部分**：新增环境变量 `CHAIN_RPC_URL`、`CHAIN_CONTRACTS_*`，或挂载部署配置文件
- **生产安全清单**：新增链相关项 — Signer 密钥保护、RPC TLS、Gas 管理
- **存储部分**：说明 Indexer SQLite 存储与 LevelDB 并存
- **故障排查**：新增 — 链连接失败、Gas 不足、Indexer 同步延迟

#### 12.3.8 `docs/WALLET.md`

- **架构图**：网络层的"区块链锚定 (可选增强)"改为 EVM Chain（必选）
- **交易结构**：`TransactionStatus` 映射到 EVM 交易状态
- **Escrow 结构**：`EscrowStatus` 直接映射到 `ClawEscrow.sol` 链上状态

#### 12.3.9 `docs/SERVICE_CONTRACTS.md`

- **架构图**：核心层路由到 `ClawContracts.sol` 链上执行
- **合约生命周期**：状态转换为 EVM 交易
- **支付条款**：Escrow 由 `ClawEscrow.sol` 链上结算

#### 12.3.10 `docs/DAO.md`

- **提案系统**：生命周期由 `ClawDAO.sol` 链上执行；`queue()` / `execute()` 为链上交易
- **委托投票**：说明链上 `delegate()` / `undelegate()` 机制（待合约确认）
- **国库管理**：余额 = `ClawToken.balanceOf(daoAddress)`；国库操作为链上交易
- **治理参数**：由 `ParamRegistry.sol` view functions 提供

#### 12.3.11 `docs/FAQ.md`

- **"Is ClawNet a blockchain?"**：修正为"ClawNet 使用混合架构——写操作提交到 EVM 链，Markets 等使用 P2P event-sourced 模型"
- **"What consensus mechanism…?"**：补充 EVM 链共识提供 finality
- **"What database…?"**：新增 SQLite（Event Indexer）
- **"What is escrow?"**：说明 Escrow 由 `ClawEscrow.sol` 链上智能合约执行

#### 12.3.12 `docs/API_REFERENCE.md`

- **Introduction**：说明 POST 端点现提交链上交易，延迟约 2–15s
- **txHash 字段**：说明返回值为 EVM 交易哈希
- **`source` 参数**（Identity resolve）：更新可选值语义
- **（可选）新增端点**：`GET /api/tx/:hash/status` 异步交易状态查询

#### 12.3.13 `docs/AGENT_RUNTIME.md`

- **架构图**：新增"On-Chain Service (ethers.js → EVM Chain)"组件
- **Node 定位**：说明节点现同时连接 P2P 网络和 EVM 链
- **配置文件**：新增 `chain:` 区块（rpcUrl, chainId, contracts 地址表）

### 12.4 P2 文档——简要变更列表

| 文件 | 变更摘要 |
|------|----------|
| `docs/IDENTITY.md` | DID 注册流程改为链上 `ClawIdentity.registerDID()`；明确说明 Capabilities 保持链下 P2P |
| `docs/REPUTATION.md` | `recordReview` / `anchorReputation` 改为链上调用；Review 列表由 Indexer 提供 |
| `docs/SDK_GUIDE.md` | 新增"薄代理架构"说明段落；文档化链上相关的新 `ClawNetError` 错误码 |
| `docs/QUICKSTART.md` | Step 5 (Start Daemon) 新增链配置说明；Step 6 状态响应可能包含 `chainId` / `lastIndexedBlock` |
| `docs/OPENCLAW_INTEGRATION.md` | 部署架构图补充链结算层 |
| `docs/SMART_CONTRACTS.md` | 说明 ClawNet"服务合约"概念与 Solidity 智能合约的关系；更新代码示例 |
| `docs/DOCS_INVENTORY.md` | 新增 `rest-onchain-proxy-migration.md` 条目；更新"实现任务"计数 |
| `docs/api/openapi.yaml` | `blockHeight` 说明为 EVM block height；write 响应的 `txHash` 说明为 EVM tx hash |
| `packages/sdk/README.md` | （可选）新增说明："Write operations are now settled on-chain via the node's proxy layer" |

### 12.5 文档更新执行计划

文档更新与代码 Phase 同步推进，遵循"哪个 Phase 改了逻辑，就同步更新对应文档"的原则：

| Phase | 同步更新的文档 |
|-------|---------------|
| **Phase 0** (Week 1–2) | `protocol-spec.md`, `storage-spec.md`, `security.md`, `testing-plan.md`, `rollout.md`, `on-chain-plan.md`, `implementation/README.md` |
| **Phase 1** (Week 3–4) | `WALLET.md`, `economics.md` |
| **Phase 2** (Week 5–6) | `IDENTITY.md` |
| **Phase 3** (Week 7–8) | `REPUTATION.md` |
| **Phase 4** (Week 9–10) | `SERVICE_CONTRACTS.md`, `SMART_CONTRACTS.md` |
| **Phase 5** (Week 11–13) | `DAO.md` |
| **Phase 6** (Week 14–15) | `ARCHITECTURE.md`, `IMPLEMENTATION.md`, `DECENTRALIZATION.md`, `DEPLOYMENT.md`, `FAQ.md`, `API_REFERENCE.md`, `AGENT_RUNTIME.md`, `SDK_GUIDE.md`, `QUICKSTART.md`, `OPENCLAW_INTEGRATION.md`, `DOCS_INVENTORY.md`, `openapi.yaml`, `sdk/README.md` |

---

## 附录 A: 依赖关系图

```
packages/contracts (Solidity)
    ↓ typechain + ABI
packages/node/src/services/ (Node chain service，使用 ethers.js 调用合约)
    ↓ 被调用
packages/node/src/api/server.ts (REST 路由)
    ↓ HTTP
packages/sdk/src/*.ts (纯 REST API 封装) ← 外部调用者使用
```

## 附录 B: 合约地址管理

建议在 `packages/contracts/deployments/` 下维护各网络的部署地址文件：

```
deployments/
  localhost.json       # hardhat local
  testnet.json         # ClawNet testnet
  mainnet.json         # 主网（未来）
```

格式：
```json
{
  "chainId": 31337,
  "contracts": {
    "ClawToken": { "address": "0x...", "blockDeployed": 1 },
    "ClawEscrow": { "address": "0x...", "blockDeployed": 1 },
    "ClawIdentity": { "address": "0x...", "blockDeployed": 1 },
    "ClawReputation": { "address": "0x...", "blockDeployed": 1 },
    "ClawContracts": { "address": "0x...", "blockDeployed": 1 },
    "ClawDAO": { "address": "0x...", "blockDeployed": 1 },
    "ClawStaking": { "address": "0x...", "blockDeployed": 1 },
    "ParamRegistry": { "address": "0x...", "blockDeployed": 1 }
  }
}
```

`blockDeployed` 用于 indexer 确定从哪个块开始扫描事件。

## 附录 C: 新增文件清单预估

| 新增文件 | 所属包 | 用途 |
|---------|--------|------|
| `src/services/chain-provider.ts` | `node` | ethers Provider/Signer 管理 |
| `src/services/wallet-service.ts` | `node` | Wallet 路由 → 链上调用（ethers.js → `ClawToken.sol` / `ClawEscrow.sol`） |
| `src/services/identity-service.ts` | `node` | Identity 路由 → 链上调用（ethers.js → `ClawIdentity.sol`） |
| `src/services/reputation-service.ts` | `node` | Reputation 路由 → 链上调用（ethers.js → `ClawReputation.sol`） |
| `src/services/contracts-service.ts` | `node` | Contracts 路由 → 链上调用（ethers.js → `ClawContracts.sol`） |
| `src/services/dao-service.ts` | `node` | DAO 路由 → 链上调用（ethers.js → `ClawDAO.sol`） |
| `src/indexer/indexer.ts` | `node` | Event Indexer 核心调度 |
| `src/indexer/store.ts` | `node` | SQLite 存储层 |
| `src/indexer/query.ts` | `node` | 分页/筛选查询层 |
| `src/indexer/handlers/*.ts` | `node` | 各合约事件处理器 |
| `src/config.ts` | `node` | 链上配置解析 |
| `test/services/*.test.ts` | `node` | Node chain service 单元测试 |
| `test/integration/chain-*.test.ts` | `node` | 集成测试 |
