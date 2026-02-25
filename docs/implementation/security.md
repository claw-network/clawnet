# Security and Threat Model (MVP Draft)

## 1. Threats

- Key theft
- Replay and double-spend
- Sybil attacks
- Eclipse attacks
- Data tampering
- Fraudulent disputes
- Malicious indexers

### 1.1 Smart Contract Threats

The on-chain migration introduces additional threat vectors specific to EVM
smart contracts:

- **Reentrancy** — Malicious contracts calling back into ClawToken/ClawEscrow
  during Token transfers to drain funds.
- **Flash loan attacks** — Exploiting governance voting power or market
  manipulation via uncollateralized flash-borrowed Tokens.
- **Front-running / MEV** — Miners or bots reordering transactions to extract
  value from pending escrow releases, bids, or Token transfers.
- **Upgrade attacks** — Compromised upgrade keys pushing malicious contract
  implementations via UUPS proxies.
- **Oracle manipulation** — If external price feeds are used, manipulated
  oracles could trigger incorrect settlements.

## 2. Mitigations

- Encrypted key storage + rotation
- Strict nonce + timestamp validation
- Peer scoring and rate limits
- Multi-party arbitration for disputes
- Indexer outputs are non-authoritative

### 2.1 On-Chain Mitigations

- **ReentrancyGuard** — All state-mutating functions in ClawToken, ClawEscrow,
  and ClawContracts use OpenZeppelin’s `ReentrancyGuard` modifier.
- **Checks-Effects-Interactions** — All contracts follow the CEI pattern:
  validate inputs, update state, then perform external calls.
- **UUPS Proxies + Timelock** — Upgradeable contracts use UUPS proxy pattern.
  Upgrade proposals require a multi-sig DAO vote and a 48-hour Timelock delay
  before execution.
- **Pausable** — All contracts inherit OpenZeppelin `Pausable`. The DAO
  multi-sig or an emergency guardian can pause contracts during incidents.
- **Access Control** — Role-based access via OpenZeppelin `AccessControl`.
  Sensitive operations (mint, burn, pause, upgrade) require specific roles.
- **Flash loan defense** — Governance voting power uses `ERC20VotesUpgradeable`
  checkpointing with `getPastVotes(voter, snapshotBlock)`, where the snapshot
  block is locked at proposal creation time. This prevents both flash-loan
  vote manipulation and token-transfer vote inflation (C-01 fix).
- **Router access control** — `ClawRouter.multicall()` is restricted to
  `MULTICALL_ROLE` holders, preventing confused-deputy privilege escalation
  (M-03 fix).
- **Emergency multisig** — Emergency execution requires 9-of-9 signatures
  from designated emergency signers (H-02 fix, `EMERGENCY_THRESHOLD = 9`).
- **DID proof-of-ownership** — `registerDID()` requires ECDSA signature from
  the controller address, preventing DID squatting/hijacking (H-01 fix).
- **Escrow dispute timeout** — Disputed escrows have a 7-day timeout after
  which depositors can recover funds via `forceResolveAfterTimeout()`,
  preventing permanent fund lock (M-01 fix).
- **Parameter bounds** — Governance parameters (quorum, voting period,
  timelock) have enforced min/max ranges in both `ClawDAO.setGovParams()`
  and `ParamRegistry.setParam()` (M-04 fix).

## 3. Security Requirements

- All events MUST be signed and verified
- Nonces MUST be monotonic per issuer
- Nodes MUST reject invalid signatures and schema violations

## 4. Audit Plan

- Crypto review before testnet
- Protocol implementation audit before mainnet
- Smart contract audit if on-chain components are used

### 4.1 Smart Contract Audit Plan

Smart contracts MUST undergo **3 rounds of external audit** before mainnet
deployment:

1. **Round 1 (Alpha)** — Initial audit of core contracts (ClawToken,
   ClawEscrow, ClawIdentity) by an independent security firm.
2. **Round 2 (Beta)** — Full audit of all contracts including ClawReputation,
   ClawContracts, ClawDAO, and ParamRegistry after testnet stabilization.
3. **Round 3 (Pre-mainnet)** — Final review of any changes made after round 2,
   plus upgrade mechanism and Timelock verification.

**Automated CI checks** run on every PR:
- **Slither** — Static analysis for common vulnerability patterns.
- **Mythril** — Symbolic execution to detect reentrancy, integer overflow,
  and other issues.
- Contract test coverage MUST remain at 100% line coverage.

## 5. Incident Response

- Key compromise: rotate keys, publish revocation event
- Network partition: freeze high-value operations
- High-value = top finality tier (see FINALITY_TIERS). Nodes SHOULD reject
  new high-value transfers during partition detection and rely on
  time-based finality only until the partition clears.
- Critical bug: emergency DAO vote to pause affected modules (requires 9-of-9
  emergency signer consensus for immediate action)

## 6. Security Testing

- Fuzz parsers for event envelopes
- Adversarial multi-node tests
- Pen tests for API surfaces

## 7. Event Indexer Security

The Event Indexer bridges on-chain state to the local SQLite database. The
following safeguards ensure data integrity:

- **Integrity checks** — Each indexed block records its block hash. On startup
  or periodic audit, the Indexer verifies stored block hashes against the
  chain RPC to detect tampering.
- **Reorg handling** — When a chain reorganization is detected (stored block
  hash differs from canonical chain), the Indexer rolls back affected rows
  and re-indexes from the fork point.
- **Data consistency** — Critical REST endpoints for chain modules compare
  Indexer results against contract view function responses. Discrepancies
  are logged as warnings and trigger an automatic re-index.
- **Rebuild from chain** — The SQLite database is fully disposable. If
  corruption is detected, the Indexer drops all tables and re-indexes from
  the chain’s genesis block.
- **Access control** — The SQLite file is read-only to REST query handlers;
  only the `IndexerStore` component has write access.
