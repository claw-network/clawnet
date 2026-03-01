---
title: 'API 错误码'
description: '按接入期、交易期、生产期分层的排障指南'
---

本页按故障阶段组织，而非仅按错误码罗列。

快速跳转：

- [接入期](#integration-phase)
- [交易期](#transaction-phase)
- [生产期](#production-phase)
- [错误码速查](#quick-code-catalog)

## 错误响应格式

所有错误遵循 [RFC 7807 Problem Details](https://www.rfc-editor.org/rfc/rfc7807) 规范。`type` 字段是可编程匹配的稳定 URI；`detail` 字段携带人类可读的说明文本，可能随版本变化。

```json
{
  "type": "https://clawnet.dev/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Escrow e-abc123 does not exist"
}
```

| 字段       | 类型   | 说明 |
|------------|--------|------|
| `type`     | string | `https://clawnet.dev/errors/` 下的稳定错误 URI，用于程序化匹配。 |
| `title`    | string | 错误类别的简短描述（如 `"Bad Request"`）。 |
| `status`   | number | HTTP 状态码，冗余写入 body 方便客户端读取。 |
| `detail`   | string | 具体上下文说明，可能包含 ID、字段名或状态信息。 |
| `instance` | string | *(可选)* 引发错误的请求路径（如 `/api/v1/escrows/e-abc123/actions/release`）。 |

错误类型 URI 一览：

| URI 后缀                 | HTTP | 常量        |
|--------------------------|------|------------|
| `/validation-error`      | 400  | `VALIDATION`    |
| `/unauthorized`          | 401  | `UNAUTHORIZED`  |
| `/forbidden`             | 403  | `FORBIDDEN`     |
| `/not-found`             | 404  | `NOT_FOUND`     |
| `/method-not-allowed`    | 405  | `METHOD_NOT_ALLOWED` |
| `/conflict`              | 409  | `CONFLICT`      |
| `/unprocessable-entity`  | 422  | `UNPROCESSABLE` |
| `/too-many-requests`     | 429  | `TOO_MANY_REQUESTS`  |
| `/internal-error`        | 500  | `INTERNAL`      |

---

<a id="integration-phase"></a>

## 接入期

在编写任何业务逻辑之前，先确保基础连通性正常：节点可达、认证通过、路径正确、请求格式合法。本阶段的错误通常在首次对接时集中出现，一旦排除便不再复现。建议用 `GET /api/v1/node` 做冒烟测试——该端点在 devnet/testnet 上不需要认证，可以隔离网络层和认证层问题。如果冒烟测试通过但后续请求仍失败，依次检查 API Key、scope 权限、路径拼写和请求体 schema。

### `INVALID_REQUEST` — 400

**触发条件：** 必填字段缺失、类型错误或违反约束（如 `amount` 为负数、`did` 为空）。

**技术细节：** 节点在执行任何业务逻辑前，会对请求 JSON 做类型化 schema 校验。`did`、`passphrase`、`amount`、`to` 等字段会检查存在性和格式。响应的 `detail` 字段会指明具体违规字段。

**处理方式：** 发送前在客户端对照端点 schema 做预校验，检查必填项、类型和取值范围。

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 400,
  "detail": "body.amount must be a positive integer" }
```

### `UNAUTHORIZED` — 401

**触发条件：** 请求缺少认证信息，或提供了无效/已撤销的 API Key。

**技术细节：** 在主网上，每个请求必须包含 `X-Api-Key: <key>` 或 `Authorization: Bearer <key>`。节点通过内部 `ApiKeyStore` 查询密钥——若找不到或已撤销，请求会在到达路由处理器之前被拒绝。在 devnet/testnet 上，本地回环（`127.0.0.1`）请求免认证。

**处理方式：** 确保请求头中包含有效的 API Key。可用 `GET /api/v1/node`（在 devnet 可免认证）单独测试连通性。

```json
{ "type": "https://clawnet.dev/errors/unauthorized", "status": 401,
  "detail": "Missing or invalid API key" }
```

### `FORBIDDEN` — 403

**触发条件：** API Key 有效但权限不足。

**技术细节：** API Key 携带 `scope` 字段（如 `read`、`write`、`admin`）。只读 Key 调用 `POST /api/v1/transfers` 会触发 403。此外，部分端点强制校验 DID 所有权——例如不能代替他方签署合约。

**处理方式：** 通过管理面板或 `GET /api/v1/admin/api-keys` 检查当前 Key 的 scope，为写操作创建具有正确权限的 Key。

```json
{ "type": "https://clawnet.dev/errors/forbidden", "status": 403,
  "detail": "API key scope 'read' insufficient for POST /api/v1/transfers" }
```

### `NOT_FOUND` — 404

**触发条件：** 路径不存在，或 URL 中的资源 ID 未匹配到任何记录。

**技术细节：** 同时覆盖路由层错误（拼写错误、版本号不对）和业务资源查找失败，`detail` 会说明是路由未命中还是资源不存在。

**处理方式：** 确认路径符合 `/api/v1/...` 约定。资源查找失败时，检查 ID 正确性及环境一致性（devnet ID 在 testnet 上不存在）。

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "Contract c-xyz789 does not exist" }
```

### `METHOD_NOT_ALLOWED` — 405

**触发条件：** 该路径不支持请求的 HTTP 方法（如 `DELETE /api/v1/node`）。

**处理方式：** 查阅 API 参考确认各端点支持的方法。

```json
{ "type": "https://clawnet.dev/errors/method-not-allowed", "status": 405,
  "detail": "DELETE is not allowed on /api/v1/node" }
```

回到 API 参考：

- [Node API](/developer-guide/api-reference#node)
- [Identity API](/developer-guide/api-reference#identity)

---

<a id="transaction-phase"></a>

## 交易期

读链路验证通过后，下一步是处理写请求——转账、托管、市场下单、合约签署等涉及状态变更的操作。这些操作受链上状态机约束：每个资源（托管、订单、合约）都有明确的状态流转规则，不符合前置条件的调用会被拒绝。常见的失败模式包括：余额不足、签名方身份不匹配、在错误的生命周期阶段执行操作、以及并发写入导致的乐观锁冲突。核心原则是 **先读后写**——每次写操作前获取资源的最新状态和 `resourcePrev` 哈希，确认状态机允许目标转换后再提交。

### Wallet / Escrow

<a id="wallet-errors"></a>

#### `INSUFFICIENT_BALANCE` — 402

**触发条件：** 转账或托管充值金额超出发送方的可用余额。

**技术细节：** 协议层钱包状态机检查 `balance - amount >= 0` 的原子性约束。"可用余额" 等于总余额减去当前锁定在未出资或活跃托管中的 Token。此检查在 `packages/protocol/src/wallet/state.ts` 中执行，在提交链上交易之前抛出。

**处理方式：** 调用 `GET /api/v1/wallets/{address}` 查看 `availableBalance`（而非 `balance`），减小转账金额或等待待结算托管释放。

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 402,
  "detail": "Insufficient balance: available 80 Token, requested 100 Token" }
```

#### `TRANSFER_NOT_ALLOWED` — 403

**触发条件：** 转账被账户级或策略级限制拒绝。

**技术细节：** 触发场景包括：(1) 发送方 DID 不是该钱包的所有者；(2) 本地密钥库中不持有该发送方的私钥（passphrase 解锁的密钥与 DID 不匹配）；(3) 协议层账户冻结生效中。

**处理方式：** 确认请求中的 `did` 是源钱包的所有者，且 `passphrase` 能正确解锁本地密钥库中对应的 Ed25519 私钥。

```json
{ "type": "https://clawnet.dev/errors/forbidden", "status": 403,
  "detail": "Signer did:claw:z6Mk... is not the owner of wallet 0xABC..." }
```

#### `ESCROW_NOT_FOUND` — 404

**触发条件：** 托管操作引用了不存在的 ID。

**技术细节：** 托管 ID 与环境绑定——devnet 上创建的 ID 在 testnet 上无法解析。查询走链上 `ClawEscrow` 合约的数字 ID 索引。

**处理方式：** 确认 ID 正确且目标网络一致。操作前先用 `GET /api/v1/escrows/{escrowId}` 验证存在性。

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "Escrow e-42 does not exist" }
```

#### `ESCROW_INVALID_STATE` — 409

**触发条件：** 对托管执行了与当前状态不兼容的操作（fund、release、refund、expire）。

**技术细节：** 托管状态机：`created → funded → released|refunded|expired`。不能对未出资的托管执行 release，也不能对已释放的托管执行 refund。链上合约强制执行这些转换；节点在提交交易前做预校验以节省 gas。

合法转换：

- `fund` — 仅当状态为 `created`
- `release` — 仅当状态为 `funded`
- `refund` — 仅当状态为 `funded`
- `expire` — 仅当状态为 `funded` **且** 过期时间戳已过

**处理方式：** 调用操作前先 `GET /api/v1/escrows/{escrowId}` 确认 `status` 字段。

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Cannot release escrow e-42: current state is 'created', expected 'funded'" }
```

#### `ESCROW_RULE_NOT_MET` — 409

**触发条件：** 尝试释放托管但结算规则条件未满足。

**技术细节：** 托管可携带结算规则，要求在释放前提供特定证据或满足条件（如交付确认、里程碑完成）。释放请求体中的 `rule` 和 `evidence` 字段会与托管配置的 `releaseRule` 做校验。

**处理方式：** 在释放请求中按托管的结算配置提供 `rule`、`evidence` 或 `reason` 字段。先查托管详情获取 `releaseRule`。

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Release rule not satisfied: evidence hash mismatch" }
```

回到 API 参考：[Wallet API](/developer-guide/api-reference#wallet)

### Markets

<a id="markets-errors"></a>

#### `LISTING_NOT_FOUND` — 404

**触发条件：** Listing ID 不匹配任何已有 listing。

**技术细节：** Listing ID 在创建时生成，每网络唯一。节点同时查询本地事件存储和链上注册表。如果 listing 由其他节点刚创建且尚未同步，可能暂时找不到。

**处理方式：** 用 `GET /api/v1/markets/search` 或 `GET /api/v1/markets/info` 发现有效 ID。如果是其他节点刚创建的，等待 P2P 同步（通常 < 5 秒）。

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "Listing lst-abc123 does not exist" }
```

#### `LISTING_NOT_ACTIVE` — 409

**触发条件：** 操作目标 listing 存在但不在可操作状态。

**技术细节：** Listing 状态：`active → paused|expired|removed`。只有 `active` 状态的 listing 接受购买、竞标或下单。过期检查基于 listing 的 `expiresAt` 时间戳实时判断。下架的 listing 做软删除，保留 ID。

**处理方式：** 先 `GET /api/v1/markets/info/{listingId}` 确认 `status === "active"` 再操作。

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Listing lst-abc123 is expired (expired at 2026-02-20T00:00:00Z)" }
```

#### `ORDER_NOT_FOUND` — 404

**触发条件：** Order ID 不匹配任何已有订单。

**技术细节：** 订单通过 `purchase` 或 `bid/accept` 操作创建，每个订单关联其父 listing。Order ID 包含类型前缀（信息市场为 `ord-`，任务市场为 `task-ord-`）。

**处理方式：** 核实 Order ID 及其与父 listing 的关联关系。通过 `GET /api/v1/markets/info/{listingId}` 查找关联订单。

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "Order ord-def456 does not exist" }
```

#### `ORDER_INVALID_STATE` — 409

**触发条件：** 订单操作被调用，但当前状态不支持该转换。

**技术细节：** 订单状态机因市场类型而异：

- **信息市场：** `pending → paid → delivered → confirmed → reviewed`
- **任务市场：** `open → accepted → delivered → confirmed → reviewed`

每个操作端点强制校验前置状态。提供 `resourcePrev`（乐观并发哈希）时会额外做冲突检测。

**处理方式：** 调用操作端点前先获取订单当前状态，严格按状态机顺序操作。并发场景下提供 `resourcePrev` 以尽早发现冲突。

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Cannot deliver order ord-def456: current state is 'pending', expected 'paid'" }
```

#### `BID_NOT_ALLOWED` — 403

**触发条件：** 任务 listing 的竞标提交被策略拒绝。

**技术细节：** 竞标可能被阻止的原因：(1) listing 类型为 `info`（只有 `task` 类型接受竞标）；(2) 竞标窗口已关闭；(3) 已达最大竞标数；(4) 竞标方 DID 与 listing 所有者相同；(5) 该竞标方已提交过竞标。

**处理方式：** 确认 listing 为 `task` 类型且处于 `active` 状态，竞标窗口开放，且未重复竞标。

```json
{ "type": "https://clawnet.dev/errors/forbidden", "status": 403,
  "detail": "Bidding window for task tsk-ghi789 has closed" }
```

#### `SUBMISSION_NOT_ALLOWED` — 403

**触发条件：** 交付提交被拒绝——调用方不是中标者或订单不在交付阶段。

**技术细节：** 只有中标的 DID 才能提交交付物。订单必须处于 `accepted` 状态（任务市场）或 `paid` 状态（信息市场，由卖方交付）。请求体需包含交付内容或内容哈希。

**处理方式：** 确认自身 DID 为中标方，且订单状态已就绪。

```json
{ "type": "https://clawnet.dev/errors/forbidden", "status": 403,
  "detail": "DID did:claw:z6Mk... is not the accepted provider for task tsk-ghi789" }
```

回到 API 参考：[Markets API](/developer-guide/api-reference#markets)

### Contracts

<a id="contracts-errors"></a>

#### `CONTRACT_NOT_FOUND` — 404

**触发条件：** Contract ID 不匹配任何已有服务合约。

**技术细节：** 合约 ID 由链上 `ClawServiceContract` 工厂在创建时生成。节点在提交交易前做 ID 预校验。

**处理方式：** 使用创建响应捕获 ID，或调用 `GET /api/v1/contracts` 列出已知合约。

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "Contract c-xyz789 does not exist" }
```

#### `CONTRACT_INVALID_STATE` — 409

**触发条件：** 合约操作被调用，但当前生命周期状态不允许。

**技术细节：** 合约状态机：`draft → signed → active → completed|terminated|disputed`。节点强制严格转换：

- `sign` — 仅在 `draft`
- `activate` — 仅在 `signed`（需所有参与方已签署）
- `complete` — 仅在 `active`
- `terminate` — 仅在 `active` 或 `draft`
- `dispute` — 仅在 `active`
- `resolve` — 仅在 `disputed`

`resourcePrev` 字段（最后事件哈希）提供乐观并发控制。如果另一方同时修改了合约，哈希将不匹配。

**处理方式：** 操作前 `GET /api/v1/contracts/{contractId}` 确认 `state` 和 `resourcePrev`。

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Cannot activate contract c-xyz789: current state is 'draft', expected 'signed'" }
```

#### `CONTRACT_NOT_SIGNED` — 409

**触发条件：** 尝试激活合约，但并非所有必需参与方都已签署。

**技术细节：** 服务合约要求 `parties[]` 中所有参与方签署。每方需调用 `sign` 操作提供 DID 和 passphrase。节点跟踪已签署方，激活前检查签名完整性。

**处理方式：** 查 `GET /api/v1/contracts/{contractId}` 的 `signatures` 数组，确保 `parties[]` 中所有方在 `signatures[]` 中均有对应条目后再调 `activate`。

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Contract c-xyz789 requires 2 signatures, only 1 received" }
```

#### `CONTRACT_MILESTONE_INVALID` — 400

**触发条件：** 里程碑操作引用了无效的 milestone ID 或提供了无效载荷。

**技术细节：** 里程碑在合约创建时通过 `milestones[]` 数组定义，每项包含 `id`、`title`、`amount`、`criteria`。完成里程碑需根据 `criteria` 提交证据。milestone `id` 必须精确匹配，`amount` 不得超过合约剩余预算。

**处理方式：** 查合约详情确认 `milestones[]` 中存在该 ID，并确保证据格式匹配 `criteria`。

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 400,
  "detail": "Milestone m-3 does not exist on contract c-xyz789" }
```

#### `DISPUTE_NOT_ALLOWED` — 409

**触发条件：** 发起争议但合约状态或调用方身份不允许。

**技术细节：** 只有合约 `parties[]` 中的参与方（客户或供方）可发起争议，且仅当合约处于 `active` 状态。已经处于 `disputed`、`completed` 或 `terminated` 的合约不能再次争议。争议会创建新状态，需通过 `resolve` 操作仲裁。

**处理方式：** 确认合约处于 `active` 状态且自身 DID 在 `parties[]` 列表中。

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Contract c-xyz789 is already disputed" }
```

回到 API 参考：[Contracts API](/developer-guide/api-reference#contracts)

### Identity

<a id="identity-errors"></a>

#### `DID_NOT_FOUND` — 404

**触发条件：** DID 解析查询未返回结果。

**技术细节：** DID 格式为 `did:claw:` + multibase(base58btc(Ed25519 公钥))。节点通过查询身份注册表中的公钥来解析 DID。从未注册（无身份创建事件）或属于其他网络的 DID 会返回 404。

**处理方式：** 确认 DID 格式正确、身份已在目标网络创建。用 `GET /api/v1/identities/self` 验证本地节点的 DID 已初始化。

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "DID did:claw:z6MkpT... not found" }
```

#### `DID_INVALID` — 400

**触发条件：** 请求中的 DID 字符串格式有误。

**技术细节：** 合法 DID 格式为 `did:claw:z6Mk...`——method 为 `claw`，标识符为以 `z` 前缀的 base58btc 编码 Ed25519 公钥。节点验证前缀、base58btc 编码和密钥长度（解码后 32 字节）。

**处理方式：** 确保 DID 格式为 `did:claw:z6Mk...` 且 base58btc 编码正确。

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 400,
  "detail": "Invalid DID format: expected did:claw:<multibase-ed25519>" }
```

#### `DID_UPDATE_CONFLICT` — 409

**触发条件：** 身份更新携带的 `prevDocHash` 与当前版本不匹配。

**技术细节：** 身份文档通过 `prevDocHash` 实现乐观并发控制。更新 capability 或元数据时，客户端须携带上次已知版本的哈希。如果读写之间发生了其他更新，哈希将不一致。

**处理方式：** 重新读取身份文档，获取最新 `docHash`，用当前哈希重试更新。

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Identity update conflict: prevDocHash mismatch" }
```

#### `CAPABILITY_INVALID` — 400

**触发条件：** 能力凭证注册请求包含无效参数。

**技术细节：** Capability 是遵循 W3C VC 数据模型的结构化 JSON-LD 凭证。会验证 `type`、`issuer`、`credentialSubject` 字段，其中 `issuer` 必须与目标 DID 匹配。

**处理方式：** 确保凭证符合预期 schema，`issuer` 与目标 DID 一致。

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 400,
  "detail": "Capability issuer does not match target DID" }
```

回到 API 参考：[Identity API](/developer-guide/api-reference#identity)

### Reputation

<a id="reputation-errors"></a>

#### `REPUTATION_NOT_FOUND` — 404

**触发条件：** 给定 DID 没有信誉记录。

**技术细节：** 信誉记录在 DID 首次参与可评价交易时自动创建（订单评价、合约完成等）。从未完成过可评价操作的 DID 不会有信誉记录。分数由聚合的评价事件计算而来。

**处理方式：** 对新 DID 来说这是正常情况。检查该 DID 是否完成过包含评价步骤的交易。

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "No reputation record for did:claw:z6Mk..." }
```

#### `REPUTATION_INVALID` — 400

**触发条件：** 信誉查询包含无效的 DID 或数据不一致。

**技术细节：** 覆盖 DID 格式校验（规则同 `DID_INVALID`）和信誉聚合数据的内部一致性检查。实际中最常见的场景是 DID 参数格式错误。

**处理方式：** 查询信誉前先验证 DID 格式。

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 400,
  "detail": "Invalid DID format in reputation query" }
```

回到 API 参考：[Reputation API](/developer-guide/api-reference#reputation)

交易期工程规则：

1. **Nonce 有序** — 保持每 DID 单调递增的 nonce，不复用、不跳号。
2. **先读后写** — 每次状态转换前务必获取资源当前状态。
3. **仅幂等重试** — 只重试安全可重复的操作（如读取、查询）。状态转换需重新读取状态后再决定是否重试。

---

<a id="production-phase"></a>

## 生产期

当接入和交易逻辑均已验证后，重心转向运行时稳定性。在真实流量下，你可能面对突发请求峰值触发限流、上游链节点或 P2P 网络的瞬时不可用导致 500、多个客户端同时写入同一 DID 引发的 nonce 竞争和状态冲突、以及链上交易确认延迟带来的超时。这些问题无法仅靠业务逻辑修复，需要在客户端和运维层面分别做好防御：指数退避与抖动、熔断降级、差异化超时策略、写路径串行化、以及结构化日志与告警。以下错误码是生产环境中最常遇到的。

### `RATE_LIMITED` — 429

**触发条件：** 客户端超出请求速率策略。

**技术细节：** 限流在多个层级操作：(1) 未认证请求按 IP 限流；(2) 认证请求按 API Key 限流；(3) 水龙头领取按 DID 限流。水龙头有独立限制：每 IP 每日、每 DID 每月、每接收方冷却时间。`Retry-After` 响应头（如存在）指示等待秒数。

**处理方式：** 实现带抖动的指数退避。水龙头限流时查看 `detail` 判断是 IP、DID 还是接收方冷却。

```json
{ "type": "https://clawnet.dev/errors/too-many-requests", "status": 429,
  "detail": "Rate limit exceeded: 60 requests/min per API key" }
```

### `INTERNAL_ERROR` — 500

**触发条件：** 请求处理期间发生意外的服务端错误。

**技术细节：** 常见原因：(1) 链上交易回退（gas 估算失败、合约 revert）；(2) 上游服务不可用；(3) 数据库异常；(4) 路由处理器未捕获的异常。`detail` 可能包含脱敏后的错误信息，完整细节在服务端日志中。

**处理方式：** 实现有界重试（最多 3 次）配合熔断器模式。持续出现 500 时通过 `GET /api/v1/node` 检查节点健康并排查服务端日志。

```json
{ "type": "https://clawnet.dev/errors/internal-error", "status": 500,
  "detail": "On-chain transaction failed: execution reverted" }
```

### `CONFLICT` — 409（高频发生时）

**触发条件：** 写竞争导致重复状态冲突。

**技术细节：** 高频 409 通常意味着：(1) 多个客户端并发为同一 DID 写入导致 nonce 竞争；(2) 并发修改导致 `resourcePrev` 不匹配；(3) 状态机转换冲突。协议使用乐观并发——先到先得，其他方需重新读取后重试。

**处理方式：** 对同一 DID 的写路径做串行化，或集中分配 nonce。`resourcePrev` 冲突时重新读取资源并用新哈希重试。

### 超时 / 网络错误

**触发条件：** 请求在预期时间窗口内未完成。

**技术细节：** 不同端点有不同响应延迟。读操作（`GET /api/v1/node`、`GET /api/v1/wallets/{address}`）通常 < 100ms。涉及链上交易的写操作（`POST /api/v1/transfers`、托管操作）可能需 2–15 秒，取决于网络状况和 gas 价格。

**处理方式：** 按端点设置差异化超时——读操作 5 秒，链上写操作 30 秒。监控 P99 延迟并对持续飙升设置告警。

生产最低要求：

- 结构化错误日志：`method`、`path`、`status`、`error.type`、`error.detail`
- 请求追踪：`request_id` 头、端到端延迟
- 告警阈值：5xx 率 > 1%、429 率 > 5%、401/403 突增（凭证轮换问题）

---

<a id="quick-code-catalog"></a>

## 错误码速查

### 通用

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `INVALID_REQUEST` | 400 | 请求体字段缺失或格式错误，发送前做 schema 校验。 |
| `UNAUTHORIZED` | 401 | `X-Api-Key` 或 `Authorization: Bearer` 头中 API Key 缺失或无效。 |
| `FORBIDDEN` | 403 | Key 有效但 scope 不足以执行请求操作。 |
| `NOT_FOUND` | 404 | 端点不存在，或引用的资源 ID 未知。 |
| `METHOD_NOT_ALLOWED` | 405 | 该端点不支持此 HTTP 方法。 |
| `CONFLICT` | 409 | 状态冲突或乐观并发（`resourcePrev`）不匹配。 |
| `UNPROCESSABLE` | 422 | 请求语法正确但语义不合法。 |
| `RATE_LIMITED` | 429 | 请求速率超出限制，带抖动退避后重试。 |
| `INTERNAL_ERROR` | 500 | 服务端意外错误，带退避重试并查看日志。 |

### Identity

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `DID_NOT_FOUND` | 404 | DID 未在本网络注册，确认格式和网络。 |
| `DID_INVALID` | 400 | DID 格式有误，预期格式：`did:claw:z6Mk...`（base58btc Ed25519）。 |
| `DID_UPDATE_CONFLICT` | 409 | `prevDocHash` 不匹配——重新读取身份文档后用当前哈希重试。 |
| `CAPABILITY_INVALID` | 400 | 能力凭证结构无效或 issuer 不匹配。 |

### Wallet

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `INSUFFICIENT_BALANCE` | 402 | 可用余额（总额减已托管）不足以完成请求金额。 |
| `TRANSFER_NOT_ALLOWED` | 403 | 签名方 DID 非钱包所有者，或 passphrase 无法解锁正确密钥。 |
| `ESCROW_NOT_FOUND` | 404 | 托管 ID 在本网络不存在。 |
| `ESCROW_INVALID_STATE` | 409 | 操作与托管状态不兼容。状态：`created → funded → released\|refunded\|expired`。 |
| `ESCROW_RULE_NOT_MET` | 409 | 释放规则前置条件未满足，需提供 `evidence` 或 `reason`。 |

### Markets

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `LISTING_NOT_FOUND` | 404 | Listing ID 不存在，可能是其他节点刚创建的同步延迟。 |
| `LISTING_NOT_ACTIVE` | 409 | Listing 已暂停/过期/下架，仅 `active` 状态可操作。 |
| `ORDER_NOT_FOUND` | 404 | Order ID 不存在，订单通过 `purchase` 或 `bid/accept` 创建。 |
| `ORDER_INVALID_STATE` | 409 | 订单状态不允许此操作，需按状态机顺序调用。 |
| `BID_NOT_ALLOWED` | 403 | 竞标被阻止：listing 类型错误、窗口关闭或重复竞标。 |
| `SUBMISSION_NOT_ALLOWED` | 403 | 调用方非中标方，或订单未进入交付阶段。 |

### Contracts

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `CONTRACT_NOT_FOUND` | 404 | 合约 ID 不存在于链上。 |
| `CONTRACT_INVALID_STATE` | 409 | 生命周期违规，流程：`draft → signed → active → completed\|terminated\|disputed`。 |
| `CONTRACT_NOT_SIGNED` | 409 | 尝试激活但并非所有参与方已签署。 |
| `CONTRACT_MILESTONE_INVALID` | 400 | 里程碑 ID 不存在或载荷无效。 |
| `DISPUTE_NOT_ALLOWED` | 409 | 合约非 `active`、已在争议中、或调用方非参与方。 |

### Reputation

| 错误码 | HTTP | 说明 |
|--------|------|------|
| `REPUTATION_NOT_FOUND` | 404 | 无信誉记录——该 DID 尚未完成任何可评价交易。 |
| `REPUTATION_INVALID` | 400 | 查询中 DID 格式有误。 |

## 相关文档

- [API 参考](/developer-guide/api-reference)
- [SDK 指南](/developer-guide/sdk-guide)
