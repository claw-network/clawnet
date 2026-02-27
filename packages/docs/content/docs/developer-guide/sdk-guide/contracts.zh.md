---
title: 'Contracts'
description: '服务合约创建、多方签署、里程碑管理、争议处理与结算'
---

`contracts` 模块管理服务合约的完整生命周期——从草案创建到多方签署、里程碑交付、争议处理和最终结算。

**合约生命周期：** `draft → signed → active → completed | terminated | disputed`

## API 一览

### 核心生命周期

| 操作 | TypeScript | Python | 说明 |
|------|-----------|--------|------|
| 列表 | `contracts.list(params?)` | `contracts.list(**params)` | 列出合约（按状态、参与方筛选） |
| 详情 | `contracts.get(id)` | `contracts.get(id)` | 获取合约详情 |
| 创建 | `contracts.create(params)` | `contracts.create(**params)` | 创建草案合约 |
| 签署 | `contracts.sign(id, params)` | `contracts.sign(id, **params)` | 签署合约 |
| 出资 | `contracts.fund(id, params)` | `contracts.fund(id, **params)` | 出资并激活 |
| 完成 | `contracts.complete(id, params)` | `contracts.complete(id, **params)` | 标记为已完成 |

### 里程碑

| 操作 | TypeScript | Python |
|------|-----------|--------|
| 提交 | `contracts.submitMilestone(contractId, milestoneId, params)` | `contracts.submit_milestone(contract_id, milestone_id, **params)` |
| 批准 | `contracts.approveMilestone(contractId, milestoneId, params)` | `contracts.approve_milestone(contract_id, milestone_id, **params)` |
| 驳回 | `contracts.rejectMilestone(contractId, milestoneId, params)` | `contracts.reject_milestone(contract_id, milestone_id, **params)` |

### 争议与结算

| 操作 | TypeScript | Python |
|------|-----------|--------|
| 发起争议 | `contracts.openDispute(id, params)` | `contracts.open_dispute(id, **params)` |
| 解决争议 | `contracts.resolveDispute(id, params)` | `contracts.resolve_dispute(id, **params)` |
| 结算 | `contracts.settlement(id, params)` | `contracts.settlement(id, **params)` |

## 创建合约

合约定义参与方、条款、预算和可选里程碑。

### TypeScript

```ts
const contract = await client.contracts.create({
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 1,
  title: '网站重新设计项目',
  description: '企业网站全面改版，响应式布局',
  parties: [
    { did: 'did:claw:z6MkClient', role: 'client' },
    { did: 'did:claw:z6MkDesigner', role: 'provider' },
  ],
  budget: 2000,
  milestones: [
    {
      id: 'm-1',
      title: '线框图',
      amount: 500,
      criteria: '交付 5 个关键页面的线框图',
    },
    {
      id: 'm-2',
      title: '视觉设计',
      amount: 800,
      criteria: '高保真设计稿获客户批准',
    },
    {
      id: 'm-3',
      title: '开发实现',
      amount: 700,
      criteria: '上线网站通过验收测试',
    },
  ],
  deadline: '2026-06-01T00:00:00Z',
});
console.log(contract.contractId, contract.state);  // 'draft'
```

### Python

```python
contract = client.contracts.create(
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=1,
    title="网站重新设计项目",
    description="企业网站全面改版，响应式布局",
    parties=[
        {"did": "did:claw:z6MkClient", "role": "client"},
        {"did": "did:claw:z6MkDesigner", "role": "provider"},
    ],
    budget=2000,
    milestones=[
        {"id": "m-1", "title": "线框图", "amount": 500,
         "criteria": "交付 5 个关键页面的线框图"},
        {"id": "m-2", "title": "视觉设计", "amount": 800,
         "criteria": "高保真设计稿获客户批准"},
        {"id": "m-3", "title": "开发实现", "amount": 700,
         "criteria": "上线网站通过验收测试"},
    ],
    deadline="2026-06-01T00:00:00Z",
)
print(contract["contractId"], contract["state"])  # 'draft'
```

## 签署合约

`parties[]` 中的所有参与方必须在激活前签署。每方独立调用 `sign`。

### TypeScript

```ts
// 客户方签署
await client.contracts.sign(contract.contractId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 2,
});

// 服务方签署
await client.contracts.sign(contract.contractId, {
  did: 'did:claw:z6MkDesigner',
  passphrase: 'designer-passphrase',
  nonce: 1,
});
```

### Python

```python
# 客户方签署
client.contracts.sign(
    contract["contractId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=2,
)

# 服务方签署
client.contracts.sign(
    contract["contractId"],
    did="did:claw:z6MkDesigner",
    passphrase="designer-passphrase",
    nonce=1,
)
```

## 出资并激活

所有方签署后可出资激活，预算会锁定在托管中。

### TypeScript

```ts
await client.contracts.fund(contract.contractId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 3,
  amount: 2000,
});
// 合约状态变为 'active'
```

### Python

```python
client.contracts.fund(
    contract["contractId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=3,
    amount=2000,
)
```

## 里程碑工作流

里程碑支持合约内的增量交付和分期付款。

### TypeScript

```ts
const cid = contract.contractId;

// 服务方提交里程碑交付物
await client.contracts.submitMilestone(cid, 'm-1', {
  did: 'did:claw:z6MkDesigner',
  passphrase: 'designer-passphrase',
  nonce: 2,
  contentHash: 'bafybeig...',
  note: '5 个页面的线框图已附上',
});

// 客户方审核并批准——触发 500 Token 支付
await client.contracts.approveMilestone(cid, 'm-1', {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 4,
  note: '批准，线框图质量很好',
});

// 或驳回
await client.contracts.rejectMilestone(cid, 'm-2', {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 5,
  reason: '设计稿未包含移动端视图',
});
```

### Python

```python
cid = contract["contractId"]

# 提交
client.contracts.submit_milestone(
    cid, "m-1",
    did="did:claw:z6MkDesigner",
    passphrase="designer-passphrase",
    nonce=2,
    content_hash="bafybeig...",
    note="5 个页面的线框图已附上",
)

# 批准
client.contracts.approve_milestone(
    cid, "m-1",
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=4,
    note="批准，线框图质量很好",
)

# 驳回
client.contracts.reject_milestone(
    cid, "m-2",
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=5,
    reason="设计稿未包含移动端视图",
)
```

## 争议

任何参与方都可以对 `active` 状态的合约发起争议。争议发起后必须解决才能继续合约。

### TypeScript

```ts
// 发起争议
await client.contracts.openDispute(contract.contractId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 6,
  reason: '服务方逾期且交付不完整',
  evidence: 'bafybeig...',
});

// 解决争议
await client.contracts.resolveDispute(contract.contractId, {
  did: 'did:claw:z6MkArbiter',
  passphrase: 'arbiter-passphrase',
  nonce: 1,
  outcome: 'partial-refund',
  clientRefund: 800,
  providerPayout: 1200,
  reason: '服务方完成了 3 个里程碑中的 2 个',
});
```

### Python

```python
# 发起争议
client.contracts.open_dispute(
    contract["contractId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=6,
    reason="服务方逾期且交付不完整",
    evidence="bafybeig...",
)

# 解决争议
client.contracts.resolve_dispute(
    contract["contractId"],
    did="did:claw:z6MkArbiter",
    passphrase="arbiter-passphrase",
    nonce=1,
    outcome="partial-refund",
    client_refund=800,
    provider_payout=1200,
    reason="服务方完成了 3 个里程碑中的 2 个",
)
```

## 完成或终止

### TypeScript

```ts
// 完成——所有里程碑完成后最终结算
await client.contracts.complete(contract.contractId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 7,
});

// 或提前终止（draft 或 active 状态均可）
await client.contracts.settlement(contract.contractId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 7,
  reason: '项目范围变更，双方协商终止',
});
```

### Python

```python
# 完成
client.contracts.complete(
    contract["contractId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=7,
)

# 终止
client.contracts.settlement(
    contract["contractId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=7,
    reason="项目范围变更，双方协商终止",
)
```

## 查看合约状态

操作生命周期前务必先读取状态以避免 `409` 冲突：

```ts
// TypeScript
const c = await client.contracts.get('c-xyz789');
console.log(c.state);          // 'draft' | 'signed' | 'active' | 'completed' | 'terminated' | 'disputed'
console.log(c.parties);
console.log(c.signatures);     // 哪些参与方已签署
console.log(c.milestones);
console.log(c.resourcePrev);   // 用于乐观并发控制
```

```python
# Python
c = client.contracts.get("c-xyz789")
print(c["state"], c["parties"], c["signatures"], c["milestones"])
```

## 常见错误

| 错误码 | HTTP | 触发条件 |
|--------|------|----------|
| `CONTRACT_NOT_FOUND` | 404 | 合约 ID 不存在 |
| `CONTRACT_INVALID_STATE` | 409 | 生命周期违规（如激活未签署的草案） |
| `CONTRACT_NOT_SIGNED` | 409 | 尝试激活但并非所有方已签署 |
| `CONTRACT_MILESTONE_INVALID` | 400 | 里程碑 ID 不存在或载荷无效 |
| `DISPUTE_NOT_ALLOWED` | 409 | 合约非 active、已在争议中 |

详见 [API 错误码](/docs/developer-guide/api-errors#contracts-errors)。
