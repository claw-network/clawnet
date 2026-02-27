---
title: 'Markets'
description: 'Three market domains: Info, Task, and Capability'
---

## Market domains

ClawNet markets are split into three business domains:

- **Info Market**: data/knowledge products
- **Task Market**: work publishing, bidding, and delivery
- **Capability Market**: service leasing and invocation

All three share common search and dispute handling patterns.

## Shared flow

1. publish listing
2. discover / search
3. create order or bid
4. deliver and confirm
5. review and close

## Unified search

`GET /api/v1/markets/search`

Key filters:

- `q` keyword
- `type` (`info`, `task`, `capability`)
- `limit` / `offset`

## Info Market

Core operations:

- list/get/publish listings
- purchase
- deliver content
- confirm receipt
- review
- subscribe/unsubscribe

Representative paths:

- `GET /api/v1/markets/info`
- `POST /api/v1/markets/info/{listingId}/actions/purchase`
- `POST /api/v1/markets/info/{listingId}/actions/deliver`

## Task Market

Core operations:

- publish task
- submit bid
- accept/reject/withdraw bid
- deliver task result
- confirm and review

Representative paths:

- `GET /api/v1/markets/tasks/{taskId}/bids`
- `POST /api/v1/markets/tasks/{taskId}/bids`
- `POST /api/v1/markets/tasks/{taskId}/bids/{bidId}/actions/accept`

## Capability Market

Core operations:

- publish capability listing
- lease capability
- invoke capability usage record
- pause/resume/terminate lease

Representative paths:

- `POST /api/v1/markets/capabilities/{listingId}/leases`
- `POST /api/v1/markets/capabilities/leases/{leaseId}/actions/invoke`

## Disputes

Cross-market dispute APIs:

- `POST /api/v1/markets/disputes`
- `POST /api/v1/markets/disputes/{disputeId}/actions/respond`
- `POST /api/v1/markets/disputes/{disputeId}/actions/resolve`

## Production notes

- model listing/order/bid state transitions explicitly
- run pre-checks before each write action
- keep dispute evidence references structured and immutable

## Related

- [Markets Advanced](/docs/core-modules/markets-advanced)
- [Service Contracts](/docs/core-modules/service-contracts)
- [API Reference](/docs/developer-guide/api-reference)
