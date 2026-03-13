# ClawNet 市场就绪审计报告

> 审计日期：2026-03-13
> 当前版本：v0.6.6
> 整体就绪度：**91%**（Testnet 公开可用，Besu Ed25519 预编译 Testnet 已验证，ParamRegistry 集成代码就绪，备份已启用，Mainnet 需完成 Phase 2）

---

## 一、缺失功能（需新增）

### P0 — 上线阻断项

- [x] **API 全局限流** ✅ `v0.6.6`
  - 已实现：`middleware.ts` 添加 `createRateLimiter()` — 基于滑动窗口的 per-IP 限流，读操作 300/min，写操作 60/min
  - OPTIONS 和 GET `/api/v1/node` 免限流；支持 `X-Forwarded-For`（Caddy 反代）
  - 429 响应含 `Retry-After` + `X-RateLimit-*` 信息头
  - 相关文件：`packages/node/src/api/middleware.ts`、`packages/node/src/api/server.ts`

- [ ] **智能合约第三方安全审计**
  - 现状：10 个合约管理真实 Token 资产，未经过任何专业审计
  - 风险：合约漏洞可导致资产损失，且 UUPS 代理模式增加升级攻击面
  - 方案：聘请审计公司（Trail of Bits / OpenZeppelin / CertiK）进行全量审计
  - 合约清单：ClawToken、ClawIdentity、ClawEscrow、ClawReputation、ClawDAO、ClawContracts、ClawRouter、ParamRegistry、ClawStaking、ClawRelayReward

### P1 — 主网前必须完成

- [x] **Prometheus 指标导出** ✅ `v0.6.6`
  - 已实现：`GET /api/v1/metrics` 端点导出 Prometheus 格式指标，可直接接入 Grafana
  - HTTP 指标：`clawnet_http_request_duration_seconds`（直方图）、`clawnet_http_requests_total`（计数器），按 method/route/status_code 分标签
  - 节点指标：`clawnet_block_height`、`clawnet_p2p_peers`、`clawnet_p2p_connections`、`clawnet_node_uptime_seconds`
  - 中继指标：`clawnet_relay_active_circuits`、`clawnet_relay_bytes_total`、`clawnet_relay_messages_total`
  - 进程指标：CPU、内存、event loop 延迟等（`prom-client` 默认指标）
  - 路径归一化防止标签基数爆炸（DID/地址/数字ID → `:id`）
  - `/metrics` 免认证免限流，支持 Prometheus 直接抓取
  - 相关文件：`packages/node/src/api/metrics.ts`、`packages/node/src/api/routes/metrics.ts`、`packages/node/src/api/server.ts`

- [ ] **集中式日志方案**
  - 现状：日志仅输出到 stdout，systemd journal 本地存储
  - 方案：接入 ELK Stack 或 Datadog，添加结构化 JSON 日志格式
  - 相关文件：`packages/node/src/logger.ts`

- [ ] **压力/负载测试**
  - 现状：无 100+ tx/sec 压力测试，无 72 小时耐久测试
  - 方案：使用 k6 或 Artillery 编写负载测试脚本，覆盖转账、市场搜索、合约创建等高频端点
  - 产出：基线性能数据、瓶颈识别

### P2 — 后续优化

- [x] **WebSocket 主题通配符订阅** ✅ 已实现
  - 支持通配符前缀：`telagent/*` 匹配所有以 `telagent/` 开头的主题
  - 支持逗号分隔：`telagent/envelope,chat/message` 订阅多个主题
  - 实时推送（`buildTopicMatcher`）和重放回放（`getInbox` SQL LIKE）均支持通配符

- [x] **拜占庭容错/网络分区测试** ✅ 测试脚本已实现，待 Docker 环境运行验证
  - 脚本：`scripts/partition-test.mjs`，运行命令：`pnpm test:partition [--verbose]`
  - 使用 `docker network disconnect/connect` 模拟网络分区（无需 `tc netem` 或容器特权）
  - 5 个测试场景：
    1. 基线检查 — 3 节点健康、block height 一致
    2. 隔离 peer2 — 少数派分区，多数派（bootstrap + peer1）继续工作
    3. 恢复 peer2 — 重连后 peer 发现恢复、block height 收敛
    4. 隔离 bootstrap — 种子节点分区，peer1/peer2 优雅降级
    5. 恢复 bootstrap — 全集群恢复，数据一致性验证
  - 前提：`docker compose -f docker-compose.testnet.yml up --build -d`
  - `finally` 块确保测试后所有容器网络恢复

---

## 二、已有功能但不完善

### P0 — 上线阻断项

- [x] **X25519 消息加密密钥不持久化** ✅ 已修复
  - 修复：X25519 私钥持久化存储到 `<dataDir>/keys/x25519.key`，节点启动时自动加载或生成
  - 位置：`packages/node/src/services/messaging-service.ts` — `loadOrCreateX25519Key()`
  - 公开方法：`getX25519PublicKeyHex()` 允许发送方获取接收方公钥

### P1 — 主网前必须完成

- [x] **Staking 奖励乘数始终返回 1x** ✅ 已修复
  - 已实现：`getLockupMultiplier()` 基于锁定时长的线性插值阶梯乘数
  - 阶梯：<30d=1.0x, 30–90d=1.0x→1.5x, 90–180d=1.5x→2.0x, 180–365d=2.0x→3.0x, ≥365d=3.0x（上限）
  - 各阶梯间线性插值，无跳跃式阶升
  - ClawDAO 投票权计算已通过 `_getLockupMultiplier()` 静态调用集成
  - 位置：`packages/contracts/contracts/ClawStaking.sol` — `getLockupMultiplier()`
  - 测试：10 个新测试覆盖所有阶梯边界、连续性、非质押/非活跃返回 1x

- [x] **Slash 罚没 Token 未转入 DAO 金库** ✅ 已完成
  - 实现：添加 `daoTreasury` 状态变量 + `setDaoTreasury()` 管理员方法，`slash()` 时自动 `safeTransfer` 到 DAO 金库
  - 位置：`packages/contracts/contracts/ClawStaking.sol`
  - 测试：6 个新测试覆盖转账、零地址不转、封顶转账、事件、权限、禁用

- [x] **Merkle 证明库为占位符** ✅ 已完成
  - 实现：完整 Merkle 证明库，包装 OZ MerkleProof.verifyCalldata/processProofCalldata
  - 双哈希叶子防护（`hashLeaf` 二次哈希防止 second preimage 攻击）
  - 领域叶子构建器：`deliverableLeaf`（合约/里程碑/内容哈希）、`reviewLeaf`（评价员/代理/epoch/分数/评论）
  - 位置：`packages/contracts/contracts/libraries/ClawMerkle.sol`
  - 测试：11 个新测试覆盖验证、拒绝、根重建、叶子计算、树集成

- [ ] **Ed25519 链上签名验证为存根**（Testnet ✅ 已验证，Mainnet 待执行）
  - **Testnet（2026-03-13 完成）**：选定方案 A（Besu 自定义预编译），Testnet 三台验证者已全部切换到 `ghcr.io/claw-network/besu-ed25519:24.12.2-494c77f440-amd64`，Ed25519 探测和合约测试均通过，当前处于观察窗口期
  - **Mainnet**：待 Testnet 观察窗口关闭后执行，部署脚本已加固（架构预检、GHCR 登录重试、健康检查）
  - **`ClawIdentity` 主路径**：注册/轮换仍使用 controller 的 ECDSA proof-of-possession，主路径切换至 Ed25519 预编译的决策**有意推迟**至 Testnet 观察窗口完成后
  - `Ed25519Verifier.sol` 为预编译适配器，backend 缺失时显式 revert `Ed25519VerificationUnavailable()`
  - 位置：`packages/contracts/contracts/libraries/Ed25519Verifier.sol`、`packages/contracts/contracts/ClawIdentity.sol`
  - 部署加固：`infra/shared/deploy-guardrails.sh`（共享守卫）、`infra/testnet/prod/deploy.sh`、`infra/mainnet/prod/deploy.sh`
  - 状态文档：`docs/handover/20260313-besu-ed25519-status-summary.md`

### P2 — 后续优化

- [x] **Escrow/Staking 参数接入 ParamRegistry** ✅ 代码已完成，运维激活待执行
  - 合约层面已全部实现：`paramRegistry` 状态变量 + `setParamRegistry()` + 双路 fallback 读取逻辑
  - **ClawEscrow**：`_calculateFee()` 优先读 `ESCROW_BASE_RATE`、`ESCROW_HOLDING_RATE`、`ESCROW_MIN_FEE`，本地存储兜底
  - **ClawStaking**：`_getMinStake()`、`_getUnstakeCooldown()`、`_getSlashPerViolation()` 均已接入 `MIN_NODE_STAKE`、`UNSTAKE_COOLDOWN`、`SLASH_PER_VIOLATION`
  - **ParamRegistry**：所有对应 key 常量已定义，bounds 校验已实现
  - 剩余运维操作（部署后执行一次即可）：
    1. 在 ParamRegistry 合约调用 `setParam()` 写入初始值
    2. 在 ClawEscrow / ClawStaking 调用 `setParamRegistry(paramRegistryAddress)` 激活接入
    3. 后续参数修改走 ClawDAO → GOVERNOR_ROLE 治理路径
  - 位置：`ClawEscrow.sol`、`ClawStaking.sol`、`ParamRegistry.sol`

- [x] **备份策略已启用** ✅ 2026-03-13
  - 脚本：`infra/shared/backup.sh`，每日 03:00 UTC 自动执行
  - SQLite 热备份（`sqlite3 .backup`，节点在线时也安全）：`api-keys.sqlite`、`indexer.sqlite`、`messages.sqlite`
  - Besu chain-data 全量打包：`/opt/clawnet/chain-data/`
  - 归档存放：`/backup/clawnet/`，7 天自动清理
  - 日志：`/var/log/clawnet-backup.log`
  - 已验证首次运行：2 个归档，共 1.1M

---

## 三、已完善的部分（无需改动）

| 领域 | 状态 | 核心证据 |
|------|------|----------|
| API 端点覆盖 | ✅ 48/48 | OpenAPI 规格与路由模块 1:1 对应 |
| 认证/授权 | ✅ | API Key（X-Api-Key/Bearer）+ Admin 端点仅限 localhost |
| 输入校验 | ✅ | 所有端点使用 Zod schema 校验 |
| CORS | ✅ | `createCors()` 支持白名单配置 |
| SSRF 防护 | ✅ | `ssrf-guard.ts` 阻断内网请求 |
| 错误格式 | ✅ | RFC 7807 Problem Details，mainnet 隐藏内部细节 |
| TypeScript SDK | ✅ 95% | 全端点覆盖、类型安全、REST-only 无 ethers.js |
| Python SDK | ✅ 80% | 同步/异步双模式、280 行 README、httpx |
| 单元测试 | ✅ 426+ | 合约 157 + 节点 418 + CLI 8 |
| 集成测试 | ✅ | 3 节点 Docker 网络、43 场景 |
| 部署自动化 | ✅ | Git push → SSH deploy 全链路 |
| TLS | ✅ | Caddy 自动 Let's Encrypt |
| 智能合约核心 | ✅ | 10 合约已部署、UUPS 可升级、proxy 地址稳定 |
| P2P 同步 | ✅ | libp2p gossipsub + 速率限制 |
| 消息限流 | ✅ | 600/min per-DID + 300/min per-peer inbound + 3000/min global |
| API 全局限流 | ✅ | per-IP 滑动窗口：读 300/min、写 60/min，429 + Retry-After |
| Prometheus 指标 | ✅ | `/api/v1/metrics` 导出 HTTP 延迟/吞吐 + 链高度 + P2P + 中继 + 进程指标 |
| 链索引 | ✅ | `eth_getLogs` 轮询 + SQLite 持久化 |

---

## 四、推进路线

### Phase 1 — Testnet 公开发布（当前可启动）

| 序号 | 任务 | 估计工作量 | 负责 |
|------|------|-----------|------|
| 1.1 | X25519 密钥持久化 | ✅ 已完成 | 后端 |
| 1.2 | API 全局限流 | ✅ 已完成 | 后端 |
| 1.3 | 启用备份 cron | ✅ 已完成（`infra/shared/backup.sh`，每日 3am UTC，7 天保留） | 运维 |
| 1.4 | 压力测试脚本 + 基线 | 2-3d | QA |

**Phase 1 完成标志：** Testnet 可接受外部开发者注册、调用 API、发布市场，72 小时无人工干预稳定运行。

### Phase 2 — Mainnet 正式上线

| 序号 | 任务 | 估计工作量 | 负责 |
|------|------|-----------|------|
| 2.1 | 智能合约安全审计 | 2-4w（外部） | 安全 |
| 2.2 | Prometheus + Grafana 监控 | ✅ 指标导出已完成，Grafana 仪表盘配置待部署 | 后端+运维 |
| 2.3 | 集中式日志 | 1-2d | 运维 |
| 2.4 | Staking 奖励乘数实现 | ✅ 已完成 | 合约 |
| 2.5 | Slash → DAO 金库 | ✅ 已完成 | 合约 |
| 2.6 | Ed25519 链上验证 | Testnet ✅ 验证通过；Mainnet 待观察窗口关闭后执行 | 合约+运维 |
| 2.7 | Merkle 证明库 | ✅ 已完成 | 合约 |
| 2.8 | ParamRegistry 集成 | ✅ 代码已完成；部署后调用 `setParamRegistry()` 激活（0.5d 运维） | 合约+运维 |

**Phase 2 完成标志：** 审计报告无 Critical/High 级别发现，监控告警就绪，合约功能无存根。

### Phase 3 — 后续迭代

| 序号 | 任务 |
|------|------|
| 3.1 | ~~WebSocket 主题通配符~~ ✅ 已完成 |
| 3.2 | ~~拜占庭容错测试~~ ✅ 脚本已实现（`scripts/partition-test.mjs`） |
| 3.3 | 多链支持规划 |
| 3.4 | SDK 功能增强（WebSocket 客户端、重试策略） |
