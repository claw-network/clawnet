# Skill: Deploy ClawNet Testnet (Besu QBFT 3-Node Cluster)

## Overview

This skill describes the full procedure to deploy (or redeploy) the ClawNet testnet — a 3-server Hyperledger Besu QBFT chain with smart contracts, clawnetd nodes, and web services. The canonical method is the one-click `deploy.sh` script; this document also covers manual steps for partial operations.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  3 Servers · ClawNet Chain (Besu QBFT) · chainId 7625             │
│                                                                     │
│  Server A (66.94.125.242)     Server B (85.239.236.49)             │
│  ─ Besu Validator #1          ─ Besu Validator #2                  │
│  ─ Caddy (TLS)                Server C (85.239.235.67)             │
│  ─ clawnetd (primary)         ─ Besu Validator #3                  │
│  ─ Homepage / Docs / Wallet                                        │
│                                                                     │
│  QBFT: 3 Validators · 零手续费 · 2 秒出块                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Server Inventory

| 标识       | IP              | 角色                                       |
| ---------- | --------------- | ------------------------------------------ |
| Server A   | 66.94.125.242   | 公共入口 + Validator #1 + clawnetd + Web   |
| Server B   | 85.239.236.49   | Validator #2 + clawnetd peer               |
| Server C   | 85.239.235.67   | Validator #3 + clawnetd peer               |

### Domains

| 域名                 | 指向 Server A | 用途             |
| -------------------- | ------------- | ---------------- |
| `clawnetd.com`       | ✅            | 项目主页 (SPA)   |
| `api.clawnetd.com`   | ✅            | REST API         |
| `rpc.clawnetd.com`   | ✅            | Chain JSON-RPC   |
| `wallet.clawnetd.com`| ✅            | Wallet webapp    |
| `docs.clawnetd.com`  | ✅            | Documentation    |

### Port Allocation

| 端口  | 用途                        | Server A | Server B/C |
| ----- | --------------------------- | -------- | ---------- |
| 22    | SSH                         | ✅       | ✅         |
| 80    | HTTP → HTTPS (Caddy)        | ✅       | ❌         |
| 443   | HTTPS (Caddy)               | ✅       | ❌         |
| 8545  | Besu JSON-RPC (local only)  | ✅       | ✅         |
| 9527  | clawnetd P2P (libp2p)       | ✅       | ✅         |
| 9528  | clawnetd REST API (local)   | ✅       | ✅         |
| 30303 | Besu P2P (devp2p)           | ✅       | ✅         |

### Key Tech Choices

| 组件         | 选择                       | 原因                                     |
| ------------ | -------------------------- | ---------------------------------------- |
| EVM 客户端   | Hyperledger Besu           | 原生 QBFT + `--min-gas-price=0`          |
| 共识协议     | QBFT (BFT)                 | 确定性最终性，适合许可链                  |
| 反向代理     | Caddy v2                   | 自动 TLS / Let's Encrypt                 |
| 合约工具链   | Hardhat + OpenZeppelin     | evmVersion 必须设为 `london`             |

---

## Key Files

```
infra/testnet/prod/
├── deploy.sh           ← 一键重部署脚本（权威入口）
├── secrets.env         ← 部署密钥与地址（本地保管，不提交 Git）
├── genesis.json        ← 创世区块（3 validator QBFT）
├── contracts.json      ← 部署后自动生成的合约地址（权威记录）
└── enodes.env          ← 部署后自动生成的 enode URL

infra/testnet/
├── docker-compose.yml      ← Server A compose（Besu validator 主节点）
├── docker-compose.peer.yml ← Server B/C compose（Besu validator peer）
├── Caddyfile               ← Server A Caddy 配置
├── genesis.json            ← genesis 模板
├── harden-server.sh        ← 安全加固脚本
├── security-audit.sh       ← 安全审计脚本
├── health-check.sh         ← 健康检查脚本
└── setup-server.sh         ← 新服务器初始化脚本
```

---

## Prerequisites

1. **SSH access** to all 3 servers: `ssh -i ~/.ssh/id_ed25519_clawnet root@<IP>` (or password auth via `sshpass`)
2. **Local tools**: `ssh`, `scp`, `python3`, `sshpass` (if using password auth)
3. **secrets.env** exists at `infra/testnet/prod/secrets.env` with all required variables
4. **genesis.json** exists at `infra/testnet/prod/genesis.json`
5. **Servers** have: Docker, Git, Python3, `/opt/clawnet` (git clone of repo)

### secrets.env Required Variables

```bash
# Validator keys (3 pairs)
VALIDATOR_1_ADDRESS=0x...
VALIDATOR_1_PRIVATE_KEY=0x...
VALIDATOR_2_ADDRESS=0x...
VALIDATOR_2_PRIVATE_KEY=0x...
VALIDATOR_3_ADDRESS=0x...
VALIDATOR_3_PRIVATE_KEY=0x...

# Deployer
DEPLOYER_ADDRESS=0x...
DEPLOYER_PRIVATE_KEY=0x...

# Fund distribution
TREASURY_ADDRESS=0x...
LIQUIDITY_ADDRESS=0x...   # Must differ from TREASURY_ADDRESS
RESERVE_ADDRESS=0x...     # Must differ from TREASURY_ADDRESS and LIQUIDITY_ADDRESS

# Optional (auto-generated if missing)
CLAW_PASSPHRASE=...
CLAW_API_KEY=...
```

### Genesis Key Rules

| 参数                          | 值         | 说明                  |
| ----------------------------- | ---------- | --------------------- |
| chainId                       | 7625       | ClawNet Chain ID      |
| qbft.blockperiodseconds       | 2          | 每 2 秒出块           |
| zeroBaseFee                   | true       | 零手续费              |
| baseFeePerGas                 | 0x0        | EIP-1559 基准费为 0   |
| gasLimit                      | 0x1C9C380  | 30,000,000 Gas        |
| EVM forks                     | 仅到 london| 不含 shanghaiTime 等  |

---

## Method 1: One-Click Deploy (Recommended)

```bash
cd infra/testnet/prod
SSH_KEY_PATH=~/.ssh/id_ed25519_clawnet bash deploy.sh
```

### What deploy.sh Does (15 Phases)

| Phase | 操作                                     | 说明                                            |
| ----- | ---------------------------------------- | ----------------------------------------------- |
| 0     | Preflight checks                         | 校验 secrets.env 格式、地址隔离、genesis、SSH 连通 |
| 1     | Stop all Besu                            | `docker compose down` on all servers             |
| 2     | Wipe chain data + upload genesis + keys  | 清理旧链数据，上传 genesis.json 和 validator key  |
| 4     | Update code                              | `git pull` on all servers                        |
| 5b    | Security hardening                       | 上传并执行 `harden-server.sh`                    |
| 6     | Start Server A                           | 启动 Besu，等待出块，获取 enode URL              |
| 7     | Start Server B                           | 启动 Besu，bootnode 指向 Server A                |
| 8     | Start Server C                           | 启动 Besu，bootnode 指向 Server A + B            |
| 9     | Deploy contracts                         | 在 Server A 上编译 + 部署 9 个 UUPS 代理合约     |
| 10    | Bootstrap mint                           | 铸造初始 Token 供应量                            |
| 11    | Save deployment record                   | 拷贝 contracts.json + enodes.env 到本地          |
| 12    | Verify cluster                           | 区块高度、peer 数、validator 数、gas price 断言   |
| 13    | Deploy clawnetd on Server A              | 安装 systemd service + config.yaml（含 chain）   |
| 14    | Deploy clawnetd on Server B/C            | peer 模式 clawnetd + P2P mesh 验证              |
| 15    | Deploy docs site                         | Next.js docs 站点 + Caddy reverse proxy          |

### Preflight Validations (Phase 0)

deploy.sh 内置 fail-fast 校验，无需手工逐条核对：

- 本地依赖（sshpass、ssh、scp、python3）
- secrets.env 变量完整性与格式（0x 前缀地址、64 位私钥）
- 地址隔离：`LIQUIDITY ≠ TREASURY ≠ RESERVE`
- genesis.json 存在性 + QBFT + zeroBaseFee 检查
- 三台服务器 SSH 连通 + 基础环境（docker、git、python3、/opt/clawnet）

### Post-Deploy Outputs

成功后在 `infra/testnet/prod/` 目录产生：

- **contracts.json** — 9 个 UUPS 代理合约地址（权威记录）
- **enodes.env** — 3 台 Besu 的 enode URL

---

## Method 2: Manual Step-by-Step

当 deploy.sh 中某个 Phase 失败需要单独重试时使用。

### Step 1: Generate Validator Keys

> ⚠️ 在安全的本地环境执行，不要在服务器上生成。

```javascript
const { ethers } = require('ethers');
for (let i = 0; i < 7; i++) {
  const w = ethers.Wallet.createRandom();
  console.log(`Address: ${w.address}`);
  console.log(`PrivKey: ${w.privateKey}\n`);
}
```

### Step 2: Generate Genesis extradata

```bash
node scripts/gen-qbft-extradata.mjs <addr1> <addr2> <addr3>
```

Extradata 格式: `0x + 32字节vanity(64个0) + RLP([排序的验证者地址列表, votes=[], round=0, seals=[]])`

### Step 3: Deploy Server A

```bash
ssh root@66.94.125.242

# 上传 genesis.json 和 validator key
mkdir -p /opt/clawnet/{chain-data,config}
# scp genesis.json → /opt/clawnet/config/genesis.json
echo "<PRIVATE_KEY_WITHOUT_0x>" > /opt/clawnet/config/key
chmod 600 /opt/clawnet/config/key

# 启动 Besu
cd /opt/clawnet
cp infra/testnet/docker-compose.yml docker-compose.chain.yml
docker compose -f docker-compose.chain.yml up -d

# 获取 enode URL
curl -s http://127.0.0.1:8545 \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"admin_nodeInfo","params":[],"id":1}' \
  | jq -r '.result.enode'
# 记录并替换 127.0.0.1 → 66.94.125.242
```

### Step 4: Deploy Server B / C

```bash
ssh root@85.239.236.49  # (or 85.239.235.67 for Server C)

mkdir -p /opt/clawnet/{chain-data,config}
# scp genesis.json + write validator key (同上)

cd /opt/clawnet
cp infra/testnet/docker-compose.peer.yml docker-compose.chain.yml
# 编辑 bootnodes → Server A enode (Server C 还需 Server B enode)
docker compose -f docker-compose.chain.yml up -d
```

### Step 5: Deploy Smart Contracts

> ⚠️ 必须在 Server A 上通过 `http://127.0.0.1:8545` 部署。远程 HTTPS 部署会超时。

```bash
ssh root@66.94.125.242
cd /opt/clawnet/packages/contracts

export DEPLOYER_PRIVATE_KEY="0x..."
export TREASURY_ADDRESS="0x..."
export LIQUIDITY_ADDRESS="0x..."
export RESERVE_ADDRESS="0x..."
export CLAWNET_RPC_URL="http://127.0.0.1:8545"
export EMERGENCY_SIGNERS="<addr1>,<addr2>,...,<addr9>"  # 9 个不重复地址

npx hardhat compile
npx hardhat run scripts/deploy-all.ts --network clawnetTestnet
```

### Step 6: Bootstrap Mint

```bash
cd /opt/clawnet/packages/contracts

export FAUCET_ADDRESS="$DEPLOYER_ADDRESS"
export NODE_ADDRESSES="<val1>,<val2>,<val3>"
export BOOTSTRAP_TOTAL_SUPPLY=1000000

npx hardhat run scripts/bootstrap-mint.ts --network clawnetTestnet
```

---

## Verification Commands

### Chain Health

```bash
RPC="https://rpc.clawnetd.com"  # 或 http://127.0.0.1:8545 (SSH into server)

# 区块号（应持续增长，每 2 秒 +1）
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Peer 数量（Server A 应为 2）
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'

# Chain ID（应为 0x1dc9 = 7625）
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

# QBFT 验证者列表（应为 3 个地址）
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"qbft_getValidatorsByBlockNumber","params":["latest"],"id":1}'

# Gas price（应为 0x0）
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_gasPrice","params":[],"id":1}'
```

### Contract Verification

```bash
# 验证代理合约有 bytecode
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["<PROXY_ADDRESS>","latest"],"id":1}'
# result 长度 > 2（非 "0x"）
```

### clawnetd Health

```bash
# Server A
curl -s http://127.0.0.1:9528/api/v1/node

# 检查 EventIndexer
sqlite3 /opt/clawnet/clawnetd-data/indexer.sqlite \
  'SELECT value FROM indexer_meta WHERE key="last_indexed_block";'
```

### Complete Checklist

**基础设施**
- [ ] 3 台 Besu 出块中（区块号增长）
- [ ] 每台 peer 数量 = 2
- [ ] chainId = 0x1dc9 (7625)
- [ ] eth_gasPrice = 0x0
- [ ] QBFT 验证者 = 3
- [ ] rpc.clawnetd.com 可访问
- [ ] clawnetd.com 主页可访问

**合约**
- [ ] 9 个 UUPS 代理合约已部署
- [ ] contracts.json 已保存
- [ ] Bootstrap mint 完成

**clawnetd**
- [ ] Server A clawnetd active (systemctl)
- [ ] Server B/C clawnetd active
- [ ] P2P mesh peers >= 2
- [ ] EventIndexer 运行中（indexer.sqlite 存在）

---

## Troubleshooting

### 合约部署超时

**原因**: 从远程通过 HTTPS RPC 部署大合约时，`eth_estimateGas` 耗时过长导致 HTTP 超时。

**解决**: SSH 到 Server A，通过 `http://127.0.0.1:8545` 直接部署。

### evmVersion 不匹配

**症状**: 合约部署或调用时报 `INVALID_OPCODE`。

**原因**: Hardhat 默认 `evmVersion: "cancun"`，但链只支持 London EVM。

**解决**: 确认 `hardhat.config.ts` 中 `evmVersion: "london"`。

### ClawDAO DuplicateSigner

**症状**: `initialize()` 调用报 `DuplicateSigner` 错误。

**原因**: ClawDAO 需要 9 个**不重复**地址作为 emergency signers。

**解决**: 提供 9 个不同的地址给 `EMERGENCY_SIGNERS` 环境变量。

### 单节点宕机

QBFT 3 节点需要 2/3 在线才能出块。单节点宕机时链继续运转。

```bash
# 恢复: SSH 到故障节点
cd /opt/clawnet
docker compose -f docker-compose.chain.yml up -d
```

### 链数据损坏

```bash
cd /opt/clawnet
docker compose -f docker-compose.chain.yml down
rm -rf chain-data/*
docker compose -f docker-compose.chain.yml up -d
# Besu 自动从 genesis 重新初始化，从其他节点同步
```

### clawnetd 启动失败

```bash
# 检查日志
journalctl -u clawnetd -n 80 --no-pager

# 常见原因:
# 1. config.yaml 缺少 chain: 段
# 2. CLAW_PRIVATE_KEY 未设置
# 3. 合约 artifacts 目录不存在（需要先 pnpm build）
```

---

## Daily Operations

```bash
# 查看 Besu 状态
ssh root@<IP> "cd /opt/clawnet && docker compose -f docker-compose.chain.yml ps"
ssh root@<IP> "docker logs clawnet-besu --tail 20"

# 查看 clawnetd 状态
ssh root@<IP> "systemctl status clawnetd"

# 重启 Besu
ssh root@<IP> "cd /opt/clawnet && docker compose -f docker-compose.chain.yml restart"

# 重启 clawnetd
ssh root@<IP> "systemctl restart clawnetd"

# 更新代码并重启
ssh root@<IP> "cd /opt/clawnet && git pull && pnpm install && pnpm build && systemctl restart clawnetd"

# 备份链数据
ssh root@<IP> "tar -czf /backup/chain-$(date +%Y%m%d).tar.gz /opt/clawnet/chain-data/"
```

---

## Critical Pitfalls

1. **Besu ≠ Geth**: 无需 `geth init`、无需 keystore/password。Besu 首次启动自动从 genesis 初始化，直接读取 hex key 文件。
2. **Genesis 仅支持 London**: 不包含 `shanghaiTime` 等 time-based fork 字段。合约编译也必须用 `london`。
3. **QBFT 容错**: 3 validator 容忍 0 宕机（需全部在线）。要容忍 1 宕机需 4 validator。
4. **合约必须在 Server A 本地部署**: 远程 HTTPS 会超时。
5. **地址隔离**: `TREASURY ≠ LIQUIDITY ≠ RESERVE`，deploy.sh 强制校验。
6. **Key 文件格式**: Besu key 文件内容为**去掉 0x 前缀**的 hex 私钥。
7. **合约地址权威来源**: `infra/testnet/prod/contracts.json`（不是 `packages/contracts/deployments/`）。
