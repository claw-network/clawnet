# ClawNet API Route Catalog (Running Server)

> **⚠ Version Mismatch Warning**
>
> The **running** Docker containers (`packages/node/dist/api/server.js`) use the **`/api/`** prefix.
> The **source code** (`packages/node/src/api/`) has been refactored to use **`/api/v1/`** prefix with a new envelope response format — but this is NOT what the Docker containers serve.
>
> This document describes the **actually running** API as of the current `dist/` build.

## General Conventions

| Item          | Detail                                                                                 |
| ------------- | -------------------------------------------------------------------------------------- |
| Base URL      | `http://localhost:9600/api/` (alice node; bob=9601, charlie=9602, dave=9603, eve=9604) |
| Port mapping  | Host port → container port 9528                                                        |
| Content-Type  | `application/json; charset=utf-8`                                                      |
| Max body size | 1 MB                                                                                   |
| Auth model    | **No header auth.** POST endpoints require `{ did, passphrase }` in the JSON body.     |
| Currency unit | **Token** (never "CLAW")                                                               |

### Response Patterns

**Success** — `sendJson(res, statusCode, rawObject)` — returns the raw JSON object directly, **NO envelope wrapper**.

**Error** — `sendError(res, statusCode, code, message)`:

```json
{ "error": { "code": "ERROR_CODE", "message": "human-readable message" } }
```

**Pagination** (collections) — inline in the response body:

```json
{
  "items": [ ... ],
  "total": 42,
  "pagination": { "limit": 20, "offset": 0, "hasMore": true }
}
```

### Common POST Body Fields

All mutation endpoints share these base fields:

| Field        | Type    | Required | Description                                      |
| ------------ | ------- | -------- | ------------------------------------------------ |
| `did`        | string  | ✅       | Caller's DID (`did:claw:...`)                    |
| `passphrase` | string  | ✅       | Passphrase to decrypt the caller's private key   |
| `nonce`      | integer | ✅       | Monotonically increasing nonce                   |
| `prev`       | string  | ❌       | Hash of the caller's previous event (hash chain) |
| `ts`         | number  | ❌       | Timestamp override (defaults to `Date.now()`)    |

---

## 1. Node

### `GET /api/node/status`

Returns node identity and runtime info.

**Response:**

```json
{
  "did": "did:claw:z...",
  "publicKey": "z...",
  "version": "0.x.x",
  "uptime": 12345,
  "eventCount": 100,
  "peerCount": 4,
  "capabilities": ["identity", "wallet", "reputation", "contracts", "market", "dao"]
}
```

### `GET /api/node/peers`

**Response:**

```json
{
  "peers": [{ "peerId": "...", "addrs": ["/ip4/..."], "did": "did:claw:z..." }]
}
```

### `GET /api/node/config`

**Response** (sanitized — no secrets):

```json
{
  "host": "0.0.0.0",
  "port": 9528,
  "p2pPort": 9527,
  "dataDir": "/data/.clawnet",
  "network": "testnet"
}
```

---

## 2. Identity

### `GET /api/identity`

Returns the **local** node's own identity.

**Response:**

```json
{
  "did": "did:claw:z...",
  "publicKey": "z...",
  "created": 1700000000000,
  "updated": 1700000001000,
  "platformLinks": [],
  "capabilities": []
}
```

### `GET /api/identity/:did`

Resolve any identity by DID (scans event log).

**Response:** Same shape as above, or `404 { error: { code: "NOT_FOUND", message: "..." } }`.

### `GET /api/identity/capabilities`

Returns capabilities for the local identity (or query param `?did=`).

**Response:**

```json
{
  "did": "did:claw:z...",
  "capabilities": [
    {
      "id": "cap-...",
      "name": "text-generation",
      "description": "...",
      "pricing": { "type": "fixed", "fixedPrice": "100" },
      "verified": false,
      "registeredAt": 1700000000000
    }
  ]
}
```

### `POST /api/identity/capabilities`

Register a new capability via a signed Verifiable Credential.

**Request body** (CapabilityRegisterSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `credential` | object | ✅ — VC with capability claims |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "abc123...", "capability": { "id": "...", "name": "...", ... } }
```

---

## 3. Reputation

### `GET /api/reputation/:did`

Query param: `?source=store|log` (default: both, `store` uses the reputation store, `log` replays event log).

**Response:**

```json
{
  "did": "did:claw:z...",
  "score": 850,
  "level": { "label": "Expert", "levelNumber": 5 },
  "totalReviews": 12,
  "averageRating": 4.5,
  "dimensions": { "quality": 900, "reliability": 800, ... },
  "completedContracts": 0,
  "disputeRatio": 0,
  "memberSince": 1700000000000,
  "lastActive": 1700000001000
}
```

### `GET /api/reputation/:did/reviews`

**Response:**

```json
{
  "did": "did:claw:z...",
  "reviews": [
    {
      "reviewer": "did:claw:z...",
      "dimension": "quality",
      "score": 900,
      "rating": 5,
      "comment": "Excellent",
      "ref": "contract-id",
      "timestamp": 1700000000000
    }
  ]
}
```

### `POST /api/reputation/record`

Submit a reputation review for another DID.

**Request body** (ReputationRecordSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `target` | string | ✅ — DID being reviewed |
| `dimension` | string | ✅ — e.g. `"quality"`, `"reliability"` |
| `score` | number\|string | ✅ — 0–1000 |
| `ref` | string | ✅ — Reference (e.g. contract ID) |
| `comment` | string | ❌ |
| `aspects` | Record<string, number\|string> | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "target": "did:claw:z...", "dimension": "quality", "status": "recorded" }
```

---

## 4. Wallet

### `GET /api/wallet/balance`

Query params: `?did=did:claw:z...` **or** `?address=...` (one required).

**Response:**

```json
{
  "address": "abc123...",
  "balance": 1000,
  "escrowLocked": 200,
  "available": 800,
  "stakingBalance": 0,
  "pendingRewards": 0
}
```

### `GET /api/wallet/history`

Query params: `?did=` or `?address=` (required), `&type=all|sent|received|escrow`, `&limit=50`, `&offset=0`.

**Response:**

```json
{
  "address": "...",
  "transactions": [
    {
      "txHash": "...",
      "type": "transfer",
      "from": "...",
      "to": "...",
      "amount": 100,
      "status": "confirmed",
      "memo": "payment",
      "timestamp": 1700000000000
    }
  ],
  "total": 5,
  "pagination": { "limit": 50, "offset": 0, "hasMore": false }
}
```

Transaction `type` values: `transfer`, `escrow_lock`, `escrow_release`.

### `POST /api/wallet/transfer`

**Request body** (WalletTransferSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `to` | string | ✅ — Recipient DID or address |
| `amount` | number\|string | ✅ — Integer Token amount |
| `fee` | number\|string | ❌ |
| `memo` | string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "from": "...", "to": "...", "amount": "100", "status": "broadcast" }
```

---

## 5. Escrow

### `POST /api/wallet/escrow`

Create an escrow. Optionally auto-funds in the same call.

**Request body** (WalletEscrowCreateSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `escrowId` | string | ❌ — Auto-generated UUID if omitted |
| `beneficiary` | string | ✅ — Beneficiary DID or address |
| `amount` | number\|string | ✅ |
| `releaseRules` | object[] | ✅ — At least 1 rule |
| `arbiter` | string | ❌ |
| `refundRules` | object[] | ❌ |
| `expiresAt` | number | ❌ — Epoch ms |
| `autoFund` | boolean | ❌ — If `true`, funds immediately |
| `nonce` | integer | ✅ |

**Response (201):**

```json
{
  "escrowId": "uuid",
  "depositor": "...",
  "beneficiary": "...",
  "amount": "1000",
  "status": "pending",
  "createTxHash": "...",
  "fundTxHash": "..."
}
```

(`fundTxHash` present only when `autoFund: true`; status is `"funded"` in that case.)

### `GET /api/wallet/escrow/:id`

**Response (200):**

```json
{
  "escrowId": "...",
  "depositor": "...",
  "beneficiary": "...",
  "amount": 1000,
  "released": 0,
  "remaining": 1000,
  "status": "active",
  "releaseConditions": [ { ... } ],
  "createdAt": 1700000000000,
  "expiresAt": 1700100000000,
  "expired": false
}
```

### `POST /api/wallet/escrow/:id/fund`

**Request body** (WalletEscrowActionSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `amount` | number\|string | ✅ |
| `resourcePrev` | string | ✅ — Previous event hash for this escrow |
| `ruleId` | string | ❌ |
| `reason` | string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "escrowId": "...", "amount": "500", "status": "broadcast" }
```

### `POST /api/wallet/escrow/:id/release`

Same request body as `/fund`. Releases funds to beneficiary.

**Response (200):**

```json
{ "txHash": "...", "escrowId": "...", "amount": "500", "status": "broadcast" }
```

### `POST /api/wallet/escrow/:id/refund`

Same request body as `/fund`. Refunds funds to depositor.

**Response (200):**

```json
{ "txHash": "...", "escrowId": "...", "amount": "500", "status": "broadcast" }
```

### `POST /api/wallet/escrow/:id/expire`

**Request body** (WalletEscrowExpireSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `action` | `"refund"` \| `"release"` | ❌ — Default: refund |
| `ruleId` | string | ❌ |
| `reason` | string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "escrowId": "...", "action": "refund", "status": "broadcast" }
```

---

## 6. Service Contracts

### `GET /api/contracts`

Query params: `?role=all|client|provider`, `?status=...`, `?limit=20`, `?offset=0`.

**Response:**

```json
{
  "items": [
    {
      "id": "...",
      "client": "did:claw:z...",
      "provider": "did:claw:z...",
      "status": "active",
      "signedAt": 1700000000000,
      "parties": { ... },
      "terms": { ... },
      "milestones": [ ... ]
    }
  ],
  "total": 5,
  "pagination": { "limit": 20, "offset": 0, "hasMore": false }
}
```

### `POST /api/contracts`

**Request body** (ContractCreateSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ — Client DID |
| `passphrase` | string | ✅ |
| `contractId` | string | ❌ — Auto UUID |
| `provider` | string | ✅ — Provider DID |
| `parties` | object | ❌ |
| `service` | object | ❌ |
| `terms` | object | ✅ |
| `payment` | object | ❌ |
| `timeline` | object | ❌ |
| `milestones` | object[] | ❌ |
| `attachments` | object[] | ❌ |
| `metadata` | object | ❌ |
| `nonce` | integer | ✅ |

**Response (201):**

```json
{
  "contractId": "...",
  "txHash": "...",
  "status": "draft",
  "client": "did:claw:z...",
  "provider": "did:claw:z..."
}
```

### `GET /api/contracts/:id`

**Response (200):** Full contract object with `parties`, `service`, `terms`, `payment`, `milestones`, `signatures`, `status`, `escrow`, plus computed `client`, `provider`, `signedAt`.

### `POST /api/contracts/:id/sign`

**Request body** (ContractSignSchema): `{ did, passphrase, nonce }`

**Response (200):**

```json
{ "txHash": "...", "contractId": "...", "signer": "did:claw:z...", "status": "draft|active" }
```

Status becomes `"active"` once both parties sign.

### `POST /api/contracts/:id/fund`

**Request body** (ContractFundSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `escrowId` | string | ❌ |
| `amount` | number\|string | ✅ |
| `releaseRules` | object[] | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{
  "contractId": "...",
  "escrowId": "...",
  "amount": "10000",
  "status": "funded",
  "createTxHash": "...",
  "fundTxHash": "..."
}
```

### `POST /api/contracts/:id/milestones/:mid/complete`

Submit milestone deliverables (provider).

**Request body** (ContractMilestoneSubmitSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `submissionId` | string | ❌ |
| `deliverables` | object[] | ❌ |
| `notes` | string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "contractId": "...", "milestoneId": "...", "status": "submitted" }
```

### `POST /api/contracts/:id/milestones/:mid/approve`

Client approves milestone. Triggers escrow release for milestone amount.

**Request body** (ContractMilestoneReviewSchema): `{ did, passphrase, notes?, rating?, feedback?, nonce }`

**Response (200):**

```json
{
  "txHash": "...",
  "contractId": "...",
  "milestoneId": "...",
  "status": "approved",
  "paymentTxHash": "...",
  "paymentAmount": "5000"
}
```

(`paymentTxHash` + `paymentAmount` only if escrow release succeeds.)

### `POST /api/contracts/:id/milestones/:mid/reject`

**Request body** (ContractMilestoneReviewSchema): `{ did, passphrase, notes?, feedback?, nonce }`

**Response (200):**

```json
{ "txHash": "...", "contractId": "...", "milestoneId": "...", "status": "rejected" }
```

### `POST /api/contracts/:id/complete`

Mark contract as completed (client).

**Request body** (ContractCompleteSchema): `{ did, passphrase, nonce }`

**Response (200):**

```json
{ "txHash": "...", "contractId": "...", "status": "completed" }
```

### `POST /api/contracts/:id/dispute`

Open a dispute on the contract.

**Request body** (ContractDisputeSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `reason` | string | ✅ |
| `description` | string | ❌ |
| `evidence` | object[] | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "contractId": "...", "status": "disputed" }
```

### `POST /api/contracts/:id/dispute/resolve`

**Request body** (ContractDisputeResolveSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `resolution` | string | ✅ |
| `notes` | string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "contractId": "...", "status": "resolved" }
```

### `POST /api/contracts/:id/settlement`

Execute a settlement (e.g. partial payment after dispute).

**Request body** (ContractSettlementSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `settlement` | object | ✅ — Settlement terms |
| `notes` | string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "contractId": "...", "status": "settled" }
```

---

## 7. Markets — Cross-Market Search

### `GET /api/markets/search`

Query params (all optional):
| Param | Type | Description |
|---|---|---|
| `keyword` | string | Full-text search |
| `markets` | csv | `info`, `task`, `capability` |
| `category` | string | Category filter |
| `tags` | csv | Tag filter |
| `skills` | csv | Required skills |
| `taskTypes` | csv | `one_time`, `recurring`, etc. |
| `infoTypes` | csv | `dataset`, `report`, etc. |
| `contentFormats` | csv | `json`, `csv`, etc. |
| `accessMethods` | csv | `api`, `download`, etc. |
| `capabilityType` | string | `ai_model`, `compute`, etc. |
| `statuses` | csv | `active`, `expired`, etc. |
| `visibility` | csv | `public`, `private`, etc. |
| `minPrice` | string | Min price in Tokens |
| `maxPrice` | string | Max price in Tokens |
| `minReputation` | number | Min reputation score |
| `minRating` | number | Min rating |
| `sort` | string | Sort field |
| `page` | int | Page number (default 1) |
| `pageSize` | int | Items per page (default 20, max 1000) |
| `includeFacets` | boolean | Include facet counts |

**Response:**

```json
{
  "results": [ { "listing": { ... }, "market": "info|task|capability", "score": 1.0 } ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "facets": { ... }
}
```

---

## 8. Markets — Disputes

### `POST /api/markets/orders/:id/dispute`

Open a dispute on a market order.

**Request body** (DisputeOpenSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `disputeId` | string | ❌ |
| `type` | string | ✅ — e.g. `"quality"`, `"non_delivery"` |
| `description` | string | ✅ |
| `claimAmount` | number\|string | ❌ |
| `nonce` | integer | ✅ |

**Response (201):**

```json
{ "txHash": "...", "disputeId": "...", "orderId": "...", "status": "open" }
```

### `POST /api/markets/disputes/:id/respond`

**Request body** (DisputeResponseSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `response` | string | ✅ |
| `evidence` | object[] | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "disputeId": "...", "status": "responded" }
```

### `POST /api/markets/disputes/:id/resolve`

**Request body** (DisputeResolveSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `resolution` | string | ✅ |
| `notes` | string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "disputeId": "...", "status": "resolved" }
```

---

## 9. Markets — Info (Data/Knowledge)

### `GET /api/markets/info`

Search/list info listings. Accepts same query params as cross-market search (subset: `keyword`, `category`, `tags`, `infoTypes`, `contentFormats`, `accessMethods`, `statuses`, `visibility`, `minPrice`, `maxPrice`, `minReputation`, `minRating`, `sort`, `page`, `pageSize`, `includeFacets`).

**Response:**

```json
{
  "results": [ { "listing": { ... }, "market": "info", "score": 1.0 } ],
  "total": 10,
  "page": 1,
  "pageSize": 20,
  "facets": { ... }
}
```

### `POST /api/markets/info`

Publish an info listing.

**Request body** (InfoPublishSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `listingId` | string | ❌ |
| `title` | string | ✅ |
| `description` | string | ✅ |
| `category` | string | ✅ |
| `tags` | string[] | ❌ |
| `pricing` | object | ✅ |
| `visibility` | string | ❌ |
| `infoType` | string | ✅ |
| `content` | object | ✅ — Content descriptor |
| `accessMethod` | object | ✅ |
| `license` | object | ✅ |
| `quality` | object | ❌ |
| `restrictions` | object | ❌ |
| `metadata` | object | ❌ |
| `expiresAt` | number | ❌ |
| `contentKeyHex` | string | ❌ — Encryption key |
| `nonce` | integer | ✅ |

**Response (201):**

```json
{ "txHash": "...", "listingId": "...", "status": "active" }
```

### `GET /api/markets/info/:id`

**Response (200):** Full listing object.

### `GET /api/markets/info/:id/content`

Returns decrypted/raw content for the listing.

**Response (200):** Content object structure varies by `infoType`.

### `POST /api/markets/info/:id/purchase`

**Request body** (InfoPurchaseSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `orderId` | string | ❌ |
| `escrowId` | string | ❌ |
| `quantity` | integer | ❌ — Default 1 |
| `unitPrice` | number\|string | ❌ |
| `releaseRules` | object[] | ❌ |
| `nonce` | integer | ✅ |

**Response (201):**

```json
{
  "txHash": "...",
  "orderId": "...",
  "listingId": "...",
  "escrowId": "...",
  "status": "pending_delivery"
}
```

### `POST /api/markets/info/:id/subscribe`

**Request body** (InfoSubscriptionSchema): `{ did, passphrase, subscriptionId?, nonce }`

**Response (201):**

```json
{ "txHash": "...", "subscriptionId": "...", "listingId": "...", "status": "active" }
```

### `POST /api/markets/info/subscriptions/:id/cancel`

**Request body** (InfoSubscriptionCancelSchema): `{ did, passphrase, nonce }`

**Response (200):**

```json
{ "txHash": "...", "subscriptionId": "...", "status": "cancelled" }
```

### `POST /api/markets/info/:id/deliver`

Seller delivers purchased info.

**Request body** (InfoDeliverSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `orderId` | string | ✅ |
| `deliveryId` | string | ❌ |
| `contentKeyHex` | string | ❌ — Encrypted content key |
| `buyerPublicKeyHex` | string | ❌ |
| `accessToken` | string | ❌ |
| `accessUrl` | string | ❌ |
| `expiresAt` | number | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{
  "txHash": "...",
  "orderId": "...",
  "deliveryId": "...",
  "status": "delivered"
}
```

### `GET /api/markets/info/orders/:orderId/delivery`

Retrieve delivery info for a purchased order.

**Response (200):**

```json
{
  "orderId": "...",
  "deliveryId": "...",
  "contentKeyHex": "...",
  "accessToken": "...",
  "accessUrl": "...",
  "expiresAt": 1700100000000,
  "deliveredAt": 1700000000000
}
```

### `POST /api/markets/info/:id/confirm`

Buyer confirms delivery and releases escrow.

**Request body** (InfoConfirmSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `orderId` | string | ✅ |
| `escrowId` | string | ❌ |
| `ruleId` | string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{
  "txHash": "...",
  "orderId": "...",
  "status": "completed",
  "escrowReleaseTxHash": "..."
}
```

### `POST /api/markets/info/:id/review`

**Request body** (InfoReviewSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `orderId` | string | ✅ |
| `rating` | number\|string | ✅ — 1–5 |
| `comment` | string | ❌ |
| `detailedRatings` | Record<string, number> | ❌ |
| `by` | `"buyer"` \| `"seller"` | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "orderId": "...", "status": "reviewed" }
```

### `POST /api/markets/info/:id/remove`

**Request body** (ListingRemoveSchema): `{ did, passphrase, nonce }`

**Response (200):**

```json
{ "txHash": "...", "listingId": "...", "status": "removed" }
```

---

## 10. Markets — Tasks

### `GET /api/markets/tasks`

Same search params as info market (with `taskTypes` and `skills` additions).

**Response:** Same paginated structure as info market search.

### `POST /api/markets/tasks`

Publish a task listing.

**Request body** (TaskPublishSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `listingId` | string | ❌ |
| `title` | string | ✅ |
| `description` | string | ✅ |
| `category` | string | ✅ |
| `tags` | string[] | ❌ |
| `pricing` | object | ✅ |
| `visibility` | string | ❌ |
| `taskType` | string | ✅ |
| `task` | object | ✅ — Task details |
| `timeline` | object | ✅ |
| `workerRequirements` | object | ❌ |
| `bidding` | object | ❌ |
| `milestones` | object[] | ❌ |
| `restrictions` | object | ❌ |
| `metadata` | object | ❌ |
| `expiresAt` | number | ❌ |
| `nonce` | integer | ✅ |

**Response (201):**

```json
{ "txHash": "...", "listingId": "...", "status": "active" }
```

### `GET /api/markets/tasks/:id`

**Response (200):** Full task listing object.

### `GET /api/markets/tasks/:id/bids`

**Response (200):**

```json
{
  "listingId": "...",
  "bids": [
    {
      "bidId": "...",
      "bidder": "did:claw:z...",
      "price": "500",
      "timeline": 86400000,
      "approach": "...",
      "status": "pending",
      "submittedAt": 1700000000000
    }
  ]
}
```

### `POST /api/markets/tasks/:id/bids`

Submit a bid on a task.

**Request body** (TaskBidSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `bidId` | string | ❌ |
| `price` | number\|string | ✅ |
| `timeline` | number | ✅ — Duration in ms |
| `approach` | string | ✅ |
| `milestones` | object[] | ❌ |
| `nonce` | integer | ✅ |

**Response (201):**

```json
{ "txHash": "...", "bidId": "...", "listingId": "...", "status": "submitted" }
```

### `POST /api/markets/tasks/:id/accept`

Accept a bid (creates order + escrow).

**Request body** (TaskAcceptSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `bidId` | string | ✅ |
| `orderId` | string | ❌ |
| `escrowId` | string | ❌ |
| `releaseRules` | object[] | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{
  "txHash": "...",
  "orderId": "...",
  "listingId": "...",
  "bidId": "...",
  "escrowId": "...",
  "status": "accepted"
}
```

### `POST /api/markets/tasks/:id/reject`

**Request body** (TaskBidActionSchema): `{ did, passphrase, bidId, nonce }`

**Response (200):**

```json
{ "txHash": "...", "bidId": "...", "listingId": "...", "status": "rejected" }
```

### `POST /api/markets/tasks/:id/withdraw`

Bidder withdraws their own bid.

**Request body** (TaskBidActionSchema): `{ did, passphrase, bidId, nonce }`

**Response (200):**

```json
{ "txHash": "...", "bidId": "...", "listingId": "...", "status": "withdrawn" }
```

### `POST /api/markets/tasks/:id/deliver`

Submit deliverables for an accepted task.

**Request body** (TaskDeliverSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `orderId` | string | ✅ |
| `submissionId` | string | ❌ |
| `deliverables` | object[] | ✅ |
| `notes` | string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "orderId": "...", "submissionId": "...", "status": "delivered" }
```

### `POST /api/markets/tasks/:id/confirm`

Review/approve a task delivery (releases escrow if approved).

**Request body** (TaskConfirmSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `orderId` | string | ✅ |
| `submissionId` | string | ✅ |
| `approved` | boolean | ✅ |
| `feedback` | string | ✅ |
| `rating` | number\|string | ❌ |
| `revisionDeadline` | number | ❌ |
| `escrowId` | string | ❌ |
| `ruleId` | string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{
  "txHash": "...",
  "orderId": "...",
  "submissionId": "...",
  "approved": true,
  "status": "completed",
  "escrowReleaseTxHash": "..."
}
```

### `POST /api/markets/tasks/:id/review`

Post-completion review.

**Request body** (TaskReviewSchema): Same as InfoReviewSchema.

**Response (200):**

```json
{ "txHash": "...", "orderId": "...", "status": "reviewed" }
```

### `POST /api/markets/tasks/:id/remove`

**Request body** (ListingRemoveSchema): `{ did, passphrase, nonce }`

**Response (200):**

```json
{ "txHash": "...", "listingId": "...", "status": "removed" }
```

---

## 11. Markets — Capabilities

### `GET /api/markets/capabilities`

Same search params (with `capabilityType` addition).

**Response:** Same paginated structure.

### `POST /api/markets/capabilities`

Publish a capability listing.

**Request body** (CapabilityPublishSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `listingId` | string | ❌ |
| `title` | string | ✅ |
| `description` | string | ✅ |
| `category` | string | ✅ |
| `tags` | string[] | ❌ |
| `pricing` | object | ✅ |
| `visibility` | string | ❌ |
| `capabilityType` | string | ✅ |
| `capability` | object | ✅ |
| `performance` | object | ❌ |
| `quota` | object | ✅ |
| `access` | object | ✅ |
| `sla` | object | ❌ |
| `restrictions` | object | ❌ |
| `metadata` | object | ❌ |
| `expiresAt` | number | ❌ |
| `nonce` | integer | ✅ |

**Response (201):**

```json
{ "txHash": "...", "listingId": "...", "status": "active" }
```

### `GET /api/markets/capabilities/:id`

**Response (200):** Full capability listing object.

### `POST /api/markets/capabilities/:id/lease`

Start a lease on a capability.

**Request body** (CapabilityLeaseSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `leaseId` | string | ❌ |
| `plan` | object | ✅ — Selected plan |
| `credentials` | object | ❌ |
| `metadata` | object | ❌ |
| `expiresAt` | number | ❌ |
| `nonce` | integer | ✅ |

**Response (201):**

```json
{
  "txHash": "...",
  "leaseId": "...",
  "listingId": "...",
  "escrowId": "...",
  "status": "active"
}
```

### `POST /api/markets/capabilities/:id/remove`

**Request body** (ListingRemoveSchema): `{ did, passphrase, nonce }`

**Response (200):**

```json
{ "txHash": "...", "listingId": "...", "status": "removed" }
```

### `GET /api/markets/capabilities/leases/:id`

**Response (200):**

```json
{
  "leaseId": "...",
  "listingId": "...",
  "lessee": "did:claw:z...",
  "provider": "did:claw:z...",
  "status": "active",
  "plan": { ... },
  "startedAt": 1700000000000,
  "expiresAt": 1700100000000,
  "usage": {
    "totalCalls": 50,
    "successfulCalls": 48,
    "failedCalls": 2,
    "totalUnits": 500,
    "averageLatency": 120,
    "p95Latency": 250,
    "totalCost": "5000"
  }
}
```

### `POST /api/markets/capabilities/leases/:id/invoke`

Record a usage/invocation event on a lease.

**Request body** (CapabilityInvokeSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `resource` | string | ✅ — Resource identifier |
| `units` | integer | ❌ — Default 1 |
| `latency` | number | ✅ — Response latency in ms |
| `success` | boolean | ✅ |
| `cost` | number\|string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{
  "txHash": "...",
  "leaseId": "...",
  "resource": "...",
  "units": 1,
  "cost": "100",
  "status": "recorded"
}
```

### `POST /api/markets/capabilities/leases/:id/pause`

**Request body** (CapabilityLeaseActionSchema): `{ did, passphrase, nonce }`

**Response (200):**

```json
{ "txHash": "...", "leaseId": "...", "status": "paused" }
```

### `POST /api/markets/capabilities/leases/:id/resume`

**Request body** (CapabilityLeaseActionSchema): `{ did, passphrase, nonce }`

**Response (200):**

```json
{ "txHash": "...", "leaseId": "...", "status": "active" }
```

### `POST /api/markets/capabilities/leases/:id/terminate`

**Request body** (CapabilityLeaseActionSchema): `{ did, passphrase, nonce }`

**Response (200):**

```json
{ "txHash": "...", "leaseId": "...", "status": "terminated" }
```

---

## 12. DAO Governance

### `GET /api/dao/proposals`

Query params: `?status=...`, `?type=...`, `?limit=20`, `?offset=0`.

**Response:**

```json
{
  "items": [
    {
      /* proposal objects */
    }
  ],
  "total": 5,
  "pagination": { "limit": 20, "offset": 0, "hasMore": false }
}
```

### `POST /api/dao/proposals`

Create a governance proposal.

**Request body** (DaoProposalCreateSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `proposalId` | string | ❌ |
| `type` | enum | ✅ — `parameter_change`, `treasury_spend`, `protocol_upgrade`, `emergency`, `signal` |
| `title` | string | ✅ |
| `description` | string | ✅ |
| `discussionUrl` | string | ❌ |
| `actions` | object[] | ✅ — At least 1 |
| `discussionPeriod` | number | ❌ |
| `votingPeriod` | number | ❌ |
| `timelockDelay` | number | ❌ |
| `nonce` | integer | ✅ |

**Response (201):**

```json
{ "txHash": "...", "proposalId": "...", "status": "discussion" }
```

### `GET /api/dao/proposals/:id`

**Response (200):** Full proposal object.

### `POST /api/dao/proposals/:id/advance`

Advance proposal to the next stage.

**Request body** (DaoProposalAdvanceSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `proposalId` | string | ✅ |
| `newStatus` | string | ✅ |
| `resourcePrev` | string | ✅ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "proposalId": "...", "newStatus": "voting", "status": "advanced" }
```

### `GET /api/dao/proposals/:id/votes`

**Response (200):**

```json
{
  "proposalId": "...",
  "votes": [
    {
      "voter": "did:claw:z...",
      "option": "for",
      "power": "1000",
      "reason": "...",
      "ts": 1700000000000
    }
  ],
  "summary": { "for": "3000", "against": "500", "abstain": "200" }
}
```

### `POST /api/dao/vote`

Cast a vote on a proposal.

**Request body** (DaoVoteCastSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `proposalId` | string | ✅ |
| `option` | enum | ✅ — `for`, `against`, `abstain` |
| `power` | number\|string | ✅ — Voting power (Token amount) |
| `reason` | string | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "proposalId": "...", "option": "for", "status": "broadcast" }
```

### `POST /api/dao/delegate`

Delegate voting power to another DID.

**Request body** (DaoDelegateSetSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `delegate` | string | ✅ — Delegate DID |
| `scope` | object | ❌ — `{ all?, proposalTypes?, topics? }` |
| `percentage` | number | ❌ — 0–100 (default 100) |
| `expiresAt` | number | ❌ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "delegate": "did:claw:z...", "status": "broadcast" }
```

### `POST /api/dao/delegate/revoke`

**Request body** (DaoDelegateRevokeSchema): `{ did, passphrase, delegate, nonce }`

**Response (200):**

```json
{ "txHash": "...", "delegate": "did:claw:z...", "status": "revoked" }
```

### `GET /api/dao/delegations/:did`

**Response (200):**

```json
{
  "did": "did:claw:z...",
  "delegatedFrom": [ ... ],
  "delegatedTo": [ ... ]
}
```

### `GET /api/dao/treasury`

**Response (200):**

```json
{ "treasury": { ... } }
```

### `POST /api/dao/treasury/deposit`

**Request body** (DaoTreasuryDepositSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `amount` | number\|string | ✅ |
| `source` | string | ✅ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "amount": "1000", "status": "broadcast" }
```

### `GET /api/dao/timelock`

**Response (200):**

```json
{ "entries": [ ... ] }
```

### `POST /api/dao/timelock/:id/execute`

**Request body** (DaoTimelockExecuteSchema): `{ did, passphrase, actionId, nonce }`

**Response (200):**

```json
{ "txHash": "...", "actionId": "...", "status": "executed" }
```

### `POST /api/dao/timelock/:id/cancel`

**Request body** (DaoTimelockCancelSchema):
| Field | Type | Required |
|---|---|---|
| `did` | string | ✅ |
| `passphrase` | string | ✅ |
| `actionId` | string | ✅ |
| `reason` | string | ✅ |
| `nonce` | integer | ✅ |

**Response (200):**

```json
{ "txHash": "...", "actionId": "...", "status": "cancelled" }
```

### `GET /api/dao/params`

**Response (200):**

```json
{
  "thresholds": {
    "parameter_change": { ... },
    "treasury_spend": { ... },
    "protocol_upgrade": { ... },
    "emergency": { ... },
    "signal": { ... }
  }
}
```

---

## 13. Dev / Testnet

### `POST /api/v1/dev/faucet`

**Dev/testnet-only route.**

**Authentication (required):**

- Header `X-API-Key: <CLAW_DEV_FAUCET_API_KEY>`
- Or header `Authorization: Bearer <CLAW_DEV_FAUCET_API_KEY>`

If `CLAW_DEV_FAUCET_API_KEY` is not configured, the faucet endpoint is disabled and returns `401`.

**Request body:**
| Field | Type | Required |
|---|---|---|
| `address` | string | ✅* — Recipient address |
| `did` | string | ✅* — Recipient DID |
| `amount` | integer | ❌ — Defaults to `CLAW_DEV_FAUCET_MAX_AMOUNT_PER_CLAIM` |

\* `address` or `did` must be provided.

**Policy guardrails (defaults):**

- `CLAW_DEV_FAUCET_MAX_AMOUNT_PER_CLAIM=50`
- `CLAW_DEV_FAUCET_COOLDOWN_HOURS=24`
- `CLAW_DEV_FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH=4`
- `CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY=3`

Exceeding policy limits returns `429 Too Many Requests` with `Retry-After`.

**Response (200):**

```json
{ "data": { "txHash": "0x...", "to": "0x...", "amount": 50, "status": "broadcast" } }
```

---

## Quick Reference — All 75 Routes

| #   | Method | Path                                             | Description                              |
| --- | ------ | ------------------------------------------------ | ---------------------------------------- |
| 1   | GET    | `/api/node/status`                               | Node status & identity                   |
| 2   | GET    | `/api/node/peers`                                | Connected peers                          |
| 3   | GET    | `/api/node/config`                               | Sanitized config                         |
| 4   | GET    | `/api/identity`                                  | Local identity                           |
| 5   | GET    | `/api/identity/:did`                             | Resolve DID                              |
| 6   | GET    | `/api/identity/capabilities`                     | List capabilities                        |
| 7   | POST   | `/api/identity/capabilities`                     | Register capability                      |
| 8   | GET    | `/api/reputation/:did`                           | Reputation profile                       |
| 9   | GET    | `/api/reputation/:did/reviews`                   | Reviews list                             |
| 10  | POST   | `/api/reputation/record`                         | Submit review                            |
| 11  | GET    | `/api/wallet/balance`                            | Wallet balance                           |
| 12  | GET    | `/api/wallet/history`                            | Transaction history                      |
| 13  | POST   | `/api/wallet/transfer`                           | Transfer Tokens                          |
| 14  | POST   | `/api/wallet/escrow`                             | Create escrow                            |
| 15  | GET    | `/api/wallet/escrow/:id`                         | Get escrow                               |
| 16  | POST   | `/api/wallet/escrow/:id/fund`                    | Fund escrow                              |
| 17  | POST   | `/api/wallet/escrow/:id/release`                 | Release escrow                           |
| 18  | POST   | `/api/wallet/escrow/:id/refund`                  | Refund escrow                            |
| 19  | POST   | `/api/wallet/escrow/:id/expire`                  | Expire escrow                            |
| 20  | GET    | `/api/contracts`                                 | List contracts                           |
| 21  | POST   | `/api/contracts`                                 | Create contract                          |
| 22  | GET    | `/api/contracts/:id`                             | Get contract                             |
| 23  | POST   | `/api/contracts/:id/sign`                        | Sign contract                            |
| 24  | POST   | `/api/contracts/:id/fund`                        | Fund contract                            |
| 25  | POST   | `/api/contracts/:id/complete`                    | Complete contract                        |
| 26  | POST   | `/api/contracts/:id/dispute`                     | Open dispute                             |
| 27  | POST   | `/api/contracts/:id/dispute/resolve`             | Resolve dispute                          |
| 28  | POST   | `/api/contracts/:id/settlement`                  | Execute settlement                       |
| 29  | POST   | `/api/contracts/:id/milestones/:mid/complete`    | Submit milestone                         |
| 30  | POST   | `/api/contracts/:id/milestones/:mid/approve`     | Approve milestone                        |
| 31  | POST   | `/api/contracts/:id/milestones/:mid/reject`      | Reject milestone                         |
| 32  | GET    | `/api/markets/search`                            | Cross-market search                      |
| 33  | POST   | `/api/markets/orders/:id/dispute`                | Open order dispute                       |
| 34  | POST   | `/api/markets/disputes/:id/respond`              | Respond to dispute                       |
| 35  | POST   | `/api/markets/disputes/:id/resolve`              | Resolve dispute                          |
| 36  | GET    | `/api/markets/info`                              | List info listings                       |
| 37  | POST   | `/api/markets/info`                              | Publish info listing                     |
| 38  | GET    | `/api/markets/info/:id`                          | Get info listing                         |
| 39  | GET    | `/api/markets/info/:id/content`                  | Get info content                         |
| 40  | GET    | `/api/markets/info/orders/:orderId/delivery`     | Get delivery info                        |
| 41  | POST   | `/api/markets/info/:id/purchase`                 | Purchase info                            |
| 42  | POST   | `/api/markets/info/:id/subscribe`                | Subscribe to info                        |
| 43  | POST   | `/api/markets/info/subscriptions/:id/cancel`     | Cancel subscription                      |
| 44  | POST   | `/api/markets/info/:id/deliver`                  | Deliver info                             |
| 45  | POST   | `/api/markets/info/:id/confirm`                  | Confirm delivery                         |
| 46  | POST   | `/api/markets/info/:id/review`                   | Review info order                        |
| 47  | POST   | `/api/markets/info/:id/remove`                   | Remove info listing                      |
| 48  | GET    | `/api/markets/tasks`                             | List task listings                       |
| 49  | POST   | `/api/markets/tasks`                             | Publish task                             |
| 50  | GET    | `/api/markets/tasks/:id`                         | Get task listing                         |
| 51  | GET    | `/api/markets/tasks/:id/bids`                    | List bids                                |
| 52  | POST   | `/api/markets/tasks/:id/bids`                    | Submit bid                               |
| 53  | POST   | `/api/markets/tasks/:id/accept`                  | Accept bid                               |
| 54  | POST   | `/api/markets/tasks/:id/reject`                  | Reject bid                               |
| 55  | POST   | `/api/markets/tasks/:id/withdraw`                | Withdraw bid                             |
| 56  | POST   | `/api/markets/tasks/:id/deliver`                 | Deliver task                             |
| 57  | POST   | `/api/markets/tasks/:id/confirm`                 | Confirm task delivery                    |
| 58  | POST   | `/api/markets/tasks/:id/review`                  | Review task order                        |
| 59  | POST   | `/api/markets/tasks/:id/remove`                  | Remove task listing                      |
| 60  | GET    | `/api/markets/capabilities`                      | List capabilities                        |
| 61  | POST   | `/api/markets/capabilities`                      | Publish capability                       |
| 62  | GET    | `/api/markets/capabilities/:id`                  | Get capability listing                   |
| 63  | POST   | `/api/markets/capabilities/:id/lease`            | Start lease                              |
| 64  | POST   | `/api/markets/capabilities/:id/remove`           | Remove capability                        |
| 65  | GET    | `/api/markets/capabilities/leases/:id`           | Get lease                                |
| 66  | POST   | `/api/markets/capabilities/leases/:id/invoke`    | Record invocation                        |
| 67  | POST   | `/api/markets/capabilities/leases/:id/pause`     | Pause lease                              |
| 68  | POST   | `/api/markets/capabilities/leases/:id/resume`    | Resume lease                             |
| 69  | POST   | `/api/markets/capabilities/leases/:id/terminate` | Terminate lease                          |
| 70  | GET    | `/api/dao/proposals`                             | List proposals                           |
| 71  | POST   | `/api/dao/proposals`                             | Create proposal                          |
| 72  | GET    | `/api/dao/proposals/:id`                         | Get proposal                             |
| 73  | POST   | `/api/dao/proposals/:id/advance`                 | Advance proposal                         |
| 74  | GET    | `/api/dao/proposals/:id/votes`                   | Get votes                                |
| 75  | POST   | `/api/dao/vote`                                  | Cast vote                                |
| 76  | POST   | `/api/dao/delegate`                              | Set delegation                           |
| 77  | POST   | `/api/dao/delegate/revoke`                       | Revoke delegation                        |
| 78  | GET    | `/api/dao/delegations/:did`                      | Get delegations                          |
| 79  | GET    | `/api/dao/treasury`                              | Get treasury                             |
| 80  | POST   | `/api/dao/treasury/deposit`                      | Deposit to treasury                      |
| 81  | GET    | `/api/dao/timelock`                              | List timelock entries                    |
| 82  | POST   | `/api/dao/timelock/:id/execute`                  | Execute timelock                         |
| 83  | POST   | `/api/dao/timelock/:id/cancel`                   | Cancel timelock                          |
| 84  | GET    | `/api/dao/params`                                | Get DAO params                           |
| 85  | POST   | `/api/v1/dev/faucet`                             | Dev faucet (API key + anti-abuse limits) |
