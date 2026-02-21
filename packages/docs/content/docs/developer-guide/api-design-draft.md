---
title: "API Design Draft"
description: "Minimal API design aligned with OpenAPI spec"
---

> 完全对齐 `docs/api/openapi.yaml`，并补齐响应 schema 与错误码引用。

## 通用约定

- Base URL: `http://127.0.0.1:9528`
- 请求/响应: JSON
- Token 单位: 所有金额字段均为 **Token 整数**，最小单位 1 Token，API 不接受小数金额。
- 错误格式（见 `api-errors.md`）:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

- 错误 schema: `Error`（所有 4xx/5xx）
- 错误码表: 见 `api-errors.md`（含 HTTP 状态约定）
- 默认错误: INVALID_REQUEST (400), UNAUTHORIZED (401; ApiKey), FORBIDDEN (403), NOT_FOUND (404), RATE_LIMITED (429), INTERNAL_ERROR (500)
- 有更具体错误码时优先返回具体码（替代通用 NOT_FOUND/CONFLICT）
- 认证（可选）: `Authorization: Bearer <token>`

---

# Node

## GET /api/node/status

- Response 200: `NodeStatus`

## GET /api/node/peers

- Response 200: `{ peers: PeerInfo[], total: number }`

## GET /api/node/config

- Response 200: `NodeConfig`

---

# Identity

## GET /api/identity

- Response 200: `Identity`

## GET /api/identity/{did}

- Response 200: `Identity`
- Errors: DID_INVALID (400), DID_NOT_FOUND (404)

## GET /api/identity/capabilities

- Response 200: `{ capabilities: Capability[] }`

## POST /api/identity/capabilities

- Request: { name, description?, pricing, proof? }
- Response 201: `Capability`
- Errors: CAPABILITY_INVALID (400)

---

# Wallet

## GET /api/wallet/balance

- Response 200: `Balance`

## POST /api/wallet/transfer

- Request: { to, amount, memo? }
- Response 200: `TransferResult`
- Errors: INVALID_REQUEST (400), INSUFFICIENT_BALANCE (402), TRANSFER_NOT_ALLOWED (403)

## GET /api/wallet/history

- Query: limit, offset, type
- Response 200: { transactions: Transaction[], total, hasMore }

## POST /api/wallet/escrow

- Request: { amount, contractId, releaseConditions }
- Response 201: `Escrow`
- Errors: INSUFFICIENT_BALANCE (402)

## GET /api/wallet/escrow/{escrowId}

- Response 200: `Escrow`
- Errors: ESCROW_NOT_FOUND (404)

## POST /api/wallet/escrow/{escrowId}/release

- Request: { amount?, reason? }
- Response 200: `TransferResult`
- Errors: ESCROW_NOT_FOUND (404), ESCROW_INVALID_STATE (409), ESCROW_RULE_NOT_MET (409)

---

# Markets - Info

## GET /api/markets/info

- Query: keyword, category, minPrice, maxPrice, sortBy, limit, offset
- Response 200: { listings: InfoListing[], total, hasMore }

## POST /api/markets/info

- Request: { title, description?, preview?, content, contentHash?, price, category?, tags?, licenseType? }
- Response 201: `InfoListing`

## GET /api/markets/info/{listingId}

- Response 200: `InfoListing`
- Errors: LISTING_NOT_FOUND (404)

## POST /api/markets/info/{listingId}/purchase

- Response 200: { purchaseId, content, txHash }
- Errors: INSUFFICIENT_BALANCE (402), LISTING_NOT_FOUND (404), LISTING_NOT_ACTIVE (409), ORDER_INVALID_STATE (409)

---

# Markets - Tasks

## GET /api/markets/tasks

- Query: keyword, capability, minBudget, maxBudget, status, limit, offset
- Response 200: { tasks: TaskListing[], total }

## POST /api/markets/tasks

- Request: { title, description, requirements?, budget, budgetType?, deadline?, milestones?, attachments? }
- Response 201: `TaskListing`

## GET /api/markets/tasks/{taskId}

- Response 200: `TaskListing`
- Errors: NOT_FOUND (404)

## GET /api/markets/tasks/{taskId}/bids

- Response 200: { bids: Bid[] }
- Errors: NOT_FOUND (404)

## POST /api/markets/tasks/{taskId}/bids

- Request: { price, proposal, estimatedDuration }
- Response 201: `Bid`
- Errors: BID_NOT_ALLOWED (403), SUBMISSION_NOT_ALLOWED (403), NOT_FOUND (404)

## POST /api/markets/tasks/{taskId}/accept

- Request: { bidId }
- Response 200: `Contract`
- Errors: BID_NOT_ALLOWED (403), NOT_FOUND (404)

---

# Markets - Capabilities

## GET /api/markets/capabilities

- Query: capability, maxPrice, minReputation, limit
- Response 200: { providers: CapabilityProvider[], total }

## POST /api/markets/capabilities/{providerId}/invoke

- Request: { capability, input, maxCost? }
- Response 200: { output, cost, txHash }
- Errors: SUBMISSION_NOT_ALLOWED (403), INSUFFICIENT_BALANCE (402), NOT_FOUND (404)

---

# Contracts

## GET /api/contracts

- Query: role, status, limit
- Response 200: { contracts: Contract[], total }

## POST /api/contracts

- Request: { provider, terms, payment?, milestones? }
- Response 201: `Contract`

## GET /api/contracts/{contractId}

- Response 200: `Contract`
- Errors: CONTRACT_NOT_FOUND (404)

## POST /api/contracts/{contractId}/sign

- Response 200: `Contract`
- Errors: CONTRACT_NOT_FOUND (404), CONTRACT_INVALID_STATE (409)

## POST /api/contracts/{contractId}/fund

- Request: { amount }
- Response 200: `Contract`
- Errors: CONTRACT_NOT_FOUND (404), CONTRACT_INVALID_STATE (409), INSUFFICIENT_BALANCE (402)

## POST /api/contracts/{contractId}/milestones/{milestoneId}/complete

- Request: { deliverables?, notes? }
- Response 200: `Milestone`
- Errors: CONTRACT_NOT_FOUND (404), CONTRACT_INVALID_STATE (409), CONTRACT_MILESTONE_INVALID (400)

## POST /api/contracts/{contractId}/milestones/{milestoneId}/approve

- Request: { rating?, feedback? }
- Response 200: `Milestone`
- Errors: CONTRACT_NOT_FOUND (404), CONTRACT_INVALID_STATE (409), CONTRACT_MILESTONE_INVALID (400)

## POST /api/contracts/{contractId}/dispute

- Request: { reason, description?, evidence? }
- Response 200: `Dispute`
- Errors: CONTRACT_NOT_FOUND (404), DISPUTE_NOT_ALLOWED (409)

---

# Reputation

## GET /api/reputation/{did}

- Response 200: `Reputation`
- Errors: REPUTATION_NOT_FOUND (404)

## GET /api/reputation/{did}/reviews

- Query: limit, offset
- Response 200: { reviews: Review[], total, averageRating }
- Errors: REPUTATION_NOT_FOUND (404)
