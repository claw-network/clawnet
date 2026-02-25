# ClawNet Chain 基础设施部署指南

> 3 台服务器部署 ClawNet Chain（Geth Clique PoA）的完整操作手册，已合并 2026-02 的 redeploy 自动校验与多签地址隔离实践。

---

## 目录

1. [架构总览](#1-架构总览)
2. [服务器清单与规格](#2-服务器清单与规格)
3. [前置准备](#3-前置准备)
4. [Step 1：生成验证者密钥](#step-1生成验证者密钥)
5. [Step 2：创建 Genesis 配置](#step-2创建-genesis-配置)
6. [Step 3：部署服务器 A（clawnetd.com）](#step-3部署服务器-aclawnetdcom)
7. [Step 4：部署服务器 B](#step-4部署服务器-b)
8. [Step 5：部署服务器 C](#step-5部署服务器-c)
9. [Step 6：部署智能合约](#step-6部署智能合约)
10. [Step 7：验证集群状态](#step-7验证集群状态)
11. [日常运维](#日常运维)
12. [故障恢复](#故障恢复)
13. [安全加固](#安全加固)
14. [已知陷阱与经验教训](#已知陷阱与经验教训)
15. [未来扩展](#未来扩展)
16. [共识迁移决策（PoA -> QBFT -> PoS）](#共识迁移决策poa---qbft---pos)

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│          3 台服务器 · ClawNet Chain (Geth Clique PoA) 最小生产级部署        │
│                                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐                         │
│  │  Server B            │  │  Server C            │                         │
│  │  85.239.236.49       │  │  85.239.235.67       │                         │
│  │                      │  │                      │                         │
│  │  Geth Validator #2   │  │  Geth Validator #3   │                         │
│  │  4C/8G/200G          │  │  4C/8G/200G          │                         │
│  └──────────┬───────────┘  └──────────┬───────────┘                         │
│             │ P2P :30303              │                                      │
│             └────────────┬────────────┘                                      │
│                          │                                                   │
│  ┌───────────────────────┴───────────────────────────┐                      │
│  │  Server A — 66.94.125.242 (clawnetd.com)          │                      │
│  │                                                    │                      │
│  │  Geth Validator #1      ← PoA 出块节点            │                      │
│  │  Caddy (TLS)            ← HTTPS 统一入口          │                      │
│  │  Homepage               ← SPA 站点               │                      │
│  │                                                    │                      │
│  │  对外:                                             │                      │
│  │    clawnetd.com:443       → 项目主页 (SPA)        │                      │
│  │    api.clawnetd.com:443   → REST API (预留)       │                      │
│  │    rpc.clawnetd.com:443   → Geth JSON-RPC         │                      │
│  │    :30303                 → Geth P2P              │                      │
│  └────────────────────────────────────────────────────┘                      │
│                                                                              │
│  PoA 共识：3 Validators → 可容忍 1 台宕机                                   │
│  出块间隔：2 秒 · Chain ID: 7625 (0x1dc9)                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 关键技术选型

| 组件       | 选择                       | 原因                                                          |
| ---------- | -------------------------- | ------------------------------------------------------------- |
| EVM 客户端 | **Geth v1.13.15**          | Reth 不支持 Clique PoA；Geth v1.14+ 移除了 Clique，仅支持 PoS |
| 共识协议   | **Clique PoA**             | 适合小型许可链，3 验证者即可运行                              |
| 反向代理   | **Caddy v2**               | 自动 TLS / Let's Encrypt                                      |
| 容器化     | **Docker + Compose**       | 标准化部署                                                    |
| 合约工具链 | **Hardhat + OpenZeppelin** | evmVersion 必须设为 `london`                                  |

### 数据流

```
Agent/SDK/Browser
  │
  ├──(HTTPS)──→ clawnetd.com:443     ──→ Caddy ──→ SPA 静态文件
  │
  ├──(HTTPS)──→ api.clawnetd.com:443 ──→ Caddy ──→ clawnetd :9528 (REST API, 预留)
  │
  ├──(HTTPS)──→ rpc.clawnetd.com:443 ──→ Caddy ──→ Geth :8545 (JSON-RPC)
  │
  └──(TCP)────→ :30303 ──→ Geth P2P (devp2p)

Geth 节点间:
  Server A :30303 ←──P2P──→ Server B :30303 ←──P2P──→ Server C :30303
```

---

## 2. 服务器清单与规格

| 标识         | IP            | 提供商  | 角色                               |
| ------------ | ------------- | ------- | ---------------------------------- |
| **Server A** | 66.94.125.242 | 现有    | 公共入口 + Validator #1 + Homepage |
| **Server B** | 85.239.236.49 | Contabo | Validator #2                       |
| **Server C** | 85.239.235.67 | Contabo | Validator #3                       |

### 端口分配

| 端口  | 协议    | 用途                      | Server A   | Server B/C   |
| ----- | ------- | ------------------------- | ---------- | ------------ |
| 22    | TCP     | SSH                       | ✅         | ✅           |
| 80    | TCP     | HTTP→HTTPS 重定向 (Caddy) | ✅         | ❌           |
| 443   | TCP     | HTTPS (Caddy)             | ✅         | ❌           |
| 8545  | TCP     | Geth JSON-RPC             | Caddy 反代 | 仅 127.0.0.1 |
| 9527  | TCP     | clawnetd P2P (预留)       | ✅         | ✅           |
| 30303 | TCP+UDP | Geth P2P (devp2p)         | ✅         | ✅           |

### 域名配置

| 域名               | A 记录指向    | 用途            |
| ------------------ | ------------- | --------------- |
| `clawnetd.com`     | 66.94.125.242 | 项目主页 (SPA)  |
| `api.clawnetd.com` | 66.94.125.242 | REST API (预留) |
| `rpc.clawnetd.com` | 66.94.125.242 | Chain JSON-RPC  |

---

## 3. 前置准备

### 3.1 本地工具

```bash
# 需要已安装:
node --version   # v20+
pnpm --version   # v10+
ssh              # SSH 客户端
```

### 3.2 DNS 配置

在域名管理面板添加 3 条 A 记录，全部指向 Server A IP：

```
clawnetd.com      →  66.94.125.242
api.clawnetd.com  →  66.94.125.242
rpc.clawnetd.com  →  66.94.125.242
```

### 3.3 Testnet 一键重部署前置检查（2026-02 更新）

当前推荐使用：`infra/testnet/prod/deploy.sh`。

在执行前，先编辑 `infra/testnet/prod/secrets.env` 并确认以下变量都已设置：

```bash
TREASURY_ADDRESS=0x...
LIQUIDITY_ADDRESS=0x...
RESERVE_ADDRESS=0x...
```

必须满足地址隔离：

- `LIQUIDITY_ADDRESS != TREASURY_ADDRESS`
- `RESERVE_ADDRESS != TREASURY_ADDRESS`
- `LIQUIDITY_ADDRESS != RESERVE_ADDRESS`

`deploy.sh` 已内置 fail-fast 校验：如果变量缺失或地址冲突，会直接中止部署。

### 3.4 一键重部署（建议）

```bash
cd infra/testnet/prod
bash deploy.sh
```

脚本已自动执行以下检查，不再需要人工逐条核对：

- 本地依赖检查（`sshpass`、`ssh`、`scp`、`python3`）
- `secrets.env` 关键变量完整性与地址/私钥格式校验
- `LIQUIDITY_ADDRESS` / `RESERVE_ADDRESS` 与国库地址隔离校验
- `genesis.json` 存在性和 Clique 兼容性校验（禁止 `shanghaiTime`）
- 三台服务器连通性与基础运行环境检查（`docker`、`git`、`python3`、`/opt/clawnet`）
- 部署后链状态断言（区块高度、peer 数）和产物文件断言（`contracts.json`、`enodes.env`）

### 3.5 多签落地步骤（Safe 版）

为避免 `LIQUIDITY_ADDRESS` / `RESERVE_ADDRESS` 与单私钥绑定，建议使用 Safe 多签地址。

1. 准备 signer 集合与阈值

- 测试网建议：`2/3`
- 长期运行环境建议：`3/5`
- signer 地址应与 deployer、treasury 托管账号隔离。

2. 在 ClawNet testnet（chainId `7625`）创建两个 Safe

- `Safe #1`：流动性资金托管（对应 `LIQUIDITY_ADDRESS`）
- `Safe #2`：风险储备托管（对应 `RESERVE_ADDRESS`）

如无 Safe UI，可使用仓库内脚本化流程：

- `pnpm --filter @claw-network/contracts run safe:deploy:testnet`
- `pnpm --filter @claw-network/contracts run safe:create:testnet`

详细命令见：`infra/testnet/multisig-soft-wallet/README.md` Step 3。

3. 将 Safe 地址写入部署配置

编辑 `infra/testnet/prod/secrets.env`：

```bash
LIQUIDITY_ADDRESS=<SAFE_LIQUIDITY_ADDRESS>
RESERVE_ADDRESS=<SAFE_RESERVE_ADDRESS>
```

必须满足：

- `LIQUIDITY_ADDRESS != TREASURY_ADDRESS`
- `RESERVE_ADDRESS != TREASURY_ADDRESS`
- `LIQUIDITY_ADDRESS != RESERVE_ADDRESS`

4. 上链前快速校验

- `eth_getCode(<SAFE_ADDRESS>)` 返回不应为 `0x`（应为合约地址）。
- 用小额资金做一次提案 + 多签确认 + 执行流程，确认阈值生效。

5. 执行 redeploy

```bash
cd infra/testnet/prod
bash deploy.sh
```

脚本会在 preflight 阶段再次校验地址格式与地址隔离。

可直接使用的自动化模板见：`infra/testnet/multisig-soft-wallet/README.md`。

### 3.6 硬件钱包采购与初始化 Checklist（适配多签）

采购建议：

- 至少采购 `3` 台（`2/3` 阈值），建议 `5` 台（可升级 `3/5`）。
- 仅通过官方渠道采购，禁止二手与来路不明设备。
- 每个关键 signer 建议配 1 台备用设备。

到货验收：

- 检查外包装与防拆封状态，记录设备编号与责任人。
- 首次初始化必须在设备内生成助记词，不导入外部助记词。
- 升级到官方稳定固件并留存版本记录。

初始化流程（每个 signer）：

- 在离线环境设置 PIN，生成助记词并离线备份（禁止拍照/云盘）。
- 可选启用 passphrase（第 25 词），并与助记词分离保存。
- 完成一次恢复演练（验证助记词可恢复到备用设备）。
- 导出公开地址并登记到 signer 名单。

多签配置与接入：

- 创建两个 Safe：`SAFE_LIQUIDITY_TESTNET`、`SAFE_RESERVE_TESTNET`。
- 阈值建议：测试网 `2/3`，稳定后可升级 `3/5`。
- 将 Safe 地址写入 `infra/testnet/prod/secrets.env`：

```bash
LIQUIDITY_ADDRESS=<SAFE_LIQUIDITY_ADDRESS>
RESERVE_ADDRESS=<SAFE_RESERVE_ADDRESS>
```

- 确认与 `TREASURY_ADDRESS` 完全隔离（部署脚本会执行 fail-fast 校验）。

上线前验证：

- `eth_getCode(<SAFE_ADDRESS>)` 返回应非 `0x`（确认是合约地址）。
- 执行一笔小额完整演练：提案 -> 多签确认 -> 执行 -> 审计记录。

运行期规范：

- 发起与审核分离（双人复核），高风险交易必须多人批准。
- 周期输出执行台账（提案数、执行数、拒绝数、异常数、资金变动）。
- 禁止把私钥/助记词保存到服务器、CI、聊天工具、邮箱。

### 3.7 地址来源 -> 脚本 -> 链上落点映射（`infra/testnet/prod/secrets.env`）

关键认知：

- `ADDRESS` 是链上账户标识，不等于“必然单私钥”。
- EOA 地址来自私钥推导；Safe 多签地址来自合约部署。
- `secrets.env` 本身不是链上状态，它是部署/运维脚本输入；脚本执行后才把关系写上链。

| 字段 | 类型 | 地址来源 | 使用脚本/阶段 | 链上落点（写入位置） |
| --- | --- | --- | --- | --- |
| `VALIDATOR_1_ADDRESS` | EOA 地址 | 由 `VALIDATOR_1_PRIVATE_KEY` 推导 | `infra/testnet/prod/deploy.sh` Phase 5/7/9/10 | Geth `--unlock/etherbase` 与 `NODE_ADDRESSES`（bootstrap 分配） |
| `VALIDATOR_1_PRIVATE_KEY` | 私钥 | 本地生成/硬件导出 | `infra/testnet/prod/deploy.sh` Phase 3 | 导入节点 keystore（间接影响出块签名） |
| `VALIDATOR_2_ADDRESS` | EOA 地址 | 由 `VALIDATOR_2_PRIVATE_KEY` 推导 | `infra/testnet/prod/deploy.sh` Phase 5/8/9/10 | 同上（验证者 #2） |
| `VALIDATOR_2_PRIVATE_KEY` | 私钥 | 本地生成/硬件导出 | `infra/testnet/prod/deploy.sh` Phase 3 | 导入节点 keystore（验证者 #2） |
| `VALIDATOR_3_ADDRESS` | EOA 地址 | 由 `VALIDATOR_3_PRIVATE_KEY` 推导 | `infra/testnet/prod/deploy.sh` Phase 5/8/9/10 | 同上（验证者 #3） |
| `VALIDATOR_3_PRIVATE_KEY` | 私钥 | 本地生成/硬件导出 | `infra/testnet/prod/deploy.sh` Phase 3 | 导入节点 keystore（验证者 #3） |
| `DEPLOYER_ADDRESS` | EOA 地址 | 由 `DEPLOYER_PRIVATE_KEY` 推导 | `infra/testnet/prod/deploy.sh`（部署与铸币交易发起者） | 作为交易 `from` 执行合约部署、bootstrap mint |
| `DEPLOYER_PRIVATE_KEY` | 私钥 | 本地生成/硬件导出 | `infra/testnet/prod/deploy.sh` Phase 9/10 -> `scripts/deploy-all.ts` / `scripts/bootstrap-mint.ts` | 链上交易签名（部署、mint） |
| `TREASURY_ADDRESS` | 地址（EOA 或合约） | 运营/治理指定 | `infra/testnet/prod/deploy.sh` Phase 9/10 | `deploy-all.ts` 参数（协议费接收）+ `bootstrap-mint.ts` 国库分配 |
| `TREASURY_PRIVATE_KEY` | 私钥（如 treasury 为 EOA） | 本地生成/硬件导出 | 当前 `deploy.sh` 不直接使用（运营支出时使用） | 非部署阶段直接落点；用于后续 treasury 出账签名 |
| `LIQUIDITY_ADDRESS` | 地址（建议 Safe 合约） | 推荐 Safe 创建 | `infra/testnet/prod/deploy.sh` Phase 10 -> `scripts/bootstrap-mint.ts` | bootstrap 的 10% 流动性份额接收地址 |
| `RESERVE_ADDRESS` | 地址（建议 Safe 合约） | 推荐 Safe 创建 | `infra/testnet/prod/deploy.sh` Phase 10 -> `scripts/bootstrap-mint.ts` | bootstrap 的 5% 风险储备份额接收地址 |
| `CLAW_PASSPHRASE` | 应用口令 | 运维设定 | 当前 `deploy.sh` 不直接使用 | 供节点/API 运行时解锁 DID 密钥（非合约状态） |
| `CLAW_API_KEY` | API 凭证 | 运维设定 | 当前 `deploy.sh` 不直接使用 | 网关/API 鉴权（非合约状态） |
| `VALIDATOR_PASSWORD` | keystore 口令 | 运维设定 | `infra/testnet/prod/deploy.sh` Phase 2/3 | 写入 `/opt/clawnet/config/password.txt`，用于 geth `account import` |

地址如何“关联到链上”：

1. Genesis `alloc` 预分配（区块 0 生效）。
2. 部署脚本传参（如 `TREASURY_ADDRESS` 写入合约状态）。
3. 交易执行写状态（如 bootstrap mint 把 Token 打到 `LIQUIDITY_ADDRESS` / `RESERVE_ADDRESS`）。

核验建议：

- EOA：`eth_getCode(<address>)` 返回 `0x`。
- Safe 合约地址：`eth_getCode(<address>)` 返回非 `0x`。
- 同一配置中保证 `TREASURY_ADDRESS`、`LIQUIDITY_ADDRESS`、`RESERVE_ADDRESS` 三者互不相同。

---

## Step 1：生成验证者密钥

> ⚠️ 在安全的本地环境执行，不要在服务器上生成密钥！

使用 Node.js ethers 库至少生成 7 个钱包：3 验证者 + 1 部署者 + 1 国库 + 1 流动性 + 1 风险储备。

```javascript
const { ethers } = require('ethers');
for (let i = 0; i < 7; i++) {
  const w = ethers.Wallet.createRandom();
  console.log(`Address: ${w.address}`);
  console.log(`PrivKey: ${w.privateKey}\n`);
}
```

将生成的地址和私钥保存到安全位置：

```
VALIDATOR_1_ADDRESS=0x...   # Server A
VALIDATOR_1_PRIVATE_KEY=0x...

VALIDATOR_2_ADDRESS=0x...   # Server B
VALIDATOR_2_PRIVATE_KEY=0x...

VALIDATOR_3_ADDRESS=0x...   # Server C
VALIDATOR_3_PRIVATE_KEY=0x...

DEPLOYER_ADDRESS=0x...      # 合约部署
DEPLOYER_PRIVATE_KEY=0x...

TREASURY_ADDRESS=0x...      # 协议国库
TREASURY_PRIVATE_KEY=0x...

LIQUIDITY_ADDRESS=0x...     # 流动性专用地址（必须独立）
LIQUIDITY_PRIVATE_KEY=0x...

RESERVE_ADDRESS=0x...       # 风险储备专用地址（必须独立）
RESERVE_PRIVATE_KEY=0x...
```

> ⚠️ `LIQUIDITY_ADDRESS` / `RESERVE_ADDRESS` 不得与 `TREASURY_ADDRESS` 相同，且二者彼此也不得相同。

---

## Step 2：创建 Genesis 配置

### 2.1 关键规则

| 参数          | 值         | 说明                  |
| ------------- | ---------- | --------------------- |
| chainId       | 7625       | ClawNet Chain ID      |
| clique.period | 2          | 每 2 秒出块           |
| clique.epoch  | 30000      | checkpoint 间隔       |
| gasLimit      | 0x1C9C380  | 30,000,000 Gas        |
| baseFeePerGas | 0x3B9ACA00 | 1 Gwei（London 必需） |

> ⚠️ **不要包含 `shanghaiTime`！** `shanghaiTime: 0` 会导致 Clique PoA 节点间同步失败，
> 错误信息为 `"clique does not support shanghai fork"`。Genesis 最高支持到 London。
> 详见 [已知陷阱 #11.3](#113-shanghaitime-与-clique-不兼容)。

### 2.2 生成 extradata

extradata 是 Clique PoA 的核心字段，编码了初始验证者集合：

```
格式: 0x + 32字节零填充(64个0) + V1地址(40字符) + V2地址(40字符) + V3地址(40字符) + 65字节零签名(130个0)
```

```bash
# 替换为实际地址（去掉 0x 前缀，**全部小写**）
V1="<validator1_address_lowercase_no_0x>"
V2="<validator2_address_lowercase_no_0x>"
V3="<validator3_address_lowercase_no_0x>"

EXTRADATA="0x$(printf '0%.0s' {1..64})${V1}${V2}${V3}$(printf '0%.0s' {1..130})"
echo $EXTRADATA
```

### 2.3 alloc（预分配）

| 地址            | 余额（hex wei）                | 约等于    | 用途                |
| --------------- | ------------------------------ | --------- | ------------------- |
| Deployer        | `0x...33B2E3C9FD0803CE8000000` | 1B Token  | 合约部署 + 初始分发 |
| Treasury        | `0x...33B2E3C9FD0803CE8000000` | 1B Token  | 协议国库            |
| Validator 1/2/3 | `0x56BC75E2D63100000`          | 100 Token | Gas 费用            |

### 2.4 完整 genesis.json

参考模板：[genesis.json](testnet/genesis.json)

将 Step 1 的地址填入对应占位符，生成最终文件。确保 **所有 fork time 字段仅到 londonBlock**。

---

## Step 3：部署服务器 A（clawnetd.com）

> Server A = 公共入口 + Validator #1 + Homepage

### 3.1 SSH 登录并安装基础软件

```bash
ssh root@66.94.125.242

# 安装 Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

# 安装 Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# 安装 Node.js v20 (用于编译 Homepage 和部署合约)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pnpm

# 安装 Git
apt install -y git
```

### 3.2 克隆项目

```bash
cd /opt
git clone https://github.com/claw-network/clawnet.git clawnet
cd /opt/clawnet
pnpm install
```

### 3.3 配置目录结构

```bash
mkdir -p /opt/clawnet/{chain-data,config}
```

### 3.4 创建 genesis.json 和 password.txt

```bash
# 将完成的 genesis.json 放到 /opt/clawnet/config/genesis.json
# 可以 scp 上传或直接 cat 写入（参考 Step 2.4）

# 验证者解锁密码
echo "clawnet-validator-password" > /opt/clawnet/config/password.txt
chmod 600 /opt/clawnet/config/password.txt
```

### 3.5 初始化 Geth 并导入验证者密钥

```bash
# 初始化链数据
docker run --rm \
  -v /opt/clawnet/chain-data:/data \
  -v /opt/clawnet/config:/config:ro \
  ethereum/client-go:v1.13.15 \
  init --datadir /data /config/genesis.json

# 导入验证者私钥
# 1. 创建临时密钥文件（去掉 0x 前缀）
echo "<VALIDATOR_1_PRIVATE_KEY_WITHOUT_0x>" > /tmp/val.key

# 2. 导入密钥
docker run --rm -it \
  -v /opt/clawnet/chain-data:/data \
  -v /opt/clawnet/config:/config:ro \
  -v /tmp/val.key:/tmp/val.key:ro \
  ethereum/client-go:v1.13.15 \
  account import --datadir /data --password /config/password.txt /tmp/val.key

# 3. 清理临时文件
rm /tmp/val.key
```

### 3.6 创建 .env

```bash
cat > /opt/clawnet/.env << 'EOF'
VALIDATOR_ADDRESS=<VALIDATOR_1_ADDRESS>
EOF
```

### 3.7 部署 docker-compose 文件

```bash
# 从仓库复制 compose 模板
cp /opt/clawnet/infra/testnet/docker-compose.yml /opt/clawnet/docker-compose.chain.yml

# 编辑 VALIDATOR_ADDRESS、bootnodes 等（Server A 无需 bootnodes，留空）
```

compose 文件模板参考：[docker-compose.yml](testnet/docker-compose.yml)

> **注意**：Server A 的 Geth 8545 端口绑定到 `0.0.0.0:8545` 是为了给 Caddy 做反向代理。
> 实际公网访问由 UFW 防火墙控制（不对外开放 8545 端口，只通过 Caddy 443 反代）。

### 3.8 启动 Geth

```bash
cd /opt/clawnet
docker compose -f docker-compose.chain.yml up -d

# 查看日志（确认出块）
docker logs -f clawnet-geth --tail 20
# 应看到: "Successfully sealed new block" 每 2 秒
```

### 3.9 获取 enode URL

后续 Server B/C 需要 Server A 的 enode URL 作为 bootnode：

```bash
curl -s http://127.0.0.1:8545 \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"admin_nodeInfo","params":[],"id":1}' \
  | jq -r '.result.enode'
# 输出: enode://<PUBKEY>@127.0.0.1:30303
# 替换 127.0.0.1 → 66.94.125.242
```

记录此 enode URL，Step 4/5 需要。

### 3.10 配置 Homepage

```bash
cd /opt/clawnet
pnpm install --filter @claw-network/homepage...
cd packages/homepage
pnpm build
# dist/ 目录会被 Caddy 直接 serve
```

### 3.11 配置 Caddy

```bash
# 从仓库复制 Caddyfile
cp /opt/clawnet/infra/testnet/Caddyfile /etc/caddy/Caddyfile

# 创建日志目录
mkdir -p /var/log/caddy
chown caddy:caddy /var/log/caddy

# 重启 Caddy
systemctl restart caddy
systemctl enable caddy

# 验证
curl -s https://clawnetd.com
curl -s https://rpc.clawnetd.com \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Caddyfile 模板参考：[Caddyfile](testnet/Caddyfile)

### 3.12 配置防火墙

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp       # SSH
ufw allow 80/tcp       # HTTP → HTTPS redirect (Caddy)
ufw allow 443/tcp      # HTTPS (Caddy)
ufw allow 9527/tcp     # clawnetd P2P (预留)
ufw allow 30303/tcp    # Geth P2P
ufw allow 30303/udp    # Geth P2P discovery
ufw enable
```

---

## Step 4：部署服务器 B

> Server B = Validator #2（无对外 HTTP）

### 4.1 安装基础软件

```bash
ssh root@85.239.236.49

curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker
apt install -y git
```

### 4.2 克隆项目并配置

```bash
cd /opt
git clone https://github.com/claw-network/clawnet.git clawnet
mkdir -p /opt/clawnet/{chain-data,config}

# 从 Server A 复制 genesis.json（确保完全一致！）
scp root@66.94.125.242:/opt/clawnet/config/genesis.json /opt/clawnet/config/

# 创建密码文件
echo "clawnet-validator-password" > /opt/clawnet/config/password.txt
chmod 600 /opt/clawnet/config/password.txt
```

### 4.3 初始化 Geth 并导入密钥

```bash
# 初始化
docker run --rm \
  -v /opt/clawnet/chain-data:/data \
  -v /opt/clawnet/config:/config:ro \
  ethereum/client-go:v1.13.15 \
  init --datadir /data /config/genesis.json

# 导入验证者 2 密钥 (同 Step 3.5 方法)
echo "<VALIDATOR_2_PRIVATE_KEY_WITHOUT_0x>" > /tmp/val.key
docker run --rm -it \
  -v /opt/clawnet/chain-data:/data \
  -v /opt/clawnet/config:/config:ro \
  -v /tmp/val.key:/tmp/val.key:ro \
  ethereum/client-go:v1.13.15 \
  account import --datadir /data --password /config/password.txt /tmp/val.key
rm /tmp/val.key
```

### 4.4 先以同步模式启动（关键！）

> ⚠️ **如果 Server A 已经在出块，不要直接启动 `--mine`！**
> 两个验证者同时独立挖 block 1 会导致链分叉，然后因 "signed recently" 限制完全卡住。
> 必须先同步到现有链高度，再开启挖矿。详见 [已知陷阱 #11.4](#114-竞争出块导致分叉)。

```bash
# 创建 .env
cat > /opt/clawnet/.env << 'EOF'
VALIDATOR_ADDRESS=<VALIDATOR_2_ADDRESS>
EOF

# 使用同步模式的 compose（不含 --mine）
cp /opt/clawnet/infra/testnet/docker-compose.sync.yml /opt/clawnet/docker-compose.sync.yml
# 编辑 bootnodes 指向 Server A 的 enode URL

docker compose -f docker-compose.sync.yml up -d

# 等待同步完成（区块号应与 Server A 一致）
watch -n2 'curl -sf http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}" | jq -r .result'
```

### 4.5 切换到挖矿模式

确认区块号与 Server A 一致后：

```bash
# 使用挖矿模式的 compose
cp /opt/clawnet/infra/testnet/docker-compose.peer.yml /opt/clawnet/docker-compose.chain.yml
# 编辑 VALIDATOR_ADDRESS、bootnodes

# 切换
docker compose -f docker-compose.sync.yml down
docker compose -f docker-compose.chain.yml up -d

# 验证 peer 连接和出块
curl -s http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'
# 期望: "0x1" (连接到 Server A)
```

### 4.6 配置防火墙

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp       # SSH
ufw allow 9527/tcp     # clawnetd P2P (预留)
ufw allow 30303/tcp    # Geth P2P
ufw allow 30303/udp    # Geth P2P discovery
# 注意：不开放 80、443、8545
ufw enable
```

---

## Step 5：部署服务器 C

与 Step 4 完全相同，仅替换以下内容：

| 项目                             | Server B            | Server C                                  |
| -------------------------------- | ------------------- | ----------------------------------------- |
| SSH 目标                         | root@85.239.236.49  | **root@85.239.235.67**                    |
| 验证者密钥                       | Validator 2         | **Validator 3**                           |
| `--miner.etherbase` / `--unlock` | Validator 2 Address | **Validator 3 Address**                   |
| `--bootnodes`                    | Server A enode      | **Server A + Server B enode**（逗号分隔） |

Server C 建议在 `--bootnodes` 中同时指定 Server A 和 Server B：

```
--bootnodes "enode://<A_PUBKEY>@66.94.125.242:30303,enode://<B_PUBKEY>@85.239.236.49:30303"
```

完成后，每台服务器应显示 2 个 peer。

---

## Step 6：部署智能合约

> ⚠️ 部署必须在 **Server A** 上执行！从远程通过 HTTPS RPC 部署会因超时失败
> （大型合约 `estimateGas` 耗时较长，远程 HTTP 连接会超时）。
> 详见 [已知陷阱 #11.6](#116-合约部署超时)。

### 6.1 在 Server A 编译合约

```bash
ssh root@66.94.125.242
cd /opt/clawnet
git pull
pnpm install --filter @claw-network/contracts...
cd packages/contracts
npx hardhat compile
# 确认输出: "Compiled 43 Solidity files successfully (evm target: london)."
```

> **注意**：`hardhat.config.ts` 中 `evmVersion` 必须设为 `"london"`（不是 `"cancun"`）。
> 我们的 Clique PoA 链不支持 Shanghai/Cancun EVM 特性。
> 详见 [已知陷阱 #11.7](#117-evmversion-必须为-london)。

### 6.2 执行部署

```bash
cd /opt/clawnet/packages/contracts

export DEPLOYER_PRIVATE_KEY="<DEPLOYER_PRIVATE_KEY>"
export TREASURY_ADDRESS="<TREASURY_ADDRESS>"
export LIQUIDITY_ADDRESS="<LIQUIDITY_ADDRESS>"
export RESERVE_ADDRESS="<RESERVE_ADDRESS>"
export CLAWNET_RPC_URL="http://127.0.0.1:8545"

# 紧急签名人（需要 9 个不重复地址）
export EMERGENCY_SIGNERS="<addr1>,<addr2>,...,<addr9>"

npx hardhat run scripts/deploy-all.ts --network clawnetTestnet
```

### 6.2.1 Bootstrap Mint（必须显式设置流动性/风险储备地址）

`scripts/bootstrap-mint.ts` 现在要求显式提供 `LIQUIDITY_ADDRESS` 和 `RESERVE_ADDRESS`，且必须与国库地址隔离。

```bash
cd /opt/clawnet/packages/contracts

export DEPLOYER_PRIVATE_KEY="<DEPLOYER_PRIVATE_KEY>"
export TREASURY_ADDRESS="<TREASURY_ADDRESS>"
export LIQUIDITY_ADDRESS="<LIQUIDITY_ADDRESS>"
export RESERVE_ADDRESS="<RESERVE_ADDRESS>"
export FAUCET_ADDRESS="<FAUCET_ADDRESS_OR_DEPLOYER>"
export NODE_ADDRESSES="<VAL1>,<VAL2>,<VAL3>"
export BOOTSTRAP_TOTAL_SUPPLY=1000000
export CLAWNET_RPC_URL="http://127.0.0.1:8545"

npx hardhat run scripts/bootstrap-mint.ts --network clawnetTestnet
```

部署脚本按依赖顺序部署 9 个 UUPS 代理合约并自动配置角色、参数。

### 6.3 部署输出

成功后输出保存在 `packages/contracts/deployments/clawnetTestnet.json`：

```json
{
  "network": "clawnetTestnet",
  "chainId": 7625,
  "contracts": {
    "ClawToken": { "proxy": "0x...", "impl": "0x..." },
    "ParamRegistry": { "proxy": "0x...", "impl": "0x..." },
    "ClawEscrow": { "proxy": "0x...", "impl": "0x..." },
    "ClawIdentity": { "proxy": "0x...", "impl": "0x..." },
    "ClawStaking": { "proxy": "0x...", "impl": "0x..." },
    "ClawReputation": { "proxy": "0x...", "impl": "0x..." },
    "ClawDAO": { "proxy": "0x...", "impl": "0x..." },
    "ClawContracts": { "proxy": "0x...", "impl": "0x..." },
    "ClawRouter": { "proxy": "0x...", "impl": "0x..." }
  }
}
```

### 6.4 部署后自动配置

`deploy-all.ts` 自动完成以下角色/模块配置：

| 操作                                        | 说明           |
| ------------------------------------------- | -------------- |
| ClawToken.MINTER_ROLE → ClawStaking         | 质押奖励铸币   |
| ParamRegistry.GOVERNOR_ROLE → ClawDAO       | DAO 治理修参数 |
| ClawDAO.reputationContract → ClawReputation | DAO 读取声誉   |
| ClawDAO.stakingContract → ClawStaking       | DAO 读取质押   |
| ClawRouter 注册 8 个模块地址                | 统一寻址       |
| ParamRegistry 设置 14 个默认参数            | 全局配置       |

---

## Step 7：验证集群状态

### 7.1 检查链出块

```bash
curl -s https://rpc.clawnetd.com \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
# 期望：区块号持续增长（每 2 秒 +1）
```

### 7.2 检查 Peer 连接

```bash
curl -s https://rpc.clawnetd.com \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'
# 期望："0x2"（Server A 连接 2 个 peer）
```

### 7.3 检查 Chain ID

```bash
curl -s https://rpc.clawnetd.com \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
# 期望："0x1dc9"  (7625)
```

### 7.4 验证合约

```bash
RPC="https://rpc.clawnetd.com"

# 验证 ClawToken 代理有 bytecode
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["<ClawToken_PROXY_ADDRESS>","latest"],"id":1}'
# 期望：result 长度 > 2（非 "0x"）

# 验证 EIP-1967 implementation slot 非零
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getStorageAt","params":["<ClawToken_PROXY_ADDRESS>","0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc","latest"],"id":1}'
# 期望：非零 32 字节值（implementation 合约地址）
```

### 7.5 完整检查清单

**基础设施层**

- [ ] Server A Geth 出块中（区块号增长）
- [ ] Server B Geth 同步中（区块号一致）
- [ ] Server C Geth 同步中（区块号一致）
- [ ] 每台 Geth peer 数量 = 2
- [ ] rpc.clawnetd.com JSON-RPC 可访问
- [ ] clawnetd.com 主页可访问
- [ ] chainId = 0x1dc9 (7625)
- [ ] 每 2 秒新区块

**合约层**

- [ ] 9 个 UUPS 代理合约均已部署
- [ ] 所有 Proxy 的 EIP-1967 implementation slot 非零
- [ ] ClawToken.MINTER_ROLE → ClawStaking
- [ ] ParamRegistry.GOVERNOR_ROLE → ClawDAO
- [ ] ClawRouter 注册 8 个模块
- [ ] ParamRegistry 14 个默认参数已设置
- [ ] Deployer 账户有足够 Token 用于后续操作

---

## 日常运维

### 查看服务状态

```bash
# 在任意节点
cd /opt/clawnet
docker compose -f docker-compose.chain.yml ps
docker logs clawnet-geth --tail 20
```

### 查看链信息

```bash
RPC="http://127.0.0.1:8545"

# 最新区块号
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# 查账户余额
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["<地址>","latest"],"id":1}'

# Peer 数量
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'

# Clique 出块 signers
curl -s $RPC -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"clique_getSigners","params":[],"id":1}'
```

### 重启服务

```bash
cd /opt/clawnet
docker compose -f docker-compose.chain.yml restart
```

### 更新代码

```bash
cd /opt/clawnet
git pull

# 如需重新编译 Homepage:
cd packages/homepage && pnpm build
```

### 备份

```bash
# 备份链数据
tar -czf /backup/chain-$(date +%Y%m%d).tar.gz /opt/clawnet/chain-data/

# 自动化（每天凌晨 3 点备份，保留 7 天）
crontab -e
# 0 3 * * * tar -czf /backup/chain-$(date +\%Y\%m\%d).tar.gz /opt/clawnet/chain-data/
# 0 4 * * * find /backup -mtime +7 -delete
```

---

## 故障恢复

### 单节点宕机

| 故障节点 | 链影响                  | 恢复方法                                                    |
| -------- | ----------------------- | ----------------------------------------------------------- |
| Server A | 链继续出块（B+C = 2/3） | SSH 重启 `docker compose -f docker-compose.chain.yml up -d` |
| Server B | 链继续出块（A+C = 2/3） | 同上                                                        |
| Server C | 链继续出块（A+B = 2/3） | 同上                                                        |

> Clique PoA 3 验证者只需 2/3 在线即可继续出块。SIGNER_LIMIT = floor(N/2)+1 = 2。

### 链数据损坏

```bash
# 1. 停止服务
docker compose -f docker-compose.chain.yml down

# 2. 备份 nodekey（关键！否则 enode 会变化）
cp /opt/clawnet/chain-data/geth/nodekey /tmp/nodekey.bak

# 3. 删除损坏的链数据
rm -rf /opt/clawnet/chain-data/*

# 4. 重新初始化
docker run --rm \
  -v /opt/clawnet/chain-data:/data \
  -v /opt/clawnet/config:/config:ro \
  ethereum/client-go:v1.13.15 \
  init --datadir /data /config/genesis.json

# 5. 恢复 nodekey
mkdir -p /opt/clawnet/chain-data/geth
cp /tmp/nodekey.bak /opt/clawnet/chain-data/geth/nodekey

# 6. 重新导入验证者密钥（init 会清除 keystore）
# ... (同 Step 3.5 方法)

# 7. 使用同步模式启动（先同步，再切换挖矿）
docker compose -f docker-compose.sync.yml up -d
# 等区块号对齐后切换到 docker-compose.chain.yml
```

### 服务器完全丢失

1. 购买新 VPS
2. 使用相同的验证者私钥和 genesis.json 重新部署
3. 按照 **sync-first-then-mine** 策略加入集群
4. 节点会自动从其他 2 台同步全部链数据

### 所有 3 台同时宕机

1. 恢复任意 1 台，使用备份的 chain-data 恢复
2. 单节点启动（PoA 1/3 也可出块）
3. 恢复其他节点，按 sync-first-then-mine 顺序加入

---

## 安全加固

### SSH 安全

```bash
# 禁用密码登录，仅允许密钥
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
```

### 验证者私钥安全

- **绝不**将私钥提交到 Git
- 密码文件 `chmod 600`
- `.env` 已添加到 `.gitignore`
- 使用 `--allow-insecure-unlock` 只因 Geth 运行在容器内部局域网

### 自动安全更新

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

---

## 已知陷阱与经验教训

以下是实际部署中踩过的坑，**务必仔细阅读**：

### 11.1 Reth 不支持 Clique PoA

Reth 是纯 PoS 客户端，无法运行 Clique PoA 共识。启动时会报错找不到 Clique 配置。
**必须使用 Geth。**

### 11.2 Geth v1.14+ 移除了 Clique

Geth v1.14 起移除了 Clique 支持（错误信息：`"only PoS networks are supported"`）。
**必须锁定使用 `ethereum/client-go:v1.13.15`。**

### 11.3 shanghaiTime 与 Clique 不兼容

Genesis 中包含 `"shanghaiTime": 0` 会导致节点间同步失败：

```
clique does not support shanghai fork
```

单节点可以正常出块，但两个节点尝试 P2P 同步时会报错拒绝对方的区块。
**Genesis 最高只能定义到 `londonBlock`，不能包含任何 time-based fork 字段。**

### 11.4 竞争出块导致分叉

两个验证者节点同时独立挖 block 1 会导致链分叉。由于 Clique 的 "signed recently"
限制（SIGNER_LIMIT = 2），两个节点都无法切换到对方的链，永久卡住。

**解决方案：sync-first-then-mine**

1. Server A 先单独启动并出块
2. 新验证者节点以 sync-only 模式启动（不带 `--mine`，使用 `docker-compose.sync.yml`）
3. 等区块号同步到与 Server A 一致
4. 停掉 sync 模式，切换到 mining 模式（`docker-compose.chain.yml`）

### 11.5 初始化会清除 nodekey

`geth init` 会重写整个 datadir，包括 `geth/nodekey`。nodekey 决定了节点的 enode URL。
如果 nodekey 丢失，其他节点配置的 bootnode 地址就会失效。

**在执行 `geth init` 之前备份 `chain-data/geth/nodekey`，init 后恢复。**

### 11.6 合约部署超时

从本地开发机通过 `https://rpc.clawnetd.com` 部署大合约时，`eth_estimateGas`
可能因 HTTP 超时（Caddy proxy / HTTP client headers timeout）而失败。

**解决方案：SSH 到 Server A，在服务器上通过 `http://127.0.0.1:8545` 直接部署。**

### 11.7 evmVersion 必须为 london

Hardhat 默认 `evmVersion: "cancun"`，但我们的链只支持到 London EVM 指令集。
使用 `cancun` 编译的合约包含 PUSH0 等新指令，在链上会执行失败。

必须在 `hardhat.config.ts` 中设置：

```typescript
solidity: {
  version: "0.8.28",
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "london",    // ← 不是 "cancun"！
  },
},
```

### 11.8 ClawDAO 需要 9 个不重复地址

ClawDAO 的 `initialize()` 需要 `address[9] signers` 参数，且 9 个地址不能重复
（会触发 `DuplicateSigner` 错误）。不能简单用 deployer 地址填充 9 次。

### 11.9 Geth 容器的 entrypoint

`ethereum/client-go` 镜像的 ENTRYPOINT 已经是 `geth`。
compose 文件中用 `entrypoint:` 直接写 `geth --flag...`（geth 后面跟参数）。

---

## 未来扩展

| 阶段           | 操作                                      | 影响                      |
| -------------- | ----------------------------------------- | ------------------------- |
| 用户增长       | 加第 4 台 Geth Full Node（只读 RPC）      | 分担 Server A 的 RPC 负载 |
| 需要区块浏览器 | 加 1 台 4C/16G 跑 Blockscout + PostgreSQL | 提供网页查询              |
| clawnetd P2P   | 部署 P2P 节点到 3 台服务器                | 链下数据三副本            |
| API 高可用     | Server B/C 也装 Caddy，DNS 轮询           | 消除单点                  |

---

## 共识迁移决策（PoA -> QBFT -> PoS）

### 决策对照表

| 维度     | 继续 PoA（Clique/Geth） | 过渡 QBFT（Besu）         | 目标 PoS             |
| -------- | ----------------------- | ------------------------- | -------------------- |
| 适用阶段 | 当前 testnet/早期主网   | 中期稳定扩容              | 长期开放网络         |
| 复杂度   | 低                      | 中                        | 高                   |
| 运维成本 | 低                      | 中                        | 高                   |
| 最终性   | 概率性/较弱             | BFT 最终性（更强）        | 强最终性（取决实现） |
| 迁移风险 | 无                      | 中（客户端/Genesis 变更） | 高（体系重构）       |
| 推荐动作 | 维持并加固              | 作为下一步目标            | 仅在条件成熟后启动   |

### 触发条件

从 PoA 升到 QBFT（建议触发）：

- 验证者数量超过 5，Clique 运维复杂度显著上升。
- 需要更明确的 BFT 最终性与治理审计可解释性。
- 不能接受分叉恢复依赖人工处置。

从 QBFT 升到 PoS（建议触发）：

- 需要开放验证者加入（permissionless 倾向）。
- 经济安全目标高于许可链治理安全。
- 团队具备执行层 + 共识层双栈运维能力。

### 分阶段路线

1. `Now -> 1-2 个月`：继续 PoA，锁定 `Geth v1.13.15` + London Genesis，优先稳定性与运维自动化。
2. `2-4 个月`：建立 QBFT 影子网络 PoC，验证部署、出块、故障恢复、监控告警。
3. `4-6 个月`：基于 SLO 与演练结果决定是否从 PoA 切到 QBFT。
4. `6+ 个月`：若业务与治理目标需要，再单独立项推进 PoS（不与常规迭代混跑）。

### 迁移硬门槛

- 至少 2 次完整演练（含失败回滚）。
- 迁移后 30 天可用性不低于当前基线。
- oncall 可独立处理常见故障。
- 文档、监控、告警、密钥管理全部更新完成。

当前建议结论：保持 PoA，先做 QBFT PoC，再决定是否继续向 PoS 演进。

---

## 附录：文件清单

```
infra/
├── README.md                          ← 本文档
└── testnet/
    ├── genesis.json                   ← 创世区块模板（需填入实际地址）
    ├── docker-compose.yml             ← Server A — Geth 挖矿 compose
    ├── docker-compose.peer.yml        ← Server B/C — Geth 挖矿 compose
    ├── docker-compose.sync.yml        ← 同步模式 compose（不挖矿，用于新节点加入）
    ├── Caddyfile                      ← Server A Caddy 配置（Homepage + API + RPC）
    ├── .env.example                   ← 环境变量模板
    ├── health-check.sh                ← 健康检查脚本
    ├── setup-server.sh                ← 新服务器初始化脚本
    ├── prod/
    │   ├── deploy.sh                  ← 一键 redeploy 脚本（含 preflight 校验）
    │   └── secrets.env                ← 部署密钥与地址（本地保管）
    └── multisig-soft-wallet/
        ├── README.md                  ← 无硬件钱包场景的多签落地手册
        ├── init-env.sh                ← signer 环境初始化（geth 或 docker 模式）
        ├── create-signer-wallet.sh    ← 生成 signer 本地 keystore + public-info
        ├── collect-owner-addresses.sh ← 聚合 3 个 signer 地址生成 Safe owner 清单
        └── create-safe-addresses.sh   ← 一键部署 Safe Core + 创建 Liquidity/Reserve Safe
```

---

_最后更新: 2026-02-25_
_适用版本: ClawNet Chain Testnet v0.1_
_Geth: v1.13.15 · Clique PoA · Chain ID: 7625_
