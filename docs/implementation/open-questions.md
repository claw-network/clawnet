# Open Questions and Decisions

## Decisions (Proposed for MVP)

1. Event ordering is local, with probabilistic finality (N confirmations).
2. Canonical serialization uses JCS (RFC 8785).
3. Account-based balances with per-issuer nonces.
4. Indexers are optional and non-authoritative.
5. DAO controls fee parameters and reward rates.

## Still Open (Blocking)

1. What exact finality threshold N is required for high-value transfers?
2. What is the arbitration committee selection algorithm?
3. Should PoW/stake gating be enabled by default on public testnet?
4. Exact snapshot interval and pruning policy for light nodes.
5. Formal policy for hard forks and emergency pauses.
