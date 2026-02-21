---
title: "Sprint Plan"
description: "Week-by-week sprint plan (Sprint 0–7) for MVP delivery"
---

> 按周推进的执行任务清单。请在方括号中标记状态：
> - [ ] 未开始
> - [~] 进行中
> - [x] 已完成

## Sprint 0 — 启动与规范冻结

- [ ] 完成 SPEC_FREEZE 签字（Protocol/Security/Engineering）
- [ ] 建立 monorepo 包结构与构建脚本
- [ ] CI 工作流接入（lint/test/build）
- [ ] FlatBuffers codegen 流水线可运行（flatc）
- [ ] 更新并确认 acceptance-checklist 与 testing-plan

## Sprint 1 — Core Crypto + Serialization

- [ ] Ed25519 / SHA-256 / JCS 实现
- [ ] event hash 规则落地（排除 sig/hash）
- [ ] FlatBuffers P2P envelope 编解码
- [ ] test-vectors 通过（ed25519/sha256/jcs）

## Sprint 2 — Core Storage

- [ ] 事件日志（append-only）
- [ ] 快照生成/校验 + 签名流程
- [ ] 索引（issuer/nonce/resource）
- [ ] 回放一致性验证
- [ ] 轻节点裁剪规则验证

## Sprint 3 — Core P2P

- [ ] libp2p 组网与 gossip
- [ ] range.request / range.response
- [ ] sybilPolicy（allowlist/PoW/stake）最小实现
- [ ] peer.rotate / pow.ticket / stake.proof 处理

## Sprint 4 — Protocol MVP (Identity + Wallet)

- [ ] identity.create / update
- [ ] wallet.transfer / escrow.create/fund/release/refund
- [ ] resourcePrev 冲突检测
- [ ] 金额最小单位与最小金额规则生效

## Sprint 5 — Protocol MVP (Contracts + Reputation)

- [ ] contract.create / sign / complete
- [ ] reputation.record
- [ ] 事件回放一致性验证（含合约/信誉）

## Sprint 6 — Node API + CLI/SDK 最小版

- [ ] Node API 路由（身份/钱包/合约/状态）
- [ ] 错误码与 openapi.yaml 对齐
- [ ] CLI 基础命令可用
- [ ] SDK 最小封装（identity/wallet/contracts）

## Sprint 7 — 测试与验收

- [ ] 单元测试（crypto/reducer）
- [ ] 多节点一致性测试
- [ ] 对抗测试（replay/sybil/invalid）
- [ ] 性能基准（吞吐/延迟/存储增长）
- [ ] 完成 acceptance-checklist
