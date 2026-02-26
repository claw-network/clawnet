# Testnet Monitoring Scripts

ClawNet testnet 提供两个监控脚本：**health-check.sh**（高频巡检）和 **daily-monitor.sh**（每日综合报告）。

---

## 架构概览

```
                  ┌─────────────────────────────────────┐
                  │  Geth Validator Cluster (3-Node)     │
                  │                                     │
  health-check.sh │  Server A (66.94.125.242)           │
  daily-monitor.sh│    ├─ Geth RPC (0.0.0.0:8545) ◄────┤── 外部可达
       ▼          │    ├─ Caddy (api.clawnetd.com)      │
  ┌────────┐      │    └─ clawnetd (:9528)              │
  │ 本地   │      │                                     │
  │ 或     │─────►│  Server B (85.239.236.49)           │
  │ 服务器 │      │    └─ Geth RPC (127.0.0.1:8545)     │── 仅 localhost
  └────────┘      │                                     │
                  │  Server C (85.239.235.67)           │
                  │    └─ Geth RPC (127.0.0.1:8545)     │── 仅 localhost
                  └─────────────────────────────────────┘

                  ┌─────────────────────────────────────┐
                  │  Scenario Test Nodes (3-Node)       │
                  │                                     │
                  │  173.249.46.252  (:9528) ─ Alice    │
                  │  167.86.93.216   (:9528) ─ Bob      │
                  │  167.86.93.223   (:9528) ─ Charlie  │
                  └─────────────────────────────────────┘
```

Server B/C 的 RPC 绑定在 127.0.0.1，外部不可达。通过 Server A 的 `net_peerCount ≥ 2` 间接验证 B/C 在线。

---

## health-check.sh

**用途**：高频健康巡检（建议 crontab 每 5 分钟）。

### 检查项

| # | 检查项 | 方法 | 阈值 |
|---|--------|------|------|
| 1 | Geth 可达性 | `eth_blockNumber` RPC | 必须返回 |
| 2 | 区块新鲜度 | `eth_getBlockByNumber` 时间戳 | ≤ 30 秒 |
| 3 | Peer 数量 | `net_peerCount` | ≥ 2（3 节点集群） |
| 4 | 出块状态 | `eth_mining` | 必须为 true |
| 5 | ClawNet Node API | `GET /api/v1/node` | HTTP 200 |
| 6 | EventIndexer | 读取 `indexer.sqlite` | lag ≤ 100 blocks |
| 7 | Docker 容器 | `docker inspect` | running |
| 8 | 磁盘空间 | `df -h /` | ≤ 80% WARN, ≤ 90% FAIL |

### 用法

```bash
# 远程模式（本地或 CI 运行，通过 Server A 的公开 RPC 检查）
./health-check.sh

# 本地模式（在服务器上直接运行，检查 localhost）
./health-check.sh --local

# 持续监控
watch -n 60 ./health-check.sh
```

### Crontab 配置

```crontab
# 每 5 分钟巡检，输出到 syslog
*/5 * * * * /opt/clawnet/infra/testnet/health-check.sh 2>&1 | logger -t clawnet-health
```

### 告警

设置 `ALERT_WEBHOOK_URL` 环境变量后，检查失败时会自动发送 webhook 告警（兼容飞书/钉钉/Slack）。

### 运行环境

- **本地 + 服务器均可运行**
- 本地运行时 Docker/磁盘检查会显示为 "not present"（正常）
- 依赖：`curl`, `jq`, `docker`（可选）, `sqlite3`（可选）

---

## daily-monitor.sh

**用途**：每日综合稳定性报告，包含 4 大检查模块 + JSON 报告输出。用于 T-3.9 观察窗口（7 天）。

### 检查模块

| # | 模块 | 说明 | 运行位置 |
|---|------|------|----------|
| 1 | **Geth Chain Health** | 区块高度、新鲜度、peer 数量、集群连通性 | 本地 + 服务器 |
| 2 | **ClawNet Node REST API** | 节点 DID、peers、版本号 | 本地 + 服务器 |
| 3 | **Reconciliation** | 4D 链上↔链下一致性检查（DID/余额/托管/合约） | **仅服务器** |
| 4 | **Scenario Regression** | Scenario 01 (Identity & Wallet) 回归测试 | 本地 + 服务器 |

### Reconciliation 详细说明

Reconciliation 通过 `packages/contracts/scripts/reconcile.ts` 执行 4 维一致性检查：

1. **DID** — 链上 `ClawIdentity.getController()` vs `indexer.sqlite` 的 `did_cache` 表
2. **Balance** — 链上 `ClawToken.balanceOf()` vs 索引器推算的转账余额
3. **Escrow** — 链上 `ClawEscrow.getEscrow()` vs `escrows` 表
4. **Contract** — 链上 `ClawContracts.getContract()` vs `service_contracts` 表

> **注意**：此模块需要 `indexer.sqlite`（仅存在于运行 clawnetd 的服务器上）+ hardhat 连接 RPC。本地运行时会自动跳过并显示 `ℹ` 提示。

### Scenario 智能检测

脚本会自动读取 `scenarios/.env` 中的 `NODE_A/B/C_URL`：

- **3 个不同 URL** → 正常运行 Scenario 01（9 个测试用例）
- **3 个相同 URL** → 自动跳过并提示「单节点，等多节点部署后自动启用」
- **URL 未配置** → 自动跳过

### 用法

```bash
# 完整运行（4 个模块全部执行）
./daily-monitor.sh

# 跳过 Scenario 回归测试
./daily-monitor.sh --skip-scenarios

# 查看当天已有报告
./daily-monitor.sh --report-only
```

### Crontab 配置

```crontab
# 每天 UTC 06:00 运行
0 6 * * * cd /opt/clawnet && bash infra/testnet/daily-monitor.sh 2>&1 | tee -a /opt/clawnet/logs/monitor.log
```

### 输出报告

每次运行会在 `infra/testnet/reports/` 下生成 JSON 报告：

```
reports/
├── 2026-02-26.json         # 每日综合报告
├── reconcile-2026-02-26.json  # Reconciliation 详细报告（仅服务器运行时）
└── ...
```

JSON 报告结构：

```json
{
  "date": "2026-02-26",
  "timestamp": "2026-02-26T06:00:00Z",
  "observationDay": 1,
  "observationTotal": 7,
  "checks": {
    "geth": { "blockHeight": 47000, "clusterPeers": 2, "expectedPeers": 2 },
    "nodeApi": { "A": "ok" },
    "reconciliation": { "status": "passed", "discrepancies": 0 },
    "scenarios": { "status": "passed", "passed": 9, "failed": 0 }
  },
  "summary": { "passed": 4, "warned": 0, "failed": 0, "status": "PASS" }
}
```

### 退出码

| 码 | 含义 |
|----|------|
| 0 | PASS 或 WARN（非致命） |
| 1 | FAIL（有关键检查失败） |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GETH_RPC_A` | `http://66.94.125.242:8545` | Server A 的 Geth RPC |
| `NODE_A_URL` | `https://api.clawnetd.com` | ClawNet Node API（Caddy 反代） |
| `OBSERVATION_START` | `2026-02-26` | 观察窗口起始日期 |
| `ALERT_WEBHOOK_URL` | （空） | 失败告警 webhook URL |

Scenario 相关变量在 `scenarios/.env` 中配置（详见 [scenarios/README.md](scenarios/README.md)）。

---

## 两个脚本的区别

| 维度 | health-check.sh | daily-monitor.sh |
|------|-----------------|------------------|
| 频率 | 每 5 分钟 | 每天 1 次 |
| 用途 | 实时巡检告警 | 综合稳定性评估 |
| 输出 | 纯文本 stdout | stdout + JSON 报告 |
| 检查深度 | 基础连通性 | 4D reconciliation + E2E 回归 |
| 告警 | Webhook 自动告警 | 仅记录报告 |
| Docker/磁盘 | ✓ 检查 | ✗ 不检查 |
| Scenario 测试 | ✗ 不执行 | ✓ 自动执行 |
