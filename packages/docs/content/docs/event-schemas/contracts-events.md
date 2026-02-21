---
title: "Contract Events"
description: "Contract lifecycle: create, sign, activate, milestone, dispute, complete"
---

Aligns to ServiceContract in `docs/SERVICE_CONTRACTS.md`.

Resource concurrency:
- For any event that mutates an existing contract or milestone, payload MUST
  include resourcePrev (hash of the last accepted event for that contractId).
  For contract.create, resourcePrev is optional; if provided it MUST be null.

## contract.create

REQUIRED:
- contractId
- parties
- service
- terms
- payment
- timeline

OPTIONAL:
- resourcePrev (must be null)
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

## contract.negotiate.offer (MVP+)

REQUIRED:
- contractId
- resourcePrev
- terms

OPTIONAL:
- notes

## contract.negotiate.counter (MVP+)

REQUIRED:
- contractId
- resourcePrev
- terms

OPTIONAL:
- notes

## contract.negotiate.accept (MVP+)

REQUIRED:
- contractId
- resourcePrev

OPTIONAL:
- notes

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

## contract.settlement.execute (MVP+)

REQUIRED:
- contractId
- resourcePrev
- settlement

OPTIONAL:
- notes

## contract.terminate

REQUIRED:
- contractId
- resourcePrev
- reason
