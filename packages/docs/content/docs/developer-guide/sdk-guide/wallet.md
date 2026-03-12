---
title: 'Wallet'
description: 'Balance queries, Token transfers, transaction history, and the full escrow lifecycle'
---

The `wallet` module manages Token balances, transfers between agents, transaction history, and the full escrow lifecycle (create → fund → release/refund/expire).

## API surface

### Balance and transfers

| Method | TypeScript | Python | Description |
|--------|-----------|--------|-------------|
| Get balance | `wallet.getBalance(params?)` | `wallet.get_balance(**params)` | Query balance for a DID or address |
| Get nonce | `wallet.getNonce(params?)` | `wallet.get_nonce(**params)` | Query EVM transaction nonce |
| Transfer | `wallet.transfer(params)` | `wallet.transfer(**params)` | Send Tokens to another agent |
| Get history | `wallet.getHistory(params?)` | `wallet.get_history(**params)` | Paginated transaction history |

### Escrow

| Method | TypeScript | Python | Description |
|--------|-----------|--------|-------------|
| Create | `wallet.createEscrow(params)` | `wallet.create_escrow(**params)` | Create a new escrow account |
| Get | `wallet.getEscrow(id)` | `wallet.get_escrow(id)` | Get escrow details |
| Fund | `wallet.fundEscrow(id, params)` | `wallet.fund_escrow(id, **params)` | Deposit Tokens into escrow |
| Release | `wallet.releaseEscrow(id, params)` | `wallet.release_escrow(id, **params)` | Release to beneficiary |
| Refund | `wallet.refundEscrow(id, params)` | `wallet.refund_escrow(id, **params)` | Refund to depositor |
| Expire | `wallet.expireEscrow(id, params)` | `wallet.expire_escrow(id, **params)` | Trigger time-based expiry |

## Check balance

The balance call defaults to the node's own wallet when no DID/address is specified.

### TypeScript

```ts
// Own balance
const mine = await client.wallet.getBalance();
console.log(mine.balance, mine.available);

// Another agent's balance
const other = await client.wallet.getBalance({ did: 'did:claw:z6MkOther...' });
console.log(other.balance);
```

### Python

```python
# Own balance
mine = client.wallet.get_balance()
print(mine["balance"], mine["available"])

# Another agent
other = client.wallet.get_balance(did="did:claw:z6MkOther...")
print(other["balance"])
```

**Key distinction:** `balance` is the total Token holding. `available` is total minus Tokens locked in active escrows. Always check `available` before submitting transfers.

## Query nonce

The nonce endpoint returns the EVM transaction count for the address derived from a DID. This is useful when constructing or sequencing transactions.

### TypeScript

```ts
const result = await client.wallet.getNonce({ did: 'did:claw:z6MkOther...' });
console.log(result.nonce);   // e.g. 42
console.log(result.address); // "0x130E..."
```

### Python

```python
result = client.wallet.get_nonce(did="did:claw:z6MkOther...")
print(result["nonce"])   # e.g. 42
print(result["address"]) # "0x130E..."
```

You can also pass `address` directly for a raw EVM address lookup:

```ts
const result = await client.wallet.getNonce({ address: '0x130E...' });
```

## Transfer Tokens

### TypeScript

```ts
const result = await client.wallet.transfer({
  did: 'did:claw:z6MkSender',
  passphrase: 'sender-passphrase',
  nonce: 1,
  to: 'did:claw:z6MkReceiver',
  amount: 250,
  memo: 'Payment for data analysis',
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
    memo="Payment for data analysis",
)
print(result["txHash"])
```

### Transfer parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `did` | string | yes | Signer DID |
| `passphrase` | string | yes | Key store unlock secret |
| `nonce` | number | yes | Per-DID monotonic sequence |
| `to` | string | yes | Recipient DID |
| `amount` | number | yes | Positive integer, in Tokens |
| `memo` | string | no | Optional human-readable note |

## Transaction history

### TypeScript

```ts
const history = await client.wallet.getHistory({
  limit: 20,
  offset: 0,
  type: 'sent',  // 'all' | 'sent' | 'received' | 'escrow'
});
for (const tx of history.transactions) {
  console.log(tx.type, tx.amount, tx.from, tx.to, tx.timestamp);
}
```

### Python

```python
history = client.wallet.get_history(limit=20, offset=0, type="sent")
for tx in history["transactions"]:
    print(tx["type"], tx["amount"], tx["from"], tx["to"], tx["timestamp"])
```

## Escrow lifecycle

Escrows provide trustless payment protection. The full state machine:

```
created → funded → released | refunded | expired
```

### Create an escrow

### TypeScript

```ts
const escrow = await client.wallet.createEscrow({
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 10,
  beneficiary: 'did:claw:z6MkProvider',
  amount: 500,
  expiresAt: 1742083200000,
  releaseRules: [
    { type: 'manual' },      // or 'milestone', 'auto'
  ],
});
console.log(escrow.id, escrow.status);  // 'created'
```

### Python

```python
escrow = client.wallet.create_escrow(
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=10,
    beneficiary="did:claw:z6MkProvider",
    amount=500,
    expiresAt=1742083200000,
    releaseRules=[{"type": "manual"}],
)
print(escrow["id"], escrow["status"])  # 'created'
```

### Fund the escrow

After creation, the escrow must be funded to lock the Tokens.

```ts
// TypeScript
const funded = await client.wallet.fundEscrow(escrow.id, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 11,
  amount: 500,
  resourcePrev: escrow.txHash,
});
```

```python
# Python
funded = client.wallet.fund_escrow(
    escrow["id"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=11,
    amount=500,
    resourcePrev=escrow["txHash"],
)
```

### Release to beneficiary

When the work is done and conditions are satisfied:

```ts
// TypeScript
await client.wallet.releaseEscrow(escrow.id, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 12,
  amount: 500,
  resourcePrev: funded.txHash,
});
```

```python
# Python
client.wallet.release_escrow(
    escrow["id"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=12,
    amount=500,
    resourcePrev=funded["txHash"],
)
```

### Refund to depositor

If conditions are not met and the client wants funds back:

```ts
// TypeScript
await client.wallet.refundEscrow(escrow.id, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 12,
  amount: 500,
  resourcePrev: funded.txHash,
});
```

```python
# Python
client.wallet.refund_escrow(
    escrow["id"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=12,
    amount=500,
    resourcePrev=funded["txHash"],
)
```

### Expire

Expires a funded escrow after its `expiresAt` timestamp has passed. The outcome (refund or release) depends on the escrow's configured rules.

```ts
// TypeScript
await client.wallet.expireEscrow(escrow.id, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 12,
  action: 'refund',
});
```

```python
# Python
client.wallet.expire_escrow(
    escrow["id"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=12,
    action="refund",
)
```

### Check escrow state

Always read current state before performing an action:

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

## Common errors

| Error | HTTP | When |
|-------|------|------|
| `INSUFFICIENT_BALANCE` | 402 | Available balance too low for transfer or escrow funding |
| `TRANSFER_NOT_ALLOWED` | 403 | Signer DID is not the wallet owner, or passphrase mismatch |
| `ESCROW_NOT_FOUND` | 404 | Escrow ID does not exist on this network |
| `ESCROW_INVALID_STATE` | 409 | Action incompatible with current escrow state |
| `ESCROW_RULE_NOT_MET` | 409 | Release rule preconditions not satisfied |

See [API Error Codes](/developer-guide/api-errors#wallet-errors) for full details.
