# ClawNet Local Devnet

本地开发链，默认使用 Besu dev 模式运行；如需验证自定义预编译镜像，可改用 Docker 入口。

## 环境要求

| 依赖 | 版本 | 安装 |
|------|------|------|
| besu | ≥ 24.x | `brew install hyperledger/besu/besu` |
| Node.js | ≥ 18 | — |
| pnpm | ≥ 9 | `npm i -g pnpm` |

> **注意**：Besu `--network=dev` 使用 chainId **1337**，与 testnet（7625）不同。Hardhat 配置通过 `CLAWNET_DEVNET_CHAIN_ID` 环境变量适配。

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

## 自定义 Besu 预编译镜像验证

如果要验证 `0x0100` Ed25519 预编译，不要改现有本机 `besu` 安装；直接使用 Docker 入口：

```bash
cd infra/devnet

CLAWNET_BESU_IMAGE=clawnet/besu-ed25519:dev \
docker compose -f docker-compose.ed25519.yml up -d

./fund-deployer.sh

CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545 \
CLAWNET_BESU_CHAIN_ID=1337 \
../../scripts/test-ed25519-precompile.mjs

CLAWNET_BESU_PRECOMPILE_TEST=1 \
CLAWNET_BESU_RPC_URL=http://127.0.0.1:8545 \
CLAWNET_BESU_CHAIN_ID=1337 \
pnpm --dir ../.. contracts:test:ed25519:besu
```

停止：

```bash
docker compose -f docker-compose.ed25519.yml down
```

固定测试向量与实现侧接口契约见 `../besu/ed25519-precompile-spec.md`。

## 脚本说明

| 脚本 | 用途 |
|------|------|
| `start.sh` | 启动本机 Besu dev 模式。`-d` 后台运行，不带参数前台运行 |
| `stop.sh` | 停止本机 Besu 进程 |
| `reset.sh` | 清空链数据，重新开始 |
| `fund-deployer.sh` | 从 dev 账户向 deployer 转 100 ETH |
| `deploy.sh` | 编译并部署全部 9 个合约到 devnet |
| `docker-compose.ed25519.yml` | 启动自定义 Besu 镜像，用于预编译验证 |
| `.env` | 环境变量配置 |

## 链信息

| 项目 | 值 |
|------|-----|
| Chain ID | 1337 |
| RPC | http://127.0.0.1:8545 |
| 共识 | Besu Dev（即时出块） |
| Deployer | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`（Hardhat 默认账户 #0） |

## 开发工作流

### 重置并重新部署

```bash
./reset.sh       # 清空数据
./start.sh -d    # 重新启动 Besu
./fund-deployer.sh
./deploy.sh
```

### 前台运行（调试）

```bash
./start.sh       # 前台运行，日志直接输出到终端，Ctrl-C 停止
```

### 查看日志

```bash
tail -f besu.log   # 后台运行时查看日志
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
├── start.sh                  # 启动本机 Besu dev 链
├── stop.sh                   # 停止本机 Besu dev 链
├── reset.sh                  # 重置脚本
├── fund-deployer.sh          # 部署者充值
├── deploy.sh                 # 合约部署
├── docker-compose.ed25519.yml # 自定义 Besu 镜像入口
├── README.md                 # 本文件
├── data/                     # Besu 链数据（git ignored）
├── besu.log                  # 日志文件（git ignored）
└── besu.pid                  # 进程 PID（git ignored）
```

## .gitignore

`data/`、`besu.log`、`besu.pid` 已在 `.gitignore` 中排除。
