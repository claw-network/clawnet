# ClawNet 市场就绪审计报告

> 审计日期：2026-03-12
> 当前版本：v0.6.6
> 整体就绪度：**85%**（Testnet 公开可用，Mainnet 需完成 Phase 2）

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

- [ ] **拜占庭容错/网络分区测试**
  - 现状：无网络分区场景测试
  - 方案：在 Docker Compose 中用 `tc netem` 模拟网络分区，验证节点恢复一致性

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

- [ ] **Ed25519 链上签名验证为存根**
  - 现状：`Ed25519Verifier.sol` 已改为预编译适配器；在链上 Ed25519 backend 缺失时会显式 revert `Ed25519VerificationUnavailable()`，不再静默返回成功或失败
  - 当前主路径：`ClawIdentity` 的注册/轮换已使用 controller 的 ECDSA proof-of-possession，避免把未落地的 Ed25519 verifier 接入主网关键路径
  - 位置：`packages/contracts/contracts/libraries/Ed25519Verifier.sol`、`packages/contracts/contracts/ClawIdentity.sol`
  - 方案（二选一）：
    - A. 部署自定义 Reth 节点，添加 Ed25519 预编译（地址 0x0100）
    - B. 接入纯 Solidity 实现（例如 SCL / SmoothCryptoLib，gas 较高但可用）

### P2 — 后续优化

- [ ] **Escrow/Staking 参数未接入 ParamRegistry**
  - 现状：费率等参数硬编码在合约存储中，只能通过 admin 函数单独修改
  - 位置：`ClawEscrow.sol:378`、`ClawStaking.sol:386`
  - 代码标记：`Phase 2 will move to ParamRegistry`
  - 方案：将 `feeRate`、`minStake`、`lockPeriod` 等参数迁移到 ParamRegistry，合约运行时读取

- [ ] **备份策略未启用**
  - 现状：infra 文档有 cron 命令示例但生产环境未配置，`BACKUP_TARGET` 为空
  - 位置：`infra/testnet/.env.example:85`、`infra/README.md:860`
  - 方案：在服务器配置每日 cron 备份 chain-data + SQLite，rsync 到远程存储

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
| 1.3 | 启用备份 cron | 0.5d | 运维 |
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
| 2.6 | Ed25519 链上验证 | 3-5d | 合约 |
| 2.7 | Merkle 证明库 | ✅ 已完成 | 合约 |
| 2.8 | ParamRegistry 集成 | 2d | 合约 |

**Phase 2 完成标志：** 审计报告无 Critical/High 级别发现，监控告警就绪，合约功能无存根。

### Phase 3 — 后续迭代

| 序号 | 任务 |
|------|------|
| 3.1 | ~~WebSocket 主题通配符~~ ✅ 已完成 |
| 3.2 | 拜占庭容错测试 |
| 3.3 | 多链支持规划 |
| 3.4 | SDK 功能增强（WebSocket 客户端、重试策略） |
