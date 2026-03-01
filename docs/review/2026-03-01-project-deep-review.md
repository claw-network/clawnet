# ClawNet 项目深度审查报告

- 审查日期: 2026-03-01
- 审查范围: `packages/core`、`packages/protocol`、`packages/node`、`packages/contracts`、`packages/sdk`、`packages/sdk-python`、根构建与工程配置
- 审查方式: 静态代码审查 + 构建/测试/规范验证 + 架构一致性复核 + 未来演进评估

## 一、执行摘要

当前仓库在“可编译、可测试”层面表现良好，但存在若干**系统性逻辑缺陷**，其中至少 2 项为 P0（阻断级）:

1. 链上索引器对 Escrow 事件名与状态码映射错误，导致资金状态数据错误。
2. P2P 快照验证链路存在参数语义错误，快照基本无法被接受。

这两项问题会直接影响账本读一致性、节点同步效率和运维信任度。结论如下:

- 当前结论: **不建议在修复 P0 前推进主网级别上线**。
- 工程成熟度结论: 基础设施成熟度高（测试、分层、类型约束较完整），但“跨模块语义一致性”与“安全工程基线”仍需补强。

## 二、验证基线（已实际执行）

已在仓库根目录执行以下命令并通过:

- `pnpm test`
- `pnpm lint`
- `pnpm build`

说明: 现有自动化测试覆盖较广，但对“跨模块语义映射”和“端到端一致性约束”的覆盖不足，导致本次发现的问题未被测试捕获。

## 三、关键发现（按优先级）

## P0-01 Escrow 索引语义错误（事件名 + 状态码双重错配）

- 证据位置:
  - `packages/node/src/indexer/indexer.ts:293-326`
  - `packages/contracts/contracts/ClawEscrow.sol:34-40`
  - `packages/contracts/contracts/ClawEscrow.sol:86-91`
- 问题描述:
  - 索引器将 `EscrowFunded` 映射为状态 `1`，但合约状态枚举中 `1` 是 `Released`，`Funded` 事件本身不应改变终态。
  - 索引器监听了 `DisputeOpened` / `DisputeResolved`，而合约真实事件名为 `EscrowDisputed` / `EscrowResolved`。
  - 索引器写入了状态 `5`，而合约 `EscrowStatus` 仅定义到 `4`。
- 影响:
  - `walletService.getBalance()` 中按 `status=0` 统计锁仓资金会失真，`available` 余额可能被高估。
  - Escrow 列表状态展示错误，导致 API/SDK 使用方得到错误业务结论。
- 修复建议:
  - 建立“合约事件 -> 索引状态”单一映射表，并用 ABI 生成类型约束（避免硬编码字符串漂移）。
  - `EscrowFunded` 不改变状态，仅更新金额/更新时间。
  - 将争议事件名改为 `EscrowDisputed` / `EscrowResolved`；Resolved 需按 `releasedToBeneficiary` 映射到 Released/Refunded。
- 回归测试建议:
  - 增加 `EventIndexer` 的合约日志回放测试（以真实 ABI + fixture logs 验证状态机）。

## P0-02 快照状态验证链路参数语义错误，导致快照无法落地

- 证据位置:
  - `packages/node/src/p2p/sync.ts:431-436`
  - `packages/node/src/p2p/sync.ts:827-863`
  - `packages/core/src/storage/snapshots.ts:14-20`
  - `packages/core/src/storage/event-store.ts:174-189`
- 问题描述:
  - `collectEventsForSnapshot()` 的游标参数语义是“事件 hash”，但调用处传入的是 `latest?.at` 与 `snapshot.at`（时间字段）。
  - 内部使用 `cursor === targetAt` 判断终止，`cursor` 是 hash，`targetAt` 是时间字符串，语义不可能匹配。
  - 默认配置启用 `verifySnapshotState`，在该逻辑下快照长期被拒绝。
- 影响:
  - 快照同步失效，节点只能依赖事件流增量回放，冷启动与追块成本显著上升。
  - 网络规模扩大后会出现同步延迟和资源浪费。
- 修复建议:
  - 调用参数改为 hash 语义（例如 `latest?.hash` 与 `snapshot.prev` / snapshot 对应终点 hash）。
  - 明确定义“快照覆盖的事件区间”协议字段，避免以时间字段推断。
- 回归测试建议:
  - 增加 `applySnapshotResponse` 的正反例测试，验证在开启 `verifySnapshotState` 时可成功落盘。

## P1-01 DID 缓存在 key rotation/revoke 后覆盖掉 controller

- 证据位置:
  - `packages/node/src/indexer/indexer.ts:349-365`
  - `packages/node/src/indexer/store.ts:373-390`
- 问题描述:
  - `KeyRotated` / `DIDRevoked` 分支传入空字符串 controller，`upsertDid` 会把已存在 controller 覆盖为空。
- 影响:
  - `getCachedDid()` 返回的数据不完整，缓存层可用性下降。
  - 上层若依赖缓存进行快速路由/展示，会出现“已注册 DID 但 controller 为空”的异常表现。
- 修复建议:
  - `upsertDid` 支持“部分字段更新”（仅更新提供的字段）。
  - 或在索引层先读取旧记录并保留 controller。
- 回归测试建议:
  - 构造 DIDRegistered -> KeyRotated -> DIDRevoked 事件序列，断言 controller 保留语义。

## P1-02 Escrow ID 语义不统一（列表 ID 与详情 ID 不可互操作）

- 证据位置:
  - `packages/node/src/indexer/indexer.ts:204-210`
  - `packages/node/src/indexer/indexer.ts:300-303`
  - `packages/node/src/services/wallet-service.ts:280`
  - `packages/node/src/services/wallet-service.ts:469-471`
  - `packages/node/src/services/wallet-service.ts:540-545`
- 问题描述:
  - 索引器存储的是合约事件中的 `bytes32 escrowId`（哈希值）。
  - 钱包服务读取详情时会对输入再次 `keccak(utf8(escrowId))`。
  - 因此“列表返回的 ID”无法直接用于详情查询。
- 影响:
  - REST API 自身可组合性被破坏（list -> detail 链路断裂）。
  - SDK/前端若直接使用列表 ID 访问详情将出现 404/空结果。
- 修复建议:
  - 明确 ID 规范: 要么全链路使用原始业务 ID，要么全链路使用 `bytes32`，不可混用。
  - 若保持两种 ID，需在 API 字段中显式区分 `escrowId` 与 `escrowHash`。
- 回归测试建议:
  - 增加 API 集成测试: 从 `GET /escrows` 返回的每条记录都可通过 `GET /escrows/:id` 成功查询。

## P1-03 API Key 明文落库，密钥泄露半径过大

- 证据位置:
  - `packages/node/src/api/api-key-store.ts:49-52`
  - `packages/node/src/api/api-key-store.ts:88-93`
  - `packages/node/src/api/api-key-store.ts:117-126`
- 问题描述:
  - API key 以明文存储并按明文检索。
- 影响:
  - 一旦 sqlite 文件被读取（备份泄漏、主机入侵、误传），所有 key 立即可用。
- 修复建议:
  - 改为“只存储 key 哈希（推荐 HMAC-SHA256 + server secret）”。
  - 校验时对传入 key 做同算法哈希后比较，数据库永不落明文 key。
- 回归测试建议:
  - 覆盖创建、校验、撤销、删除全流程，确保迁移后行为不变。

## P2-01 错误细节直接透出 + 全开放 CORS，增加信息暴露面

- 证据位置:
  - `packages/node/src/api/middleware.ts:10-13`
  - `packages/node/src/api/middleware.ts:29-32`
  - `packages/node/src/api/response.ts:238-244`
- 问题描述:
  - CORS `Access-Control-Allow-Origin: *` 与 `Authorization/X-Api-Key` 头同时允许。
  - 错误边界默认把异常 message 原样返回给客户端。
- 影响:
  - 生产环境中会扩大错误信息外泄面（内部路径、合约错误细节、配置异常）。
- 修复建议:
  - 生产环境按 allowlist 配置 CORS。
  - 外部响应统一错误码；详细错误仅写日志（含 request id 关联）。

## P2-02 金额在 API/Service 层大量 `Number()` 化，存在精度风险

- 证据位置:
  - `packages/node/src/api/schemas/common.ts:8`
  - `packages/node/src/api/routes/transfers.ts:35`
  - `packages/node/src/services/wallet-service.ts:134`
  - `packages/node/src/services/wallet-service.ts:147`
  - `packages/node/src/services/wallet-service.ts:523`
- 问题描述:
  - 虽然 Schema 允许字符串金额，但多处进入业务后被 `Number()` 转换。
- 影响:
  - 超过 JS 安全整数范围会出现无声精度损失，最终影响转账、余额和统计结果。
- 修复建议:
  - 业务层统一使用 `bigint`/字符串十进制表示，直到 UI 展示层再格式化。

## P2-03 运行时网络覆盖值未反映到状态接口，CLI 端口参数校验不足

- 证据位置:
  - `packages/node/src/index.ts:662-664`
  - `packages/node/src/daemon.ts:48-50`
  - `packages/node/src/daemon.ts:91-94`
- 问题描述:
  - `resolveNetwork()` 仅读取持久化配置，忽略运行时覆盖值。
  - `--api-port` 无 NaN/范围校验，可能以非预期参数进入服务启动。
- 影响:
  - 运维观测与实际运行网络不一致，易引发误判。
  - 配置错误定位成本上升。
- 修复建议:
  - 状态接口优先返回 runtime 配置。
  - 对 `--api-port` 增加显式校验（1-65535）。

## 四、工程优点（本次审查确认）

- 分层结构清晰: core/protocol/node/contracts/sdk 职责边界明确。
- 自动化基础扎实: 单测覆盖广，lint/build 在当前分支可稳定通过。
- 协议化意识较强: EventEnvelope、P2P 消息、索引器模块化设计具备持续演进基础。

## 五、测试与质量体系改进建议（务实可执行）

1. 新增“跨模块一致性测试”层（contract event -> indexer -> API response）。
2. 引入 ABI 代码生成（event name/arg type），消除字符串硬编码漂移。
3. 增加基于属性的状态机测试（Escrow/Contract/DAO）。
4. 为 P2P snapshot 增加对抗场景测试（乱序 chunk、重复 chunk、伪造 prev 链）。
5. 在 CI 中增加“安全基线检查”（密钥存储、错误暴露、CORS 策略）。

## 六、前瞻性建议（面向未来 12-24 个月）

## 1) 协议与链层

- 规划账户抽象兼容（EIP-4337/EIP-7702 路线评估），为 Agent 自动化交易与批处理降低 gas/运维成本。
- 将关键治理/信誉证明接口设计为可插拔证明后端，为后续零知识证明（ZK reputation / selective disclosure）预留协议字段。

## 2) 身份与密码学

- 当前 Ed25519 路线可持续，但建议制定“混合签名迁移策略”（经典算法 + PQC 预研）以应对长期密码学演进。
- 对 API key、节点密钥、部署密钥建立统一“密钥生命周期管理”规范（生成、轮转、吊销、审计）。

## 3) 可观测性与运维

- 引入 OpenTelemetry + 结构化日志 + trace id 贯通 API/Indexer/P2P。
- 建立 SLO: 同步延迟、索引滞后、API 错误率、快照命中率。
- 为关键状态机建立“运行时不变量监测”告警（例如 escrow 状态跳转合法性）。

## 七、建议的整改顺序

1. 立即修复 P0-01、P0-02，并补齐对应回归测试。
2. 同步修复 P1-01、P1-02、P1-03，避免数据语义和安全债务扩散。
3. 在一个迭代内完成 P2 项，建立生产安全与可观测性基线。

---

如需，我可以基于本报告继续输出“修复任务分解版”（按模块拆成可直接执行的 Issue 清单 + 验收标准 + 预估工作量）。
