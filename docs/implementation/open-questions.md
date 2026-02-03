# Open Questions and Decisions

## Decisions (Proposed for MVP)

1. Event ordering is local, with probabilistic finality (N confirmations).
2. Canonical serialization uses JCS (RFC 8785).
3. Account-based balances with per-issuer nonces.
4. Indexers are optional and non-authoritative.
5. DAO controls fee parameters and reward rates.

## Still Open (Blocking) — Resolved (Adopt Recommendations)

### 1. Finality threshold for high-value transfers

Decision:
- Use tiered N (3/5/7) based on amount, with optional arbitration for disputes.

Rationale:
- Balances latency and security at different value tiers.

### 2. Arbitration committee selection

Decision:
- Reputation-weighted random with minimum stake and rotating committee.

Rationale:
- Sybil resistance + fairness without central control.

### 3. PoW/stake gating on public testnet

Decision:
- Disabled by default; enable PoW if spam observed.

Rationale:
- Preserves accessibility while keeping a mitigation option.

### 4. Snapshot interval and pruning policy

Decision:
- Fixed interval + minimum time cap (every 10k events or 1 hour).

Rationale:
- Predictable storage growth with bounded recovery time.

### 5. Hard fork and emergency pause policy

Decision:
- Emergency multi-sig + DAO ratification, with public time-lock for non-emergency upgrades.

Rationale:
- Fast response with governance accountability.
