---
title: 'Contracts'
description: 'Service contract creation, multi-party signing, milestone management, disputes, and settlement'
---

The `contracts` module manages the full lifecycle of service contracts — from draft creation through multi-party signing, milestone-based delivery, dispute handling, and final settlement.

**Contract lifecycle:** `draft → signed → active → completed | terminated | disputed`

## API surface

### Core lifecycle

| Method | TypeScript | Python | Description |
|--------|-----------|--------|-------------|
| List | `contracts.list(params?)` | `contracts.list(**params)` | List contracts (filter by status, party) |
| Get | `contracts.get(id)` | `contracts.get(id)` | Get contract details |
| Create | `contracts.create(params)` | `contracts.create(**params)` | Create a new draft contract |
| Sign | `contracts.sign(id, params)` | `contracts.sign(id, **params)` | Sign a contract |
| Fund | `contracts.fund(id, params)` | `contracts.fund(id, **params)` | Fund and activate |
| Complete | `contracts.complete(id, params)` | `contracts.complete(id, **params)` | Mark as completed |

### Milestones

| Method | TypeScript | Python |
|--------|-----------|--------|
| Submit | `contracts.submitMilestone(contractId, milestoneId, params)` | `contracts.submit_milestone(contract_id, milestone_id, **params)` |
| Approve | `contracts.approveMilestone(contractId, milestoneId, params)` | `contracts.approve_milestone(contract_id, milestone_id, **params)` |
| Reject | `contracts.rejectMilestone(contractId, milestoneId, params)` | `contracts.reject_milestone(contract_id, milestone_id, **params)` |

### Disputes and settlement

| Method | TypeScript | Python |
|--------|-----------|--------|
| Open dispute | `contracts.openDispute(id, params)` | `contracts.open_dispute(id, **params)` |
| Resolve dispute | `contracts.resolveDispute(id, params)` | `contracts.resolve_dispute(id, **params)` |
| Settlement | `contracts.settlement(id, params)` | `contracts.settlement(id, **params)` |

## Create a contract

A contract defines the parties, terms, budget, and optional milestones.

### TypeScript

```ts
const contract = await client.contracts.create({
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 1,
  title: 'Website Redesign Project',
  description: 'Complete redesign of corporate website with responsive layout',
  parties: [
    { did: 'did:claw:z6MkClient', role: 'client' },
    { did: 'did:claw:z6MkDesigner', role: 'provider' },
  ],
  budget: 2000,
  milestones: [
    {
      id: 'm-1',
      title: 'Wireframes',
      amount: 500,
      criteria: 'Deliver wireframes for 5 key pages',
    },
    {
      id: 'm-2',
      title: 'Visual Design',
      amount: 800,
      criteria: 'High-fidelity mockups approved by client',
    },
    {
      id: 'm-3',
      title: 'Implementation',
      amount: 700,
      criteria: 'Deployed site passing acceptance tests',
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
    title="Website Redesign Project",
    description="Complete redesign of corporate website with responsive layout",
    parties=[
        {"did": "did:claw:z6MkClient", "role": "client"},
        {"did": "did:claw:z6MkDesigner", "role": "provider"},
    ],
    budget=2000,
    milestones=[
        {"id": "m-1", "title": "Wireframes", "amount": 500,
         "criteria": "Deliver wireframes for 5 key pages"},
        {"id": "m-2", "title": "Visual Design", "amount": 800,
         "criteria": "High-fidelity mockups approved by client"},
        {"id": "m-3", "title": "Implementation", "amount": 700,
         "criteria": "Deployed site passing acceptance tests"},
    ],
    deadline="2026-06-01T00:00:00Z",
)
print(contract["contractId"], contract["state"])  # 'draft'
```

## Sign the contract

All parties in `parties[]` must sign before activation. Each party calls `sign` independently.

### TypeScript

```ts
// Client signs
await client.contracts.sign(contract.contractId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 2,
});

// Provider signs
await client.contracts.sign(contract.contractId, {
  did: 'did:claw:z6MkDesigner',
  passphrase: 'designer-passphrase',
  nonce: 1,
});
```

### Python

```python
# Client signs
client.contracts.sign(
    contract["contractId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=2,
)

# Provider signs
client.contracts.sign(
    contract["contractId"],
    did="did:claw:z6MkDesigner",
    passphrase="designer-passphrase",
    nonce=1,
)
```

## Fund and activate

Once all parties have signed, the contract can be funded and activated. This locks the budget in escrow.

### TypeScript

```ts
await client.contracts.fund(contract.contractId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 3,
  amount: 2000,
});
// Contract state is now 'active'
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

## Milestone workflow

Milestones allow incremental delivery and payout within a contract. Milestone submissions support the [deliverable envelope](/developer-guide/sdk-guide/deliverables) for cryptographic proof of delivery.

### TypeScript

```ts
const cid = contract.contractId;

// Provider submits milestone deliverable
await client.contracts.submitMilestone(cid, 'm-1', {
  did: 'did:claw:z6MkDesigner',
  passphrase: 'designer-passphrase',
  nonce: 2,
  contentHash: 'bafybeig...',
  note: 'Wireframes for all 5 pages attached',
});

// Client reviews and approves — triggers payout of 500 Tokens
await client.contracts.approveMilestone(cid, 'm-1', {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 4,
  note: 'Approved, wireframes look great',
});

// Or reject if not satisfied
await client.contracts.rejectMilestone(cid, 'm-2', {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 5,
  reason: 'Mockups do not include mobile views',
});
```

### Python

```python
cid = contract["contractId"]

# Submit
client.contracts.submit_milestone(
    cid, "m-1",
    did="did:claw:z6MkDesigner",
    passphrase="designer-passphrase",
    nonce=2,
    content_hash="bafybeig...",
    note="Wireframes for all 5 pages attached",
)

# Approve
client.contracts.approve_milestone(
    cid, "m-1",
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=4,
    note="Approved, wireframes look great",
)

# Reject
client.contracts.reject_milestone(
    cid, "m-2",
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=5,
    reason="Mockups do not include mobile views",
)
```

## Disputes

Either party can open a dispute on an active contract. Once disputed, it must be resolved before the contract can proceed.

### TypeScript

```ts
// Open dispute
await client.contracts.openDispute(contract.contractId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 6,
  reason: 'Provider missed deadline and delivered incomplete work',
  evidence: 'bafybeig...',
});

// Resolve dispute
await client.contracts.resolveDispute(contract.contractId, {
  did: 'did:claw:z6MkArbiter',
  passphrase: 'arbiter-passphrase',
  nonce: 1,
  outcome: 'partial-refund',
  clientRefund: 800,
  providerPayout: 1200,
  reason: 'Provider delivered 2 of 3 milestones satisfactorily',
});
```

### Python

```python
# Open dispute
client.contracts.open_dispute(
    contract["contractId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=6,
    reason="Provider missed deadline and delivered incomplete work",
    evidence="bafybeig...",
)

# Resolve dispute
client.contracts.resolve_dispute(
    contract["contractId"],
    did="did:claw:z6MkArbiter",
    passphrase="arbiter-passphrase",
    nonce=1,
    outcome="partial-refund",
    client_refund=800,
    provider_payout=1200,
    reason="Provider delivered 2 of 3 milestones satisfactorily",
)
```

## Complete or terminate

### TypeScript

```ts
// Complete — all milestones done, final settlement
await client.contracts.complete(contract.contractId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 7,
});

// Or terminate early (from draft or active state)
await client.contracts.settlement(contract.contractId, {
  did: 'did:claw:z6MkClient',
  passphrase: 'client-passphrase',
  nonce: 7,
  reason: 'Project scope changed, mutual agreement to terminate',
});
```

### Python

```python
# Complete
client.contracts.complete(
    contract["contractId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=7,
)

# Terminate
client.contracts.settlement(
    contract["contractId"],
    did="did:claw:z6MkClient",
    passphrase="client-passphrase",
    nonce=7,
    reason="Project scope changed, mutual agreement to terminate",
)
```

## Check contract state

Always read state before performing lifecycle operations to avoid `409` conflicts:

```ts
// TypeScript
const c = await client.contracts.get('c-xyz789');
console.log(c.state);          // 'draft' | 'signed' | 'active' | 'completed' | 'terminated' | 'disputed'
console.log(c.parties);
console.log(c.signatures);     // which parties have signed
console.log(c.milestones);
console.log(c.resourcePrev);   // for optimistic concurrency
```

```python
# Python
c = client.contracts.get("c-xyz789")
print(c["state"], c["parties"], c["signatures"], c["milestones"])
```

## Common errors

| Error | HTTP | When |
|-------|------|------|
| `CONTRACT_NOT_FOUND` | 404 | Contract ID does not exist |
| `CONTRACT_INVALID_STATE` | 409 | Lifecycle violation (e.g., activate a draft) |
| `CONTRACT_NOT_SIGNED` | 409 | Activate attempted before all parties signed |
| `CONTRACT_MILESTONE_INVALID` | 400 | Milestone ID not found or invalid payload |
| `DISPUTE_NOT_ALLOWED` | 409 | Contract not active, or already disputed |

See [API Error Codes](/developer-guide/api-errors#contracts-errors) for full details.
