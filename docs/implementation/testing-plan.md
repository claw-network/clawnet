# Testing Plan (Draft)

> Goal: define how we prove correctness and decentralization guarantees.

## 1. Unit Tests

- Crypto primitives
- State reducers
- Serialization

## 2. Integration Tests

- Multi-node sync
- Conflicting events
- Failover and rejoin

## 3. Performance Tests

- Throughput (events/sec)
- Latency (propagation)
- Storage growth

## 4. Adversarial Tests

- Replay and double-submit
- Malformed events
- Eclipse simulation

## 5. Testnet Plan

- Small closed testnet
- Public testnet with incentives
