# ClawNet 上链实施计划

> 所有模块从链下 P2P 协议迁移至区块链的详细技术方案与实施路线

## 目录

1. [现状分析](#1-现状分析)
2. [上链总体策略](#2-上链总体策略)
3. [链选型与架构](#3-链选型与架构)
4. [模块一：Token / Wallet 上链](#4-模块一token--wallet-上链)
5. [模块二：Identity 上链](#5-模块二identity-上链)
6. [模块三：Reputation 上链](#6-模块三reputation-上链)
7. [模块四：Service Contracts 上链](#7-模块四service-contracts-上链)
8. [模块五：Markets 上链](#8-模块五markets-上链)
9. [模块六：DAO / Governance 上链](#9-模块六dao--governance-上链)
10. [模块七：Staking / Node Incentives](#10-模块七staking--node-incentives)
11. [跨模块集成](#11-跨模块集成)
12. [迁移方案](#12-迁移方案)
13. [安全审计计划](#13-安全审计计划)
14. [实施时间线](#14-实施时间线)
15. [风险与缓解](#15-风险与缓解)

---

## 1. 现状分析

### 当前架构（Phase 1 — 链下 P2P）

```
┌─────────────────────────────────────────────────────────────────────┐
│                    当前系统（完全链下）                               │
│                                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │  Identity   │  │   Wallet   │  │ Reputation │  │  Contracts │    │
│  │  Ed25519    │  │ EventStore │  │  内存计算   │  │  EventStore│    │
│  │  DID 本地   │  │  LevelDB   │  │  LevelDB   │  │  LevelDB   │    │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘    │
│                                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                    │
│  │  Markets   │  │    DAO     │  │  Staking   │                    │
│  │  EventStore│  │  尚未实现   │  │  尚未实现   │                    │
│  │  LevelDB   │  │            │  │            │                    │
│  └────────────┘  └────────────┘  └────────────┘                    │
│                                                                      │
│  数据同步：libp2p gossipsub + 事件溯源                               │
│  共识机制：事件哈希 + N 节点确认（概率性最终性）                      │
│  存储引擎：LevelDB（本地） + 快照签名（P2P 验证）                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 各模块现状与上链必要性

| 模块 | 当前存储 | 当前共识 | 上链必要性 | 优先级 |
|------|----------|----------|-----------|--------|
| **Token / Wallet** | LevelDB 事件日志 | N 节点确认 | ★★★★★ 核心资产，必须链上保证 | P0 |
| **Identity** | 本地密钥 + 事件日志 | 签名验证 | ★★★★☆ DID 锚定需要链上不可篡改 | P0 |
| **Staking** | 未实现 | — | ★★★★★ 节点安全依赖质押 | P0 |
| **DAO** | 未实现 | — | ★★★★☆ 治理决策需要链上执行 | P1 |
| **Reputation** | LevelDB + 内存 | 快照签名 | ★★★☆☆ 可链下计算 + 链上锚定 | P1 |
| **Contracts** | LevelDB 事件日志 | N 节点确认 | ★★★★☆ 资金绑定需要链上保证 | P1 |
| **Markets** | LevelDB 事件日志 | N 节点确认 | ★★☆☆☆ 大部分可保持链下 | P2 |

---

## 2. 上链总体策略

### 核心原则

```
┌─────────────────────────────────────────────────────────────────────┐
│                       上链设计原则                                    │
│                                                                      │
│  1. 最小化链上状态                                                   │
│     → 只将「必须不可篡改」的状态放链上                               │
│     → 计算密集型逻辑保持链下                                         │
│                                                                      │
│  2. 链下计算 + 链上验证                                              │
│     → 节点在链下完成匹配/计算                                        │
│     → 关键结果提交链上存证                                           │
│                                                                      │
│  3. 渐进式迁移                                                       │
│     → 先锚定（hash 上链），再状态迁移（逻辑上链）                     │
│     → 保持链下系统作为 fallback                                      │
│                                                                      │
│  4. Gas 成本可控 + Gas 收入归协议                                    │
│     → 批量提交，减少单笔交易上链频率                                 │
│     → 自建 L3 应用链，Gas 收入 100% 归 ClawNet                      │
│                                                                      │
│  5. 双轨运行期                                                       │
│     → 链下系统与链上系统并行                                         │
│     → 链上为 source of truth，链下为性能缓存                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 上链 vs 锚定 vs 链下 决策矩阵

| 模块 / 操作 | 完全链上 | 链上锚定 | 完全链下 | 原因 |
|-------------|---------|---------|---------|------|
| Token 余额与转账 | ✅ | | | 核心资产，需要链上最终性 |
| Escrow 创建/释放 | ✅ | | | 资金安全，需要原子性 |
| DID 注册/轮换 | ✅ | | | 身份根，需要不可篡改 |
| 平台身份链接证明 | | ✅ | | 只需存证 hash |
| 信誉分数快照 | | ✅ | | 链下计算，定期锚定 |
| 信誉评价记录 | | ✅ | | 存 hash，原文链下 |
| 合约签订/结算 | ✅ | | | 资金绑定，需要链上执行 |
| 合约里程碑追踪 | | ✅ | | 进度数据量大，锚定即可 |
| 市场挂单/匹配 | | | ✅ | 高频操作，链上不经济 |
| 市场订单结算 | ✅ | | | 涉及资金转移 |
| DAO 投票/执行 | ✅ | | | 治理决策需要链上可验证 |
| 节点质押/惩罚 | ✅ | | | 经济安全保证 |
| P2P 通信 | | | ✅ | 实时性要求 |
| 搜索/索引 | | | ✅ | 读操作，不需要共识 |

---

## 3. 链选型与架构

### 推荐方案：ClawNet L3（自建应用链）

```
┌─────────────────────────────────────────────────────────────────────┐
│                       链选型对比                                     │
│                                                                      │
│  ┌─────────────┬──────────┬─────────┬─────────┬──────────────────┐  │
│  │             │ 自建 L3  │ Base L2 │Ethereum │  Solana         │  │
│  ├─────────────┼──────────┼─────────┼─────────┼──────────────────┤  │
│  │ Gas 成本    │  极低    │  低     │  高     │  极低           │  │
│  │ Gas 收入    │ 100%归己 │  归Base │  归矿工 │  归验证者       │  │
│  │ 安全性      │  高(继承)│  高(L1) │  最高   │  中             │  │
│  │ 自定义Gas币 │  ✅      │  ❌     │  ❌     │  ❌             │  │
│  │ EVM 兼容    │  ✅      │  ✅     │  ✅     │  ❌             │  │
│  │ 延迟        │  <1s     │  ~2s    │  ~12s   │  ~0.4s          │  │
│  │ 排序器控制  │  自主    │ Coinbase│  去中心 │  去中心         │  │
│  │ 独立性      │  完全    │  依赖   │  —      │  —              │  │
│  └─────────────┴──────────┴─────────┴─────────┴──────────────────┘  │
│                                                                      │
│  推荐：基于 OP Stack 自建 ClawNet L3 应用链                         │
│  结算层：Base L2 → Ethereum L1（继承以太坊安全性）                   │
│  原因：                                                              │
│    1. Gas 收入 100% 归 ClawNet 协议（排序器由我们运营）             │
│    2. 可使用 Token 作为 Gas 代币（用户无需持有 ETH）                │
│    3. 完全 EVM 兼容，复用以太坊工具链                               │
│    4. 低延迟 + 高吞吐 + 可定制区块参数                              │
│    5. 安全性继承：L3 → Base L2 → Ethereum L1                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### L3 架构说明

```
┌────────────────────────────────────────────────────────────┐
│                 ClawNet L3 应用链                           │
│                                                            │
│  框架：OP Stack（与 Base 同源）                            │
│  排序器：ClawNet 团队运营（Gas 收入 → 协议国库）          │
│  Gas 代币：Token（原生 Gas Token，用户无需 ETH）           │
│  出块时间：~1 秒                                          │
│  数据可用性：Blob 提交至 Base L2                           │
│                                                            │
│  收入模型：                                                │
│  ├── 用户每笔交易支付 Gas（以 Token 计价）                │
│  ├── Gas 收入 → 排序器 → ClawNet 协议国库                │
│  ├── 扣除 L2 结算成本后，剩余为净收入                     │
│  └── 预估净利率 > 80%（L3 Gas 远大于 L2 结算成本）        │
│                                                            │
│  安全性继承链：                                            │
│  ClawNet L3 → Base L2 → Ethereum L1                       │
│  (交易执行)    (状态结算)   (数据锚定)                     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 目标架构：混合链上链下

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          目标架构                                            │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                       应用层 (SDK / CLI)                             │   │
│  │  claw.wallet.transfer()  claw.dao.vote()  claw.contracts.sign()     │   │
│  └───────────────────────────────┬──────────────────────────────────────┘   │
│                                  │                                          │
│                    ┌─────────────┴─────────────┐                           │
│                    │                           │                           │
│                    ▼                           ▼                           │
│  ┌────────────────────────────┐  ┌────────────────────────────┐           │
│  │    链上层 (ClawNet L3)     │  │       链下层 (P2P)          │           │
│  │                            │  │                            │           │
│  │  ┌──────────────────────┐  │  │  ┌──────────────────────┐  │           │
│  │  │   ClawToken.sol      │  │  │  │   MarketMatcher      │  │           │
│  │  │   (ERC-20 Token)     │  │  │  │   (挂单/搜索/匹配)   │  │           │
│  │  └──────────────────────┘  │  │  └──────────────────────┘  │           │
│  │  ┌──────────────────────┐  │  │  ┌──────────────────────┐  │           │
│  │  │   ClawEscrow.sol     │  │  │  │   ReputationEngine   │  │           │
│  │  │   (托管/释放/退款)   │  │  │  │   (信誉计算)         │  │           │
│  │  └──────────────────────┘  │  │  └──────────────────────┘  │           │
│  │  ┌──────────────────────┐  │  │  ┌──────────────────────┐  │           │
│  │  │   ClawIdentity.sol   │  │  │  │   ContentStore       │  │           │
│  │  │   (DID 注册/轮换)    │  │  │  │   (IPFS 大数据)      │  │           │
│  │  └──────────────────────┘  │  │  └──────────────────────┘  │           │
│  │  ┌──────────────────────┐  │  │  ┌──────────────────────┐  │           │
│  │  │   ClawStaking.sol    │  │  │  │   P2P Gossip         │  │           │
│  │  │   (质押/惩罚/奖励)   │  │  │  │   (消息传播)         │  │           │
│  │  └──────────────────────┘  │  │  └──────────────────────┘  │           │
│  │  ┌──────────────────────┐  │  │                            │           │
│  │  │   ClawDAO.sol        │  │  │                            │           │
│  │  │   (提案/投票/执行)   │  │  │                            │           │
│  │  └──────────────────────┘  │  │                            │           │
│  │  ┌──────────────────────┐  │  │                            │           │
│  │  │   ClawContracts.sol  │  │  │                            │           │
│  │  │   (合约/里程碑/结算) │  │  │                            │           │
│  │  └──────────────────────┘  │  │                            │           │
│  │  ┌──────────────────────┐  │  │                            │           │
│  │  │   ClawReputation.sol │  │  │                            │           │
│  │  │   (信誉锚定/查询)   │  │  │                            │           │
│  │  └──────────────────────┘  │  │                            │           │
│  │                            │  │                            │           │
│  └────────────────────────────┘  └────────────────────────────┘           │
│                                                                              │
│                    ┌─────────────┴─────────────┐                           │
│                    │        Base L2              │                           │
│                    │    (L3 状态结算层)          │                           │
│                    └──────────────┬──────────────┘                           │
│                                   │                                          │
│                    ┌──────────────┴──────────────┐                           │
│                    │      Ethereum L1             │                           │
│                    │   (最终确认 / 数据锚定)      │                           │
│                    └─────────────────────────────┘                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 智能合约清单

| 合约名 | 功能 | 可升级 | 预估代码行 |
|--------|------|--------|-----------|
| `ClawToken.sol` | ERC-20 Token + Mint/Burn | ✅ (UUPS) | ~300 |
| `ClawEscrow.sol` | 托管/释放/退款/过期 | ✅ (UUPS) | ~500 |
| `ClawIdentity.sol` | DID 注册/更新/撤销 | ✅ (UUPS) | ~400 |
| `ClawStaking.sol` | 质押/解押/奖励/惩罚 | ✅ (UUPS) | ~600 |
| `ClawDAO.sol` | 提案/投票/时间锁/执行 | ✅ (UUPS) | ~800 |
| `ClawContracts.sol` | 服务合约/里程碑/结算 | ✅ (UUPS) | ~700 |
| `ClawReputation.sol` | 信誉锚定/查询 | ✅ (UUPS) | ~300 |
| `ClawRouter.sol` | 统一入口 / 模块注册 | ✅ (UUPS) | ~200 |
| **总计** | | | **~3,800** |

---

## 4. 模块一：Token / Wallet 上链

### 目标

将 Token 余额、转账、铸造/销毁从链下事件溯源迁移到标准 ERC-20 链上合约。

### 智能合约设计

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title ClawToken — ClawNet 协议原生 Token
/// @notice ERC-20 标准，支持 mint/burn，可升级
contract ClawToken is ERC20Upgradeable, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    /// @notice 初始化（替代 constructor）
    function initialize(string memory name, string memory symbol) public initializer {
        __ERC20_init(name, symbol);
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice 无小数位（1 Token = 最小单位，与链下协议一致）
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /// @notice 铸造 Token（Treasury / 奖励 / 迁移初始化）
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice 销毁 Token（手续费销毁 / DAO 决议）
    function burn(address from, uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(from, amount);
    }

    /// @notice 升级授权（仅 Admin）
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
```

### Escrow 合约设计

```solidity
/// @title ClawEscrow — 链上托管
/// @notice 支持条件释放、退款、过期、多方托管
contract ClawEscrow is AccessControlUpgradeable, UUPSUpgradeable {

    struct Escrow {
        bytes32 escrowId;           // 链下 escrowId 映射
        address depositor;          // 存款方
        address beneficiary;        // 收款方
        address arbiter;            // 仲裁方（可选）
        uint256 amount;             // 托管金额
        uint256 fee;                // 托管手续费
        uint64  createdAt;          // 创建时间
        uint64  expiresAt;          // 过期时间
        EscrowStatus status;        // 状态
    }

    enum EscrowStatus { Active, Released, Refunded, Expired, Disputed }

    IERC20 public token;
    mapping(bytes32 => Escrow) public escrows;

    event EscrowCreated(bytes32 indexed escrowId, address depositor, address beneficiary, uint256 amount);
    event EscrowReleased(bytes32 indexed escrowId, address releasedBy);
    event EscrowRefunded(bytes32 indexed escrowId, address refundedBy);
    event EscrowExpired(bytes32 indexed escrowId);
    event EscrowDisputed(bytes32 indexed escrowId, address disputedBy);

    /// @notice 创建托管
    function createEscrow(
        bytes32 escrowId,
        address beneficiary,
        address arbiter,
        uint256 amount,
        uint64 expiresAt
    ) external;

    /// @notice 释放托管资金给收款方
    function release(bytes32 escrowId) external;

    /// @notice 退款给存款方
    function refund(bytes32 escrowId) external;

    /// @notice 过期处理
    function expire(bytes32 escrowId) external;

    /// @notice 发起争议（进入仲裁）
    function dispute(bytes32 escrowId) external;

    /// @notice 仲裁裁决（arbiter 调用）
    function resolve(bytes32 escrowId, bool releaseToBeneficiary) external;
}
```

### 链下事件到链上的映射

| 链下事件类型 | 链上操作 | 说明 |
|-------------|---------|------|
| `wallet.transfer` | `ClawToken.transfer()` | 标准 ERC-20 转账 |
| `wallet.mint` | `ClawToken.mint()` | 仅 MINTER_ROLE |
| `wallet.burn` | `ClawToken.burn()` | 仅 BURNER_ROLE |
| `wallet.escrow.create` | `ClawEscrow.createEscrow()` | 创建链上托管 |
| `wallet.escrow.fund` | `ClawToken.transfer() → Escrow` | 追加资金 |
| `wallet.escrow.release` | `ClawEscrow.release()` | 释放给收款方 |
| `wallet.escrow.refund` | `ClawEscrow.refund()` | 退款给存款方 |
| `wallet.fee` | `ClawToken.transfer() → Treasury` | 手续费转入国库 |
| `wallet.reward` | `ClawToken.mint()` | 从国库铸造奖励 |

### 实施步骤

```
Phase W1: 合约开发与测试                            [4 周]
├── 编写 ClawToken.sol + 完整单元测试
├── 编写 ClawEscrow.sol + 完整单元测试
├── 编写部署脚本（Hardhat / Foundry）
└── 本地测试网验证

Phase W2: SDK 适配                                  [3 周]
├── 新增 packages/contracts/ (Hardhat 项目)
├── 修改 packages/sdk/src/wallet.ts
│   ├── 新增 WalletOnChain 适配器
│   └── 保持 WalletApi 接口不变（策略模式切换链上/链下）
├── 修改 packages/node/ 支持链上事件监听
└── 编写集成测试

Phase W3: 测试网部署                                [2 周]
├── 部署至 ClawNet L3 测试网（本地 OP Stack devnet）
├── 运行 clawnet 集成测试场景
└── 压力测试（并发转账、托管创建/释放）

Phase W4: 迁移与上线                                [2 周]
├── 链下余额快照
├── 链上 mint 初始余额
├── 双轨运行验证
└── 切换至链上为 source of truth
```

---

## 5. 模块二：Identity 上链

### 目标

将 DID 注册、更新、密钥轮换、撤销锚定到链上，确保身份不可篡改。

### 智能合约设计

```solidity
/// @title ClawIdentity — 链上 DID 注册表
/// @notice 存储 DID → 公钥映射、密钥轮换历史、撤销状态
contract ClawIdentity is UUPSUpgradeable {

    struct DIDRecord {
        bytes32 didHash;            // SHA-256(did:claw:xxx) 绑定
        bytes32 activeKeyHash;      // 当前活跃公钥 hash
        address controller;         // 链上控制地址
        uint64  createdAt;
        uint64  updatedAt;
        bool    revoked;
    }

    struct KeyRecord {
        bytes   publicKey;          // Ed25519 公钥（32 字节）
        uint64  addedAt;
        uint64  revokedAt;          // 0 表示未撤销
        KeyPurpose purpose;         // 用途
    }

    enum KeyPurpose { Authentication, Assertion, KeyAgreement, Recovery }

    // DID hash → DID record
    mapping(bytes32 => DIDRecord) public dids;
    // DID hash → key hash → key record
    mapping(bytes32 => mapping(bytes32 => KeyRecord)) public keys;
    // DID hash → platform link hashes（已验证的平台链接证明）
    mapping(bytes32 => bytes32[]) public platformLinks;

    event DIDRegistered(bytes32 indexed didHash, address controller);
    event KeyRotated(bytes32 indexed didHash, bytes32 oldKeyHash, bytes32 newKeyHash);
    event DIDRevoked(bytes32 indexed didHash);
    event PlatformLinked(bytes32 indexed didHash, bytes32 linkHash);

    /// @notice 注册 DID（公钥 → 地址映射）
    function registerDID(
        bytes32 didHash,
        bytes calldata publicKey,
        KeyPurpose purpose
    ) external;

    /// @notice 密钥轮换
    function rotateKey(
        bytes32 didHash,
        bytes calldata newPublicKey,
        bytes calldata rotationProof   // 旧密钥签名的轮换证明
    ) external;

    /// @notice 撤销 DID
    function revokeDID(bytes32 didHash) external;

    /// @notice 添加平台链接证明 hash
    function addPlatformLink(bytes32 didHash, bytes32 linkHash) external;

    /// @notice 验证 DID 是否有效
    function isActive(bytes32 didHash) external view returns (bool);

    /// @notice 获取当前活跃公钥
    function getActiveKey(bytes32 didHash) external view returns (bytes memory);
}
```

### 链下 → 链上映射

| 链下事件 | 链上操作 | 数据存储 |
|---------|---------|---------|
| `identity.create` | `registerDID()` | DID hash + 公钥 on-chain |
| `identity.update` | `rotateKey()` | 新公钥 on-chain |
| `identity.platform.link` | `addPlatformLink()` | 证明 hash on-chain，完整 VC 在 IPFS |
| `identity.capability.register` | — | 链下存储，hash 可选锚定 |
| DID Document | — | 完整文档在 IPFS/Ceramic，hash 锚定链上 |

### 设计决策

1. **链上只存 hash + 最小映射**：完整 DID Document 存 IPFS/Ceramic，链上只存
   `didHash → activeKeyHash → controller` 映射，节省 gas。
2. **Ed25519 签名验证**：Solidity 原生不支持 Ed25519，使用预编译
   （L3 可自行添加预编译支持 EIP-7212）或链下验证 + 链上提交模式。
3. **密钥轮换原子性**：轮换操作在单个交易内完成，避免中间状态。

### 实施步骤

```
Phase I1: 合约开发                                  [3 周]
├── ClawIdentity.sol + 测试
├── Ed25519 验证库适配
└── DID ↔ EVM address 映射逻辑

Phase I2: Ceramic / IPFS 集成                       [2 周]
├── DID Document 存 Ceramic Stream
├── 链上锚定 Ceramic Stream ID
└── 解析器：链上查 hash → Ceramic 取完整文档

Phase I3: SDK 适配                                  [2 周]
├── 修改 packages/sdk/ 的 identity 模块
├── 保持 did:claw: 格式不变
└── 新增链上 DID 解析路径

Phase I4: 迁移                                      [2 周]
├── 现有 DID 批量注册上链
├── 验证所有密钥映射正确
└── 切换解析优先级：链上 > 链下
```

---

## 6. 模块三：Reputation 上链

### 目标

链下计算信誉分数，定期将快照锚定到链上；评价记录的 hash 上链保证不可篡改。

### 策略：链下计算 + 链上锚定（Hybrid）

```
┌───────────────────────────────────────────────────────────┐
│              信誉混合架构                                   │
│                                                            │
│  ┌────────────────────────────────────┐                   │
│  │         链下（P2P 节点）            │                   │
│  │                                    │                   │
│  │  评价提交 → 多维度计算 → 分数聚合  │                   │
│  │       ↓              ↓             │                   │
│  │  评价 hash      分数快照           │                   │
│  └───────┬──────────────┬─────────────┘                   │
│          │              │                                  │
│          ▼              ▼                                  │
│  ┌────────────────────────────────────┐                   │
│  │         链上（ClawNet L3）           │                   │
│  │                                    │                   │
│  │  评价 hash 存证   信誉快照锚定     │                   │
│  │  (per review)     (per epoch)      │                   │
│  └────────────────────────────────────┘                   │
│                                                            │
│  查询路径：                                                │
│  快：链下节点直接返回最新分数                              │
│  验：查链上快照 hash，对比链下数据                         │
│                                                            │
└───────────────────────────────────────────────────────────┘
```

### 智能合约设计

```solidity
/// @title ClawReputation — 信誉锚定合约
contract ClawReputation is UUPSUpgradeable {

    struct ReputationSnapshot {
        bytes32 agentDIDHash;       // Agent DID hash
        uint16  overallScore;       // 0-1000
        uint16  transactionScore;   // 交易维度
        uint16  fulfillmentScore;   // 履约维度
        uint16  qualityScore;       // 质量维度
        uint16  socialScore;        // 社交维度
        uint16  behaviorScore;      // 行为维度
        uint64  epoch;              // 快照 epoch
        bytes32 merkleRoot;         // 该 Agent 所有评价的 Merkle Root
        uint64  timestamp;
    }

    struct ReviewAnchor {
        bytes32 reviewHash;         // 评价内容 hash
        bytes32 reviewerDIDHash;    // 评价者 DID hash
        bytes32 subjectDIDHash;     // 被评价者 DID hash
        bytes32 txHash;             // 关联交易 hash
        uint64  timestamp;
    }

    // Agent DID hash → 最新快照
    mapping(bytes32 => ReputationSnapshot) public latestSnapshots;
    // Agent DID hash → epoch → 历史快照
    mapping(bytes32 => mapping(uint64 => ReputationSnapshot)) public snapshotHistory;
    // Review hash → anchor
    mapping(bytes32 => ReviewAnchor) public reviewAnchors;

    // 全局 epoch（每 24 小时或 DAO 可调）
    uint64 public currentEpoch;
    uint64 public epochDuration;  // 默认 86400 (24h)

    event ReputationAnchored(bytes32 indexed agentDIDHash, uint64 epoch, uint16 score);
    event ReviewRecorded(bytes32 indexed reviewHash, bytes32 indexed subjectDIDHash);

    /// @notice 提交信誉快照（由授权节点调用）
    function anchorReputation(
        bytes32 agentDIDHash,
        uint16 overallScore,
        uint16[5] calldata dimensionScores,
        bytes32 merkleRoot
    ) external;

    /// @notice 批量锚定（节省 gas）
    function batchAnchorReputation(
        bytes32[] calldata agentDIDHashes,
        uint16[] calldata scores,
        bytes32[] calldata merkleRoots
    ) external;

    /// @notice 记录评价锚点
    function recordReview(
        bytes32 reviewHash,
        bytes32 reviewerDIDHash,
        bytes32 subjectDIDHash,
        bytes32 txHash
    ) external;

    /// @notice 查询信誉
    function getReputation(bytes32 agentDIDHash) external view returns (uint16 score, uint64 epoch);
}
```

### 锚定频率与 Gas 估算

| 操作 | 频率 | 预估 Gas (ClawNet L3) | 月成本估算 |
|------|------|-------------------|-----------|
| 批量信誉锚定 (100 个 Agent) | 每 24h | ~200,000 gas | 极低（Gas 以 Token 计价，收入归协议） |
| 评价 hash 记录 | 每笔评价 | ~50,000 gas | 取决于评价量 |
| 单个信誉查询 | 按需 | 0 (view call) | 免费 |

### 实施步骤

```
Phase R1: 合约开发                                  [3 周]
├── ClawReputation.sol + 测试
├── Merkle 树构建工具
└── 批量锚定 gas 优化

Phase R2: 锚定服务                                  [2 周]
├── 节点定时任务：每 epoch 计算快照
├── 提交 Merkle Root 到链上
└── 评价 hash 实时/批量上链

Phase R3: 查询与验证                                [2 周]
├── SDK 新增链上信誉查询路径
├── 链下分数 → 链上 hash 验证工具
└── 不一致检测告警
```

---

## 7. 模块四：Service Contracts 上链

### 目标

合约签订、资金绑定、里程碑结算、争议仲裁等关键资金操作上链。

### 智能合约设计

```solidity
/// @title ClawContracts — 服务合约链上管理
contract ClawContracts is UUPSUpgradeable {

    struct ServiceContract {
        bytes32 contractId;
        address client;             // 付款方 EVM 地址
        address provider;           // 服务方 EVM 地址
        uint256 totalAmount;        // 总金额
        uint256 fundedAmount;       // 已托管金额
        uint256 releasedAmount;     // 已释放金额
        uint8   milestoneCount;     // 里程碑数量
        ContractStatus status;
        bytes32 termsHash;          // 完整条款 hash（原文在 IPFS）
        uint64  createdAt;
        uint64  deadline;
    }

    struct Milestone {
        bytes32 milestoneId;
        uint256 amount;             // 该里程碑金额
        MilestoneStatus status;
        bytes32 deliverableHash;    // 交付物 hash
        uint64  deadline;
    }

    enum ContractStatus {
        Draft, Negotiating, Signed, Active,
        Completed, Disputed, Terminated, Cancelled
    }

    enum MilestoneStatus {
        Pending, Submitted, Approved, Rejected, Disputed
    }

    IERC20 public token;
    IClawEscrow public escrow;

    mapping(bytes32 => ServiceContract) public contracts;
    mapping(bytes32 => Milestone[]) public milestones;
    // contractId → party address → signed
    mapping(bytes32 => mapping(address => bool)) public signatures;

    event ContractCreated(bytes32 indexed contractId, address client, address provider);
    event ContractSigned(bytes32 indexed contractId, address signer);
    event ContractActivated(bytes32 indexed contractId);
    event MilestoneSubmitted(bytes32 indexed contractId, uint8 index, bytes32 deliverableHash);
    event MilestoneApproved(bytes32 indexed contractId, uint8 index, uint256 amount);
    event ContractCompleted(bytes32 indexed contractId);
    event ContractDisputed(bytes32 indexed contractId, address disputedBy);

    /// @notice 创建合约
    function createContract(
        bytes32 contractId,
        address provider,
        uint256 totalAmount,
        bytes32 termsHash,
        uint64 deadline,
        uint256[] calldata milestoneAmounts,
        uint64[] calldata milestoneDeadlines
    ) external;

    /// @notice 签署合约
    function signContract(bytes32 contractId) external;

    /// @notice 提交里程碑交付
    function submitMilestone(bytes32 contractId, uint8 index, bytes32 deliverableHash) external;

    /// @notice 批准里程碑（释放该阶段资金）
    function approveMilestone(bytes32 contractId, uint8 index) external;

    /// @notice 拒绝里程碑
    function rejectMilestone(bytes32 contractId, uint8 index, bytes32 reasonHash) external;

    /// @notice 完成合约（所有里程碑完成后）
    function completeContract(bytes32 contractId) external;

    /// @notice 发起争议
    function disputeContract(bytes32 contractId, bytes32 evidenceHash) external;
}
```

### 链上 vs 链下分工

| 操作 | 链上 | 链下 | 原因 |
|------|------|------|------|
| 合约条款协商 | | ✅ | 数据量大，非关键路径 |
| 合约签名 | ✅ | | 需要不可否认性 |
| 资金托管/释放 | ✅ | | 资金安全 |
| 里程碑提交/审批 | ✅ | | 资金释放条件 |
| 交付物内容 | | ✅ (IPFS) | 只存 hash |
| 争议发起 | ✅ | | 需要链上存证 |
| 仲裁执行 | ✅ | | 资金裁决需要原子性 |
| 完成/结算 | ✅ | | 最终资金分配 |

### 实施步骤

```
Phase C1: 合约开发                                  [4 周]
├── ClawContracts.sol + 完整测试
├── 与 ClawEscrow.sol 集成
├── 里程碑状态机验证
└── 争议/仲裁逻辑

Phase C2: SDK 适配                                  [3 周]
├── 修改 packages/sdk/ contracts 模块
├── 合约创建流程：链下协商 → 链上签订
└── 里程碑审批自动触发链上交易

Phase C3: 测试与部署                                [2 周]
├── 全流程端到端测试
├── 测试网部署
└── 场景测试（正常完成、争议、超时）
```

---

## 8. 模块五：Markets 上链

### 目标

市场的大部分逻辑保持链下（搜索/匹配/挂单），仅将**订单结算**上链。

### 策略：最小化上链

```
┌─────────────────────────────────────────────────────────────────────┐
│                    市场混合架构                                       │
│                                                                      │
│  完全链下：                                                          │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │ 挂单发布 → 搜索索引 → 匹配算法 → 报价/议价 → 订单确认  │       │
│  └──────────────────────────┬───────────────────────────────┘       │
│                             │ 订单确认后                             │
│                             ▼                                        │
│  链上执行：                                                          │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │ 创建托管 → 交付确认 → 释放资金 → 手续费扣除 → 评价锚定  │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                      │
│  原因：                                                              │
│  • 挂单/搜索 是高频读写操作，链上不经济                              │
│  • 匹配算法需要复杂计算，不适合 EVM                                 │
│  • 资金结算 是低频但高价值操作，必须链上保证                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 市场相关的链上操作

| 操作 | 对应合约 | 说明 |
|------|---------|------|
| 订单付款 | `ClawEscrow.createEscrow()` | 买方创建托管 |
| 信息购买 | `ClawToken.transfer()` | 即时付款（低价值可直接转账） |
| 任务完成结算 | `ClawEscrow.release()` | 任务验收后释放 |
| 能力市场租赁付款 | `ClawEscrow.createEscrow()` | 周期性托管 |
| 手续费 | 自动扣除 | Escrow 释放时扣除 fee |
| 订单 hash 锚定 | `ClawReputation.recordReview()` | 订单完成后评价上链 |

### 不上链的操作

- `market.listing.publish` / `update` / `remove` — 链下 P2P 广播
- `market.order.create` / `update` — 链下协商
- `market.bid.*` — 链下投标
- `market.submission.*` — 链下提交（hash 可锚定）
- 搜索/匹配 — 链下索引节点

### 实施步骤

```
Phase M1: 适配现有合约                              [2 周]
├── 市场订单结算走 ClawEscrow
├── 手续费计算逻辑迁移
└── 信息市场即时支付走 ClawToken.transfer()

Phase M2: SDK 适配                                  [2 周]
├── 修改 markets SDK 模块
├── 订单确认 → 自动创建链上托管
└── 交付确认 → 自动释放托管

Phase M3: 测试                                      [1 周]
├── 三大市场端到端测试
└── 手续费计算验证
```

---

## 9. 模块六：DAO / Governance 上链

### 目标

将提案、投票、时间锁、执行全部上链，实现真正的链上治理。

### 智能合约设计

```solidity
/// @title ClawDAO — 链上治理
/// @notice 信誉加权投票 + 平方根 Token 权重 + 时间锁执行
contract ClawDAO is UUPSUpgradeable {

    struct Proposal {
        bytes32 proposalId;
        address proposer;
        ProposalType pType;
        bytes32 descriptionHash;    // IPFS hash
        bytes   callData;           // 执行调用数据
        address target;             // 执行目标合约
        uint64  discussionEnd;      // 讨论期结束
        uint64  votingEnd;          // 投票期结束
        uint64  timelockEnd;        // 时间锁结束
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        ProposalStatus status;
    }

    enum ProposalType {
        ParameterChange,     // 参数调整
        TreasurySpend,       // 国库支出
        ProtocolUpgrade,     // 协议升级
        Emergency,           // 紧急操作
        Signal               // 信号投票
    }

    enum ProposalStatus {
        Discussion, Voting, Passed, Rejected,
        Timelocked, Executed, Cancelled, Expired
    }

    IClawToken public token;
    IClawReputation public reputation;
    IClawStaking public staking;

    // 治理参数（DAO 自治可调）
    uint64 public discussionPeriod;     // 默认 2 天
    uint64 public votingPeriod;         // 默认 3-7 天
    uint64 public timelockDelay;        // 默认 1-7 天
    uint256 public proposalThreshold;   // 提案门槛 Token 数
    uint256 public quorumBps;           // 法定人数 (basis points)

    mapping(bytes32 => Proposal) public proposals;
    // proposalId → voter → voted
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(bytes32 indexed proposalId, address proposer, ProposalType pType);
    event VoteCast(bytes32 indexed proposalId, address voter, uint8 support, uint256 weight);
    event ProposalExecuted(bytes32 indexed proposalId);

    /// @notice 提交提案
    function propose(
        ProposalType pType,
        bytes32 descriptionHash,
        address target,
        bytes calldata callData
    ) external returns (bytes32 proposalId);

    /// @notice 投票
    /// @param support 0=反对, 1=赞成, 2=弃权
    function vote(bytes32 proposalId, uint8 support) external;

    /// @notice 计算投票权重
    /// @dev √(tokenBalance) × (1 + trustScore/1000) × lockupMultiplier
    function getVotingPower(address voter) public view returns (uint256);

    /// @notice 执行通过的提案（时间锁到期后）
    function execute(bytes32 proposalId) external;

    /// @notice 紧急操作（多签 5/9）
    function emergencyExecute(bytes32 proposalId, bytes[] calldata sigs) external;
}
```

### 可治理参数清单

以下参数的修改需要通过 DAO 提案投票：

```
┌────────────────────────────────────────────────────┐
│              DAO 可治理参数                          │
│                                                     │
│  市场参数:                                          │
│  ├── marketFeeRate (info: 2%, task: 5%, cap: 3%)   │
│  ├── market_min_fee (1 Token)                      │
│  ├── market_max_fee (100,000 Token)                │
│  └── MIN_TRANSFER_AMOUNT / MIN_ESCROW_AMOUNT       │
│                                                     │
│  Escrow 参数:                                       │
│  ├── base_escrow_rate (0.5%)                       │
│  ├── holding_rate (0.01%/day)                      │
│  └── min_escrow_fee (1 Token)                      │
│                                                     │
│  信誉参数:                                          │
│  ├── trustDecayRate                                │
│  ├── 各等级折扣率 (Legend 20%, Elite 15%...)        │
│  └── epochDuration (24h)                           │
│                                                     │
│  节点参数:                                          │
│  ├── minNodeStake (10,000 Token)                   │
│  ├── validatorRewardRate (1 Token/snapshot)         │
│  └── slashingRate (1 Token/violation)              │
│                                                     │
│  治理参数（元治理）:                                │
│  ├── proposalThreshold                             │
│  ├── votingPeriod                                  │
│  ├── timelockDelay                                 │
│  └── quorumBps                                     │
│                                                     │
└────────────────────────────────────────────────────┘
```

### 实施步骤

```
Phase D1: 合约开发                                  [5 周]
├── ClawDAO.sol + 投票权计算
├── 时间锁合约 (TimeLock.sol)
├── 多签紧急合约 (MultiSig.sol)
├── 参数注册表合约 (ParamRegistry.sol)
└── 完整单元测试 + 攻击测试

Phase D2: 前端/CLI 集成                             [3 周]
├── SDK 治理模块
├── CLI 命令：propose / vote / execute
└── 提案详情页（链上数据 + IPFS 描述）

Phase D3: 测试与部署                                [2 周]
├── 治理场景端到端测试
├── 攻击模拟（闪电贷攻击投票、巨鲸垄断等）
└── 测试网部署 + 社区治理演练
```

---

## 10. 模块七：Staking / Node Incentives

### 目标

节点必须质押 Token 才能参与网络，链上管理质押/解押/奖励/惩罚。

### 智能合约设计

```solidity
/// @title ClawStaking — 节点质押与激励
contract ClawStaking is UUPSUpgradeable {

    struct StakeInfo {
        uint256 amount;             // 质押金额
        uint64  stakedAt;           // 质押时间
        uint64  unstakeRequestAt;   // 解押请求时间（0=无请求）
        uint256 rewards;            // 累计待领取奖励
        uint256 slashed;            // 累计被惩罚金额
        NodeType nodeType;          // 节点类型
        bool    active;             // 是否活跃
    }

    enum NodeType { Validator, Relay, Matcher, Arbiter, Indexer }

    IClawToken public token;

    uint256 public minStake;                        // 最低质押 (DAO 可调)
    uint64  public unstakeCooldown;                 // 解押冷却期
    uint256 public rewardPerEpoch;                  // 每 epoch 奖励
    uint256 public slashPerViolation;               // 每次违规惩罚

    mapping(address => StakeInfo) public stakes;
    address[] public activeValidators;

    event Staked(address indexed node, uint256 amount, NodeType nodeType);
    event UnstakeRequested(address indexed node, uint64 unlockAt);
    event Unstaked(address indexed node, uint256 amount);
    event RewardClaimed(address indexed node, uint256 amount);
    event Slashed(address indexed node, uint256 amount, bytes32 reason);

    /// @notice 质押 Token 成为节点
    function stake(uint256 amount, NodeType nodeType) external;

    /// @notice 请求解押（进入冷却期）
    function requestUnstake() external;

    /// @notice 完成解押（冷却期后）
    function unstake() external;

    /// @notice 领取奖励
    function claimRewards() external;

    /// @notice 惩罚节点（由仲裁/DAO 调用）
    function slash(address node, uint256 amount, bytes32 reason) external;

    /// @notice 分发 epoch 奖励（由系统调用）
    function distributeRewards(address[] calldata validators, uint256[] calldata amounts) external;

    /// @notice 查询质押状态
    function getStakeInfo(address node) external view returns (StakeInfo memory);

    /// @notice 判断是否为活跃验证者
    function isActiveValidator(address node) external view returns (bool);
}
```

### 质押经济模型

```
┌─────────────────────────────────────────────────────────────────────┐
│                    质押经济循环                                       │
│                                                                      │
│    节点质押 Token                                                    │
│         │                                                            │
│         ▼                                                            │
│    参与验证/中继                                                     │
│         │                                                            │
│    ┌────┴────┐                                                      │
│    │         │                                                      │
│    ▼         ▼                                                      │
│  正常工作   作恶/离线                                                │
│    │         │                                                      │
│    ▼         ▼                                                      │
│  获得奖励   被惩罚(Slash)                                           │
│    │         │                                                      │
│    ▼         ▼                                                      │
│  奖励来源:  惩罚去向:                                                │
│  Treasury   Treasury (回流)                                         │
│  手续费分成  或 销毁                                                 │
│                                                                      │
│  MVP 默认参数:                                                       │
│  ├── 最低质押: 10,000 Token                                         │
│  ├── 解押冷却: 7 天                                                  │
│  ├── Validator 奖励: 1 Token/snapshot                                │
│  ├── 违规惩罚: 1 Token/次                                           │
│  └── 24h 内 3 次违规: 临时封禁                                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 实施步骤

```
Phase S1: 合约开发                                  [3 周]
├── ClawStaking.sol + 测试
├── 奖励分发机制
├── Slash 机制 + 冷却期
└── 与 ClawToken.sol 集成

Phase S2: 节点适配                                  [3 周]
├── 修改 packages/node/ 启动流程
│   └── 启动前检查链上质押状态
├── 奖励自动领取
└── 违规检测 → 自动 slash 上报

Phase S3: 测试                                      [2 周]
├── 质押/解押全流程
├── Slash 场景测试
└── 奖励计算正确性验证
```

---

## 11. 跨模块集成

### 合约间调用关系

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        合约调用关系图                                      │
│                                                                            │
│                          ClawRouter                                       │
│                         (统一入口)                                        │
│                              │                                            │
│          ┌───────────┬───────┴───────┬────────────┬──────────┐           │
│          │           │               │            │          │           │
│          ▼           ▼               ▼            ▼          ▼           │
│    ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌────────┐    │
│    │ClawToken │ │ClawEscrow│ │ClawContra.│ │ ClawDAO  │ │ClawSta.│    │
│    │          │ │          │ │           │ │          │ │        │    │
│    │ ERC-20   │ │ 托管管理 │ │ 服务合约  │ │ 治理     │ │ 质押   │    │
│    └────┬─────┘ └────┬─────┘ └─────┬─────┘ └────┬─────┘ └───┬────┘    │
│         │            │             │             │           │          │
│         │      ┌─────┘      ┌──────┘       ┌────┘     ┌─────┘          │
│         │      │            │              │          │                │
│         ▼      ▼            ▼              ▼          ▼                │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│    │ClawIdentity  │  │ClawReputation│  │ ParamRegistry│               │
│    │              │  │              │  │              │               │
│    │ DID 注册表   │  │ 信誉锚定     │  │ 治理参数     │               │
│    └──────────────┘  └──────────────┘  └──────────────┘               │
│                                                                        │
│  调用示例:                                                             │
│  ClawContracts → ClawEscrow.createEscrow()  (合约签订时创建托管)      │
│  ClawContracts → ClawEscrow.release()       (里程碑通过时释放资金)    │
│  ClawDAO → ParamRegistry.setParam()         (投票通过后更新参数)      │
│  ClawDAO → ClawStaking.slash()              (DAO 决议惩罚节点)        │
│  ClawStaking → ClawToken.transfer()         (奖励分发)               │
│  ClawEscrow → ClawToken.transferFrom()      (托管资金操作)           │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 权限矩阵

| 调用方 | ClawToken | ClawEscrow | ClawContracts | ClawDAO | ClawStaking | ClawReputation |
|--------|-----------|-----------|---------------|---------|-------------|---------------|
| 用户 EOA | transfer | create/fund | create/sign | propose/vote | stake/unstake | — |
| ClawEscrow | transferFrom | — | — | — | — | — |
| ClawContracts | — | release/refund | — | — | — | — |
| ClawDAO | mint/burn | — | — | execute | slash/setParams | — |
| ClawStaking | transferFrom | — | — | — | — | — |
| 授权节点 | — | — | — | — | distributeRewards | anchor/record |

---

## 12. 迁移方案

### 三阶段迁移

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       迁移路线                                           │
│                                                                          │
│  阶段 A: 部署 + 初始化                          [2 周]                   │
│  ├── 部署所有合约到测试网                                                │
│  ├── 验证合约功能                                                        │
│  └── 社区公示合约地址                                                    │
│                                                                          │
│  阶段 B: 双轨运行                               [4 周]                   │
│  ├── 链下系统继续运行                                                    │
│  ├── 链上系统同步写入                                                    │
│  ├── 对比链上链下状态一致性                                              │
│  └── 发现并修复差异                                                      │
│                                                                          │
│  阶段 C: 切换 + 退役                            [2 周]                   │
│  ├── 链上成为 source of truth                                            │
│  ├── 链下降级为缓存/索引层                                               │
│  └── 废弃链下共识机制                                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 数据迁移详细步骤

#### 1. Token 余额迁移

```
1. 设定迁移截止区块（快照点）
2. 从链下事件日志导出所有 DID → 余额映射
3. DID → EVM address 映射（通过 ClawIdentity 注册）
4. 批量调用 ClawToken.mint() 初始化余额
5. 验证：链上总量 = 链下总量
6. 冻结链下转账，启用链上转账
```

#### 2. Identity 迁移

```
1. 导出所有活跃 DID + 公钥
2. 批量调用 ClawIdentity.registerDID()
3. 已验证平台链接 hash 批量上链
4. 验证：所有 DID 可在链上解析
```

#### 3. 进行中的 Escrow 迁移

```
1. 导出所有 Active 状态的 Escrow
2. 在链上重建（depositor → ClawEscrow.createEscrow）
3. 链下 Escrow 标记为 "migrated"
4. 后续释放/退款走链上
```

#### 4. 进行中的合约迁移

```
1. 导出所有 Active 状态的 ServiceContract
2. 链上创建对应合约 + 里程碑
3. 已完成的里程碑直接标记 Approved
4. 未完成的里程碑继续在链上执行
```

### 回滚方案

```
如果迁移过程中发现严重问题:
1. 暂停链上合约（OpenZeppelin Pausable）
2. 恢复链下系统为 source of truth
3. 链上数据保留但标记为无效
4. 修复问题后重新迁移
```

---

## 13. 安全审计计划

### 审计范围

| 阶段 | 范围 | 预期提供方 | 时间 |
|------|------|-----------|------|
| 内部审计 | 所有合约 | 核心团队 | 持续 |
| 自动化审计 | 所有合约 | Slither / Mythril / Aderyn | 开发中 |
| 外部审计 1 | ClawToken + ClawEscrow | 专业审计公司 | 主网部署前 |
| 外部审计 2 | ClawDAO + ClawStaking | 专业审计公司 | 主网部署前 |
| 外部审计 3 | ClawContracts + ClawIdentity + ClawReputation | 专业审计公司 | 主网部署前 |
| Bug Bounty | 所有合约 | 社区白帽 | 上线后持续 |

### 安全要求

```
┌─────────────────────────────────────────────────────────────────────┐
│                       安全矩阵                                       │
│                                                                      │
│  已知攻击向量          防护措施                                      │
│  ─────────────────────────────────────────────────────────────────  │
│  重入攻击              ReentrancyGuard + checks-effects-interactions │
│  整数溢出              Solidity 0.8+ 内置检查                        │
│  闪电贷攻击投票        快照机制（投票前 N 个区块余额）               │
│  前端运行(Front-run)   commit-reveal 投票 / 私密 mempool            │
│  治理攻击              时间锁 + 紧急多签 + 平方根投票权              │
│  预言机操纵            链下多节点共识 + 挑战期                       │
│  升级风险              UUPS + 时间锁 + DAO 审批                     │
│  密钥泄露              多签管理员 + 密钥轮换                        │
│  DoS 攻击              Gas 限制 + 速率限制                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 14. 实施时间线

### 整体路线图

```
2026 Q2                    2026 Q3                    2026 Q4                    2027 Q1
  │                          │                          │                          │
  ├── Phase 0               ├── Phase 1               ├── Phase 2               ├── Phase 3
  │   基础设施               │   核心合约               │   高级合约               │   全面迁移
  │                          │                          │                          │
  │ ┌──────────────────┐    │ ┌──────────────────┐    │ ┌──────────────────┐    │ ┌──────────────────┐
  │ │• Hardhat 项目搭建 │    │ │• ClawToken 部署  │    │ │• ClawDAO 部署    │    │ │• 主网部署准备     │
  │ │• CI/CD 流水线     │    │ │• ClawEscrow 部署 │    │ │• ClawContracts   │    │ │• 余额迁移         │
  │ │• 测试框架         │    │ │• ClawIdentity    │    │ │• ClawReputation  │    │ │• 双轨运行         │
  │ │• OP Stack L3    │    │ │• ClawStaking     │    │ │• 外部审计        │    │ │• 切换 source of   │
  │ │  搭建             │    │ │• 测试网部署      │    │ │• Bug Bounty 启动 │    │ │  truth            │
  │ │• Ed25519 适配     │    │ │• SDK 适配        │    │ │• SDK 适配        │    │ │• 链下系统退役     │
  │ └──────────────────┘    │ └──────────────────┘    │ └──────────────────┘    │ └──────────────────┘
  │                          │                          │                          │
  │ 4 周                     │ 10 周                    │ 12 周                    │ 8 周
```

### 详细甘特图

```
任务                                 Q2-W1  W2  W3  W4  Q3-W1  W2  W3  W4  W5  W6  W7  W8  W9  W10  Q4-W1  W2  W3  ...
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Phase 0: 基础设施
  Hardhat/Foundry 项目搭建           ████
  CI/CD + 自动化测试                      ████
  OpenZeppelin 集成                       ████
  OP Stack L3 搭建 + Ed25519 适配             ████

Phase 1: 核心合约 (P0)
  ClawToken.sol 开发                                ████████
  ClawToken.sol 测试                                     ████████
  ClawEscrow.sol 开发                                         ████████████
  ClawEscrow.sol 测试                                              ████████
  ClawIdentity.sol 开发                                                 ████████
  ClawStaking.sol 开发                                                       ████████████
  测试网部署 (Token+Escrow+Identity+Staking)                                          ████
  SDK 适配 (Wallet + Identity)                                                             ████████

Phase 2: 高级合约 (P1)
  ClawDAO.sol 开发                                                                              ████████████████
  ClawContracts.sol 开发                                                                             ████████████████
  ClawReputation.sol 开发                                                                                 ████████
  ParamRegistry.sol 开发                                                                                       ████
  测试网部署 (全部合约)                                                                                             ████
  SDK 适配 (DAO + Contracts + Reputation)                                                                            ████████
  外部安全审计                                                                                                            ████████████
  Bug Bounty 启动                                                                                                              ████

Phase 3: 迁移 (2027 Q1)
  主网部署准备                                                                                                                      ... 
  数据迁移 + 双轨运行                                                                                                               ...
  切换 + 退役链下系统                                                                                                               ...
```

### 人力资源需求

| 角色 | 人数 | 职责 |
|------|------|------|
| 智能合约工程师 | 2 | Solidity 开发、测试、部署 |
| 后端/节点工程师 | 2 | SDK 适配、节点对接、迁移 |
| 安全工程师 | 1 | 内部审计、自动化扫描、配合外部审计 |
| 前端工程师 | 1 | DAO 界面、合约交互 UI |
| DevOps | 1 | CI/CD、测试网运维、监控 |
| **总计** | **7** | |

---

## 15. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| 智能合约漏洞 | 资金损失 | 中 | 多轮审计 + Bug Bounty + 可暂停 + UUPS 可升级 |
| Gas 成本超预期 | 用户体验差 | 低 | 自建 L3 可调 Gas 参数 + 批量操作 + 链下优先策略 |
| Ed25519 兼容问题 | 身份系统无法迁移 | 低 | 预编译调研 + 链下验证备选方案 |
| 迁移数据不一致 | 余额错误 | 中 | 双轨运行期 + 自动对账 + 回滚机制 |
| 外部审计延期 | 上线延迟 | 中 | 提前预约 + 并行多家审计 |
| L3 排序器故障 | 服务中断 | 低 | 排序器高可用部署 + 链下系统保持可用作 fallback |
| DAO 治理攻击 | 恶意参数修改 | 低 | 平方根投票 + 时间锁 + 紧急多签 |

---

## 附录 A：新增 Package 结构

```
packages/
  contracts/                        # 新增
    ├── package.json
    ├── hardhat.config.ts
    ├── foundry.toml                # 可选 Foundry 配合
    ├── contracts/
    │   ├── ClawToken.sol
    │   ├── ClawEscrow.sol
    │   ├── ClawIdentity.sol
    │   ├── ClawStaking.sol
    │   ├── ClawDAO.sol
    │   ├── ClawContracts.sol
    │   ├── ClawReputation.sol
    │   ├── ClawRouter.sol
    │   ├── ParamRegistry.sol
    │   └── libraries/
    │       ├── Ed25519Verifier.sol
    │       └── MerkleProof.sol
    ├── test/
    │   ├── ClawToken.test.ts
    │   ├── ClawEscrow.test.ts
    │   ├── ClawIdentity.test.ts
    │   ├── ClawStaking.test.ts
    │   ├── ClawDAO.test.ts
    │   ├── ClawContracts.test.ts
    │   ├── ClawReputation.test.ts
    │   └── integration/
    │       ├── full-cycle.test.ts
    │       └── migration.test.ts
    ├── scripts/
    │   ├── deploy.ts
    │   ├── migrate-balances.ts
    │   ├── migrate-identities.ts
    │   └── verify.ts
    ├── deployments/                # 部署地址记录
    │   ├── clawnetTestnet.json
    │   └── clawnetMainnet.json
    └── typechain-types/            # 自动生成

infra/                              # 新增 — L3 基础设施
  l3-devnet/
    ├── docker-compose.yml          # L3 本地 devnet
    ├── genesis.json                # 创世配置
    ├── rollup.json                 # OP Stack rollup 配置
    └── sequencer.env               # 排序器环境变量
  l3-testnet/
    └── ...                         # 测试网部署配置
  l3-mainnet/
    └── ...                         # 主网部署配置
```

## 附录 B：SDK 变更概览

```typescript
// packages/sdk/src/index.ts 变更
import { WalletApi } from './wallet.js';
import { WalletOnChainApi } from './wallet-onchain.js';     // 新增

export class ClawNet {
  readonly wallet: WalletApi | WalletOnChainApi;

  constructor(opts: ClawNetOptions) {
    if (opts.onChain) {
      // 链上模式：通过 ethers.js / viem 与智能合约交互
      this.wallet = new WalletOnChainApi(opts.provider, opts.contracts);
    } else {
      // 链下模式：通过 HTTP API 与节点交互（兼容 Phase 1）
      this.wallet = new WalletApi(this.http);
    }
  }
}

// 两种模式共用相同接口
interface IWallet {
  getBalance(params?: { did?: string }): Promise<Balance>;
  transfer(params: TransferParams): Promise<TransferResult>;
  createEscrow(params: CreateEscrowParams): Promise<Escrow>;
  releaseEscrow(escrowId: string, params: EscrowActionParams): Promise<TransferResult>;
  // ...
}
```

## 附录 C：关键决策记录

| # | 决策 | 选项 | 结论 | 原因 |
|---|------|------|------|------|
| 1 | 主链选择 | Ethereum L1 / Base L2 / Solana / 自建 L3 | 自建 L3 (OP Stack) | Gas 收入归协议 + Token 作 Gas 代币 + EVM 兼容 + L1 安全继承 |
| 2 | 合约框架 | Hardhat / Foundry | Hardhat (+ Foundry 辅助) | TypeScript 生态一致性 |
| 3 | 升级模式 | Transparent Proxy / UUPS / Diamond | UUPS | Gas 效率 + OpenZeppelin 支持 |
| 4 | Token 标准 | ERC-20 / 自定义 | ERC-20 (decimals=0) | 与链下整数单位一致 + 生态兼容 |
| 5 | Identity 链上存储 | 完整 DID Doc / Hash 锚定 | Hash + 最小映射 | 节省 gas，完整文档存 IPFS |
| 6 | Reputation 上链方式 | 完全链上 / Merkle 锚定 | Merkle 锚定 | 计算复杂度高，链上不经济 |
| 7 | Market 上链范围 | 全部 / 仅结算 | 仅结算 | 挂单/搜索高频操作不适合链上 |

---

*最后更新: 2026年2月22日*
*状态: 规划中 — 待团队评审*
