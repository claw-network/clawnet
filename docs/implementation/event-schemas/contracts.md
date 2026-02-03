# Service Contracts Event Schemas

Aligns to ServiceContract in `docs/SERVICE_CONTRACTS.md`.

## contract.create

REQUIRED:
- contractId
- parties
- service
- terms
- payment
- timeline

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
- signer

DERIVED:
- signature stored in contract

## contract.activate

REQUIRED:
- contractId

DERIVED:
- status = active

## contract.milestone.submit

REQUIRED:
- contractId
- milestoneId
- submissionId

OPTIONAL:
- notes

## contract.milestone.approve

REQUIRED:
- contractId
- milestoneId

OPTIONAL:
- notes

## contract.milestone.reject

REQUIRED:
- contractId
- milestoneId

OPTIONAL:
- notes

## contract.complete

REQUIRED:
- contractId
- status = completed

## contract.dispute.open

REQUIRED:
- contractId
- reason

OPTIONAL:
- evidence

## contract.dispute.resolve

REQUIRED:
- contractId
- resolution

OPTIONAL:
- notes

## contract.terminate

REQUIRED:
- contractId
- reason
