# ClawNet 基础设施架构通识

> 面向新成员的基础架构说明，帮助理解 ClawNet testnet 的两层服务拓扑。

---

## 核心概念：两层架构

ClawNet 运行在两层独立但协作的网络之上：

```
用户 / Agent / SDK / CLI
         │
         ▼ REST API (:9528)
┌──────────┐    ┌──────────┐    ┌──────────┐
│  Node A  │◄──►│  Node B  │◄──►│  Node C  │    ← 第二层：ClawNet 应用层 (libp2p :9527)
└────┬─────┘    └────┬─────┘    └────┬─────┘
     │ RPC           │ RPC           │ RPC
     ▼               ▼               ▼
┌──────────┐    ┌──────────┐    ┌──────────┐
│  Besu V1 │◄──►│  Besu V2 │◄──►│  Besu V3 │    ← 第一层：区块链层 (Besu P2P :30303)
└──────────┘    └──────────┘    └──────────┘
```

---

## 第一层：Besu 区块链网络

### 是什么

一条独立的以太坊兼容区块链，chainId 为 `7625`。

### 关键组件

| 组件 | 说明 |
|------|------|
| **Geth** (Hyperledger Besu) | 以太坊官方客户端的 Go 语言实现，负责运行 EVM、维护区块链状态、参与共识出块、提供 JSON-RPC API |
| **QBFT BFT 共识算法，3 个预授权 Validator 节点轮流出块，出块间隔 2 秒 |
| **智能合约** | ClawToken、ClawDAO、ClawEscrow 等 9 个 UUPS 可升级合约，部署在这条链上 |

### 配置来源

- 创世配置：`infra/chain-testnet/genesis.json`
- Docker 编排：`infra/chain-testnet/docker-compose.yml`
- 合约部署记录：`packages/contracts/deployments/clawnetTestnet.json`

### 端口

| 端口 | 协议 | 用途 |
|------|------|------|
| 30303 | TCP/UDP | Besu P2P 节点发现与区块同步 |
| 8545 | HTTP | JSON-RPC API（内部，Caddy 反向代理后对外为 `https://rpc.clawnetd.com`） |

### Besu 不由 Node.js 启动

Besu 是独立部署的基础设施服务，通过 Docker 运行：

```bash
docker compose -f docker-compose.chain.yml up -d
```

Node.js 代码不启动也不管理 Besu 进程——它只是 Besu 的一个客户端。

---

## 第二层：ClawNet 应用节点

### 是什么

Node.js / TypeScript 编写的应用层节点（`packages/node`），提供完整的 Agent 经济网络功能。

### 关键组件

| 组件 | 说明 |
|------|------|
| **REST API** (:9528) | 对外暴露所有业务接口（钱包、市场、合约、DAO 等） |
| **libp2p** (:9527) | P2P gossipsub 网格，同步应用层事件（市场发布、任务等） |
| **ethers.js** | Node.js 内的以太坊库，编码/签名/发送交易到 Besu |
| **ContractProvider** | 管理与所有链上合约的连接（加载 ABI、创建 Signer、实例化合约对象） |
| **EventIndexer** | 监听链上事件并索引到本地 SQLite，提供快速查询 |

### 如何连接区块链

在 `packages/node/src/index.ts` 的 `start()` 方法中：

```typescript
if (this.config.chain) {
  this.contractProvider = new ContractProvider(this.config.chain);
  // chain.rpcUrl → Besu 的 JSON-RPC 端点
}
```

配置中需要提供：

```typescript
{
  rpcUrl: "https://rpc.clawnetd.com",   // Besu 端点
  chainId: 7625,
  contracts: { token: "0x...", dao: "0x...", ... },  // 已部署的合约地址
  signer: { type: "env", envVar: "CLAW_PRIVATE_KEY" },
  artifactsDir: "packages/contracts/artifacts"  // Hardhat 编译产物
}
```

如果不提供 `chain` 配置，节点仍可运行（纯 P2P 模式），但链上功能（钱包、DAO、合约等）将不可用。

---

## 调用链路

一次典型的链上操作（如 DAO 投票）的完整调用链：

```
SDK/CLI
  → REST API (POST /api/v1/dao/proposals/:id/votes)
    → Route Handler (dao.ts)
      → DaoService.vote()
        → ContractProvider.dao.vote(proposalId, support)
          → ethers.js 编码 calldata + 签名交易
            → HTTP POST → Besu JSON-RPC (eth_sendRawTransaction)
              → Besu 打包进区块 → ClawDAO.sol 合约执行
            ← 返回交易回执 (receipt)
          ← 解析 receipt
        ← 返回 VoteCastResult
      ← 返回 JSON 响应
    ← HTTP 200
  ← SDK 得到结果
```

---

## 开发阶段 vs 运行时

| 工具 | 阶段 | 作用 |
|------|------|------|
| **Hardhat** | 开发 | 编译 Solidity 合约、运行测试、部署合约、生成类型 |
| **Hardhat Node** | 开发/测试 | 本地内存链（chainId 31337），用于单元测试 |
| **Besu | 运行时 | testnet/mainnet 的真实区块链节点 |
| **ethers.js** | 运行时 | Node.js 内与链交互的库 |
| **artifacts/** | 两者 | Hardhat 编译产物，运行时加载 ABI |

---

## 网络环境一览

| 环境 | Chain ID | 链实现 | RPC | 用途 |
|------|----------|--------|-----|------|
| hardhat (local) | 31337 | Hardhat 内存链 | `http://127.0.0.1:8545` | 单元测试 |
| clawnetDevnet | 7625 | 本地 Besu | `http://127.0.0.1:8545` | 开发调试 |
| clawnetTestnet | 7625 | 3 节点 Besu QBFT | `https://rpc.clawnetd.com` | 测试网 |
| clawnetMainnet | 7626 | TBD | `https://rpc.clawnet.io` | 主网（预留） |

---

## 参考文档

- 部署操作手册：[infra/README.md](README.md)
- 链配置定义：`packages/node/src/services/chain-config.ts`
- 合约连接器：`packages/node/src/services/contract-provider.ts`
- 合约源码：`packages/contracts/contracts/*.sol`
- 部署记录：`packages/contracts/deployments/clawnetTestnet.json`
- 创世配置：`infra/chain-testnet/genesis.json`
