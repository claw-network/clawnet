---
title: "Implementation Overview"
description: "Master implementation guide and specification index"
---

> 从设计到交付的完整技术实现指南

---

## 实施前置条件（必须补齐的规范）

当前文档为路线图与交付物清单。进入实作前，需要补齐以下规范与研究文档，确保任何节点都能**独立验证**协议状态、避免中心化依赖：

- ✅ `docs/implementation/protocol-spec.md` — 事件/状态模型、最终性、序列化
- ✅ `docs/implementation/crypto-spec.md` — 密钥/签名/加密与 DID 规则
- ✅ `docs/implementation/p2p-spec.md` — P2P 协议、发现/同步、反滥用
- ✅ `docs/implementation/storage-spec.md` — 本地存储模型、索引、迁移
- ✅ `docs/implementation/economics.md` — 费用与激励参数
- ✅ `docs/implementation/security.md` — 威胁模型与审计计划
- ✅ `docs/implementation/testing-plan.md` — 多节点测试与基准
- ✅ `docs/implementation/rollout.md` — 测试网/主网发布策略
- ✅ `docs/implementation/open-questions.md` — 未决问题清单

## 交付物总览


---

## 组件架构与依赖

### 整体组件图


---

## 组件详解

### Layer 1: Core Layer (核心层)

**必须最先实现 - 所有其他组件依赖这一层**

对应规范文档：
- `docs/implementation/crypto-spec.md`
- `docs/implementation/storage-spec.md`
- `docs/implementation/p2p-spec.md`
- `docs/implementation/p2p-spec.fbs`


### Layer 2: Protocol Layer (协议层)

**业务逻辑，依赖 Core Layer**

对应规范文档：
- `docs/implementation/protocol-spec.md`
- `docs/implementation/event-schemas/*.md`
- `docs/IDENTITY.md`
- `docs/WALLET.md`
- `docs/MARKETS.md`
- `docs/SERVICE_CONTRACTS.md`
- `docs/REPUTATION.md`
- `docs/DAO.md`


### Layer 3: Interface Layer (接口层)

对应规范文档：
- `docs/api/openapi.yaml`
- `docs/implementation/tasks/min-api-draft.md`
- `docs/implementation/tasks/api-errors.md`
- `docs/AGENT_RUNTIME.md`


---

## 依赖关系图


---

## 代码结构


---

## 技术选型总结

| 层级 | 组件 | 技术选型 | 理由 |
|------|------|----------|------|
| Core | Crypto | @noble/* 或 ed25519-dalek | 纯 JS/TS，无 native 依赖 |
| Core | Storage | LevelDB / SQLite | 嵌入式、可靠 |
| Core | P2P | libp2p | 成熟、模块化 |
| Protocol | 全部 | TypeScript | 类型安全、生态丰富 |
| Interface | API | Fastify / Hono | 轻量、高性能 |
| Interface | CLI | Commander | 标准、简单 |

### 可选: Rust 核心


性能敏感模块可用 Rust 重写:
- Crypto Engine → Rust + NAPI
- P2P Engine → rust-libp2p
- Storage → RocksDB via Rust


---

## 交付给 Agent

### Agent 使用流程


### 交付物清单


---

## 下一步：完整实现路径

以下 Phase 覆盖 MVP 到长期阶段的全部实施路径。

### Phase 0: 基础设施 (Week 0)

**要求：每个 Phase 开始前，必须先阅读对应的规范文档。**

对应规范文档：
- `docs/implementation/SPEC_FREEZE.md`
- `docs/implementation/README.md`
- `docs/api/openapi.yaml`


---

### Phase 1: Core Layer (Week 1-2)

**要求：每个 Phase 开始前，必须先阅读对应的规范文档。**

对应规范文档：
- `docs/implementation/crypto-spec.md`
- `docs/implementation/storage-spec.md`
- `docs/implementation/p2p-spec.md`
- `docs/implementation/p2p-spec.fbs`


---

### Phase 2: Protocol Layer - 基础模块 (Week 3-4)

**要求：每个 Phase 开始前，必须先阅读对应的规范文档。**

对应规范文档：
- `docs/implementation/protocol-spec.md`
- `docs/implementation/event-schemas/identity.md`
- `docs/implementation/event-schemas/wallet.md`
- `docs/IDENTITY.md`
- `docs/WALLET.md`


---

### Phase 3: Interface Layer - MVP (Week 5-6)

**要求：每个 Phase 开始前，必须先阅读对应的规范文档。**

对应规范文档：
- `docs/api/openapi.yaml`
- `docs/implementation/tasks/min-api-draft.md`
- `docs/implementation/tasks/api-errors.md`
- `docs/AGENT_RUNTIME.md`


---

### Phase 4: Protocol Layer - 信誉系统 (Week 7-8)

**要求：每个 Phase 开始前，必须先阅读对应的规范文档。**

对应规范文档：
- `docs/implementation/protocol-spec.md`
- `docs/implementation/event-schemas/reputation.md`
- `docs/REPUTATION.md`


---

### Phase 5: Protocol Layer - 市场模块 (Week 9-12)

**要求：每个 Phase 开始前，必须先阅读对应的规范文档。**

对应规范文档：
- `docs/implementation/protocol-spec.md`
- `docs/implementation/event-schemas/markets.md`
- `docs/MARKETS.md`
- `docs/implementation/economics.md`


---

### Phase 6: Protocol Layer - 合约模块 (Week 13-16)

**要求：每个 Phase 开始前，必须先阅读对应的规范文档。**

对应规范文档：
- `docs/implementation/protocol-spec.md`
- `docs/implementation/event-schemas/contracts.md`
- `docs/SERVICE_CONTRACTS.md`
- `docs/SMART_CONTRACTS.md`
- `docs/implementation/economics.md`


---

### Phase 7: SDK 开发 (Week 17-18)

**要求：每个 Phase 开始前，必须先阅读对应的规范文档。**

对应规范文档：
- `docs/api/openapi.yaml`
- `docs/implementation/tasks/min-api-draft.md`
- `docs/implementation/tasks/api-errors.md`


---

### Phase 8: 文档与发布 (Week 19-20)

**要求：每个 Phase 开始前，必须先阅读对应的规范文档。**

对应规范文档：
- `docs/implementation/rollout.md`
- `docs/implementation/testing-plan.md`


---

### Phase 9: DAO 治理 (Week 21+)

**要求：每个 Phase 开始前，必须先阅读对应的规范文档。**

对应规范文档：
- `docs/implementation/protocol-spec.md`
- `docs/DAO.md`
- `docs/implementation/economics.md`


---

### 进度跟踪

| Phase | 描述 | 预计周期 | 状态 |
|-------|------|----------|------|
| 0 | 基础设施 | Week 0 | ✅ 已完成 |
| 1 | Core Layer | Week 1-2 | ✅ 已完成 |
| 2 | Identity + Wallet | Week 3-4 | ✅ 已完成 |
| 3 | Interface (MVP) | Week 5-6 | ✅ 已完成 |
| 4 | Reputation | Week 7-8 | ✅ 已完成 |
| 5 | Markets | Week 9-12 | ✅ 已完成 |
| 6 | Contracts | Week 13-16 | ✅ 已完成 |
| 7 | SDK | Week 17-18 | ✅ 已完成 (TS 61 tests + Python 51 tests) |
| 8 | 文档与发布 | Week 19-20 | 🔄 8.1 ✅ 8.2 ✅ / 8.3 ⏳ |
| 9 | DAO | Week 21+ | ✅ 已完成 (29 tests) |

---

## 相关文档

- [AGENT_RUNTIME.md](AGENT_RUNTIME.md) — 节点运行与 API 调用
- [ARCHITECTURE.md](ARCHITECTURE.md) — 整体架构设计
- [DECENTRALIZATION.md](DECENTRALIZATION.md) — 去中心化路线图

---

*最后更新: 2025年7月25日*
