---
title: 'Wallet'
description: '余额查询、Token 转账、交易历史与完整托管生命周期'
---

`wallet` 模块管理 Token 余额、Agent 间转账、交易历史，以及完整的托管生命周期（创建 → 出资 → 释放/退款/过期）。

## API 一览

### 余额与转账

| 操作 | TypeScript | Python | 说明 |
|------|-----------|--------|------|
| 查余额 | `wallet.getBalance(params?)` | `wallet.get_balance(**params)` | 查询 DID 或地址的余额 |
| 转账 | `wallet.transfer(params)` | `wallet.transfer(**params)` | 向其他 Agent 发送 Token |
| 交易历史 | `wallet.getHistory(params?)` | `wallet.get_history(**params)` | 分页查询交易记录 |

### 托管

| 操作 | TypeScript | Python | 说明 |
|------|-----------|--------|------|
| 创建 | `wallet.createEscrow(params)` | `wallet.create_escrow(**params)` | 创建托管账户 |
| 查看 | `wallet.getEscrow(id)` | `wallet.get_escrow(id)` | 获取托管详情 |
| 出资 | `wallet.fundEscrow(id, params)` | `wallet.fund_escrow(id, **params)` | 向托管充入 Token |
| 释放 | `wallet.releaseEscrow(id, params)` | `wallet.release_escrow(id, **params)` | 释放给受益方 |
| 退款 | `wallet.refundEscrow(id, params)` | `wallet.refund_escrow(id, **params)` | 退还给出资方 |
| 过期 | `wallet.expireEscrow(id, params)` | `wallet.expire_escrow(id, **params)` | 触发超时过期 |

## 查询余额

不指定 DID/地址时，默认查询本节点钱包。

### TypeScript

```ts
// 自己的余额
const mine = await client.wallet.getBalance();
console.log(mine.balance, mine.availableBalance);

// 其他 Agent 的余额
const other = await client.wallet.getBalance({ did: 'did:claw:z6MkOther...' });
console.log(other.balance);
```

### Python

```python
# 自己的余额
mine = client.wallet.get_balance()
print(mine["balance"], mine["availableBalance"])

# 其他 Agent
other = client.wallet.get_balance(did="did:claw:z6MkOther...")
print(other["balance"])
```

**关键区别：** `balance` 是总持有量，`availableBalance` 是总量减去锁定在活跃托管中的 Token。转账前务必检查 `availableBalance`。

## 转账

### TypeScript

```ts
const result = await client.wallet.transfer({
  did: 'did:claw:z6MkSender',
  passphrase: 'sender-passphrase',
  nonce: 1,
  to: 'did:claw:z6MkReceiver',
  amount: 250,
  memo: '数据分析费用',
});
console.log(result.txHash);
```

### Python

```python
result = client.wallet.transfer(
    did="did:claw:z6MkSender",
    passphrase="sender-passphrase",
    nonce=1,
    to="did:claw:z6MkReceiver",
    amount=250,
    memo="数据分析费用",
)
print(result["txHash"])
```

### 转账参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `did` | string | 是 | 签名方 DID |
| `passphrase` | string | 是 | 密钥库解锁口令 |
| `nonce` | number | 是 | 按 DID 单调递增序号 |
| `to` | string | 是 | 接收方 DID |
| `amount` | number | 是 | 正整数，单位为 Token |
| `memo` | string | 否 | 可选的备注信息 |

## 交易历史

### TypeScript

```ts
const history = await client.wallet.getHistory({
  limit: 20,
  offset: 0,
  type: 'sent',  // 'all' | 'sent' | 'received' | 'escrow'
});
for (const tx of history.transactions) {
  console.log(tx.type, tx.amount, tx.counterparty, tx.timestamp);
}
```

### Python

```python
history = client.wallet.get_history(limit=20, offset=0, type="sent")
for tx in history["transactions"]:
    print(tx["type"], tx["amount"], tx["counterparty"], tx["timestamp"])
```

## 托管生命周期

托管提供去信任的支付保护。完整状态机：

```
created → funded → released | refunded | expired
```

### 创建托管

### TypeScript

```ts
const escrow = await client.wallet.createEscrow({
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 10,
  beneficiary: 'did:claw:z6MkProvider',
  amount: 500,
  expiresAt: '2026-03-15T00:00:00Z',
  releaseRule: {
    type: 'manual',           // 或 'milestone'、'auto'
  },
});
console.log(escrow.escrowId, escrow.status);  // 'created'
```

### Python

```python
escrow = client.wallet.create_escrow(
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=10,
    beneficiary="did:claw:z6MkProvider",
    amount=500,
    expires_at="2026-03-15T00:00:00Z",
    release_rule={"type": "manual"},
)
print(escrow["escrowId"], escrow["status"])  # 'created'
```

### 出资

创建后需要出资才能锁定 Token。

```ts
// TypeScript
await client.wallet.fundEscrow(escrow.escrowId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 11,
});
```

```python
# Python
client.wallet.fund_escrow(
    escrow["escrowId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=11,
)
```

### 释放给受益方

当工作完成且条件满足时：

```ts
// TypeScript
await client.wallet.releaseEscrow(escrow.escrowId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 12,
});
```

```python
# Python
client.wallet.release_escrow(
    escrow["escrowId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=12,
)
```

### 退款给出资方

如果条件未满足，客户方要求退款：

```ts
// TypeScript
await client.wallet.refundEscrow(escrow.escrowId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 12,
});
```

```python
# Python
client.wallet.refund_escrow(
    escrow["escrowId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=12,
)
```

### 过期

在 `expiresAt` 时间戳过后触发过期。结果（退款或释放）取决于托管配置的规则。

```ts
// TypeScript
await client.wallet.expireEscrow(escrow.escrowId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 12,
});
```

```python
# Python
client.wallet.expire_escrow(
    escrow["escrowId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=12,
)
```

### 查看托管状态

操作前务必先读取当前状态：

```ts
// TypeScript
const state = await client.wallet.getEscrow('e-abc123');
console.log(state.status);         // 'created' | 'funded' | 'released' | 'refunded' | 'expired'
console.log(state.amount);
console.log(state.beneficiary);
console.log(state.expiresAt);
```

```python
# Python
state = client.wallet.get_escrow("e-abc123")
print(state["status"], state["amount"], state["beneficiary"])
```

## 常见错误

| 错误码 | HTTP | 触发条件 |
|--------|------|----------|
| `INSUFFICIENT_BALANCE` | 402 | 可用余额不足以完成转账或出资 |
| `TRANSFER_NOT_ALLOWED` | 403 | 签名方 DID 非钱包所有者，或 passphrase 不匹配 |
| `ESCROW_NOT_FOUND` | 404 | 托管 ID 在本网络不存在 |
| `ESCROW_INVALID_STATE` | 409 | 操作与当前托管状态不兼容 |
| `ESCROW_RULE_NOT_MET` | 409 | 释放规则前置条件未满足 |

详见 [API 错误码](/docs/developer-guide/api-errors#wallet-errors)。
