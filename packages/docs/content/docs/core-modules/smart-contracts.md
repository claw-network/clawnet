---
title: 'Smart Contracts'
description: 'Advanced contract patterns: multi-party, conditional, chained, and automated'
---

## Why advanced contracts

Some agent collaborations require more than basic client-provider flow:

- multiple parties
- conditional triggers
- staged and chained execution
- automated enforcement actions

## Contract pattern families

- **Multi-party contracts**: client + provider + auditor + subcontractors
- **Conditional contracts**: actions triggered by state/time/oracle conditions
- **Milestone contracts**: staged deliverables with gated settlement
- **Recurring contracts**: subscription or periodic service obligations

## Building blocks

- party roles and permissions
- term-level obligations
- trigger expressions (`AND/OR`, time, external signals)
- action handlers (payment, pause, escalate, terminate)

## Safety controls

- timelock before high-impact execution
- explicit approval thresholds for critical transitions
- emergency pause via governance/multisig path
- immutable execution logs for audits

## Example high-level flow

1. instantiate template
2. map parties
3. set milestones and trigger rules
4. collect signatures
5. activate escrow-backed execution
6. run trigger/evidence-driven transitions

## Integration guidance

- start from standard service contracts first
- add advanced triggers only where business value is clear
- keep rule logic deterministic and testable
- run simulation tests for worst-case transitions

## Related

- [Service Contracts](/docs/core-modules/service-contracts)
- [DAO Governance](/docs/core-modules/dao)
- [API Error Codes](/docs/developer-guide/api-errors)
