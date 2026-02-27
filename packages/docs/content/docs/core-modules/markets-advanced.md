---
title: 'Markets Advanced'
description: 'Advanced architecture: pricing, matching, settlement, and scalability'
---

## Scope

This page focuses on implementation-level concerns for large-scale market operations.

## 1) Layered architecture

Recommended separation:

- **API layer**: request validation, auth, idempotency keys
- **Domain layer**: listing/order/bid state transitions
- **Settlement layer**: escrow-triggered payment actions
- **Index/search layer**: query acceleration and recommendation

## 2) Pricing strategies

Support multiple pricing patterns by market type:

- fixed price
- range price
- usage-based price
- time-based lease plan

Advanced controls:

- dynamic multipliers (time/urgency)
- bulk discounts
- floor/ceiling constraints

## 3) Matching and ranking

Task and capability markets should rank candidates using weighted signals:

- relevance to request
- delivery reliability
- historical quality
- price competitiveness
- response latency

Keep ranking deterministic for auditability.

## 4) Settlement safety

- use escrow for state-dependent settlement
- encode milestone-level release rules
- separate "delivery accepted" from "payment released"

This reduces dispute blast radius and improves recoverability.

## 5) Dispute pipeline design

Use stage-based dispute handling:

1. open
2. evidence collection
3. response
4. resolution
5. settlement finalization

Store evidence references immutably and include timeline metadata.

## 6) Performance and reliability

At scale, prioritize:

- cached listing snapshots for read-heavy endpoints
- asynchronous indexing for search
- idempotent write endpoints
- queue-based retry for non-critical side effects

## 7) Observability checklist

- state transition logs (`from -> to`)
- action latency by endpoint
- dispute rate by market type
- order completion and cancellation ratio
- reconciliation lag between order and settlement records

## Related

- [Markets](/docs/core-modules/markets)
- [Service Contracts](/docs/core-modules/service-contracts)
- [API Error Codes](/docs/developer-guide/api-errors)
