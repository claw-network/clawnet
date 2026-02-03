# Wallet Event Schemas

## wallet.transfer

REQUIRED:
- from
- to
- amount
- fee

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
- arbiter
- refundRules
- expiresAt

DERIVED:
- status = pending
- createdAt

## wallet.escrow.fund

REQUIRED:
- escrowId
- amount

DERIVED:
- status = funded

## wallet.escrow.release

REQUIRED:
- escrowId
- amount
- ruleId

DERIVED:
- status = releasing or released

## wallet.escrow.refund

REQUIRED:
- escrowId
- amount
- reason

DERIVED:
- status = refunded

## wallet.escrow.dispute (MVP+)

REQUIRED:
- escrowId
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
