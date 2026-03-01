# Deliverable Specification 审阅报告

| Field | Value |
|---|---|
| Date | 2026-03-01 |
| Target Doc | `docs/implementation/deliverable-spec.md` |
| Target Version | v0.1.0 (Draft) |
| Reviewer | Codex |
| Scope | 可实现性、一致性、安全性、迁移路径 |

## 1. 审阅范围

- 规范文档：`docs/implementation/deliverable-spec.md`
- 对照代码：
  - `packages/core`（加密、JCS、签名）
  - `packages/protocol`（markets/contracts 类型与状态机）
  - `packages/node`（API schema、route、on-chain service）
  - `packages/contracts`（`ClawContracts.sol`）
  - `packages/sdk` / `packages/sdk-python`（客户端类型）
- 对照规范：
  - `packages/docs/content/docs/implementation-specs/protocol-spec.md`
  - `packages/docs/content/docs/implementation-specs/p2p-spec.md`

## 2. 结论摘要

该规范方向正确，能统一三类市场和服务合约的交付物模型，但当前草案存在若干“落地阻断项”：

- 安全阻断：凭据透传到 gossip 事件会泄露访问能力。
- 协议阻断：签名与事件类型设计和现有协议栈不一致。
- 链上阻断：`deliverableHash` 迁移语义未覆盖当前 `keccak(utf8(string))` 实现路径。
- 迁移风险：编码格式、阈值与 API/SDK 兼容策略还不够收敛。

建议先修复第 3 章到第 6 章中的高优先问题，再进入 Phase 1 编码。

## 3. Findings（按严重级别）

### Critical

#### DS-001 凭据泄露风险：`sessionToken/accessToken` 出现在 gossip 可见的 envelope 中

- 现象：
  - 文档把 `StreamTransport.sessionToken`、`EndpointTransport.accessToken` 作为 envelope 字段。
  - 文档中 `delivery.submit` 通过 P2P 事件传播 envelope。
  - 当前 P2P `/events` 载荷是完整事件 envelope 字节，订阅方可读 payload。
- 证据：
  - `docs/implementation/deliverable-spec.md:214`
  - `docs/implementation/deliverable-spec.md:228`
  - `docs/implementation/deliverable-spec.md:309`
  - `packages/docs/content/docs/implementation-specs/p2p-spec.md:105`
- 风险：
  - 任何网络 peer 可被动获取令牌并越权访问交付服务或流。
- 建议：
  - 不在 gossip 事件携带明文令牌。
  - 改为 `tokenRef`/`tokenHash` 占位；令牌本体用接收方密钥加密后通过点对点通道下发。
  - 增加令牌绑定约束（recipient DID、orderId、ttl、single-use）。

### High

#### DS-002 链上锚定迁移不完整：当前实现会继续对字符串做 `keccak`

- 现象：
  - 文档要求链上存 `bytes32(BLAKE3(JCS(envelope)))`。
  - 现代码 `submitMilestone` 仍调用 `hash(deliverableHash)`，内部是 `keccak256(toUtf8Bytes(value))`。
  - API route 还在把 `deliverables` `JSON.stringify` 后传给 service。
- 证据：
  - `docs/implementation/deliverable-spec.md:357`
  - `docs/implementation/deliverable-spec.md:480`
  - `packages/node/src/services/contracts-service.ts:137`
  - `packages/node/src/services/contracts-service.ts:327`
  - `packages/node/src/api/routes/contracts.ts:588`
- 风险：
  - 链上哈希与链下验签哈希不一致，无法完成自动验证与争议证据对齐。
- 建议：
  - 明确 `deliverableHash` 的输入/编码规范：直接传 `0x` 前缀 32-byte digest。
  - service 中仅对 `contractId` 保留 `keccak`；`deliverableHash` 禁止二次哈希。
  - 在 API schema 增加 `deliverableEnvelope` 或 `deliverableDigest` 明确字段，移除隐式 stringify 路径。

#### DS-003 签名规则与现有协议不一致，但文档表述为“一致”

- 现象：
  - 文档：`Ed25519.sign(BLAKE3(JCS(envelope \\ {signature})))`。
  - 现协议事件签名：对 `"clawnet:event:v1:" + JCS(...)` 进行签名（域分离）。
- 证据：
  - `docs/implementation/deliverable-spec.md:236`
  - `docs/implementation/deliverable-spec.md:247`
  - `packages/core/src/protocol/event-hash.ts:29`
  - `packages/docs/content/docs/implementation-specs/protocol-spec.md:109`
- 风险：
  - 交付物验签实现会分叉，无法复用现有签名工具链。
- 建议：
  - 明确选择一种规范并写死：
  - 选项 A：沿用现有域分离签名模式。
  - 选项 B：定义新 domain（如 `clawnet:deliverable:v1:`）并明确与事件签名不同。

#### DS-004 新增 `delivery.*` 事件未与现有事件体系兼容

- 现象：
  - 文档新增 `delivery.submit/ack/...`。
  - 当前 protocol spec 和 reducer 使用 `market.*`、`contract.*` 事件命名，状态机按固定 type 分支。
  - 文档称“无需修改 p2p/protocol 冻结文档”，与上述差异冲突。
- 证据：
  - `docs/implementation/deliverable-spec.md:463`
  - `docs/implementation/deliverable-spec.md:541`
  - `packages/docs/content/docs/implementation-specs/protocol-spec.md:197`
  - `packages/protocol/src/markets/state.ts:670`
- 风险：
  - 混合版本节点会忽略新事件，导致交付状态无法进入现有 store/indexer。
- 建议：
  - 优先扩展现有 `market.submission.submit`/`market.order.update` payload。
  - 若坚持 `delivery.*`，需走冻结规范变更流程并定义版本兼容策略。

### Medium

#### DS-005 “信息市场已完整实现完整性+E2E”描述过于乐观

- 现象：
  - 文档把信息市场描述为唯一完整实现。
  - 现 API 交付流程主要发 `market.order.update`；`InfoContentStore` 对 `order.update` 只做 deliveryId 链接，不执行完整 Layer 1 校验闭环。
- 证据：
  - `docs/implementation/deliverable-spec.md:15`
  - `packages/node/src/api/routes/markets-info.ts:386`
  - `packages/protocol/src/markets/info-store.ts:468`
- 风险：
  - 低估 Phase 1 实际改造范围和测试工作量。
- 建议：
  - 在 Motivation 中区分“已有加密能力”与“端到端交付验证流程”。

#### DS-006 Inline 阈值 `<= 1 MB` 与网络封包上限冲突

- 现象：
  - 文档把 `<=1MB` 定义为 inline。
  - P2P 规范最大 envelope 大小同为 `1MB`，而 inline 采用 base64 会额外膨胀。
- 证据：
  - `docs/implementation/deliverable-spec.md:195`
  - `docs/implementation/deliverable-spec.md:302`
  - `packages/docs/content/docs/implementation-specs/p2p-spec.md:209`
- 风险：
  - 边界 payload 易超限，形成难以定位的投递失败。
- 建议：
  - 以“序列化后字节数”定义阈值，并下调 raw 内容上限（需压测定值）。

#### DS-007 加密元数据结构与现有 `InfoKeyEnvelope` 不兼容

- 现象：
  - 文档使用 `algorithm: 'x25519-aes256gcm'` 与 `keyEnvelopes: Record<DID,string>`。
  - 现实现为 `x25519-aes-256-gcm` + `senderPublicKeyHex/nonceHex/ciphertextHex/tagHex`。
- 证据：
  - `docs/implementation/deliverable-spec.md:157`
  - `docs/implementation/deliverable-spec.md:159`
  - `packages/protocol/src/markets/info-store.ts:49`
  - `packages/protocol/src/markets/info-store.ts:126`
- 风险：
  - v1 迁移中出现双格式并存，互操作失败。
- 建议：
  - 明确“v1 兼容编码”和“v2 目标编码”，提供双向映射规则。

#### DS-008 防重放语义前后不一致

- 现象：
  - 文档允许 `id` 为 UUIDv7 或 `contentHash+producer`。
  - 安全章节又写“`id` 包含 orderId + timestamp”。
- 证据：
  - `docs/implementation/deliverable-spec.md:118`
  - `docs/implementation/deliverable-spec.md:516`
- 风险：
  - 各实现幂等键不同，重放校验不可互认。
- 建议：
  - 固化 replay key（如 `orderId + producer + nonce + createdAt`），并给出验证伪代码。

#### DS-009 `composite` 哈希规则与“顺序语义”冲突

- 现象：
  - 正文使用 `sort(part_hashes)`，语义上顺序无关。
  - Open Questions 又询问是否需要顺序。
- 证据：
  - `docs/implementation/deliverable-spec.md:257`
  - `docs/implementation/deliverable-spec.md:526`
- 风险：
  - 不同实现对同一 composite 算出不同哈希。
- 建议：
  - 在 v0.1.0 明确：顺序相关或顺序无关二选一。

## 4. 兼容性差距清单（代码现状）

- Task 交付提交仍为 `Record<string, unknown>[]`：
  - `packages/protocol/src/markets/types.ts:392`
  - `packages/protocol/src/markets/events.ts:129`
  - `packages/node/src/api/schemas/markets.ts:147`
- Contract milestone submission 仍为 `Record<string, unknown>[]`：
  - `packages/protocol/src/contracts/types.ts:44`
  - `packages/node/src/api/schemas/contracts.ts:45`
- SDK 仍大量使用 `string[]` 或弱类型 object：
  - `packages/sdk/src/types.ts:339`
  - `packages/sdk/src/types.ts:511`
  - `packages/sdk-python/src/clawnet/types.py:283`
- OpenAPI 仍以旧结构为主：
  - `docs/api/openapi.yaml:3933`
  - `docs/api/openapi.yaml:4544`
  - `docs/api/openapi.yaml:5012`

## 5. 建议的修订优先级

### P0（先修文档再编码）

- 去除 gossip 明文 token。
- 固化交付物签名规则（domain + bytes 规范）。
- 固化链上 `deliverableHash` 编码（禁止二次 hash）。
- 统一事件接入方案（扩展 `market.*` 或变更冻结规范）。

### P1（进入 Phase 1 代码改造前）

- 给出 `InfoKeyEnvelope` 迁移兼容表。
- 重新定义 inline 大小阈值为“序列化后字节数”。
- 明确 replay key 和 `composite` 顺序语义。

### P2（实现中同步）

- 更新 REST schema / OpenAPI / SDK / SDK-Python 的统一模型。
- 增加跨版本兼容策略（legacy 自动包装、告警、淘汰窗口）。

## 6. 审阅边界与说明

- 本报告基于当前仓库主工作区静态代码与文档对照。
- 本报告未执行运行时压测或跨节点互操作实验。
- 本报告不修改 `SPEC_FREEZE.md` 结论，仅指出当前草案与现有实现的冲突点。

