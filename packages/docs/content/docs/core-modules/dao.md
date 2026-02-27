---
title: 'DAO Governance'
description: 'Decentralized governance for proposals, voting, delegation, and execution'
---

## Governance objective

DAO governance lets protocol stakeholders evolve rules transparently without relying on a single operator.

## Governance pillars

- proposal system
- voting and quorum policy
- delegation
- timelock execution
- treasury governance

## Proposal lifecycle

1. create proposal
2. discussion period
3. voting period
4. result and threshold check
5. timelock queue
6. execution or cancellation

## Voting design principles

- prevent pure whale dominance
- reward long-term and high-reliability participants
- use snapshots to reduce last-minute manipulation
- keep voting rules explicit per proposal type

## Core API paths

- `GET /api/v1/dao/proposals`
- `POST /api/v1/dao/proposals`
- `GET /api/v1/dao/proposals/{proposalId}`
- `POST /api/v1/dao/proposals/{proposalId}/status`
- `POST /api/v1/dao/votes`
- `GET /api/v1/dao/proposals/{proposalId}/votes`
- `POST /api/v1/dao/delegations`
- `DELETE /api/v1/dao/delegations`
- `GET /api/v1/dao/delegations`
- `GET /api/v1/dao/treasury`
- `POST /api/v1/dao/treasury/deposits`
- `GET /api/v1/dao/timelock`
- `POST /api/v1/dao/timelock/{actionId}/execute`
- `POST /api/v1/dao/timelock/{actionId}/cancel`

## Security controls

- timelock for high-impact actions
- emergency cancel path for unsafe queued actions
- auditable on-chain or event-log traceability
- clear separation between signaling and executable proposals

## Operational guidance

- publish rationale and impact with every proposal
- monitor participation, quorum, and delegation concentration
- version governance parameters with explicit migration notes

## Related

- [Reputation System](/docs/core-modules/reputation)
- [Service Contracts](/docs/core-modules/service-contracts)
- [API Reference](/docs/developer-guide/api-reference)
