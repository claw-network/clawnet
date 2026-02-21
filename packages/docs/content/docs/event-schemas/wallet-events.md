---
title: "Wallet Events"
description: "wallet.transfer, escrow state machine events"
---

Resource concurrency:
- For escrow update events, payload MUST include resourcePrev (hash of the last
  accepted event for that escrowId). For escrow.create, resourcePrev is optional;
  if provided it MUST be null.

## wallet.transfer

REQUIRED:
- from
- to
- amount
- fee

Notes:
- from and to MUST be claw addresses (not DIDs).
- issuer MUST control the from address.

OPTIONAL:
- memo

DERIVED:
- txHash (envelope.hash)
- createdAt (envelope.ts)

## wallet.escrow.create

REQUIRED:
- escrowId
- depositor
- beneficiary
- amount
- releaseRules

OPTIONAL:
- resourcePrev (must be null)

OPTIONAL:
- arbiter
- refundRules
- expiresAt

DERIVED:
- status = pending
- createdAt

## wallet.escrow.fund

REQUIRED:
- escrowId
- resourcePrev
- amount

DERIVED:
- status = funded

## wallet.escrow.release

REQUIRED:
- escrowId
- resourcePrev
- amount
- ruleId

DERIVED:
- status = releasing or released

## wallet.escrow.refund

REQUIRED:
- escrowId
- resourcePrev
- amount
- reason

DERIVED:
- status = refunded

## wallet.escrow.dispute (MVP+)

REQUIRED:
- escrowId
- resourcePrev
- reason

OPTIONAL:
- evidence

DERIVED:
- status = disputed

## wallet.stake (MVP+)

REQUIRED:
- amount
- validatorId

## wallet.unstake (MVP+)

REQUIRED:
- amount
- validatorId

## wallet.governance.lock (MVP+)

REQUIRED:
- amount
- duration

## wallet.governance.unlock (MVP+)

REQUIRED:
- lockId
