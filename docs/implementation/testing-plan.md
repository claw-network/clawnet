# Testing Plan (MVP Draft)

## 1. Unit Tests

- Serialization and hashing
- Signature verification
- Reducer determinism
- Fee calculation
- Escrow rules

### 1.1 Solidity Contract Unit Tests

- All contracts (ClawToken, ClawEscrow, ClawIdentity, ClawReputation,
  ClawContracts, ClawDAO, ParamRegistry) have Hardhat/Foundry unit tests.
- Coverage target: **100% line coverage** for every contract.
- Tests run against a local Hardhat node with deterministic block timestamps.
- Key scenarios: Token transfer, escrow create/fund/release/refund/dispute,
  identity register/update, reputation record, contract lifecycle, DAO
  proposal/vote/execute, parameter changes.

### 1.2 Event Indexer Unit Tests

- Parsing of every contract event type into the correct SQLite row.
- Reorg rollback: simulate a chain reorg and verify rollback + re-index.
- Block hash integrity verification.
- Pagination and filtering via `IndexerQuery`.

## 2. Integration Tests

- Multi-node event propagation
- Sync after offline period
- Conflicting events and rejection
- Identity update races

### 2.1 REST → On-Chain Proxy End-to-End Tests

- Full round-trip tests: REST request → Node service → contract call →
  chain confirmation → Indexer materialization → REST query verification.
- Run against a local Hardhat node with auto-mining enabled.
- Cover all chain modules: Wallet (transfer, escrow lifecycle), Identity
  (register, update), Reputation (record), Contracts (create, sign,
  milestone, complete), DAO (propose, vote, execute).
- Verify that REST responses match both contract view functions and
  Indexer query results.

## 3. Performance Tests

- Events per second
- Propagation latency
- Storage growth
- Snapshot load time

### 3.1 Chain Performance Tests

- **Transaction throughput** — Measure sustained Token transfers per second on
  local Hardhat and public testnet.
- **Indexer sync latency** — Time between block confirmation and row
  availability in SQLite. Target: < 2 seconds on devnet.
- **Indexer rebuild time** — Full re-index from genesis for 100k blocks.
- **Comparison baseline** — Compare chain module response times against the
  original P2P event-sourced implementation to verify acceptable overhead.

## 4. Adversarial Tests

- Replay attacks
- Malformed events
- Sybil flood
- Eclipse attempts

### 4.1 Smart Contract Adversarial Tests

- **Reentrancy** — Deploy attacker contracts that attempt reentrant calls
  during Token transfers and escrow releases; verify all are reverted.
- **Flash loan voting** — Attempt to borrow Tokens, vote on a DAO proposal,
  and repay in the same block; verify governance snapshot rejects it.
- **Front-running** — Simulate transaction reordering on escrow releases and
  bid acceptances; verify economic invariants hold.
- **Unauthorized upgrade** — Attempt UUPS upgrades from non-authorized
  addresses; verify revert.
- **Pausable bypass** — Attempt state-mutating calls while contracts are
  paused; verify revert.

## 5. Testnet

- Closed alpha testnet
- Public beta testnet
- Community-run bootstrap nodes

## 6. Exit Criteria

- No critical bugs in 30 days
- Deterministic state across 10+ nodes
- Average propagation latency < 3s

### 6.1 On-Chain Exit Criteria

- **State consistency** — For every chain module operation, the following MUST
  be equal: contract view function result = Indexer SQLite query result =
  REST API response.
- **Contract coverage** — 100% line coverage for all Solidity contracts.
- **Audit clean** — Zero high/critical findings from Slither and Mythril CI,
  and all external audit issues resolved.
- **Indexer reliability** — Indexer MUST correctly handle at least 3
  simulated chain reorgs without data loss.
