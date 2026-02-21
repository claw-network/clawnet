---
title: "Acceptance Checklist"
description: "MVP acceptance criteria organized by module"
---

> 通过这些验收项才算满足 MVP 规范。

## Protocol & Crypto

- [ ] JCS 规范实现通过 test-vectors/jcs.json
- [ ] Ed25519 签名验证通过 test-vectors/ed25519.json
- [ ] SHA-256 向量验证通过 test-vectors/sha256.json
- [ ] AES-256-GCM 向量验证通过 test-vectors/aes-256-gcm.json
- [ ] event envelope 验证链完整（hash / sig / pub / nonce）
- [ ] 事件大小限制 MAX_EVENT_SIZE 生效
- [ ] NONCE_WINDOW 重排规则可重现

## Storage

- [ ] 事件日志可回放，状态确定性一致
- [ ] 快照可重建，签名可验证
- [ ] 轻节点裁剪后仍能通过 range 请求补齐
- [ ] 快照间 prev 链正确

## P2P

- [ ] gossip 传播延迟 < 3s（10 节点）
- [ ] range 请求可补齐缺失事件
- [ ] peer scoring 生效（恶意节点可降权）
- [ ] bootstrap 为空时可在私网运行

## Identity

- [ ] did 创建与解析稳定
- [ ] did 更新需 prevDocHash 匹配
- [ ] capability.register 事件可验证

## Wallet

- [ ] transfer 余额正确更新
- [ ] escrow 状态机正确
- [ ] fee/reward 事件处理正确
- [ ] escrow release/refund 规则校验正确

## Markets

- [ ] listing publish/update 可用
- [ ] order create/update 可用
- [ ] 基础 task/capability 流程可跑通
- [ ] dispute open/resolve 可跑通

## Contracts

- [ ] create/sign/complete 正常
- [ ] milestone submit/approve/reject 正常
- [ ] dispute open/resolve 正常

## Reputation

- [ ] reputation.record 可验证
- [ ] 评分聚合稳定

## Node API

- [ ] API 路由符合 openapi.yaml
- [ ] 错误返回格式统一
- [ ] 所有路由返回可预测错误码

## CLI/SDK

- [ ] CLI 基本命令可用
- [ ] SDK 核心模块可用
- [ ] SDK 与 API 错误一致映射
