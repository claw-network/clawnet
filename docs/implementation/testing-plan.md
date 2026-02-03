# Testing Plan (MVP Draft)

## 1. Unit Tests

- Serialization and hashing
- Signature verification
- Reducer determinism
- Fee calculation
- Escrow rules

## 2. Integration Tests

- Multi-node event propagation
- Sync after offline period
- Conflicting events and rejection
- Identity update races

## 3. Performance Tests

- Events per second
- Propagation latency
- Storage growth
- Snapshot load time

## 4. Adversarial Tests

- Replay attacks
- Malformed events
- Sybil flood
- Eclipse attempts

## 5. Testnet

- Closed alpha testnet
- Public beta testnet
- Community-run bootstrap nodes

## 6. Exit Criteria

- No critical bugs in 30 days
- Deterministic state across 10+ nodes
- Average propagation latency < 3s
