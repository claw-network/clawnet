# ClawNet Chain 基础设施部署指南

> 3 台服务器部署 ClawNet Chain（独立 EVM PoA）+ clawnetd P2P 节点的完整操作手册

---

## 目录

1. [架构总览](#1-架构总览)
2. [服务器清单与规格](#2-服务器清单与规格)
3. [前置准备](#3-前置准备)
4. [Step 1：生成验证者密钥](#step-1生成验证者密钥)
5. [Step 2：创建 Genesis 配置](#step-2创建-genesis-配置)
6. [Step 3：部署服务器 A（clawnetd.com）](#step-3部署服务器-aclawnetdcom)
7. [Step 4：部署服务器 B（Contabo #1）](#step-4部署服务器-bcontabo-1)
8. [Step 5：部署服务器 C（Contabo #2）](#step-5部署服务器-ccontabo-2)
9. [Step 6：验证集群状态](#step-6验证集群状态)
10. [日常运维](#7-日常运维)
11. [故障恢复](#8-故障恢复)
12. [安全加固](#9-安全加固)
13. [未来扩展](#10-未来扩展)

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│          3 台服务器 · ClawNet Chain + P2P 最小生产级部署                     │
│                                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐                         │
│  │  Server B            │  │  Server C            │                         │
│  │  Contabo #1          │  │  Contabo #2          │                         │
│  │                      │  │                      │                         │
│  │  Reth Validator #2   │  │  Reth Validator #3   │                         │
│  │  clawnetd (peer)     │  │  clawnetd (peer)     │                         │
│  │  4C/8G/200G          │  │  4C/8G/200G          │                         │
│  │  €5.99/月            │  │  €5.99/月            │                         │
│  └──────────┬───────────┘  └──────────┬───────────┘                         │
│             │ P2P :30303 + :9527      │                                     │
│             └────────────┬────────────┘                                     │
│                          │                                                   │
│  ┌───────────────────────┴───────────────────────────┐                      │
│  │  Server A — clawnetd.com（现有）                   │                      │
│  │                                                    │                      │
│  │  Reth Validator #1      ← PoA 出块节点            │                      │
│  │  clawnetd (bootstrap)   ← P2P 引导节点            │                      │
│  │  Caddy (TLS)            ← HTTPS 统一入口          │                      │
│  │                                                    │                      │
│  │  对外:                                             │                      │
│  │    api.clawnetd.com:443    → clawnetd REST API    │                      │
│  │    rpc.clawnetd.com:443    → Reth JSON-RPC        │                      │
│  │    :9527                   → libp2p P2P           │                      │
│  │    :30303                  → Reth P2P             │                      │
│  └────────────────────────────────────────────────────┘                      │
│                                                                              │
│  PoA 共识：3 Validators → 可容忍 1 台宕机                                   │
│  P2P 网络：3 clawnetd 节点 → 链下数据三副本                                 │
│  月成本：~€12 (~¥92) + 现有服务器                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 数据流

```
Agent/SDK
  │
  ├──(HTTPS)──→ api.clawnetd.com:443 ──→ Caddy ──→ clawnetd :9528 (REST API)
  │
  ├──(HTTPS)──→ rpc.clawnetd.com:443 ──→ Caddy ──→ Reth :8545 (JSON-RPC)
  │
  └──(TCP)────→ :9527 ──→ clawnetd libp2p (P2P gossip)

Reth 节点间:
  Server A :30303 ←──P2P──→ Server B :30303 ←──P2P──→ Server C :30303

clawnetd 节点间:
  Server A :9527 ←──libp2p──→ Server B :9527 ←──libp2p──→ Server C :9527
```

---

## 2. 服务器清单与规格

| 标识 | 主机名 | 提供商 | 配置 | 月费 | 角色 |
|------|--------|--------|------|------|------|
| **Server A** | clawnetd.com | 现有 | ≥4 GB RAM, ≥80 GB SSD | ¥0 | 公共入口 + Validator #1 + Bootstrap |
| **Server B** | contabo-1 | Contabo VPS S | 4C/8G/200G | €5.99 | Validator #2 + Peer |
| **Server C** | contabo-2 | Contabo VPS S | 4C/8G/200G | €5.99 | Validator #3 + Peer |

### 端口分配

| 端口 | 协议 | 用途 | Server A | Server B | Server C |
|------|------|------|----------|----------|----------|
| 443 | TCP | HTTPS (Caddy) | ✅ 对外 | ❌ | ❌ |
| 8545 | TCP | Reth JSON-RPC | 仅本地 | 仅本地 | 仅本地 |
| 9527 | TCP | clawnetd P2P (libp2p) | ✅ 对外 | ✅ 对外 | ✅ 对外 |
| 9528 | TCP | clawnetd REST API | 仅本地 | 仅本地 | 仅本地 |
| 30303 | TCP+UDP | Reth P2P | ✅ 对外 | ✅ 对外 | ✅ 对外 |

### 域名配置

| 域名 | A 记录指向 | 用途 |
|------|-----------|------|
| `api.clawnetd.com` | Server A IP | clawnetd REST API |
| `rpc.clawnetd.com` | Server A IP | Chain JSON-RPC |

---

## 3. 前置准备

### 3.1 购买 Contabo VPS

1. 访问 https://contabo.com/en/vps/
2. 选择 **VPS S** (4 vCPU / 8 GB / 200 GB SSD)
3. 操作系统选择 **Ubuntu 22.04 LTS**
4. 购买 2 台，记录 IP 地址

### 3.2 本地工具

在本地开发机安装以下工具（用于生成密钥和配置）：

```bash
# 安装 Foundry（包含 cast 命令行工具）
curl -L https://foundry.paradigm.xyz | bash
foundryup

# 验证
cast --version
```

### 3.3 DNS 配置

在域名管理面板，为 `clawnetd.com` 添加 A 记录：

```
api.clawnetd.com  →  <Server A IP>
rpc.clawnetd.com  →  <Server A IP>
```

---

## Step 1：生成验证者密钥

> ⚠️ 在安全的本地环境执行，不要在服务器上生成密钥！

### 1.1 生成 3 个验证者账户

```bash
# 验证者 1 (Server A)
cast wallet new
# 输出示例:
# Address:     0xAAAA...
# Private key: 0xaaaa...

# 验证者 2 (Server B)
cast wallet new
# Address:     0xBBBB...
# Private key: 0xbbbb...

# 验证者 3 (Server C)
cast wallet new
# Address:     0xCCCC...
# Private key: 0xcccc...
```

### 1.2 生成部署者账户（用于部署合约）

```bash
cast wallet new
# Address:     0xDEPL...
# Private key: 0xdepl...
```

### 1.3 生成国库账户

```bash
cast wallet new
# Address:     0xTREA...
# Private key: 0xtrea...
```

### 1.4 记录所有地址

将以下信息记录到安全的密码管理器中（**不要**提交到 Git）：

```
VALIDATOR_1_ADDRESS=0xAAAA...
VALIDATOR_1_PRIVATE_KEY=0xaaaa...

VALIDATOR_2_ADDRESS=0xBBBB...
VALIDATOR_2_PRIVATE_KEY=0xbbbb...

VALIDATOR_3_ADDRESS=0xCCCC...
VALIDATOR_3_PRIVATE_KEY=0xcccc...

DEPLOYER_ADDRESS=0xDEPL...
DEPLOYER_PRIVATE_KEY=0xdepl...

TREASURY_ADDRESS=0xTREA...
TREASURY_PRIVATE_KEY=0xtrea...
```

---

## Step 2：创建 Genesis 配置

### 2.1 编辑 genesis.json

将 Step 1 中生成的地址填入 `infra/chain-testnet/genesis.json`（模板已提供在本仓库）。

关键字段说明：

```
chainId: 7625          — ClawNet Chain ID（已在模板中预设）
clique.period: 2       — 每 2 秒出块
gasLimit: 30,000,000   — 每个区块的 Gas 上限

extradata 格式:
  32 字节零填充
  + Validator1 地址 (20 字节)
  + Validator2 地址 (20 字节)
  + Validator3 地址 (20 字节)
  + 65 字节零签名

alloc:
  Deployer: 预分配 10 亿 Token（用于合约部署和初始分发）
  Treasury: 预分配 10 亿 Token（协议国库）
  Validator 1/2/3: 各预分配 100 Token（Gas 费用）
```

### 2.2 生成 extradata

```bash
# 替换为实际地址（去掉 0x 前缀）
V1="AAAA..."  # 40 字符 hex (验证者 1 地址，不含 0x)
V2="BBBB..."  # 40 字符 hex
V3="CCCC..."  # 40 字符 hex

EXTRADATA="0x$(printf '0%.0s' {1..64})${V1}${V2}${V3}$(printf '0%.0s' {1..130})"
echo $EXTRADATA
```

将输出的 `EXTRADATA` 值写入 `genesis.json` 的 `extradata` 字段。

---

## Step 3：部署服务器 A（clawnetd.com）

> Server A = 现有服务器，公共入口 + Validator #1 + Bootstrap 节点

### 3.1 SSH 登录并安装基础软件

```bash
ssh root@<SERVER_A_IP>

# 更新系统
apt update && apt upgrade -y

# 安装 Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

# 安装 Docker Compose plugin
apt install -y docker-compose-plugin

# 安装 Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# 验证
docker --version
docker compose version
caddy version
```

### 3.2 创建目录结构

```bash
mkdir -p /opt/clawnet/{chain-data,clawnetd-data,config}
```

### 3.3 上传配置文件

从本地仓库将以下文件上传到服务器：

```bash
# 在本地执行
scp infra/chain-testnet/genesis.json       root@<SERVER_A_IP>:/opt/clawnet/config/
scp infra/chain-testnet/docker-compose.yml root@<SERVER_A_IP>:/opt/clawnet/
scp infra/chain-testnet/Caddyfile          root@<SERVER_A_IP>:/etc/caddy/Caddyfile
```

### 3.4 创建环境变量文件

```bash
cat > /opt/clawnet/.env << 'EOF'
# === Server A: clawnetd.com ===
SERVER_ROLE=primary

# Reth Validator
RETH_VALIDATOR_KEY=<VALIDATOR_1_PRIVATE_KEY>  # 替换为实际私钥
RETH_CHAIN_ID=7625
RETH_NETWORK_PORT=30303
RETH_HTTP_PORT=8545
RETH_BOOTNODES=

# clawnetd P2P node
CLAW_PASSPHRASE=<生成一个安全的随机密码>
CLAW_API_HOST=127.0.0.1
CLAW_API_PORT=9528
CLAW_DATA_DIR=/data

# Caddy
CLAW_API_KEY=<生成一个安全的 API Key>
EOF

chmod 600 /opt/clawnet/.env
```

### 3.5 初始化 Reth

```bash
cd /opt/clawnet

# 初始化链数据（使用 genesis.json 创建创世区块）
docker run --rm \
  -v /opt/clawnet/chain-data:/data \
  -v /opt/clawnet/config/genesis.json:/genesis.json \
  ghcr.io/paradigmxyz/reth:latest \
  init --datadir /data --chain /genesis.json
```

### 3.6 启动服务

```bash
cd /opt/clawnet
docker compose up -d

# 查看日志
docker compose logs -f
```

### 3.7 配置 Caddy

```bash
# Caddy 配置已通过 scp 上传到 /etc/caddy/Caddyfile
# 设置 API Key 环境变量
echo 'CLAW_API_KEY=<你的 API Key>' >> /etc/default/caddy

# 重启 Caddy
systemctl restart caddy
systemctl enable caddy

# 验证 HTTPS
curl -s https://api.clawnetd.com/api/node/status
curl -s https://rpc.clawnetd.com \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### 3.8 配置防火墙

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp       # SSH
ufw allow 443/tcp      # HTTPS (Caddy)
ufw allow 9527/tcp     # clawnetd P2P
ufw allow 30303/tcp    # Reth P2P
ufw allow 30303/udp    # Reth P2P discovery
ufw enable
```

---

## Step 4：部署服务器 B（Contabo #1）

> Server B = Validator #2 + clawnetd Peer（无对外 HTTP）

### 4.1 SSH 登录并安装基础软件

```bash
ssh root@<SERVER_B_IP>

apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker
apt install -y docker-compose-plugin
```

### 4.2 创建目录结构

```bash
mkdir -p /opt/clawnet/{chain-data,clawnetd-data,config}
```

### 4.3 上传配置

```bash
# 在本地执行
scp infra/chain-testnet/genesis.json                root@<SERVER_B_IP>:/opt/clawnet/config/
scp infra/chain-testnet/docker-compose.peer.yml     root@<SERVER_B_IP>:/opt/clawnet/docker-compose.yml
```

### 4.4 创建环境变量文件

```bash
cat > /opt/clawnet/.env << 'EOF'
# === Server B: Contabo #1 ===
SERVER_ROLE=peer

# Reth Validator
RETH_VALIDATOR_KEY=<VALIDATOR_2_PRIVATE_KEY>  # 替换
RETH_CHAIN_ID=7625
RETH_NETWORK_PORT=30303
RETH_HTTP_PORT=8545
RETH_BOOTNODES=enode://<VALIDATOR_1_ENODE_ID>@<SERVER_A_IP>:30303

# clawnetd P2P node
CLAW_PASSPHRASE=<生成一个安全的随机密码>
CLAW_API_HOST=127.0.0.1
CLAW_API_PORT=9528
CLAW_DATA_DIR=/data
CLAW_BOOTSTRAP=/ip4/<SERVER_A_IP>/tcp/9527/p2p/<BOOTSTRAP_PEER_ID>
EOF

chmod 600 /opt/clawnet/.env
```

### 4.5 初始化并启动

```bash
cd /opt/clawnet

# 初始化链
docker run --rm \
  -v /opt/clawnet/chain-data:/data \
  -v /opt/clawnet/config/genesis.json:/genesis.json \
  ghcr.io/paradigmxyz/reth:latest \
  init --datadir /data --chain /genesis.json

# 启动
docker compose up -d
docker compose logs -f
```

### 4.6 配置防火墙

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp       # SSH
ufw allow 9527/tcp     # clawnetd P2P
ufw allow 30303/tcp    # Reth P2P
ufw allow 30303/udp    # Reth P2P discovery
# 注意：不开放 443、8545、9528
ufw enable
```

---

## Step 5：部署服务器 C（Contabo #2）

与 Step 4 完全相同，仅替换：

| 变量 | Server B 值 | Server C 值 |
|------|------------|------------|
| `RETH_VALIDATOR_KEY` | Validator 2 私钥 | **Validator 3 私钥** |
| `RETH_BOOTNODES` | Server A enode | Server A enode（相同） |
| `CLAW_BOOTSTRAP` | Server A P2P 地址 | Server A P2P 地址（相同） |

重复 Step 4 的 4.1–4.6，将 `VALIDATOR_2_PRIVATE_KEY` 替换为 `VALIDATOR_3_PRIVATE_KEY`。

---

## Step 6：验证集群状态

### 6.1 检查链出块

```bash
# 在 Server A 上执行
curl -s http://127.0.0.1:8545 \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# 期望：区块号持续增长（每 2 秒 +1）
```

### 6.2 检查 Peer 连接

```bash
# 检查 Reth peer 数量
curl -s http://127.0.0.1:8545 \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}'

# 期望：结果为 "0x2"（连接了 2 个 peer）
```

### 6.3 检查 clawnetd 状态

```bash
# 在 Server A 上
curl -s http://127.0.0.1:9528/api/node/status | jq .
# 期望：{ "synced": true, "peers": 2, ... }
```

### 6.4 检查外部 HTTPS 访问

```bash
# 在本地执行
curl -s https://api.clawnetd.com/api/node/status
curl -s https://rpc.clawnetd.com \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

# 期望：chainId = "0x1dc9" (7625)
```

### 6.5 检查清单

```
□ Server A Reth 出块中（区块号增长）
□ Server B Reth 同步中（区块号一致）
□ Server C Reth 同步中（区块号一致）
□ Reth peer 数量 = 2（每台）
□ clawnetd 3 节点互联（peers = 2）
□ api.clawnetd.com HTTPS 可访问
□ rpc.clawnetd.com JSON-RPC 可访问
□ chainId = 7625
□ 每 2 秒新区块
```

---

## 7. 日常运维

### 7.1 查看服务状态

```bash
# 在任意节点
cd /opt/clawnet
docker compose ps
docker compose logs --tail 50 reth
docker compose logs --tail 50 clawnetd
```

### 7.2 查看链信息（命令行替代 Blockscout）

前期不部署区块浏览器，使用命令行查询：

```bash
# 查最新区块号
cast block-number --rpc-url http://127.0.0.1:8545

# 查账户余额（Token）
cast balance <地址> --rpc-url http://127.0.0.1:8545

# 查交易详情
cast tx <交易hash> --rpc-url http://127.0.0.1:8545

# 查区块详情
cast block latest --rpc-url http://127.0.0.1:8545

# 查看合约（如果已部署）
cast call <合约地址> "balanceOf(address)" <地址> --rpc-url http://127.0.0.1:8545
```

### 7.3 重启服务

```bash
cd /opt/clawnet
docker compose restart        # 重启所有
docker compose restart reth   # 仅重启 Reth
docker compose restart clawnetd  # 仅重启 clawnetd
```

### 7.4 更新服务

```bash
cd /opt/clawnet

# 更新 clawnetd 镜像
docker compose pull clawnetd
docker compose up -d clawnetd

# 更新 Reth 镜像（谨慎操作，建议先在 1 台验证）
docker compose pull reth
docker compose up -d reth
```

### 7.5 备份

```bash
# 备份链数据（建议每天凌晨）
tar -czf /backup/chain-$(date +%Y%m%d).tar.gz /opt/clawnet/chain-data/

# 备份 clawnetd 数据
tar -czf /backup/clawnetd-$(date +%Y%m%d).tar.gz /opt/clawnet/clawnetd-data/

# 自动化（添加到 crontab）
crontab -e
# 添加：
# 0 3 * * * tar -czf /backup/chain-$(date +\%Y\%m\%d).tar.gz /opt/clawnet/chain-data/
# 0 3 * * * tar -czf /backup/clawnetd-$(date +\%Y\%m\%d).tar.gz /opt/clawnet/clawnetd-data/
# 0 4 * * * find /backup -mtime +7 -delete
```

### 7.6 监控脚本

```bash
# 保存为 /opt/clawnet/health-check.sh
#!/bin/bash

RETH_RPC="http://127.0.0.1:8545"

# 检查 Reth
BLOCK=$(curl -sf $RETH_RPC -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  | jq -r '.result')

if [ -z "$BLOCK" ]; then
  echo "[ALERT] Reth not responding!"
  # 可选：发送告警（邮件/Telegram/钉钉）
else
  echo "[OK] Reth block: $BLOCK"
fi

# 检查 clawnetd
STATUS=$(curl -sf http://127.0.0.1:9528/api/node/status | jq -r '.synced')
if [ "$STATUS" != "true" ]; then
  echo "[ALERT] clawnetd not synced!"
else
  echo "[OK] clawnetd synced"
fi

# 检查 peers
PEERS=$(curl -sf $RETH_RPC -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}' \
  | jq -r '.result')

echo "[INFO] Reth peers: $PEERS"
```

添加到 crontab 每 5 分钟执行：
```
*/5 * * * * /opt/clawnet/health-check.sh >> /var/log/clawnet-health.log 2>&1
```

---

## 8. 故障恢复

### 8.1 单节点宕机

| 故障节点 | 链影响 | 恢复方法 |
|---------|--------|---------|
| Server A | 链继续出块（B+C = 2/3） | SSH 登录重启 `docker compose up -d` |
| Server B | 链继续出块（A+C = 2/3） | 同上 |
| Server C | 链继续出块（A+B = 2/3） | 同上 |

### 8.2 链数据损坏

```bash
# 1. 停止服务
docker compose down

# 2. 删除损坏的链数据
rm -rf /opt/clawnet/chain-data/*

# 3. 重新初始化
docker run --rm \
  -v /opt/clawnet/chain-data:/data \
  -v /opt/clawnet/config/genesis.json:/genesis.json \
  ghcr.io/paradigmxyz/reth:latest \
  init --datadir /data --chain /genesis.json

# 4. 重新启动（会自动从其他节点同步）
docker compose up -d
```

### 8.3 服务器完全丢失

1. 购买新 Contabo VPS
2. 重复 Step 4/5 的部署流程
3. 使用相同的验证者私钥和 genesis.json
4. 节点会自动从其他 2 台同步全部链数据

### 8.4 所有 3 台同时宕机

如果所有 3 台服务器同时不可用（极端罕见）：

1. 恢复任意 1 台服务器
2. 使用备份的 chain-data 恢复
3. 启动 Reth 单节点（PoA 1/3 也可出块）
4. 恢复其他节点

---

## 9. 安全加固

### 9.1 SSH 安全

```bash
# 禁用密码登录，仅允许密钥
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# 更换 SSH 端口（可选）
sed -i 's/#Port 22/Port 2222/' /etc/ssh/sshd_config
systemctl restart sshd
ufw allow 2222/tcp
ufw delete allow 22/tcp
```

### 9.2 验证者私钥安全

- **绝不**将私钥提交到 Git
- 使用 `.env` 文件 + `chmod 600` 权限
- `.env` 已添加到 `.gitignore`
- 定期轮换密钥（需要 DAO 治理或多签更新 genesis）

### 9.3 自动安全更新

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

---

## 10. 未来扩展

| 阶段 | 操作 | 影响 |
|------|------|------|
| 用户增长 | 加第 4 台：Reth Full Node（只读 RPC） | 分担 Server A 的 RPC 负载 |
| 需要浏览器 | 加 1 台 4C/16G 跑 Blockscout + PostgreSQL | 提供网页查询 |
| PoA → PoS | 合约部署后，社区节点通过质押加入验证 | 去中心化 |
| API 高可用 | Server B/C 也装 Caddy，DNS 轮询或 Cloudflare LB | 消除 A 单点 |

---

## 附录：文件清单

```
infra/
├── README.md                          ← 本文档
├── chain-testnet/
│   ├── genesis.json                   ← 创世区块配置（需填入地址）
│   ├── docker-compose.yml             ← Server A 的 docker-compose
│   ├── docker-compose.peer.yml        ← Server B/C 的 docker-compose
│   ├── Caddyfile                      ← Server A 的 Caddy 反向代理配置
│   ├── .env.example                   ← 环境变量模板
│   ├── health-check.sh                ← 健康检查脚本
│   └── setup-server.sh                ← 服务器初始化脚本
└── chain-devnet/
    └── ...                            ← 本地开发用（后续创建）
```

---

*最后更新: 2026-02-22*
*适用版本: ClawNet Chain Testnet v0.1*
