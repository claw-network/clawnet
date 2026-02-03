# MVP 实施清单（模块化可执行任务）

> 按模块拆解的可执行任务清单，用于进入实现阶段。

## 0. 基础设施（全局）

- 建立 monorepo 与包结构（core / protocol / node / cli / sdk）
- 统一代码规范、构建、测试脚本
- 引入 CI 工作流（lint、test、build）
- 生成 docs/implementation/test-vectors 校验脚本接入 CI

## 1. Core - Crypto

- 实现 Ed25519 密钥生成与签名/验签
- 实现 JCS 序列化与域分离签名
- 实现 AES-256-GCM 加密/解密
- 实现 Argon2id 密钥派生
- 完成 test-vectors 验证（ed25519/sha256/aes/jcs）

## 2. Core - Storage

- 事件日志存储（append-only）
- 状态快照存储与验证
- KV 索引（by DID / by address / by nonce）
- 快照签名与验证流程
- 轻节点裁剪逻辑（保留窗口与补齐）
- 事件回放一致性验证

## 3. Core - P2P

- libp2p 节点初始化（Noise/Yamux/Gossipsub）
- gossip 事件传播与签名校验
- range 请求与回放同步
- DHT 发现与可选 bootstrap
- anti-spam 与 peer scoring
- 节点健康指标输出（本地）

## 4. Protocol - Identity

- DID 创建与解析
- DID 文档验证与更新
- 能力注册事件处理
- 与 storage / crypto / p2p 集成
- prevDocHash 冲突处理

## 5. Protocol - Wallet

- 余额状态机（基于事件）
- transfer 事件校验与余额更新
- escrow create/fund/release/refund 状态机
- fee/reward 事件处理
- 交易历史索引与查询

## 6. Protocol - Markets

- listing publish/update 状态机
- order create/update 状态机
- task bid/submit/review 基础流程
- capability lease/invoke 基础流程
- 基础 dispute open/resolve

## 7. Protocol - Contracts

- contract create/sign/activate/complete
- milestone submit/approve/reject
- dispute open/resolve（基础）
- escrow 联动（fund/release）

## 8. Reputation

- reputation.record 事件处理
- 评分聚合与查询
- 维度权重配置

## 9. Node API

- 提供本地 HTTP API（/api/node, /identity, /wallet, /markets, /contracts）
- 请求验证与错误规范
- 与 openapi.yaml 对齐

## 10. CLI

- init / status / balance / transfer / peers
- escrow 基本操作

## 11. SDK

- 最小封装：identity, wallet, markets, contracts
- 基础错误类型与重试策略

## 12. 测试与验证

- 单元测试（crypto / reducer）
- 多节点集成测试
- 事件回放一致性测试
- 负载与对抗测试（spam / replay）
