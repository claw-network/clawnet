# Open Questions and Decisions

## Decisions (Proposed for MVP)

1. Event ordering is local, with probabilistic finality (N confirmations).
2. Canonical serialization uses JCS (RFC 8785).
3. Account-based balances with per-issuer nonces.
4. Indexers are optional and non-authoritative.
5. DAO controls fee parameters and reward rates.

## Still Open (Blocking)

### 1. Finality threshold for high-value transfers

Options:
- A: Fixed N=7 for high-value events
- B: N based on amount tiers (e.g., 3/5/7)
- C: Require arbitration for > threshold

Recommendation:
- Use tiered N (3/5/7) based on amount, with optional arbitration for disputes.

Decision criteria:
- Security vs latency tradeoff
- Network size and peer availability

### 2. Arbitration committee selection

Options:
- A: Random from DAO arbitration pool
- B: Reputation-weighted random
- C: Stake-weighted random

Recommendation:
- Reputation-weighted random with minimum stake and rotating committee.

Decision criteria:
- Sybil resistance
- Fairness and liveness
- Incentive compatibility

### 3. PoW/stake gating on public testnet

Options:
- A: Disabled by default
- B: Proof-of-work tickets
- C: Minimum stake requirement

Recommendation:
- Default disabled; enable PoW if spam observed.

Decision criteria:
- Testnet accessibility
- Spam resistance
- Implementation complexity

### 4. Snapshot interval and pruning policy

Options:
- A: Fixed snapshot interval (10k events)
- B: Time-based (hourly/daily)
- C: Adaptive based on event rate

Recommendation:
- Fixed interval + minimum time cap (e.g., every 10k or 1 hour).

Decision criteria:
- Storage growth
- Recovery speed
- Light node performance

### 5. Hard fork and emergency pause policy

Options:
- A: DAO vote with time-lock
- B: Emergency multi-sig + DAO ratification
- C: Automated safety triggers

Recommendation:
- Emergency multi-sig + DAO ratification, with public time-lock for non-emergency upgrades.

Decision criteria:
- Governance security
- Response time
- Decentralization guarantees
