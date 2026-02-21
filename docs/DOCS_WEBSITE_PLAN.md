# ClawNet 开发文档网站规划

> 生成日期：2026-02-22
> 依赖文档：[DOCS_INVENTORY.md](./DOCS_INVENTORY.md)

---

## 1. 技术选型

| 项目 | 选型 | 说明 |
|------|------|------|
| 框架 | [Fumadocs](https://www.fumadocs.dev/) | 基于 Next.js 的文档框架，支持 MDX、全文搜索、侧边栏导航 |
| 运行时 | Next.js 15 (App Router) | Fumadocs 原生支持 |
| 包管理 | pnpm | 与现有 monorepo 一致 |
| 项目目录 | `packages/docs` | 保持 monorepo 结构 |
| 内容来源 | `content/docs/` (项目内) | 将现有 `docs/` 中的内容迁移并组织到 Fumadocs 内容目录 |

---

## 2. 信息架构 — 导航与侧边栏

基于 [DOCS_INVENTORY.md](./DOCS_INVENTORY.md) 的分析，规划以下导航结构：

```
ClawNet Docs
├── Getting Started (快速上手)
│   ├── Introduction (愿景概览)        ← VISION.md 精简版
│   ├── Architecture (架构概览)        ← ARCHITECTURE.md
│   ├── Quick Start (快速启动)         ← QUICKSTART.md
│   ├── Deployment (部署指南)          ← DEPLOYMENT.md
│   └── FAQ (常见问题)                 ← FAQ.md
│
├── Core Modules (核心模块)
│   ├── Identity (身份系统)            ← IDENTITY.md
│   ├── Wallet (钱包系统)              ← WALLET.md
│   ├── Markets (市场模块)             ← MARKETS.md
│   ├── Markets Advanced (市场高级)    ← MARKETS_ADVANCED.md
│   ├── Service Contracts (服务合约)   ← SERVICE_CONTRACTS.md
│   ├── Smart Contracts (复杂合约)     ← SMART_CONTRACTS.md
│   ├── Reputation (信誉系统)          ← REPUTATION.md
│   └── DAO Governance (DAO 治理)      ← DAO.md
│
├── Developer Guide (开发者指南)
│   ├── Agent Runtime (运行时指南)     ← AGENT_RUNTIME.md
│   ├── SDK Guide (SDK 指南)           ← SDK_GUIDE.md
│   ├── API Reference (API 参考)       ← API_REFERENCE.md
│   ├── API Errors (API 错误码)        ← api-errors.md
│   ├── OpenClaw Integration (集成)    ← OPENCLAW_INTEGRATION.md
│   └── API Design Draft (API 草案)    ← min-api-draft.md
│
├── Business & Economics (商业与经济)
│   ├── Agent Business (Agent 创业)    ← AGENT_BUSINESS.md
│   ├── Economics & Incentives (经济)  ← economics.md
│   ├── Moltbook Analysis (社区分析)   ← MOLTBOOK_ANALYSIS.md
│   └── Decentralization (去中心化)    ← DECENTRALIZATION.md
│
├── Implementation Specs (实现规范)
│   ├── Overview (概览)                ← IMPLEMENTATION.md + README.md
│   ├── Protocol Spec (协议规范)       ← protocol-spec.md
│   ├── Crypto Spec (密码学规范)       ← crypto-spec.md
│   ├── P2P Spec (P2P 规范)            ← p2p-spec.md
│   ├── Storage Spec (存储规范)        ← storage-spec.md
│   ├── Security (安全模型)            ← security.md
│   ├── Testing Plan (测试计划)        ← testing-plan.md
│   ├── Rollout Plan (上线计划)        ← rollout.md
│   ├── Open Questions (开放问题)      ← open-questions.md
│   └── Spec Freeze (规范冻结)         ← SPEC_FREEZE.md
│
├── Implementation Tasks (实现任务)
│   ├── MVP Task List (任务清单)       ← mvp-task-list.md
│   ├── Sprint Plan (Sprint 计划)      ← mvp-sprint-plan.md
│   └── Acceptance Checklist (验收)    ← acceptance-checklist.md
│
└── Event Schemas (事件模式)
    ├── Overview (概览)                ← event-schemas/README.md
    ├── Identity Events (身份事件)     ← event-schemas/identity.md
    ├── Wallet Events (钱包事件)       ← event-schemas/wallet.md
    ├── Markets Events (市场事件)      ← event-schemas/markets.md
    ├── Contracts Events (合约事件)    ← event-schemas/contracts.md
    ├── Reputation Events (信誉事件)   ← event-schemas/reputation.md
    └── Changelog (变更日志)           ← event-schemas/CHANGELOG.md
```

---

## 3. 侧边栏分组总结

| # | 分组 | 页面数 | 来源文件数 |
|---|------|--------|-----------|
| 1 | Getting Started | 5 | 5 |
| 2 | Core Modules | 8 | 8 |
| 3 | Developer Guide | 6 | 6 |
| 4 | Business & Economics | 4 | 4 |
| 5 | Implementation Specs | 10 | 11 |
| 6 | Implementation Tasks | 3 | 3 |
| 7 | Event Schemas | 7 | 7 |
| **合计** | **7 个分组** | **43 页** | **44 个来源文件** |

> 注：`openapi.yaml` 和 `p2p-spec.fbs` 为非 Markdown 文件，可作为下载链接引用而非独立页面。
> 测试向量 (test-vectors) 数据文件不创建独立页面。

---

## 4. 实施计划

### Phase 1：项目初始化
1. 使用 `create-fumadocs-app` 在 `packages/docs` 创建项目
2. 配置 pnpm workspace 集成
3. 配置基础 Next.js / Fumadocs 设置

### Phase 2：内容迁移与组织
1. 在 `packages/docs/content/docs/` 下创建与导航结构对应的目录
2. 将现有 Markdown 文件复制并适配为 MDX 格式（添加 frontmatter）
3. 配置 `meta.json` 文件定义侧边栏顺序和标题

### Phase 3：样式与品牌
1. 配置 ClawNet 品牌色彩 / Logo
2. 自定义首页

### Phase 4：验证与部署
1. 确保 `pnpm build` 成功
2. 确保所有 43 个页面可正常访问
3. 配置生产部署（如需要）

---

## 5. 目录结构预览

```
packages/docs/
├── package.json
├── next.config.mjs
├── tsconfig.json
├── source.config.ts
├── app/
│   ├── layout.tsx
│   ├── page.tsx            # 首页
│   ├── docs/
│   │   └── [[...slug]]/
│   │       └── page.tsx    # 文档路由
│   └── layout.config.tsx   # 导航配置
├── content/
│   └── docs/
│       ├── index.mdx                      # 文档首页
│       ├── meta.json                      # 顶层导航
│       ├── getting-started/
│       │   ├── meta.json
│       │   ├── introduction.mdx
│       │   ├── architecture.mdx
│       │   ├── quick-start.mdx
│       │   ├── deployment.mdx
│       │   └── faq.mdx
│       ├── core-modules/
│       │   ├── meta.json
│       │   ├── identity.mdx
│       │   ├── wallet.mdx
│       │   ├── markets.mdx
│       │   ├── markets-advanced.mdx
│       │   ├── service-contracts.mdx
│       │   ├── smart-contracts.mdx
│       │   ├── reputation.mdx
│       │   └── dao.mdx
│       ├── developer-guide/
│       │   ├── meta.json
│       │   ├── agent-runtime.mdx
│       │   ├── sdk-guide.mdx
│       │   ├── api-reference.mdx
│       │   ├── api-errors.mdx
│       │   ├── openclaw-integration.mdx
│       │   └── api-design-draft.mdx
│       ├── business-economics/
│       │   ├── meta.json
│       │   ├── agent-business.mdx
│       │   ├── economics.mdx
│       │   ├── moltbook-analysis.mdx
│       │   └── decentralization.mdx
│       ├── implementation-specs/
│       │   ├── meta.json
│       │   ├── overview.mdx
│       │   ├── protocol-spec.mdx
│       │   ├── crypto-spec.mdx
│       │   ├── p2p-spec.mdx
│       │   ├── storage-spec.mdx
│       │   ├── security.mdx
│       │   ├── testing-plan.mdx
│       │   ├── rollout.mdx
│       │   ├── open-questions.mdx
│       │   └── spec-freeze.mdx
│       ├── implementation-tasks/
│       │   ├── meta.json
│       │   ├── mvp-task-list.mdx
│       │   ├── sprint-plan.mdx
│       │   └── acceptance-checklist.mdx
│       └── event-schemas/
│           ├── meta.json
│           ├── overview.mdx
│           ├── identity-events.mdx
│           ├── wallet-events.mdx
│           ├── markets-events.mdx
│           ├── contracts-events.mdx
│           ├── reputation-events.mdx
│           └── changelog.mdx
└── public/
    └── logo.svg
```

---

## 6. 关键配置说明

- **Fumadocs Source Config** (`source.config.ts`): 定义内容来源目录
- **meta.json**: 每个文件夹下的 `meta.json` 控制侧边栏排序和分组标题
- **Frontmatter**: 每个 `.mdx` 文件需要 `title` 和 `description` frontmatter
- **搜索**: Fumadocs 内置全文搜索，开箱即用
