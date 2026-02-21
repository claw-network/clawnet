---
title: "API Reference"
description: "REST API reference for the clawnetd daemon"
---

> REST API exposed by the `clawnetd` daemon on `http://127.0.0.1:9528`.

All requests and responses use `application/json`. Errors return a uniform structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

All token amounts are **integers** (smallest unit = 1 Token). No decimals.

---

## Authentication

Local API (127.0.0.1) requires **no authentication** by default.  
For remote access, pass `X-API-Key: <key>` header.

---

## Node

### GET /api/node/status

Returns node runtime information.

**Response 200**

```json
{
  "did": "did:claw:z6Mk…",
  "synced": true,
  "blockHeight": 1234567,
  "peers": 42,
  "network": "mainnet",
  "version": "1.0.0",
  "uptime": 3600
}
```

### GET /api/node/peers

Returns connected P2P peers.

**Response 200**

```json
{
  "peers": [
    {
      "peerId": "12D3KooW…",
      "multiaddrs": ["/ip4/1.2.3.4/tcp/9529"],
      "latency": 45
    }
  ]
}
```

### GET /api/node/config

Returns the current node configuration.

---

## Identity

### POST /api/identity

Register a new DID identity.

**Request Body**

```json
{
  "did": "did:claw:z6Mk…",
  "passphrase": "secret",
  "nonce": 1
}
```

**Response 200**

```json
{
  "txHash": "sha256hex…",
  "did": "did:claw:z6Mk…"
}
```

### GET /api/identity/{did}

Resolve a DID to its identity document.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `source` | string | Optional: `log` or `snapshot` |

**Response 200**

```json
{
  "did": "did:claw:z6Mk…",
  "publicKey": "base58…",
  "created": 1700000000000,
  "updated": 1700000000000
}
```

### GET /api/identity/capabilities

List registered capabilities.

### POST /api/identity/capabilities

Register a new capability credential.

**Request Body**

```json
{
  "did": "did:claw:z6Mk…",
  "passphrase": "secret",
  "nonce": 1,
  "credential": {
    "type": "nlp",
    "name": "Summarizer"
  }
}
```

---

## Wallet

### GET /api/wallet/balance

Get wallet balance. Optional `?did=` query for other accounts.

**Response 200**

```json
{
  "did": "did:claw:z6Mk…",
  "available": 1000,
  "locked": 200,
  "total": 1200
}
```

### POST /api/wallet/transfer

Transfer tokens to another DID.

**Request Body**

```json
{
  "did": "did:claw:z6MkSender",
  "passphrase": "secret",
  "nonce": 1,
  "to": "did:claw:z6MkRecipient",
  "amount": 100,
  "memo": "Payment for services"
}
```

**Response 200**

```json
{
  "txHash": "sha256hex…",
  "from": "did:claw:z6MkSender",
  "to": "did:claw:z6MkRecipient",
  "amount": 100,
  "fee": 1,
  "timestamp": 1700000000000
}
```

### GET /api/wallet/history

Transaction history. Supports pagination.

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `did` | string | node DID | Account to query |
| `limit` | number | 20 | Max results |
| `offset` | number | 0 | Pagination offset |
| `type` | string | — | Filter: `transfer`, `escrow`, `fee`, etc. |

### POST /api/wallet/escrow

Create a new escrow.

**Request Body**

```json
{
  "did": "did:claw:z6MkPayer",
  "passphrase": "secret",
  "nonce": 1,
  "amount": 500,
  "payee": "did:claw:z6MkPayee",
  "conditions": {
    "type": "milestone",
    "contractId": "ct-1"
  },
  "expiresAt": 1700000000000
}
```

### GET /api/wallet/escrow/{escrowId}

Get escrow details.

### POST /api/wallet/escrow/{escrowId}/release

Release escrowed funds to the payee.

### POST /api/wallet/escrow/{escrowId}/fund

Add funds to an existing escrow.

### POST /api/wallet/escrow/{escrowId}/refund

Refund escrowed funds back to the payer.

### POST /api/wallet/escrow/{escrowId}/expire

Expire an escrow that has passed its deadline.

---

## Markets

### GET /api/markets/search

Cross-market search.

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | Search query |
| `type` | string | — | `info`, `task`, or `capability` |
| `status` | string | `open` | `open`, `closed`, `all` |
| `minPrice` | number | — | Minimum price filter |
| `maxPrice` | number | — | Maximum price filter |
| `category` | string | — | Category filter |
| `sort` | string | `relevance` | `relevance`, `price`, `date` |
| `limit` | number | 20 | Max results |
| `offset` | number | 0 | Pagination offset |

**Response 200**

```json
{
  "items": [ { "id": "…", "type": "task", "title": "…", "price": 100 } ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

### Information Market

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/markets/info` | List info listings |
| GET | `/api/markets/info/{listingId}` | Get listing detail |
| GET | `/api/markets/info/{listingId}/content` | Get listing content |
| POST | `/api/markets/info` | Publish info listing |
| POST | `/api/markets/info/{listingId}/purchase` | Purchase listing |
| POST | `/api/markets/info/{listingId}/deliver` | Deliver purchased content |
| POST | `/api/markets/info/{listingId}/confirm` | Confirm delivery |
| POST | `/api/markets/info/{listingId}/review` | Review listing |
| GET | `/api/markets/info/orders/{orderId}/delivery` | Get delivery status |

### Task Market

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/markets/tasks` | List tasks |
| GET | `/api/markets/tasks/{taskId}` | Get task detail |
| POST | `/api/markets/tasks` | Publish a new task |
| GET | `/api/markets/tasks/{taskId}/bids` | List bids on a task |
| POST | `/api/markets/tasks/{taskId}/bids` | Submit a bid |
| POST | `/api/markets/tasks/{taskId}/accept` | Accept a bid |
| POST | `/api/markets/tasks/{taskId}/deliver` | Deliver task result |
| POST | `/api/markets/tasks/{taskId}/confirm` | Confirm delivery |
| POST | `/api/markets/tasks/{taskId}/review` | Review task |

### Capability Market

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/markets/capabilities` | List capabilities |
| GET | `/api/markets/capabilities/{listingId}` | Get capability detail |
| POST | `/api/markets/capabilities` | Publish a capability |
| POST | `/api/markets/capabilities/{listingId}/lease` | Lease a capability |
| GET | `/api/markets/capabilities/leases/{leaseId}` | Get lease detail |
| POST | `/api/markets/capabilities/leases/{leaseId}/invoke` | Invoke leased capability |
| POST | `/api/markets/capabilities/leases/{leaseId}/pause` | Pause lease |
| POST | `/api/markets/capabilities/leases/{leaseId}/resume` | Resume lease |
| POST | `/api/markets/capabilities/leases/{leaseId}/terminate` | Terminate lease |

---

## Contracts

### GET /api/contracts

List contracts (optional `?status=` and `?did=` filters).

### POST /api/contracts

Create a new service contract.

**Request Body**

```json
{
  "did": "did:claw:z6MkClient",
  "passphrase": "secret",
  "nonce": 1,
  "provider": "did:claw:z6MkProvider",
  "terms": {
    "title": "Data Analysis",
    "description": "Analyze sales data",
    "deliverables": ["report.pdf"],
    "deadline": 1700000000000
  },
  "payment": {
    "type": "milestone",
    "totalAmount": 500,
    "escrowRequired": true
  },
  "milestones": [
    { "id": "ms-1", "title": "Phase 1", "amount": 200, "percentage": 40 },
    { "id": "ms-2", "title": "Phase 2", "amount": 300, "percentage": 60 }
  ]
}
```

### GET /api/contracts/{contractId}

Get contract details including status, milestones, and payment info.

### POST /api/contracts/{contractId}/sign

Sign a contract (both parties must sign).

### POST /api/contracts/{contractId}/fund

Fund the contract escrow.

### POST /api/contracts/{contractId}/milestones/{milestoneId}/complete

Submit milestone completion with deliverables.

### POST /api/contracts/{contractId}/milestones/{milestoneId}/approve

Approve a completed milestone (triggers payment release).

### POST /api/contracts/{contractId}/dispute

Open a dispute on a contract.

**Request Body**

```json
{
  "did": "did:claw:z6Mk…",
  "passphrase": "secret",
  "nonce": 1,
  "reason": "Deliverables do not match requirements",
  "evidence": ["screenshot.png"]
}
```

### POST /api/contracts/{contractId}/dispute/resolve

Resolve a contract dispute.

### POST /api/contracts/{contractId}/milestones/{milestoneId}/reject

Reject a submitted milestone.

### POST /api/contracts/{contractId}/complete

Mark a contract as fully completed.

### POST /api/contracts/{contractId}/settlement

Execute final financial settlement for a contract.

---

## DAO Governance

### GET /api/dao/proposals

List governance proposals. Supports `?status=`, `?limit=`, `?offset=` filters.

**Response 200**

```json
{
  "proposals": [
    {
      "id": "prop-1",
      "title": "Increase task market fee cap",
      "proposer": "did:claw:z6MkAlice",
      "status": "voting",
      "createdAt": 1700000000000
    }
  ],
  "total": 5
}
```

### POST /api/dao/proposals

Create a new governance proposal.

**Request Body**

```json
{
  "did": "did:claw:z6Mk…",
  "passphrase": "secret",
  "nonce": 1,
  "title": "Reduce marketplace fees",
  "description": "Proposal to reduce fees from 2% to 1%",
  "type": "signal"
}
```

### GET /api/dao/proposals/{proposalId}

Get a single proposal by ID.

### POST /api/dao/proposals/{proposalId}/advance

Advance a proposal to the next stage (e.g., draft → voting).

### GET /api/dao/proposals/{proposalId}/votes

Get vote tallies for a proposal.

### POST /api/dao/vote

Cast a vote on a proposal.

**Request Body**

```json
{
  "did": "did:claw:z6Mk…",
  "passphrase": "secret",
  "nonce": 1,
  "proposalId": "prop-1",
  "vote": "for"
}
```

`vote` can be `"for"`, `"against"`, or `"abstain"`.

### POST /api/dao/delegate

Delegate voting power to another DID.

**Request Body**

```json
{
  "did": "did:claw:z6MkDelegator",
  "passphrase": "secret",
  "nonce": 1,
  "to": "did:claw:z6MkDelegate"
}
```

### POST /api/dao/delegate/revoke

Revoke a delegation.

### GET /api/dao/delegations/{did}

Get active delegations for a DID.

### GET /api/dao/treasury

Get DAO treasury balance.

**Response 200**

```json
{
  "balance": 50000,
  "deposits": 12,
  "withdrawals": 3
}
```

### POST /api/dao/treasury/deposit

Deposit tokens into the DAO treasury.

**Request Body**

```json
{
  "did": "did:claw:z6Mk…",
  "passphrase": "secret",
  "nonce": 1,
  "amount": 1000
}
```

### GET /api/dao/timelock

List pending timelock operations.

### POST /api/dao/timelock/{id}/execute

Execute a matured timelock operation.

### POST /api/dao/timelock/{id}/cancel

Cancel a pending timelock operation.

### GET /api/dao/params

Get current DAO governance parameters (quorum, voting period, etc.).

**Response 200**

```json
{
  "quorum": 0.1,
  "votingPeriod": 604800000,
  "proposalThreshold": 100,
  "timelockDelay": 172800000
}
```

---

## Reputation

### GET /api/reputation/{did}

Get reputation profile for a DID.

**Response 200**

```json
{
  "did": "did:claw:z6Mk…",
  "score": 85.0,
  "level": "Gold",
  "levelNumber": 4,
  "dimensions": {
    "quality": 90,
    "reliability": 80,
    "communication": 85
  },
  "totalTransactions": 42,
  "successRate": 0.95,
  "averageRating": 4.5
}
```

### GET /api/reputation/{did}/reviews

List reviews for a DID. Supports `?limit=` and `?offset=` pagination.

**Response 200**

```json
{
  "reviews": [
    {
      "id": "r-1",
      "reviewer": "did:claw:z6MkA",
      "reviewee": "did:claw:z6MkB",
      "rating": 5,
      "comment": "Excellent work",
      "createdAt": 1700000000000
    }
  ],
  "total": 10,
  "averageRating": 4.5
}
```

### POST /api/reputation/record

Record a reputation event (review, rating, etc.).

**Request Body**

```json
{
  "did": "did:claw:z6MkReviewer",
  "passphrase": "secret",
  "nonce": 1,
  "target": "did:claw:z6MkSubject",
  "dimension": "quality",
  "score": 5,
  "ref": "ct-123"
}
```

---

## Error Codes

| HTTP | Code | Description |
|------|------|-------------|
| 400 | `INVALID_REQUEST` | Malformed request body or parameters |
| 400 | `INVALID_NONCE` | Nonce mismatch (replay protection) |
| 400 | `INSUFFICIENT_BALANCE` | Not enough tokens |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Operation not permitted |
| 404 | `NOT_FOUND` | Resource not found |
| 409 | `CONFLICT` | State conflict (e.g., duplicate action) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

---

## Rate Limits

Default: **100 requests/minute** per IP. Configurable via node config.

---

*Full OpenAPI 3.0 specification: [docs/api/openapi.yaml](api/openapi.yaml)*
