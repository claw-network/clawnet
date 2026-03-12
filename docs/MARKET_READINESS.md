# ClawNet 市场就绪审计报告

> 审计日期：2026-03-12
> 当前版本：v0.6.6
> 整体就绪度：**85%**（Testnet 公开可用，Mainnet 需完成 Phase 2）

---

## 一、缺失功能（需新增）

### P0 — 上线阻断项

- [ ] **API 全局限流**
  - 现状：仅消息端点有 600/min 限流（`messaging-service.ts`），其余端点（转账、合约创建、市场搜索等）无任何限流
  - 风险：DoS 攻击可耗尽节点资源
  - 方案：在 `packages/node/src/api/middleware.ts` 添加全局限流中间件，或在 Caddy 配置 `rate_limit` 指令
  - 相关文件：`packages/node/src/api/middleware.ts`、`/etc/caddy/Caddyfile`

- [ ] **智能合约第三方安全审计**
  - 现状：10 个合约管理真实 Token 资产，未经过任何专业审计
  - 风险：合约漏洞可导致资产损失，且 UUPS 代理模式增加升级攻击面
  - 方案：聘请审计公司（Trail of Bits / OpenZeppelin / CertiK）进行全量审计
  - 合约清单：ClawToken、ClawIdentity、ClawEscrow、ClawReputation、ClawDAO、ClawContracts、ClawRouter、ParamRegistry、ClawStaking、ClawRelayReward

### P1 — 主网前必须完成

- [ ] **Prometheus 指标导出**
  - 现状：节点无 `/metrics` 端点，无法接入 Grafana 监控
  - 方案：添加 `prom-client` 导出关键指标（请求延迟、tx 吞吐量、P2P 连接数、区块高度、escrow 数量等）
  - 相关文件：`packages/node/src/api/server.ts`

- [ ] **集中式日志方案**
  - 现状：日志仅输出到 stdout，systemd journal 本地存储
  - 方案：接入 ELK Stack 或 Datadog，添加结构化 JSON 日志格式
  - 相关文件：`packages/node/src/logger.ts`

- [ ] **压力/负载测试**
  - 现状：无 100+ tx/sec 压力测试，无 72 小时耐久测试
  - 方案：使用 k6 或 Artillery 编写负载测试脚本，覆盖转账、市场搜索、合约创建等高频端点
  - 产出：基线性能数据、瓶颈识别

### P2 — 后续优化

- [ ] **WebSocket 主题通配符订阅**
  - 现状：无法订阅 `telagent/*` 等前缀过滤，客户端被迫全量接收再过滤
  - 方案：在 `ws-messaging.ts` 添加 glob/prefix 匹配支持

- [ ] **拜占庭容错/网络分区测试**
  - 现状：无网络分区场景测试
  - 方案：在 Docker Compose 中用 `tc netem` 模拟网络分区，验证节点恢复一致性

---

## 二、已有功能但不完善

### P0 — 上线阻断项

- [ ] **X25519 消息加密密钥不持久化**
  - 现状：每次节点启动重新生成 X25519 密钥对，先前接收的加密消息不可解密
  - 位置：`packages/node/src/services/messaging-service.ts:1230`
  - 代码标记：`// TODO: use persistent X25519 key`
  - 方案：将 X25519 私钥存入 keystore（与 Ed25519 身份密钥相同的加密存储），启动时加载

### P1 — 主网前必须完成

- [ ] **Staking 奖励乘数始终返回 1x**
  - 现状：`getRewardMultiplier()` 返回固定值 1000（即 1x），锁定时长不影响收益
  - 位置：`packages/contracts/contracts/ClawStaking.sol:363`
  - 代码标记：`Phase 3 will implement actual lockup bonus logic (up to 3x)`
  - 方案：实现基于锁定时长的阶梯乘数（30d=1x, 90d=1.5x, 180d=2x, 365d=3x）

- [ ] **Slash 罚没 Token 未转入 DAO 金库**
  - 现状：罚没的 Token 留在 Staking 合约内，未转入 DAO 金库
  - 位置：`packages/contracts/contracts/ClawStaking.sol:293`
  - 代码标记：`Phase 2 sends to DAO treasury`
  - 方案：添加 `_forwardSlashedTokens()` 内部方法，slash 时自动转入 ClawDAO

- [ ] **Merkle 证明库为占位符**
  - 现状：`ClawMerkle.sol` 为 Phase 2 占位符，deliverable 链上验证不可用
  - 位置：`packages/contracts/contracts/libraries/ClawMerkle.sol:9`
  - 方案：实现完整的 Merkle Tree 验证逻辑（verify proof, compute root）

- [ ] **Ed25519 链上签名验证为存根**
  - 现状：`Ed25519Verifier.sol` 的 `verify()` 始终返回 `true`，等待 Phase 2 预编译
  - 位置：`packages/contracts/contracts/libraries/Ed25519Verifier.sol:102`
  - 方案（二选一）：
    - A. 部署自定义 Reth 节点，添加 Ed25519 预编译（地址 0x0100）
    - B. 使用纯 Solidity 实现（gas 较高但可用）

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
| 链索引 | ✅ | `eth_getLogs` 轮询 + SQLite 持久化 |

---

## 四、推进路线

### Phase 1 — Testnet 公开发布（当前可启动）

| 序号 | 任务 | 估计工作量 | 负责 |
|------|------|-----------|------|
| 1.1 | X25519 密钥持久化 | 1-2d | 后端 |
| 1.2 | API 全局限流 | 1d | 后端 |
| 1.3 | 启用备份 cron | 0.5d | 运维 |
| 1.4 | 压力测试脚本 + 基线 | 2-3d | QA |

**Phase 1 完成标志：** Testnet 可接受外部开发者注册、调用 API、发布市场，72 小时无人工干预稳定运行。

### Phase 2 — Mainnet 正式上线

| 序号 | 任务 | 估计工作量 | 负责 |
|------|------|-----------|------|
| 2.1 | 智能合约安全审计 | 2-4w（外部） | 安全 |
| 2.2 | Prometheus + Grafana 监控 | 2-3d | 后端+运维 |
| 2.3 | 集中式日志 | 1-2d | 运维 |
| 2.4 | Staking 奖励乘数实现 | 2-3d | 合约 |
| 2.5 | Slash → DAO 金库 | 1d | 合约 |
| 2.6 | Ed25519 链上验证 | 3-5d | 合约 |
| 2.7 | Merkle 证明库 | 2-3d | 合约 |
| 2.8 | ParamRegistry 集成 | 2d | 合约 |

**Phase 2 完成标志：** 审计报告无 Critical/High 级别发现，监控告警就绪，合约功能无存根。

### Phase 3 — 后续迭代

| 序号 | 任务 |
|------|------|
| 3.1 | WebSocket 主题通配符 |
| 3.2 | 拜占庭容错测试 |
| 3.3 | 多链支持规划 |
| 3.4 | SDK 功能增强（WebSocket 客户端、重试策略） |
