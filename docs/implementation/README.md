# Implementation Research Docs

These documents define the minimum specs required to start implementation.

Status: All previously blocking recommendations have been adopted in
`docs/implementation/open-questions.md`. Implementation may proceed once the
team confirms no additional open items remain.
They are written to be decentralization-first: no required central services.

## Status

- These specs are normative. Implementation SHOULD NOT begin until all sections
  are at least in a stable draft state with review sign-off.
- All parameters marked as DAO-controlled must be changeable via governance.
- Unit/amount freeze (MVP): 1 Token is the smallest unit; minimum fee = 1 Token;
  minimum transfer/escrow amount = 1 Token.
- Spec freeze page: `SPEC_FREEZE.md`

## Index

- protocol-spec.md - Event model, state machine, finality, versioning
- crypto-spec.md - Key formats, signatures, encryption, DID derivation
- p2p-spec.md - libp2p stack, message protocol, discovery, sync
- storage-spec.md - Local data model, indexes, snapshots, migrations
- economics.md - Fees, incentives, treasury, governance parameters
- value-anchor-monetary-policy-v0.1.md - Bilingual value anchor and v0.1 monetary defaults
- dao-proposal-bootstrap-v0.1.md - Directly votable DAO proposal draft mapped from v0.1 policy
- security.md - Threat model, mitigations, audit and incident response
- testing-plan.md - Test strategy, benchmarks, multi-node scenarios
- rollout.md - Testnet/mainnet release plan and upgrade policy
- open-questions.md - Remaining decisions blocking implementation
- tasks/rest-onchain-proxy-migration.md - REST-to-on-chain proxy migration plan and implementation details

## Review Checklist (minimum)

- Protocol events and validation rules are deterministic.
- Serialization and signing rules are canonical and versioned.
- P2P sync can fully reconstruct state without trusted indexers.
  - **Note:** This requirement applies to P2P-only modules (Markets, Node). For
    chain-backed modules (Wallet, Identity, Reputation, Contracts, DAO), the EVM
    chain is the source of truth; P2P sync is no longer used for state
    reconstruction. Read operations use chain view functions or the Event Indexer
    (SQLite).
- Storage schema supports replay + snapshot recovery.
- Security model covers replay, sybil, eclipse, and key theft.
- Tests include multi-node adversarial scenarios.

## Update Cadence

- Weekly spec review during implementation planning
- All changes require version bump and changelog entry
