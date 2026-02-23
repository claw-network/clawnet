# Breaking Refactoring — RESTful 规范化

> **Status**: Active  
> **Scope**: Full stack — REST API, Service layer, SDK (TS + Python), CLI  
> **Backward Compatibility**: None — all-new interfaces, no `@deprecated`

---

## 1. Design Principles

| # | Principle | Detail |
|---|-----------|--------|
| 1 | **Resource-oriented URLs** | Nouns, not verbs. `/api/v1/contracts/:id` not `/api/contracts/:id/sign` |
| 2 | **Proper HTTP methods** | `DELETE` for removals, `PATCH` for partial updates |
| 3 | **Versioned prefix** | All routes under `/api/v1/` |
| 4 | **Uniform response envelope** | `{ data, meta?, links? }` for all 2xx responses |
| 5 | **RFC 7807 errors** | `{ type, title, status, detail, instance }` for all errors |
| 6 | **Offset pagination** | `?page=1&per_page=20`, response includes `meta.pagination` |
| 7 | **State-transition actions** | Non-CRUD ops use `POST /resource/:id/actions/:action` |
| 8 | **Currency unit: Token** | Always "Token", never "CLAW" |
| 9 | **0-dependency SDK** | SDK is pure REST client, no ethers.js |
| 10 | **Modular route files** | One file per resource domain |

---

## 2. New REST API Specification

### 2.1 Response Envelope

```jsonc
// Single resource
{ "data": { ... }, "links": { "self": "/api/v1/wallets/0x..." } }

// Collection
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "perPage": 20,
    "total": 42,
    "totalPages": 3
  },
  "links": {
    "self":  "/api/v1/contracts?page=1&per_page=20",
    "next":  "/api/v1/contracts?page=2&per_page=20",
    "prev":  null,
    "first": "/api/v1/contracts?page=1&per_page=20",
    "last":  "/api/v1/contracts?page=3&per_page=20"
  }
}

// Action result (write operations)
{
  "data": { "txHash": "0x...", "status": "released", ... },
  "links": { "self": "/api/v1/escrows/abc123" }
}
```

### 2.2 Error Format (RFC 7807)

```json
{
  "type": "https://clawnet.dev/errors/insufficient-balance",
  "title": "Insufficient Balance",
  "status": 400,
  "detail": "Account 0x... has 50 Tokens but transfer requires 100 Tokens",
  "instance": "/api/v1/transfers"
}
```

Standard error types:
- `validation-error` (400)
- `unauthorized` (401)
- `forbidden` (403)
- `not-found` (404)
- `conflict` (409) — e.g., escrow already released
- `unprocessable-entity` (422) — business logic violation
- `internal-error` (500)

### 2.3 Pagination

Query params: `page` (1-based, default 1), `per_page` (default 20, max 100)  
Sorting: `sort=field` (asc), `sort=-field` (desc)  
Filtering: domain-specific query params (e.g., `status=active`, `did=did:claw:...`)

---

## 3. Route Map

### 3.1 Node

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/node` | Node status + config |
| GET | `/api/v1/node/peers` | Connected peers |

### 3.2 Identities

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/identities` | Register DID |
| GET | `/api/v1/identities/self` | Own identity |
| GET | `/api/v1/identities/:did` | Resolve DID document |
| DELETE | `/api/v1/identities/:did` | Revoke DID |
| POST | `/api/v1/identities/:did/keys` | Rotate key |
| GET | `/api/v1/identities/:did/links` | List platform links |
| POST | `/api/v1/identities/:did/links` | Add platform link |
| GET | `/api/v1/identities/:did/capabilities` | List capabilities |
| POST | `/api/v1/identities/:did/capabilities` | Register capability |

### 3.3 Wallets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/wallets/:address` | Balance + info |
| GET | `/api/v1/wallets/:address/transactions` | Transaction history |

### 3.4 Transfers

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/transfers` | Transfer Tokens |

### 3.5 Escrows

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/escrows` | Create escrow |
| GET | `/api/v1/escrows` | List escrows |
| GET | `/api/v1/escrows/:id` | Get escrow |
| POST | `/api/v1/escrows/:id/actions/fund` | Fund escrow |
| POST | `/api/v1/escrows/:id/actions/release` | Release to beneficiary |
| POST | `/api/v1/escrows/:id/actions/refund` | Refund to depositor |
| POST | `/api/v1/escrows/:id/actions/expire` | Expire escrow |
| POST | `/api/v1/escrows/:id/actions/dispute` | Open dispute |
| POST | `/api/v1/escrows/:id/actions/resolve` | Resolve dispute |

### 3.6 Reputation

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/reputations/:did` | Reputation profile |
| GET | `/api/v1/reputations/:did/reviews` | List reviews |
| POST | `/api/v1/reputations/:did/reviews` | Record review |
| POST | `/api/v1/reputations/:did/anchor` | Anchor snapshot |

### 3.7 Service Contracts

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/contracts` | Create contract |
| GET | `/api/v1/contracts` | List contracts |
| GET | `/api/v1/contracts/:id` | Get contract |
| DELETE | `/api/v1/contracts/:id` | Cancel contract |
| POST | `/api/v1/contracts/:id/actions/sign` | Sign contract |
| POST | `/api/v1/contracts/:id/actions/activate` | Fund & activate |
| POST | `/api/v1/contracts/:id/actions/complete` | Mark complete |
| POST | `/api/v1/contracts/:id/actions/terminate` | Terminate |
| POST | `/api/v1/contracts/:id/actions/dispute` | Open dispute |
| POST | `/api/v1/contracts/:id/actions/resolve` | Resolve dispute |
| POST | `/api/v1/contracts/:id/actions/settle` | Execute settlement |
| GET | `/api/v1/contracts/:id/milestones` | List milestones |
| POST | `/api/v1/contracts/:id/milestones/:idx/actions/submit` | Submit milestone |
| POST | `/api/v1/contracts/:id/milestones/:idx/actions/approve` | Approve milestone |
| POST | `/api/v1/contracts/:id/milestones/:idx/actions/reject` | Reject milestone |

### 3.8 DAO

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/dao/proposals` | Create proposal |
| GET | `/api/v1/dao/proposals` | List proposals |
| GET | `/api/v1/dao/proposals/:id` | Get proposal |
| DELETE | `/api/v1/dao/proposals/:id` | Cancel proposal |
| POST | `/api/v1/dao/proposals/:id/actions/advance` | Advance lifecycle |
| POST | `/api/v1/dao/proposals/:id/actions/queue` | Queue for execution |
| POST | `/api/v1/dao/proposals/:id/actions/execute` | Execute |
| POST | `/api/v1/dao/proposals/:id/votes` | Cast vote |
| GET | `/api/v1/dao/proposals/:id/votes` | List votes |
| GET | `/api/v1/dao/treasury` | Treasury balance |
| POST | `/api/v1/dao/treasury/deposits` | Deposit to treasury |
| POST | `/api/v1/dao/delegations` | Set delegation |
| DELETE | `/api/v1/dao/delegations/:did` | Revoke delegation |
| GET | `/api/v1/dao/delegations/:did` | Get delegations |
| GET | `/api/v1/dao/timelock` | List timelock |
| POST | `/api/v1/dao/timelock/:id/actions/execute` | Execute timelock |
| DELETE | `/api/v1/dao/timelock/:id` | Cancel timelock |
| GET | `/api/v1/dao/params` | Governance params |

### 3.9 Markets — Info

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/markets/info` | Publish listing |
| GET | `/api/v1/markets/info` | List/search |
| GET | `/api/v1/markets/info/:id` | Get listing |
| DELETE | `/api/v1/markets/info/:id` | Remove listing |
| GET | `/api/v1/markets/info/:id/content` | Get content |
| POST | `/api/v1/markets/info/:id/actions/purchase` | Purchase |
| POST | `/api/v1/markets/info/:id/actions/subscribe` | Subscribe |
| DELETE | `/api/v1/markets/info/:id/subscription` | Cancel subscription |
| POST | `/api/v1/markets/info/:id/actions/deliver` | Deliver |
| POST | `/api/v1/markets/info/:id/actions/confirm` | Confirm delivery |
| POST | `/api/v1/markets/info/:id/reviews` | Write review |
| GET | `/api/v1/markets/info/orders/:oid/delivery` | Get delivery |

### 3.10 Markets — Tasks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/markets/tasks` | Publish task |
| GET | `/api/v1/markets/tasks` | List/search |
| GET | `/api/v1/markets/tasks/:id` | Get task |
| DELETE | `/api/v1/markets/tasks/:id` | Remove task |
| GET | `/api/v1/markets/tasks/:id/bids` | List bids |
| POST | `/api/v1/markets/tasks/:id/bids` | Submit bid |
| POST | `/api/v1/markets/tasks/:id/bids/:bid/actions/accept` | Accept bid |
| POST | `/api/v1/markets/tasks/:id/bids/:bid/actions/reject` | Reject bid |
| DELETE | `/api/v1/markets/tasks/:id/bids/:bid` | Withdraw bid |
| POST | `/api/v1/markets/tasks/:id/actions/deliver` | Deliver |
| POST | `/api/v1/markets/tasks/:id/actions/confirm` | Confirm |
| POST | `/api/v1/markets/tasks/:id/reviews` | Write review |

### 3.11 Markets — Capabilities

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/markets/capabilities` | Publish capability |
| GET | `/api/v1/markets/capabilities` | List/search |
| GET | `/api/v1/markets/capabilities/:id` | Get capability |
| DELETE | `/api/v1/markets/capabilities/:id` | Remove capability |
| POST | `/api/v1/markets/capabilities/:id/leases` | Start lease |
| GET | `/api/v1/markets/capabilities/leases/:lid` | Get lease |
| POST | `/api/v1/markets/capabilities/leases/:lid/actions/invoke` | Invoke |
| POST | `/api/v1/markets/capabilities/leases/:lid/actions/pause` | Pause |
| POST | `/api/v1/markets/capabilities/leases/:lid/actions/resume` | Resume |
| DELETE | `/api/v1/markets/capabilities/leases/:lid` | Terminate lease |

### 3.12 Markets — Disputes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/markets/orders/:oid/disputes` | Open dispute |
| POST | `/api/v1/markets/disputes/:id/actions/respond` | Respond to dispute |
| POST | `/api/v1/markets/disputes/:id/actions/resolve` | Resolve dispute |

### 3.13 Markets — Unified Search

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/markets/search` | Cross-market search |

### 3.14 Dev (development only)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/dev/faucet` | Mint test Tokens |

---

## 4. Architecture Changes

### 4.1 Server Decomposition

**Before**: Single 8000-line `server.ts` with giant if-else chain.  
**After**: Modular route files with a lightweight router.

```
packages/node/src/api/
├── server.ts              # ApiServer class (slim: router setup, start/stop)
├── router.ts              # Lightweight path-matching router
├── middleware.ts           # CORS, body parsing, error handling
├── response.ts            # ok(), created(), noContent(), paginated(), problem()
├── routes/
│   ├── node.ts
│   ├── identities.ts
│   ├── wallets.ts
│   ├── transfers.ts
│   ├── escrows.ts
│   ├── reputations.ts
│   ├── contracts.ts
│   ├── dao.ts
│   ├── markets-info.ts
│   ├── markets-tasks.ts
│   ├── markets-capabilities.ts
│   ├── markets-disputes.ts
│   ├── markets-search.ts
│   └── dev.ts
└── schemas/               # Zod schemas (extracted from server.ts)
    ├── common.ts
    ├── identity.ts
    ├── wallet.ts
    ├── contracts.ts
    ├── dao.ts
    └── markets.ts
```

### 4.2 Router Design

Simple trie/prefix-tree router supporting:
- Path params: `/api/v1/contracts/:id/milestones/:idx`
- Method matching: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`
- Middleware chain: `[cors, bodyParser, handler]`

### 4.3 Service Layer

No changes to service class signatures — they're already well-designed.  
The refactoring is purely at the HTTP routing & serialization layer.

### 4.4 Contracts (Solidity)

No ABI changes. The on-chain contracts are already RESTful-agnostic.  
Service layer continues to be the bridge.

---

## 5. SDK Changes

### TypeScript SDK

| Old Class | New Class | Key Changes |
|-----------|-----------|-------------|
| `WalletApi` | `WalletApi` | `getBalance(addr)` → `get(addr)`, path `/api/v1/wallets/:addr` |
| — | `TransferApi` | New class for `POST /api/v1/transfers` |
| — | `EscrowApi` | Extracted from WalletApi, actions use `/actions/:verb` |
| `IdentityApi` | `IdentityApi` | Pluralized paths, `resolve()` → `get()` |
| `ReputationApi` | `ReputationApi` | Path `/api/v1/reputations/:did` |
| `ContractsApi` | `ContractApi` | Actions use `/actions/:verb` pattern |
| `DaoApi` | `DaoApi` | Votes moved under proposals, delegation/timelock paths |
| `MarketsApi` | `MarketApi` | Sub-APIs with `/actions/:verb` pattern, DELETE for removals |

### Python SDK

Mirror TypeScript SDK 1:1 with `snake_case` methods.

---

## 6. CLI Changes

All commands stay the same structure — only the underlying REST paths change.  
The CLI is a consumer of the SDK, so SDK changes propagate automatically.

---

## 7. Migration Summary

| Layer | Files Changed | Effort |
|-------|---------------|--------|
| Route infrastructure | 4 new files | router, middleware, response, schemas |
| Route modules | 14 new files | One per resource domain |
| server.ts | Rewritten | Slim orchestrator |
| TS SDK | 8 files updated | Path changes + new classes |
| Python SDK | 8 files updated | Path changes |
| CLI | 1 file updated | SDK method name changes |
| OpenAPI | 1 file rewritten | Full spec |
| Tests | ~10 files updated | Path/assertion changes |
