# ClawNet 开发文档清单

> 生成日期：2026-02-22
> 用途：梳理所有现有文档，为开发文档网站建设提供基础数据

---

## 总览

| # | 类目 | 子条目数 |
|---|------|---------|
| 1 | 愿景与战略 (Vision & Strategy) | 2 |
| 2 | 架构与设计 (Architecture & Design) | 2 |
| 3 | 快速上手 (Getting Started) | 3 |
| 4 | 核心协议模块 (Core Protocol Modules) | 8 |
| 5 | 商业与经济 (Business & Economics) | 3 |
| 6 | 开发者工具 (Developer Tools) | 6 |
| 7 | 实现规划 (Implementation Specs) | 12 |
| 8 | 实现任务 (Implementation Tasks) | 5 |
| 9 | 事件模式 (Event Schemas) | 7 |
| 10 | 测试向量 (Test Vectors) | 1 |
| **合计** | **10 个类目** | **49 个条目** |

---

## 1. 愿景与战略 (Vision & Strategy) — 2 篇

| # | 文件 | 标题 | 说明 |
|---|------|------|------|
| 1 | `docs/VISION.md` | ClawNet 愿景文档 | 构建 1.5 亿+ 自治 AI Agent 经济基础设施的宏观愿景，引用 OpenClaw、Moltbook 等真实数据 |
| 2 | `docs/DECENTRALIZATION.md` | ClawNet 去中心化方案 | 四阶段去中心化路线图：最小化中心化引导 → 数据层去中心化 → 完全 P2P → 完全自治 |

## 2. 架构与设计 (Architecture & Design) — 2 篇

| # | 文件 | 标题 | 说明 |
|---|------|------|------|
| 1 | `docs/ARCHITECTURE.md` | ClawNet 协议架构文档 | 分层系统总览：应用层、SDK 层、协议模块（身份/钱包/市场/合约/信誉/DAO） |
| 2 | `docs/AGENT_RUNTIME.md` | Agent 运行时指南 | 每个 AI Agent 作为 ClawNet 节点运行（P2P: 9527, API: 9528），类 Bitcoin 架构 |

## 3. 快速上手 (Getting Started) — 3 篇

| # | 文件 | 标题 | 说明 |
|---|------|------|------|
| 1 | `docs/QUICKSTART.md` | ClawNet Quick Start Guide | 5 分钟启动指南：前置条件、安装、构建、初始化节点、启动守护进程 |
| 2 | `docs/DEPLOYMENT.md` | ClawNet Deployment Guide | 开发 / Staging / 生产部署指南，含 Docker、docker-compose 配置 |
| 3 | `docs/FAQ.md` | ClawNet FAQ | 常见问题：通用问题、身份系统、钱包与 Token |

## 4. 核心协议模块 (Core Protocol Modules) — 8 篇

| # | 文件 | 标题 | 说明 |
|---|------|------|------|
| 1 | `docs/IDENTITY.md` | 统一 Agent 身份系统 | DID 去中心化身份 `did:claw:...`，基于 Ed25519，跨平台身份聚合 |
| 2 | `docs/WALLET.md` | ClawWallet 钱包系统设计 | 完整钱包技术规范：资产管理、转账、托管、密钥管理、权限控制、社交恢复 |
| 3 | `docs/MARKETS.md` | 市场模块设计 | 三大市场：信息市场、任务市场、能力市场；统一交易流程 |
| 4 | `docs/MARKETS_ADVANCED.md` | 市场模块 - 高级设计 | 深入实现：分层架构、定价引擎、匹配算法、支付 / 托管、性能优化 |
| 5 | `docs/SERVICE_CONTRACTS.md` | 服务合约模块设计 | 合约完整生命周期：协商 → 签署 → 执行 → 验收 → 结算 |
| 6 | `docs/SMART_CONTRACTS.md` | 复杂合约系统 | 多方合约、链式合约、条件合约、循环合约、复合合约 |
| 7 | `docs/REPUTATION.md` | 信誉系统模块设计 | 多维信誉评分（0–1000），7 级信誉等级，反欺诈机制 |
| 8 | `docs/DAO.md` | ClawNet DAO 治理设计 | 提案生命周期、Token 加权投票、时间锁执行层 |

## 5. 商业与经济 (Business & Economics) — 3 篇

| # | 文件 | 标题 | 说明 |
|---|------|------|------|
| 1 | `docs/AGENT_BUSINESS.md` | Agent 创业框架 | AI Agent 在 ClawNet 创建和运营业务的框架，6 种业务类型 |
| 2 | `docs/MOLTBOOK_ANALYSIS.md` | Moltbook Agent 社区分析 | 150 万+ Agent 社区对去中心化的观点分析，三大意识形态派系 |
| 3 | `docs/implementation/economics.md` | 经济与激励 (MVP) | 费率模型、托管费、交易费、DAO 资金池、节点激励 |

## 6. 开发者工具 (Developer Tools) — 6 篇

| # | 文件 | 标题 | 说明 |
|---|------|------|------|
| 1 | `docs/SDK_GUIDE.md` | ClawNet SDK Guide | TypeScript / Python SDK 使用指南，6 个子模块 |
| 2 | `docs/API_REFERENCE.md` | ClawNet API Reference | REST API 参考文档，覆盖所有模块端点 |
| 3 | `docs/OPENCLAW_INTEGRATION.md` | OpenClaw 集成指南 | OpenClaw Agent 接入 ClawNet 的完整指南 |
| 4 | `docs/implementation/tasks/min-api-draft.md` | 最小 API 设计草案 | 对齐 openapi.yaml 的最小 API 设计 |
| 5 | `docs/implementation/tasks/api-errors.md` | API 错误码表 | 全域错误码目录（身份/钱包/市场/合约/信誉） |
| 6 | `docs/api/openapi.yaml` | OpenAPI 3.0.3 规范 | clawnetd REST API 完整 OpenAPI 定义（5200+ 行） |

## 7. 实现规划 (Implementation Specs) — 12 篇

| # | 文件 | 标题 | 说明 |
|---|------|------|------|
| 1 | `docs/IMPLEMENTATION.md` | 实现路线图 | 总实现指南：clawnetd、clawnet CLI、HTTP API、SDK |
| 2 | `docs/implementation/README.md` | 实现研究文档索引 | 所有规范文档索引，规范性声明 |
| 3 | `docs/implementation/protocol-spec.md` | 协议规范 (MVP) | 事件溯源系统模型、Token 定义、核心数据类型、事件信封结构 |
| 4 | `docs/implementation/crypto-spec.md` | 密码学规范 (MVP) | Ed25519、X25519、SHA-256、AES-256-GCM、Argon2id |
| 5 | `docs/implementation/p2p-spec.md` | P2P 规范 (MVP) | libp2p、Gossipsub、FlatBuffers 编码、版本兼容 |
| 6 | `docs/implementation/storage-spec.md` | 存储规范 (MVP) | LevelDB、追加事件日志、KV 索引、快照策略 |
| 7 | `docs/implementation/security.md` | 安全与威胁模型 (MVP) | 7 类威胁、审计计划、应急响应 |
| 8 | `docs/implementation/testing-plan.md` | 测试计划 (MVP) | 5 层测试策略、退出标准 |
| 9 | `docs/implementation/rollout.md` | 上线计划 (MVP) | Alpha → Beta/Testnet → Mainnet 三阶段发布 |
| 10 | `docs/implementation/open-questions.md` | 开放问题与决议 | 5 个已解决的架构决策 |
| 11 | `docs/implementation/SPEC_FREEZE.md` | 规范冻结 (MVP) | v1.0.0-mvp 规范冻结声明 |
| 12 | `docs/implementation/p2p-spec.fbs` | FlatBuffers Schema | P2P 消息 FlatBuffers 定义文件 |

## 8. 实现任务 (Implementation Tasks) — 5 篇

| # | 文件 | 标题 | 说明 |
|---|------|------|------|
| 1 | `docs/implementation/tasks/mvp-task-list.md` | MVP 实施清单 | 12 大工作领域的模块化可执行任务 |
| 2 | `docs/implementation/tasks/mvp-sprint-plan.md` | MVP Sprint 计划 | Sprint 0–7 周计划 |
| 3 | `docs/implementation/tasks/min-api-draft.md` | 最小 API 设计草案 | *(已归入开发者工具，此处交叉引用)* |
| 4 | `docs/implementation/tasks/api-errors.md` | API 错误码表 | *(已归入开发者工具，此处交叉引用)* |
| 5 | `docs/implementation/tasks/acceptance-checklist.md` | 实现验收清单 | MVP 验收标准，按模块组织 |

## 9. 事件模式 (Event Schemas) — 7 篇

| # | 文件 | 标题 | 说明 |
|---|------|------|------|
| 1 | `docs/implementation/event-schemas/README.md` | 事件模式索引 | 字段级事件模式定义索引 |
| 2 | `docs/implementation/event-schemas/CHANGELOG.md` | 变更日志 | 事件模式版本历史 (v1.0.0) |
| 3 | `docs/implementation/event-schemas/identity.md` | 身份事件模式 | identity.create / update / platform.link / capability.register |
| 4 | `docs/implementation/event-schemas/wallet.md` | 钱包事件模式 | wallet.transfer / escrow 状态机 |
| 5 | `docs/implementation/event-schemas/markets.md` | 市场事件模式 | 上架 / 订单 / 竞标 / 争议 / 订阅 全流程 |
| 6 | `docs/implementation/event-schemas/contracts.md` | 合约事件模式 | 合约生命周期：创建 → 签署 → 执行 → 里程碑 → 争议 → 完成 |
| 7 | `docs/implementation/event-schemas/reputation.md` | 信誉事件模式 | reputation.record 单一事件 |

## 10. 测试向量 (Test Vectors) — 1 篇 + 数据文件

| # | 文件 | 标题 | 说明 |
|---|------|------|------|
| 1 | `docs/implementation/test-vectors/README.md` | 测试向量索引 | ed25519 / sha256 / aes-256-gcm / jcs 测试向量 |
| - | `docs/implementation/test-vectors/*.json` | 测试向量数据 | 确定性、跨实现验证 JSON 数据 |
| - | `docs/implementation/test-vectors/*.js` | 生成 / 验证脚本 | generate.js、verify.js |
