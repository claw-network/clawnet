# Markets Event Schemas

Resource concurrency:
- For any event that mutates an existing resource (listingId, orderId, bidId,
  submissionId, leaseId, disputeId), payload MUST include resourcePrev (hash of
  the last accepted event for that resource).
- For create events, resourcePrev is OPTIONAL; if provided it MUST be null.

## market.listing.publish

Aligns to MarketListing.

REQUIRED:
- listingId
- marketType
- seller.did
- title, description, category, tags
- pricing
- visibility
- marketData (market-specific fields below)

OPTIONAL:
- restrictions
- expiresAt
- metadata
- resourcePrev (must be null)

DERIVED:
- seller.reputation/verified
- stats (initial zeros)
- createdAt/updatedAt

Market-specific marketData:

- Info market: infoType, content.format, accessMethod, license
  optional: quality, usageRestrictions
- Task market: taskType, task.requirements, task.deliverables, task.skills,
  timeline; optional: workerRequirements, bidding, milestones
- Capability market: capabilityType, capability.name, capability.version,
  capability.interface, access.endpoint, access.authentication, quota.rateLimits

## market.listing.update

REQUIRED:
- listingId
- resourcePrev
- status

OPTIONAL:
- metadata

## market.listing.remove (MVP+)

REQUIRED:
- listingId
- resourcePrev

DERIVED:
- status = removed

## market.order.create

Aligns to Order.

REQUIRED:
- orderId
- listingId
- marketType
- buyer.did
- items (listingId, quantity, unitPrice)
- pricing.subtotal, pricing.total
- payment.status = pending
- delivery.status = pending

OPTIONAL:
- pricing.discounts, pricing.fees
- resourcePrev (must be null)

DERIVED:
- seller.did (from listing)
- createdAt (envelope.ts)

## market.order.update

REQUIRED:
- orderId
- resourcePrev
- status

OPTIONAL:
- payment
- delivery
- review

## market.bid.submit

REQUIRED:
- bidId
- taskId (listing id)
- bidder.did
- proposal.price
- proposal.timeline
- proposal.approach

OPTIONAL:
- proposal.milestones
- resourcePrev (must be null)

DERIVED:
- bidder.reputation
- createdAt

## market.submission.submit

REQUIRED:
- orderId
- submissionId
- worker
- deliverables

OPTIONAL:
- notes
- resourcePrev (must be null)

DERIVED:
- status = pending_review

## market.submission.review

REQUIRED:
- submissionId
- resourcePrev
- approved
- feedback

OPTIONAL:
- rating
- revisionDeadline

## market.capability.lease.start

REQUIRED:
- listingId
- leaseId
- lessee
- plan

DERIVED:
- credentials
- status = active

OPTIONAL:
- resourcePrev (must be null)

## market.capability.lease.pause (MVP+)

REQUIRED:
- leaseId
- resourcePrev

DERIVED:
- status = paused

## market.capability.lease.resume (MVP+)

REQUIRED:
- leaseId
- resourcePrev

DERIVED:
- status = active

## market.capability.lease.terminate (MVP+)

REQUIRED:
- leaseId
- resourcePrev

DERIVED:
- status = terminated

## market.capability.invoke

REQUIRED:
- leaseId
- resource
- units
- latency
- success

DERIVED:
- cost

## market.dispute.open

REQUIRED:
- orderId
- type
- description

OPTIONAL:
- claimAmount
- resourcePrev (must be null)

## market.dispute.response (MVP+)

REQUIRED:
- disputeId
- resourcePrev
- response

OPTIONAL:
- evidence

## market.dispute.resolve (MVP+)

REQUIRED:
- disputeId
- resourcePrev
- resolution

OPTIONAL:
- notes

## market.bid.accept (MVP+)

REQUIRED:
- bidId
- resourcePrev

DERIVED:
- status = accepted

## market.bid.reject (MVP+)

REQUIRED:
- bidId
- resourcePrev

DERIVED:
- status = rejected

## market.bid.withdraw (MVP+)

REQUIRED:
- bidId
- resourcePrev

DERIVED:
- status = withdrawn

## market.subscription.start (MVP+)

REQUIRED:
- subscriptionId
- listingId
- buyer.did

OPTIONAL:
- resourcePrev (must be null)

DERIVED:
- status = active

## market.subscription.cancel (MVP+)

REQUIRED:
- subscriptionId
- resourcePrev

DERIVED:
- status = cancelled
