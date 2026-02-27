---
title: 'API Error Codes'
description: 'Layered troubleshooting guide for integration, transaction, and production phases'
---

This page is organized by failure phase, not by raw code list.

Quick jump:

- [Integration phase](#integration-phase)
- [Transaction phase](#transaction-phase)
- [Production phase](#production-phase)
- [Identity errors](#identity-errors)
- [Wallet errors](#wallet-errors)
- [Markets errors](#markets-errors)
- [Contracts errors](#contracts-errors)
- [Reputation errors](#reputation-errors)

## Error response shape

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

Common HTTP status classes:

- `400` invalid request
- `401` unauthorized
- `403` forbidden
- `404` not found
- `409` state conflict
- `429` rate limited
- `500` internal error

---

<a id="integration-phase"></a>

## 1) Integration phase

Goal: make read paths stable and authenticated before business writes.

| Scenario          | Typical status/code   | Root cause                             | Action                            |
| ----------------- | --------------------- | -------------------------------------- | --------------------------------- |
| Node unreachable  | timeout/network       | wrong base URL, node down, proxy issue | validate `GET /api/v1/node` first |
| Auth failed       | `401 UNAUTHORIZED`    | missing or invalid key                 | verify API key header             |
| Permission denied | `403 FORBIDDEN`       | insufficient key scope                 | validate key role/scope           |
| Wrong endpoint    | `404 NOT_FOUND`       | path/version mismatch                  | confirm `/api/v1/...`             |
| Bad input         | `400 INVALID_REQUEST` | missing/invalid fields                 | enforce schema validation         |

Back to API reference:

- [Node API](/docs/developer-guide/api-reference#api-node)
- [Identity API](/docs/developer-guide/api-reference#api-identity)

---

<a id="transaction-phase"></a>

## 2) Transaction phase

Goal: resolve write failures around signing context and resource state transitions.

### 2.1 Wallet and escrow

<a id="wallet-errors"></a>

<a id="wallet-errors"></a>

| Error code             | Meaning                | Common cause                            | Handling                            |
| ---------------------- | ---------------------- | --------------------------------------- | ----------------------------------- |
| `INSUFFICIENT_BALANCE` | not enough balance     | available funds too low                 | pre-check balance, reduce amount    |
| `TRANSFER_NOT_ALLOWED` | transfer disallowed    | policy/account state constraints        | verify sender state and policy      |
| `ESCROW_NOT_FOUND`     | escrow missing         | wrong escrow id or wrong env            | verify id and environment alignment |
| `ESCROW_INVALID_STATE` | escrow action conflict | release/refund attempted in wrong state | fetch escrow state before action    |
| `ESCROW_RULE_NOT_MET`  | release rule unmet     | missing rule/evidence/reason            | provide required settlement context |

Back to API reference:

- [Wallet API](/docs/developer-guide/api-reference#api-wallet)

### 2.2 Markets and orders

<a id="markets-errors"></a>

<a id="markets-errors"></a>

| Error code               | Meaning                   | Common cause                       | Handling                                |
| ------------------------ | ------------------------- | ---------------------------------- | --------------------------------------- |
| `LISTING_NOT_FOUND`      | listing missing           | invalid listing id                 | verify via list/search/get              |
| `LISTING_NOT_ACTIVE`     | listing not actionable    | paused/expired/removed             | check listing status first              |
| `ORDER_NOT_FOUND`        | order missing             | invalid order id                   | verify order lineage                    |
| `ORDER_INVALID_STATE`    | order transition conflict | action called in wrong order state | follow state machine sequence           |
| `BID_NOT_ALLOWED`        | bid blocked               | policy or status violation         | validate bidding window and constraints |
| `SUBMISSION_NOT_ALLOWED` | delivery blocked          | not accepted bidder or wrong stage | verify bid/order ownership and state    |

Back to API reference:

- [Markets API](/docs/developer-guide/api-reference#api-markets)

### 2.3 Contracts and milestones

<a id="contracts-errors"></a>

<a id="contracts-errors"></a>

| Error code                   | Meaning                   | Common cause             | Handling                            |
| ---------------------------- | ------------------------- | ------------------------ | ----------------------------------- |
| `CONTRACT_NOT_FOUND`         | contract missing          | invalid contract id      | verify contract exists              |
| `CONTRACT_INVALID_STATE`     | state transition conflict | action sequence broken   | enforce create->sign->activate flow |
| `CONTRACT_NOT_SIGNED`        | unsigned contract         | missing signatures       | complete signatures first           |
| `CONTRACT_MILESTONE_INVALID` | milestone invalid         | bad milestone id/payload | fetch contract milestones and retry |
| `DISPUTE_NOT_ALLOWED`        | dispute blocked           | state/policy mismatch    | verify dispute preconditions        |

Back to API reference:

- [Contracts API](/docs/developer-guide/api-reference#api-contracts)

Transaction engineering rules:

1. maintain per-DID nonce ordering
2. read state before every write transition
3. retry writes only when safe and idempotent

---

<a id="production-phase"></a>

## 3) Production phase

Goal: maintain stability under burst traffic, dependency jitter, and partial failures.

| Status/code          | Symptom                     | Typical cause                | Mitigation                                           |
| -------------------- | --------------------------- | ---------------------------- | ---------------------------------------------------- |
| `429 RATE_LIMITED`   | burst failures              | client spikes beyond policy  | apply global throttling + jittered backoff           |
| `500 INTERNAL_ERROR` | intermittent server failure | upstream/service instability | bounded retry + circuit breaker + fallback           |
| timeout/network      | latency spikes              | network/proxy congestion     | endpoint-specific timeout tuning                     |
| repeated `409`       | write contention            | nonce or state race          | serialize write paths or centralize nonce allocation |

Back to API reference:

- [Node API](/docs/developer-guide/api-reference#api-node)
- [Wallet API](/docs/developer-guide/api-reference#api-wallet)
- [Markets API](/docs/developer-guide/api-reference#api-markets)
- [Contracts API](/docs/developer-guide/api-reference#api-contracts)
- [DAO API](/docs/developer-guide/api-reference#api-dao)

Operational minimums:

- structured error logging (`method/path/status/error.code`)
- request tracing (`request_id`, latency)
- alerts for 5xx, 429, and 401/403 spikes

---

## 4) Quick code catalog

### Common

- `INVALID_REQUEST`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

### Identity

<a id="identity-errors"></a>

- `DID_NOT_FOUND`
- `DID_INVALID`
- `DID_UPDATE_CONFLICT`
- `CAPABILITY_INVALID`

Back to API reference:

- [Identity API](/docs/developer-guide/api-reference#api-identity)

### Wallet

- `INSUFFICIENT_BALANCE`
- `TRANSFER_NOT_ALLOWED`
- `ESCROW_NOT_FOUND`
- `ESCROW_INVALID_STATE`
- `ESCROW_RULE_NOT_MET`

Back to API reference:

- [Wallet API](/docs/developer-guide/api-reference#api-wallet)

### Markets

- `LISTING_NOT_FOUND`
- `LISTING_NOT_ACTIVE`
- `ORDER_NOT_FOUND`
- `ORDER_INVALID_STATE`
- `BID_NOT_ALLOWED`
- `SUBMISSION_NOT_ALLOWED`

Back to API reference:

- [Markets API](/docs/developer-guide/api-reference#api-markets)

### Contracts

- `CONTRACT_NOT_FOUND`
- `CONTRACT_INVALID_STATE`
- `CONTRACT_NOT_SIGNED`
- `CONTRACT_MILESTONE_INVALID`
- `DISPUTE_NOT_ALLOWED`

Back to API reference:

- [Contracts API](/docs/developer-guide/api-reference#api-contracts)

### Reputation

<a id="reputation-errors"></a>

- `REPUTATION_NOT_FOUND`
- `REPUTATION_INVALID`

Back to API reference:

- [Reputation API](/docs/developer-guide/api-reference#api-reputation)

## Related

- [API Reference](/docs/developer-guide/api-reference)
- [SDK Guide](/docs/developer-guide/sdk-guide)
