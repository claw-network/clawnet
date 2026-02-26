# Mainnet Multisig Runbook

> 主网 Safe 多签钱包创建指南，与 `infra/testnet/multisig-soft-wallet/` 对齐。

## 与测试网的关系

| 步骤 | 脚本 | 网络依赖 | 复用方式 |
|------|------|----------|----------|
| Step 1: 创建 Signer 钱包 | `create-signer-wallet.sh` | 无 | 直接用 testnet 版 |
| Step 2: 收集 Owner 地址 | `collect-owner-addresses.sh` | 无 | 直接用 testnet 版 |
| Step 3: 创建 Safe 合约 | `create-safe-addresses.sh` | **有** | 本目录的主网版 |

Signer 钱包和 Owner 收集与网络无关（只是生成 EOA 和收集地址），所以直接复用测试网脚本。
Safe 合约创建需要指定 `--network clawnetMainnet`，因此本目录提供专用脚本。

## 安全模型

主网建议使用 **3/5** 门限（testnet 使用 2/3），即 5 个 signer 中需要 3 人签名。

长期目标仍然是硬件钱包签名。

## 操作流程

### Step 1: 各 Signer 创建钱包

复用测试网脚本（网络无关）：

```bash
bash infra/testnet/multisig-soft-wallet/create-signer-wallet.sh --name signer1
bash infra/testnet/multisig-soft-wallet/create-signer-wallet.sh --name signer2
bash infra/testnet/multisig-soft-wallet/create-signer-wallet.sh --name signer3
bash infra/testnet/multisig-soft-wallet/create-signer-wallet.sh --name signer4
bash infra/testnet/multisig-soft-wallet/create-signer-wallet.sh --name signer5
```

如果 testnet 阶段已有同一批 signer 的钱包，可直接复用其 `public-info.txt`。

环境初始化（如需）同样复用：

```bash
bash infra/testnet/multisig-soft-wallet/init-env.sh
```

### Step 2: Coordinator 收集 Owner 地址

```bash
bash infra/testnet/multisig-soft-wallet/collect-owner-addresses.sh \
  --input infra/testnet/multisig-soft-wallet/.generated/signer1/public-info.txt \
  --input infra/testnet/multisig-soft-wallet/.generated/signer2/public-info.txt \
  --input infra/testnet/multisig-soft-wallet/.generated/signer3/public-info.txt \
  --input infra/testnet/multisig-soft-wallet/.generated/signer4/public-info.txt \
  --input infra/testnet/multisig-soft-wallet/.generated/signer5/public-info.txt \
  --threshold 3
```

输出：`infra/testnet/multisig-soft-wallet/.generated/safe-owners.env`

### Step 3: 创建 Mainnet Safe

使用本目录的主网专用脚本：

```bash
bash infra/mainnet/multisig-soft-wallet/create-safe-addresses.sh
```

或指定自定义 owners 文件：

```bash
bash infra/mainnet/multisig-soft-wallet/create-safe-addresses.sh /path/to/safe-owners.env
```

前置条件：
- `infra/mainnet/secrets.env` 存在且含 `DEPLOYER_PRIVATE_KEY`
- 主网 Geth 已启动，`clawnetMainnet` hardhat 网络可达
- `pnpm install` 已在 repo 根目录执行

脚本输出两个地址：

```
LIQUIDITY_ADDRESS=0x...
RESERVE_ADDRESS=0x...
```

### Step 4: 写入 secrets.env

```bash
# infra/mainnet/secrets.env
LIQUIDITY_ADDRESS=<SAFE_LIQUIDITY_ADDRESS>
RESERVE_ADDRESS=<SAFE_RESERVE_ADDRESS>
```

### Step 5: 验证 Safe 地址

```bash
RPC="https://rpc.clawnet.io"

# 两个地址都应返回非 0x 的合约代码
curl -s "$RPC" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["<SAFE_ADDRESS>","latest"],"id":1}'
```

## 与测试网的差异

| 配置项 | 测试网 | 主网 |
|--------|--------|------|
| Hardhat 网络 | `clawnetTestnet` | `clawnetMainnet` |
| Safe 标签 | `SAFE_LIQUIDITY_TESTNET` / `SAFE_RESERVE_TESTNET` | `SAFE_LIQUIDITY_MAINNET` / `SAFE_RESERVE_MAINNET` |
| 部署清单 | `safe-wallets-clawnetTestnet.json` | `safe-wallets-clawnetMainnet.json` |
| 建议门限 | 2/3 | 3/5 |
| Secrets 路径 | `infra/testnet/prod/secrets.env` | `infra/mainnet/secrets.env` |
| RPC | `rpc.clawnetd.com` | `rpc.clawnet.io` |

## 文件清单

```
infra/mainnet/multisig-soft-wallet/
├── README.md                      # 本文档
├── create-safe-addresses.sh       # 主网 Safe 创建脚本
└── .gitignore                     # 排除生成文件
```

网络无关脚本复用自：

```
infra/testnet/multisig-soft-wallet/
├── init-env.sh                    # 安装 geth / docker
├── create-signer-wallet.sh        # 生成 signer EOA
└── collect-owner-addresses.sh     # 收集 owner 地址
```
