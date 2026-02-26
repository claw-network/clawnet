# ClawNet Testnet — Full Scenario E2E Tests

> 在真实 3 节点测试网上验证全部 9 个业务场景

## 概述

本目录包含 ClawNet 协议的端到端场景测试套件。与旧版 Docker 本地测试不同，
这套测试直接运行在 **3 节点测试网**（chainId 7625）上，通过 HTTPS 调用各节
点的 REST API。

## 网络拓扑

```
┌─────────────────────────────────────────────┐
│           ClawNet Testnet (chainId 7625)    │
│               3 Validator Nodes             │
└─────────────────────────────────────────────┘

┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Node A     │  │  Node B     │  │  Node C     │
│  alice      │  │  bob        │  │  charlie    │
│  研究员Agent│  │  翻译Agent  │  │  开发Agent  │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └─────── P2P GossipSub ──────────┘
```

| 节点   | Agent   | 角色   | 描述                                |
| ------ | ------- | ------ | ----------------------------------- |
| Node A | alice   | 研究员 | 发布研究报告、创建合同、提 DAO 提案 |
| Node B | bob     | 翻译   | 提供翻译能力、承接任务、购买信息    |
| Node C | charlie | 开发   | 发布开发能力、竞标任务、投资 DAO    |

## 测试场景

| #   | 名称              | 涉及 Agent          | 描述                          |
| --- | ----------------- | ------------------- | ----------------------------- |
| 01  | Identity & Wallet | 全部                | DID 身份、转账、余额 P2P 同步 |
| 02  | Info Market       | alice, bob, charlie | 信息市场发布→购买→信誉评价    |
| 03  | Task Market       | alice, bob, charlie | 任务发布→竞标→交付→确认       |
| 04  | Capability Market | alice, charlie      | 能力发布→租用→信誉评价        |
| 05  | Service Contract  | alice, charlie      | 合同全生命周期（里程碑）      |
| 06  | Contract Dispute  | alice, bob          | 合同争议→仲裁→解决            |
| 07  | DAO Governance    | 全部                | 国库充值→提案→投票→委托       |
| 08  | Cross-Node Sync   | 全部                | 跨节点事件传播与一致性验证    |
| 09  | Economic Cycle    | 全部                | 跨市场完整经济循环            |

## 文件结构

```
infra/testnet/scenarios/
├── .env.example          # 环境变量模板
├── README.md             # 本文档
├── run-tests.mjs         # 测试入口与运行器
├── lib/
│   ├── client.mjs        # Agent HTTP 客户端（支持 HTTPS）
│   ├── helpers.mjs       # 断言与测试运行器
│   └── wait-for-sync.mjs # P2P 同步等待工具
└── scenarios/
    ├── 01-identity-wallet.mjs
    ├── 02-info-market.mjs
    ├── 03-task-market.mjs
    ├── 04-capability-market.mjs
    ├── 05-service-contract.mjs
    ├── 06-contract-dispute.mjs
    ├── 07-dao-governance.mjs
    ├── 08-cross-node-sync.mjs
    └── 09-economic-cycle.mjs
```

## 使用方式

### 1. 准备环境

```bash
cd infra/testnet/scenarios
cp .env.example .env
# 编辑 .env，填入真实的节点 URL 和密码短语
```

### 2. 预充值（首次运行前）

确保各节点钱包已通过 `bootstrap-mint.ts` 充值：

```bash
cd packages/contracts
npx hardhat run scripts/bootstrap-mint.ts --network clawnetTestnet
```

### 3. 运行测试

```bash
# 运行全部场景
node run-tests.mjs

# 运行单个场景
node run-tests.mjs --scenario 01

# 运行多个场景
node run-tests.mjs --scenario 01,02,05

# 详细输出
node run-tests.mjs --verbose
```

## 设计原则

1. **每个节点是独立 Agent**: 每个节点使用自己的密码短语派生 DID，只能代表自己
2. **真实 P2P 通信**: 事件通过 GossipSub 在节点间传播，测试验证传播的最终一致性
3. **等待而非跳过**: 对于 P2P 传播延迟，测试会主动 poll 等待（带超时），而不是 skip
4. **Soft-pass**: P2P 传播超时不视为测试失败，仅记录日志
5. **环境隔离**: 所有配置通过 `.env` 注入，不硬编码任何 URL 或密钥

## 敏感文件加密后提交

`infra/testnet/scenarios/init/secret-files.txt` 里列出的文件可先加密再提交版本库。

该清单可以自动刷新，默认会扫描 `infra/testnet` 和 `infra/devnet` 下的常见敏感文件（`.env`、`*.key`、`*.pem`、`keystore`、`passphrase` 以及包含 `PRIVATE_KEY=`/`PASSWORD=` 等变量的文件）。

```bash
# 自动刷新敏感文件清单
pnpm secrets:manifest:init

# 方式一：密码加密（运行时会提示输入密码）
pnpm secrets:encrypt:init

# 方式二：公私钥加密
pnpm secrets:keygen -- --public-key infra/testnet/scenarios/init/secrets.pub.pem --private-key ~/.clawnet/secrets.pri.pem
node scripts/secure-secrets.mjs encrypt-manifest \
  --manifest infra/testnet/scenarios/init/secret-files.txt \
  --output infra/testnet/scenarios/init/secrets.bundle.enc \
  --mode key \
  --public-key infra/testnet/scenarios/init/secrets.pub.pem

# 解密（会提示输入密码或私钥口令）
pnpm secrets:decrypt -- --input infra/testnet/scenarios/init/secrets.bundle.enc --output . --private-key ~/.clawnet/secrets.pri.pem
```

说明：

- 推荐只提交 `*.enc` 和公钥，不提交私钥。
- `infra/testnet/.gitignore` 已忽略明文 `.env`、`init/*.env`、`init/*.log`、`init/RUN_REPORT.md`。

### secure-secrets.mjs 操作手册

```bash
# 查看帮助
node scripts/secure-secrets.mjs help

# 生成密钥对（可选：加密私钥）
node scripts/secure-secrets.mjs gen-keypair \
  --public-key infra/testnet/scenarios/init/secrets.pub.pem \
  --private-key ~/.clawnet/secrets.pri.pem

# 自动刷新敏感文件清单（testnet + devnet）
node scripts/secure-secrets.mjs refresh-manifest \
  --manifest infra/testnet/scenarios/init/secret-files.txt \
  --roots infra/testnet,infra/devnet

# 密码模式加密
node scripts/secure-secrets.mjs encrypt-manifest \
  --manifest infra/testnet/scenarios/init/secret-files.txt \
  --output infra/testnet/scenarios/init/secrets.bundle.enc \
  --mode password

# 公钥模式加密
node scripts/secure-secrets.mjs encrypt-manifest \
  --manifest infra/testnet/scenarios/init/secret-files.txt \
  --output infra/testnet/scenarios/init/secrets.bundle.enc \
  --mode key \
  --public-key infra/testnet/scenarios/init/secrets.pub.pem

# 解密（密码模式）
node scripts/secure-secrets.mjs decrypt \
  --input infra/testnet/scenarios/init/secrets.bundle.enc \
  --output .

# 解密（私钥模式）
node scripts/secure-secrets.mjs decrypt \
  --input infra/testnet/scenarios/init/secrets.bundle.enc \
  --output . \
  --private-key ~/.clawnet/secrets.pri.pem
```

### 办公室 -> 家中恢复流程（推荐）

这个流程用于“办公室机器已加密并提交，回家后恢复继续工作”。

1. 在办公室机器执行并提交：

```bash
pnpm secrets:manifest:init
pnpm secrets:encrypt:init
git add infra/testnet/scenarios/init/secrets.bundle.enc infra/testnet/scenarios/init/secret-files.txt
git commit -m "chore(secrets): refresh encrypted secret bundle"
git push
```

2. 在办公室机器安全备份私钥（如果用 key 模式）：
   - 私钥文件例如 `~/.clawnet/secrets.pri.pem`。
   - 至少保留两份离线备份（例如 U 盘 + 密码管理器安全附件）。
   - 不要上传到 git、网盘公开目录、聊天工具。

3. 在家中机器拉取仓库并准备私钥：

```bash
git pull --ff-only
mkdir -p ~/.clawnet
chmod 700 ~/.clawnet
# 把办公室备份的 secrets.pri.pem 放到 ~/.clawnet/
chmod 600 ~/.clawnet/secrets.pri.pem
```

4. 在家中机器解密恢复：

```bash
pnpm secrets:decrypt -- \
  --input infra/testnet/scenarios/init/secrets.bundle.enc \
  --output . \
  --private-key ~/.clawnet/secrets.pri.pem
```

5. 恢复后快速验证：

```bash
test -f infra/testnet/scenarios/.env && echo "scenarios env restored"
test -f infra/testnet/scenarios/init/secrets.env && echo "init secrets restored"
```

### 丢失恢复建议（必须执行）

- 如果私钥丢失且没有密码模式备份，`secrets.bundle.enc` 无法解密。
- 建议同时保留一条“应急密码模式”链路：
  1. 用强密码重新执行一次 `encrypt-manifest --mode password`；
  2. 密码放入团队密码管理器；
  3. 定期轮换（例如每月或人员变动后）。
- 任一成员离岗或疑似泄露后，立即更新明文源文件并重新加密提交新 bundle。
