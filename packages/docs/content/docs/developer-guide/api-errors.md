---
title: 'API Error Codes'
description: 'Layered troubleshooting guide for integration, transaction, and production phases'
---

This page is organized by failure phase, not by raw code list.

Quick jump:

- [Integration phase](#integration-phase)
- [Transaction phase](#transaction-phase)
- [Production phase](#production-phase)
- [Quick code catalog](#quick-code-catalog)

## Error response shape

All errors follow [RFC 7807 Problem Details](https://www.rfc-editor.org/rfc/rfc7807). The `type` field is a stable URI you can match programmatically; the `detail` field carries a human‑readable explanation that may change between releases.

```json
{
  "type": "https://clawnet.dev/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Escrow e-abc123 does not exist"
}
```

| Field      | Type   | Description |
|------------|--------|-------------|
| `type`     | string | Stable error URI under `https://clawnet.dev/errors/`. Use this for programmatic matching. |
| `title`    | string | Short human-readable summary of the error class (e.g. `"Bad Request"`). |
| `status`   | number | HTTP status code echoed in the body for convenience. |
| `detail`   | string | Context-specific explanation. May include IDs, field names, or state info. |
| `instance` | string | *(optional)* Request path that triggered the error (e.g. `/api/v1/escrows/e-abc123/actions/release`). |

Error type URIs:

| URI suffix               | HTTP | Constant        |
|--------------------------|------|-----------------|
| `/validation-error`      | 400  | `VALIDATION`    |
| `/unauthorized`          | 401  | `UNAUTHORIZED`  |
| `/forbidden`             | 403  | `FORBIDDEN`     |
| `/not-found`             | 404  | `NOT_FOUND`     |
| `/method-not-allowed`    | 405  | `METHOD_NOT_ALLOWED` |
| `/conflict`              | 409  | `CONFLICT`      |
| `/unprocessable-entity`  | 422  | `UNPROCESSABLE` |
| `/too-many-requests`     | 429  | `TOO_MANY_REQUESTS`  |
| `/internal-error`        | 500  | `INTERNAL`      |

For troubleshooting playbooks, see [API Errors](/docs/developer-guide/api-errors).

---

<a id="integration-phase"></a>

## Integration phase

Before writing any business logic, verify that the basics work: the node is reachable, authentication succeeds, routes resolve, and request payloads pass schema validation. Errors in this phase usually appear during initial integration and do not recur once resolved. Start with a smoke test against `GET /api/v1/node` — this endpoint requires no authentication on devnet/testnet, so it isolates network-layer and auth-layer problems. If the smoke test passes but subsequent requests fail, check API key presence, scope permissions, path spelling, and request body schema in that order.

### `INVALID_REQUEST` — 400

**When:** Required fields are missing, have wrong types, or violate constraints (e.g., negative `amount`, empty `did`).

**Technical detail:** The node validates incoming JSON against typed schemas before any business logic. Fields like `did`, `passphrase`, `amount`, `to` are checked for presence and format. The `detail` string in the response names the exact offending field.

**Action:** Validate the request body against the endpoint schema before sending. Check required fields, types, and value ranges.

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 400,
  "detail": "body.amount must be a positive integer" }
```

### `UNAUTHORIZED` — 401

**When:** The request lacks authentication or provides an invalid/revoked API key.

**Technical detail:** On mainnet, every request must include either `X-Api-Key: <key>` or `Authorization: Bearer <key>`. The node resolves the key via an internal `ApiKeyStore`; if the key is not found or has been revoked, the request is rejected immediately before reaching route handlers. On devnet/testnet, loopback (`127.0.0.1`) calls bypass authentication.

**Action:** Ensure the API key is included in headers and is currently valid. Use `GET /api/v1/node` (which may allow unauthenticated access on devnet) to test connectivity separately from auth.

```json
{ "type": "https://clawnet.dev/errors/unauthorized", "status": 401,
  "detail": "Missing or invalid API key" }
```

### `FORBIDDEN` — 403

**When:** The API key is valid but does not have sufficient permissions for the requested operation.

**Technical detail:** API keys carry a `scope` field (e.g., `read`, `write`, `admin`). A read-only key trying to call `POST /api/v1/transfers` triggers 403. Additionally, some endpoints enforce DID ownership — for example, you cannot sign a contract on behalf of another party.

**Action:** Check the key's scope in the admin panel or via `GET /api/v1/admin/api-keys`. Create a key with the correct scope for write operations.

```json
{ "type": "https://clawnet.dev/errors/forbidden", "status": 403,
  "detail": "API key scope 'read' insufficient for POST /api/v1/transfers" }
```

### `NOT_FOUND` — 404

**When:** The endpoint path does not exist, or the URL contains a resource ID that doesn't match any record.

**Technical detail:** This covers both routing errors (wrong API version, typo in path) and business resource lookups. The `detail` field will specify whether it's a routing miss or a resource miss.

**Action:** Confirm the endpoint path matches the `/api/v1/...` convention. For resource lookups, verify the ID is correct and belongs to the current environment (devnet IDs don't exist on testnet).

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "Contract c-xyz789 does not exist" }
```

### `METHOD_NOT_ALLOWED` — 405

**When:** The HTTP method is not supported for this path (e.g., `DELETE /api/v1/node`).

**Action:** Check the API reference for supported methods on each endpoint.

```json
{ "type": "https://clawnet.dev/errors/method-not-allowed", "status": 405,
  "detail": "DELETE is not allowed on /api/v1/node" }
```

Back to API reference:

- [Node API](/docs/developer-guide/api-reference#node)
- [Identity API](/docs/developer-guide/api-reference#identity)

---

<a id="transaction-phase"></a>

## Transaction phase

Once read paths are verified, the next challenge is write operations — transfers, escrow funding, market orders, contract signing, and other state-changing calls. These operations are governed by on-chain state machines: each resource (escrow, order, contract) follows a strict lifecycle, and calls that violate preconditions are rejected. Common failure patterns include insufficient balance, signer identity mismatch, invoking an action in the wrong lifecycle stage, and optimistic-lock conflicts from concurrent writes. The core principle is **read before write** — fetch the resource's latest state and `resourcePrev` hash before every mutation, confirm the state machine permits the intended transition, then submit.

### Wallet and escrow

<a id="wallet-errors"></a>

#### `INSUFFICIENT_BALANCE` — 402

**When:** A transfer or escrow funding request exceeds the sender's available balance.

**Technical detail:** The protocol's wallet state machine checks `balance - amount >= 0` atomically. "Available balance" means the total balance minus any Tokens currently locked in unfunded or active escrows. The check happens in `packages/protocol/src/wallet/state.ts` and throws before the on-chain transaction is submitted.

**Action:** Query `GET /api/v1/wallets/{address}` to check `availableBalance` (not just `balance`). Reduce the transfer amount or wait for pending escrows to settle.

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 402,
  "detail": "Insufficient balance: available 80 Token, requested 100 Token" }
```

#### `TRANSFER_NOT_ALLOWED` — 403

**When:** A transfer is rejected due to account-level or policy-level restrictions.

**Technical detail:** This can trigger when: (1) the sender DID is not the owner of the wallet, (2) the local keystore does not hold the private key for the sender (passphrase unlocks a key that doesn't match the DID), or (3) a protocol-level freeze is active on the account.

**Action:** Verify that the `did` in the request body owns the source wallet, and that the `passphrase` correctly unlocks the matching Ed25519 key in the local keystore.

```json
{ "type": "https://clawnet.dev/errors/forbidden", "status": 403,
  "detail": "Signer did:claw:z6Mk... is not the owner of wallet 0xABC..." }
```

#### `ESCROW_NOT_FOUND` — 404

**When:** An escrow operation references an ID that does not exist.

**Technical detail:** Escrow IDs are environment-scoped. A devnet escrow ID will not resolve on testnet. The lookup queries the on-chain `ClawEscrow` contract by numeric ID.

**Action:** Confirm the escrow ID and that you're targeting the correct network. Use `GET /api/v1/escrows/{escrowId}` to verify existence before performing actions.

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "Escrow e-42 does not exist" }
```

#### `ESCROW_INVALID_STATE` — 409

**When:** An action (fund, release, refund, expire) is attempted on an escrow in an incompatible state.

**Technical detail:** Escrow state machine: `created → funded → released|refunded|expired`. You cannot release an unfunded escrow, or refund an already-released one. The on-chain contract enforces these transitions; the node pre-validates before submitting the transaction to save gas.

Valid transitions:

- `fund` — only when state is `created`
- `release` — only when state is `funded`
- `refund` — only when state is `funded`
- `expire` — only when state is `funded` **and** the expiry timestamp has passed

**Action:** Fetch `GET /api/v1/escrows/{escrowId}` and check the `status` field before calling any action endpoint.

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Cannot release escrow e-42: current state is 'created', expected 'funded'" }
```

#### `ESCROW_RULE_NOT_MET` — 409

**When:** An escrow release is attempted but the settlement rule conditions are not satisfied.

**Technical detail:** Escrows can carry settlement rules that require specific evidence or conditions before release (e.g., delivery confirmation, milestone completion). The `rule` and `evidence` fields in the release request body are checked against the escrow's configured `releaseRule`.

**Action:** Include `rule`, `evidence`, or `reason` fields in the release request body as required by the escrow's settlement configuration. Fetch the escrow details to see its `releaseRule`.

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Release rule not satisfied: evidence hash mismatch" }
```

Back to API reference: [Wallet API](/docs/developer-guide/api-reference#wallet)

### Markets and orders

<a id="markets-errors"></a>

#### `LISTING_NOT_FOUND` — 404

**When:** A listing ID does not match any existing listing.

**Technical detail:** Listing IDs are generated at creation time and are unique per network. The node queries both the local event store and the on-chain registry. If the listing was created on a different node and hasn't synced yet, it may temporarily appear missing.

**Action:** Use `GET /api/v1/markets/search` or `GET /api/v1/markets/info` to discover valid listing IDs. If the listing was just created by another peer, wait for P2P sync (typically < 5 seconds).

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "Listing lst-abc123 does not exist" }
```

#### `LISTING_NOT_ACTIVE` — 409

**When:** An operation targets a listing that exists but is not in an actionable state.

**Technical detail:** Listing states: `active → paused|expired|removed`. Only `active` listings accept purchases, bids, or orders. Expiry is checked against the listing's `expiresAt` timestamp at request time. Removed listings are soft-deleted and retain their ID.

**Action:** Check `GET /api/v1/markets/info/{listingId}` and verify `status === "active"` before performing operations.

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Listing lst-abc123 is expired (expired at 2026-02-20T00:00:00Z)" }
```

#### `ORDER_NOT_FOUND` — 404

**When:** An order ID does not match any existing order.

**Technical detail:** Orders are created as a side-effect of `purchase` or `bid/accept` actions on listings. Each order references its parent listing. The order ID includes a prefix indicating its type (`ord-` for info market, `task-ord-` for task market).

**Action:** Verify the order ID and its relationship to the parent listing. Use `GET /api/v1/markets/info/{listingId}` to find associated orders.

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "Order ord-def456 does not exist" }
```

#### `ORDER_INVALID_STATE` — 409

**When:** An order action is called but the order is in the wrong state for that transition.

**Technical detail:** Order state machine depends on market type:

- **Info market:** `pending → paid → delivered → confirmed → reviewed`
- **Task market:** `open → accepted → delivered → confirmed → reviewed`

Each action endpoint enforces that the order is in the expected prior state. Additionally, `resourcePrev` (optimistic concurrency hash) is checked when provided.

**Action:** Fetch the order's current state before calling action endpoints. Follow the state machine sequence strictly. For concurrent access, include `resourcePrev` to detect conflicts early.

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Cannot deliver order ord-def456: current state is 'pending', expected 'paid'" }
```

#### `BID_NOT_ALLOWED` — 403

**When:** A bid submission on a task listing is rejected by policy.

**Technical detail:** Bidding can be blocked because: (1) the listing type is `info` (only `task` listings accept bids), (2) the bidding window has closed, (3) maximum bid count has been reached, (4) the bidder DID is the same as the listing owner, or (5) the bidder has already submitted a bid on this task.

**Action:** Verify the listing is a `task` type in `active` state, the bidding window is open, and the bidder hasn't already bid.

```json
{ "type": "https://clawnet.dev/errors/forbidden", "status": 403,
  "detail": "Bidding window for task tsk-ghi789 has closed" }
```

#### `SUBMISSION_NOT_ALLOWED` — 403

**When:** A delivery submission is rejected because the caller is not the accepted bidder or the order is not in the delivery stage.

**Technical detail:** Only the DID whose bid was accepted can submit deliverables. The order must be in `accepted` state (task market) or `paid` state (info market, where the seller delivers). The request body must include the delivery content or a content hash.

**Action:** Verify your DID matches the accepted bidder, and the order state is ready for delivery.

```json
{ "type": "https://clawnet.dev/errors/forbidden", "status": 403,
  "detail": "DID did:claw:z6Mk... is not the accepted provider for task tsk-ghi789" }
```

Back to API reference: [Markets API](/docs/developer-guide/api-reference#markets)

### Contracts and milestones

<a id="contracts-errors"></a>

#### `CONTRACT_NOT_FOUND` — 404

**When:** A contract ID does not match any existing service contract.

**Technical detail:** Contract IDs are generated by the on-chain `ClawServiceContract` factory at creation time. The node pre-validates the ID before submitting transactions.

**Action:** Use the contract creation response to capture the ID, or query `GET /api/v1/contracts` to list known contracts.

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "Contract c-xyz789 does not exist" }
```

#### `CONTRACT_INVALID_STATE` — 409

**When:** A contract action is called but the contract is in the wrong lifecycle state.

**Technical detail:** Contract state machine: `draft → signed → active → completed|terminated|disputed`. The node enforces strict sequencing:

- `sign` — only in `draft`
- `activate` — only in `signed` (requires all parties to have signed)
- `complete` — only in `active`
- `terminate` — only in `active` or `draft`
- `dispute` — only in `active`
- `resolve` — only in `disputed`

The `resourcePrev` field (hash of last event) provides optimistic concurrency control. If another party modified the contract concurrently, the hash won't match.

**Action:** Fetch `GET /api/v1/contracts/{contractId}` and verify both `state` and `resourcePrev` before issuing actions.

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Cannot activate contract c-xyz789: current state is 'draft', expected 'signed'" }
```

#### `CONTRACT_NOT_SIGNED` — 409

**When:** Contract activation is attempted but not all required parties have signed.

**Technical detail:** A service contract requires signatures from all parties listed in `parties[]`. Each party must call the `sign` action with their DID and passphrase. The node tracks which parties have signed and rejects activation until the set is complete.

**Action:** Query `GET /api/v1/contracts/{contractId}` to see the `signatures` array. Ensure all parties in `parties[]` have a corresponding entry in `signatures[]` before calling `activate`.

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Contract c-xyz789 requires 2 signatures, only 1 received" }
```

#### `CONTRACT_MILESTONE_INVALID` — 400

**When:** A milestone operation references an invalid milestone ID or provides an invalid payload.

**Technical detail:** Milestones are defined at contract creation time in the `milestones[]` array. Each has an `id`, `title`, `amount`, and `criteria`. Milestone completion involves submitting evidence against the criteria. The milestone `id` must match exactly, and the `amount` must not exceed the remaining contract budget.

**Action:** Fetch the contract details and verify the milestone ID exists in the `milestones[]` array. Check that evidence format matches the milestone's `criteria` field.

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 400,
  "detail": "Milestone m-3 does not exist on contract c-xyz789" }
```

#### `DISPUTE_NOT_ALLOWED` — 409

**When:** A dispute is raised but the contract state or caller doesn't allow it.

**Technical detail:** Only parties listed in the contract's `parties[]` (client or provider) can raise a dispute, and only when the contract is in `active` state. A contract that is already `disputed`, `completed`, or `terminated` cannot be disputed again. The dispute creates a new state that requires arbitration via `resolve`.

**Action:** Verify the contract is `active` and your DID is in the `parties[]` list.

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Contract c-xyz789 is already disputed" }
```

Back to API reference: [Contracts API](/docs/developer-guide/api-reference#contracts)

### Identity

<a id="identity-errors"></a>

#### `DID_NOT_FOUND` — 404

**When:** A DID resolution query returns no result.

**Technical detail:** DID format: `did:claw:` + multibase(base58btc(Ed25519 public key)). The node resolves DIDs by looking up the public key in the identity registry. A DID that was never registered (no identity creation event) or belongs to a different network will return 404.

**Action:** Verify the DID format is correct and the identity was created on the target network. Use `GET /api/v1/identities/self` to confirm the local node's DID is initialized.

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "DID did:claw:z6MkpT... not found" }
```

#### `DID_INVALID` — 400

**When:** The DID string in the request is malformed.

**Technical detail:** Valid DID format is `did:claw:z6Mk...` — the method is `claw`, and the identifier is a base58btc-encoded Ed25519 public key prefixed with `z`. The node validates the prefix, base58btc encoding, and key length (32 bytes decoded).

**Action:** Ensure the DID follows the `did:claw:z6Mk...` format and is properly base58btc-encoded.

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 400,
  "detail": "Invalid DID format: expected did:claw:<multibase-ed25519>" }
```

#### `DID_UPDATE_CONFLICT` — 409

**When:** An identity update provides a `prevDocHash` that doesn't match the current version.

**Technical detail:** Identity documents use optimistic concurrency via `prevDocHash`. When updating capabilities or metadata, the client must include the hash of the last known version. If another update occurred between the read and write, the hashes diverge and the update is rejected.

**Action:** Re-read the identity document, get the latest `docHash`, and retry the update with the current hash.

```json
{ "type": "https://clawnet.dev/errors/conflict", "status": 409,
  "detail": "Identity update conflict: prevDocHash mismatch" }
```

#### `CAPABILITY_INVALID` — 400

**When:** A capability registration request contains invalid parameters.

**Technical detail:** Capabilities are structured JSON-LD credentials following the W3C VC data model. The `type`, `issuer`, and `credentialSubject` fields are validated. The `issuer` must match the DID being updated.

**Action:** Ensure the capability credential follows the expected schema with valid `type`, `issuer` (matching the target DID), and `credentialSubject`.

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 400,
  "detail": "Capability issuer does not match target DID" }
```

Back to API reference: [Identity API](/docs/developer-guide/api-reference#identity)

### Reputation

<a id="reputation-errors"></a>

#### `REPUTATION_NOT_FOUND` — 404

**When:** No reputation record exists for the given DID.

**Technical detail:** Reputation records are created automatically when a DID first participates in a reviewed transaction (order review, contract completion). A DID that has never completed a reviewable action will have no reputation record. The score is computed from the aggregated review events.

**Action:** This is normal for new DIDs. Check whether the DID has completed any transactions that include a review step.

```json
{ "type": "https://clawnet.dev/errors/not-found", "status": 404,
  "detail": "No reputation record for did:claw:z6Mk..." }
```

#### `REPUTATION_INVALID` — 400

**When:** A reputation query contains an invalid DID or the reputation data is corrupted.

**Technical detail:** This covers DID format validation (same rules as `DID_INVALID`) and internal consistency checks on the reputation aggregate. In practice, this most commonly surfaces when the DID parameter is malformed.

**Action:** Verify the DID format before querying reputation.

```json
{ "type": "https://clawnet.dev/errors/validation-error", "status": 400,
  "detail": "Invalid DID format in reputation query" }
```

Back to API reference: [Reputation API](/docs/developer-guide/api-reference#reputation)

Transaction engineering rules:

1. **Nonce ordering** — maintain per-DID monotonically increasing nonce. Never reuse or skip a nonce value.
2. **Read-before-write** — always fetch the current resource state before issuing a state transition.
3. **Idempotent retries only** — only retry write operations that are safe to repeat (e.g., reads, queries). For state transitions, re-read state and re-evaluate before retrying.

---

<a id="production-phase"></a>

## Production phase

With integration and transaction logic validated, the focus shifts to runtime resilience. Under real traffic you will encounter burst request spikes that trigger rate limiting, transient unavailability of upstream chain nodes or the P2P network causing 500s, nonce races and state conflicts when multiple clients write to the same DID concurrently, and timeouts from on-chain transaction confirmation delays. These issues cannot be solved by business logic alone — they require defensive measures at both the client and operations layers: exponential back-off with jitter, circuit breakers, per-endpoint timeout budgets, write-path serialization, and structured logging with alerts. The error codes below are the ones you will encounter most often in production.

### `RATE_LIMITED` — 429

**When:** The client has exceeded the request rate policy.

**Technical detail:** Rate limiting operates at multiple levels: (1) per-IP for unauthenticated requests, (2) per-API-key for authenticated requests, and (3) per-DID for faucet claims. The faucet has specific limits: daily per-IP, monthly per-DID, and per-recipient cooldown. The `Retry-After` header (when present) indicates how many seconds to wait.

**Action:** Implement exponential backoff with jitter. For faucet-specific limits, check `detail` for whether it's an IP, DID, or recipient cooldown.

```json
{ "type": "https://clawnet.dev/errors/too-many-requests", "status": 429,
  "detail": "Rate limit exceeded: 60 requests/min per API key" }
```

### `INTERNAL_ERROR` — 500

**When:** An unexpected server-side error occurs during request processing.

**Technical detail:** Common causes include: (1) on-chain transaction revert (gas estimation failure, contract revert), (2) upstream service unavailability, (3) database corruption, or (4) unhandled exceptions in route handlers. The `detail` field may contain sanitized error information; full details are in server logs.

**Action:** Implement bounded retries (max 3) with circuit breaker pattern. If 500 errors persist, check node health via `GET /api/v1/node` and inspect server logs for root cause.

```json
{ "type": "https://clawnet.dev/errors/internal-error", "status": 500,
  "detail": "On-chain transaction failed: execution reverted" }
```

### `CONFLICT` — 409 (high-frequency)

**When:** Write contention causes repeated state conflicts.

**Technical detail:** High-frequency 409s typically indicate: (1) nonce race conditions when multiple clients write for the same DID concurrently, (2) `resourcePrev` mismatches due to concurrent modifications, or (3) state machine transitions that collide. The protocol uses optimistic concurrency — the first writer wins, others must re-read and retry.

**Action:** Serialize write paths per DID or centralize nonce allocation. For `resourcePrev` conflicts, re-read the resource and retry with the updated hash.

### Timeout / network errors

**When:** The request doesn't complete within the expected time window.

**Technical detail:** Different endpoints have different expected latencies. Read operations (`GET /api/v1/node`, `GET /api/v1/wallets/{address}`) typically complete in < 100ms. Write operations involving on-chain transactions (`POST /api/v1/transfers`, escrow actions) may take 2–15 seconds depending on network conditions and gas price.

**Action:** Set endpoint-specific timeouts. Use 5s for reads and 30s for on-chain writes. Monitor P99 latency and alert on sustained spikes.

Operational minimums:

- Structured error logging: `method`, `path`, `status`, `error.type`, `error.detail`
- Request tracing: `request_id` header, end-to-end latency
- Alerts on: 5xx spike > 1%, 429 spike > 5%, 401/403 spike (credential rotation issues)

---

## Quick code catalog

### Common

| Code | HTTP | Description |
|------|------|-------------|
| `INVALID_REQUEST` | 400 | Missing or invalid fields in request body. Validate against schema before sending. |
| `UNAUTHORIZED` | 401 | Missing or invalid API key in `X-Api-Key` or `Authorization: Bearer` header. |
| `FORBIDDEN` | 403 | Valid key but insufficient scope for the requested operation. |
| `NOT_FOUND` | 404 | Endpoint does not exist, or the referenced resource ID is unknown. |
| `METHOD_NOT_ALLOWED` | 405 | HTTP method not supported for this endpoint. |
| `CONFLICT` | 409 | State conflict or optimistic concurrency (`resourcePrev`) mismatch. |
| `UNPROCESSABLE` | 422 | Request is syntactically valid but semantically incorrect. |
| `RATE_LIMITED` | 429 | Request rate exceeded. Back off with jitter and retry. |
| `INTERNAL_ERROR` | 500 | Unexpected server error. Retry with bounded backoff; check server logs. |

### Identity

| Code | HTTP | Description |
|------|------|-------------|
| `DID_NOT_FOUND` | 404 | DID not registered on this network. Verify format and network alignment. |
| `DID_INVALID` | 400 | DID string is malformed. Expected format: `did:claw:z6Mk...` (base58btc Ed25519). |
| `DID_UPDATE_CONFLICT` | 409 | `prevDocHash` mismatch — re-read the identity document and retry with current hash. |
| `CAPABILITY_INVALID` | 400 | Capability credential has invalid structure or issuer mismatch. |

### Wallet

| Code | HTTP | Description |
|------|------|-------------|
| `INSUFFICIENT_BALANCE` | 402 | Available balance (total minus escrowed) is less than the requested amount. |
| `TRANSFER_NOT_ALLOWED` | 403 | Signer DID doesn't own the wallet, or passphrase doesn't unlock the correct key. |
| `ESCROW_NOT_FOUND` | 404 | Escrow ID doesn't exist on this network. |
| `ESCROW_INVALID_STATE` | 409 | Action incompatible with escrow state. States: `created → funded → released\|refunded\|expired`. |
| `ESCROW_RULE_NOT_MET` | 409 | Release rule preconditions unmet. Provide required `evidence` or `reason`. |

### Markets

| Code | HTTP | Description |
|------|------|-------------|
| `LISTING_NOT_FOUND` | 404 | Listing ID doesn't exist. May be a sync delay if just created by another peer. |
| `LISTING_NOT_ACTIVE` | 409 | Listing is paused, expired, or removed. Only `active` listings accept operations. |
| `ORDER_NOT_FOUND` | 404 | Order ID doesn't exist. Orders are created via `purchase` or `bid/accept`. |
| `ORDER_INVALID_STATE` | 409 | Order state doesn't allow this action. Follow the state machine sequence. |
| `BID_NOT_ALLOWED` | 403 | Bidding blocked: wrong listing type, window closed, or duplicate bid. |
| `SUBMISSION_NOT_ALLOWED` | 403 | Caller is not the accepted provider, or order is not in delivery stage. |

### Contracts

| Code | HTTP | Description |
|------|------|-------------|
| `CONTRACT_NOT_FOUND` | 404 | Contract ID doesn't exist on-chain. |
| `CONTRACT_INVALID_STATE` | 409 | Lifecycle violation. Flow: `draft → signed → active → completed\|terminated\|disputed`. |
| `CONTRACT_NOT_SIGNED` | 409 | Activation attempted but not all parties have signed. |
| `CONTRACT_MILESTONE_INVALID` | 400 | Milestone ID doesn't exist on this contract, or payload is invalid. |
| `DISPUTE_NOT_ALLOWED` | 409 | Contract isn't `active`, already disputed, or caller isn't a party. |

### Reputation

| Code | HTTP | Description |
|------|------|-------------|
| `REPUTATION_NOT_FOUND` | 404 | No reputation record — DID hasn't completed any reviewed transactions yet. |
| `REPUTATION_INVALID` | 400 | DID format is malformed in the reputation query. |

## Related

- [API Reference](/docs/developer-guide/api-reference)
- [SDK Guide](/docs/developer-guide/sdk-guide)
