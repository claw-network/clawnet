# ClawNet Local Devnet

本地开发链，使用 `geth --dev` 模式运行，无需 Docker。

## 环境要求

| 依赖 | 版本 | 安装 |
|------|------|------|
| geth | ≥ 1.14 | `brew install ethereum` |
| Node.js | ≥ 18 | — |
| pnpm | ≥ 9 | `npm i -g pnpm` |

> **注意**：`geth --dev` 使用 chainId **1337**，与 testnet（7625）不同。Hardhat 配置通过 `CLAWNET_DEVNET_CHAIN_ID` 环境变量适配。

## 快速开始

```bash
cd infra/devnet

# 1. 启动 devnet（后台运行）
./start.sh -d

# 2. 给 deployer 转入 100 ETH
./fund-deployer.sh

# 3. 部署全部合约
./deploy.sh

# 4. 停止 devnet
./stop.sh
```

## 脚本说明

| 脚本 | 用途 |
|------|------|
| `start.sh` | 启动 geth dev 模式。`-d` 后台运行，不带参数前台运行 |
| `stop.sh` | 停止 geth 进程 |
| `reset.sh` | 清空链数据，重新开始 |
| `fund-deployer.sh` | 从 dev 账户向 deployer 转 100 ETH |
| `deploy.sh` | 编译并部署全部 9 个合约到 devnet |
| `.env` | 环境变量配置 |

## 链信息

| 项目 | 值 |
|------|-----|
| Chain ID | 1337 |
| RPC | http://127.0.0.1:8545 |
| 共识 | Dev PoA（即时出块） |
| Deployer | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`（Hardhat 默认账户 #0） |

## 开发工作流

### 重置并重新部署

```bash
./reset.sh       # 清空数据
./start.sh -d    # 重新启动
./fund-deployer.sh
./deploy.sh
```

### 前台运行（调试）

```bash
./start.sh       # 前台运行，日志直接输出到终端，Ctrl-C 停止
```

### 查看日志

```bash
tail -f geth.log   # 后台运行时查看日志
```

### 与 Hardhat 交互

```bash
cd packages/contracts

# 使用 devnet 网络
npx hardhat console --network clawnetDevnet

# 运行单个脚本
npx hardhat run scripts/deploy-all.ts --network clawnetDevnet
```

## 文件结构

```
infra/devnet/
├── .env              # 环境变量
├── start.sh          # 启动脚本
├── stop.sh           # 停止脚本
├── reset.sh          # 重置脚本
├── fund-deployer.sh  # 部署者充值
├── deploy.sh         # 合约部署
├── README.md         # 本文件
├── data/             # geth 链数据（git ignored）
├── geth.log          # 日志文件（git ignored）
└── geth.pid          # 进程 PID（git ignored）
```

## .gitignore

`data/`、`geth.log`、`geth.pid` 已在 `.gitignore` 中排除。
