# Service Contracts Event Schemas

Aligns to ServiceContract in `docs/SERVICE_CONTRACTS.md`.

Resource concurrency:
- For any event that mutates an existing contract or milestone, payload MUST
  include resourcePrev (hash of the last accepted event for that contractId).
  For contract.create, resourcePrev MUST be null.

## contract.create

REQUIRED:
- contractId
- parties
- service
- terms
- payment
- timeline
- resourcePrev (must be null)

OPTIONAL:
- milestones
- attachments
- metadata

DERIVED:
- status = draft
- createdAt = envelope.ts

## contract.sign

REQUIRED:
- contractId
- resourcePrev
- signer

DERIVED:
- signature stored in contract

## contract.activate

REQUIRED:
- contractId
- resourcePrev

DERIVED:
- status = active

## contract.milestone.submit

REQUIRED:
- contractId
- resourcePrev
- milestoneId
- submissionId

OPTIONAL:
- notes

## contract.milestone.approve

REQUIRED:
- contractId
- resourcePrev
- milestoneId

OPTIONAL:
- notes

## contract.milestone.reject

REQUIRED:
- contractId
- resourcePrev
- milestoneId

OPTIONAL:
- notes

## contract.complete

REQUIRED:
- contractId
- resourcePrev
- status = completed

## contract.dispute.open

REQUIRED:
- contractId
- resourcePrev
- reason

OPTIONAL:
- evidence

## contract.dispute.resolve

REQUIRED:
- contractId
- resourcePrev
- resolution

OPTIONAL:
- notes

## contract.terminate

REQUIRED:
- contractId
- resourcePrev
- reason
