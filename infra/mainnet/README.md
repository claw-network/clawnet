# ClawNet Mainnet Infrastructure

> T-3.10 ~ T-3.15: 主网基础设施准备 → 部署 → 数据迁移 → 上线

## 概述

主网采用 5 节点 Geth v1.13.15 Clique PoA 共识（3/5 签名出块），复用测试网已验证的架构。

## 网络拓扑

```
┌───────────────────────────────────────────────────────────────────┐
│                  ClawNet Mainnet (chainId 7626)                   │
│                     5 Validator Nodes                              │
└───────────────────────────────────────────────────────────────────┘

┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ ┌───────────┐
│  Node 1     │ │  Node 2     │ │  Node 3     │ │  Node 4   │ │  Node 5   │
│  Validator  │ │  Validator  │ │  Validator  │ │ Validator │ │ Validator │
│  + API GW   │ │             │ │             │ │  (新增)   │ │  (新增)   │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └─────┬─────┘ └─────┬─────┘
       │               │               │              │              │
       └───────────── P2P (port 30303) ───────────────┘──────────────┘
```

## 与测试网的差异

| 配置项 | 测试网 | 主网 |
|--------|--------|------|
| chainId | 7625 | 7626 |
| Validator 数量 | 3 | 5 (3/5 签名出块) |
| 域名 | rpc.clawnetd.com | rpc.clawnet.io |
| 合约地址 | clawnetTestnet.json | clawnetMainnet.json |
| 数据来源 | 初始 mint | 从测试网迁移 |

## 准备工作清单

### 1. 服务器准备

- [ ] 采购 2 台新 VPS (Contabo VPS S, €5.99/月)
- [ ] 运行 `setup-server.sh` 初始化 (Docker, UFW, swap 等)
- [ ] 配置 SSH 密钥免密登录

### 2. 密钥生成

```bash
# 生成 5 个 Validator 密钥 + 1 个 Deployer + 1 个 Treasury
cd infra/mainnet
node ../../scripts/gen-testnet-keys.mjs --validators 5 --output secrets.env
```

### 3. 多签钱包 (Safe)

为 `LIQUIDITY_ADDRESS` / `RESERVE_ADDRESS` 创建 Safe 多签（建议 3/5 门限）。

Signer 钱包和 Owner 收集复用 testnet 脚本（网络无关），Safe 合约创建使用主网专用脚本：

```bash
# Step 1-2: 复用 testnet 脚本创建 signer + 收集 owners（详见 testnet README）
bash infra/testnet/multisig-soft-wallet/create-signer-wallet.sh --name signer1
# ... 共 5 个 signer
bash infra/testnet/multisig-soft-wallet/collect-owner-addresses.sh \
  --input .../signer1/public-info.txt ... --threshold 3

# Step 3: 主网 Safe 创建
bash infra/mainnet/multisig-soft-wallet/create-safe-addresses.sh
```

详见：[multisig-soft-wallet/README.md](multisig-soft-wallet/README.md)

### 4. Genesis 配置

```bash
# 基于 genesis-template.json 生成实际 genesis
# 填入 5 个 validator 地址 + deployer/treasury 预分配
```

### 5. 部署顺序

1. 生成密钥 → `secrets.env`
2. 创建 Safe 多签 → `LIQUIDITY_ADDRESS` / `RESERVE_ADDRESS`
3. 构建 genesis.json (chainId 7626, 5 validators)
4. Node 1 先启动 mining
5. Node 2-3 sync → mine
6. Node 4-5 sync → mine
7. 验证 5 节点出块一致
8. 部署 9 个合约 → `clawnetMainnet.json`
9. Safe 多签转入初始资金
10. 数据迁移 (DID, 余额, Escrow, ServiceContract)
11. 对账验证 (reconcile.ts)
12. 启动 5 台 ClawNet Node
13. DNS 切换

## 文件清单

```
infra/mainnet/
├── README.md                  # 本文档
├── genesis-template.json      # Genesis 模板 (chainId 7626)
├── docker-compose.yml         # Node 1 (primary validator + API GW)
├── docker-compose.peer.yml    # Node 2-5 (peer validators)
├── Caddyfile                  # 反向代理 (rpc.clawnet.io)
├── .env.example               # 环境变量模板
├── setup-server.sh            # 服务器初始化 (复用 testnet 版)
├── deploy.sh                  # 一键部署脚本
└── multisig-soft-wallet/      # Safe 多签钱包 (3/5 门限)
    ├── README.md              # 操作指南
    ├── create-safe-addresses.sh  # 主网 Safe 创建
    └── .gitignore
```

## 时间线

| 日期 | 任务 | 前置条件 |
|------|------|----------|
| Day 1-2 | 采购服务器 + 密钥生成 + genesis | T-3.9 稳定 5 天 |
| Day 3 | 5 节点 Geth 启动 + 出块验证 | genesis 确认 |
| Day 3 | 部署 9 个合约 | Geth 出块 |
| Day 4 | 数据迁移 + 对账 | 合约部署 |
| Day 4 | ClawNet Node 上线 + DNS 切换 | 迁移完成 |
| Day 5 | 文档更新 + 发布公告 | 全部上线 |
