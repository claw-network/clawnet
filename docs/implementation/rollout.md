# Rollout Plan (MVP Draft)

## 1. Alpha

- Single-node MVP
- Deterministic reducer tests
- Developer-only distribution

### 1.1 Local Devnet (On-Chain)

- Deploy all contracts (ClawToken, ClawEscrow, ClawIdentity, ClawReputation,
  ClawContracts, ClawDAO, ParamRegistry) to a local Hardhat devnet.
- Run the Event Indexer against the local chain and verify SQLite tables
  are populated correctly for every contract event.
- Execute full REST → on-chain proxy round-trip tests (see Testing Plan
  §2.1) to validate the Node service layer.
- Verify dual storage: P2P modules write to LevelDB, chain modules write
  to on-chain contracts and are read from Indexer/view functions.

## 2. Beta (Testnet)

- Multi-node testnet
- Community bootstrap nodes
- Snapshot distribution
- Faucet and test tokens

### 2.1 Testnet Chain Deployment

- Deploy contracts to a public EVM testnet (e.g., Sepolia or dedicated
  ClawNet testnet).
- Run **dual-track validation**: for each chain module operation, compare
  results from the old event-sourced path against the new on-chain path
  and flag discrepancies.
- Conduct **balance migration rehearsal**: snapshot all Token balances from
  the event-sourced state, mint equivalent amounts on-chain, and verify
  totals match.
- Stress-test the Event Indexer under sustained testnet load and verify
  sync latency stays within targets (< 2s).
- Complete audit rounds 1 and 2 (see Security §4.1).

## 3. Mainnet

- DAO-controlled parameters
- Upgrade windows published in advance
- Emergency pause policy

### 3.1 On-Chain Mainnet Migration

**Contract deployment order:**

1. ParamRegistry (governance parameters)
2. ClawToken (Token balances, mint authority)
3. ClawEscrow (escrow lifecycle)
4. ClawIdentity (DID registry)
5. ClawReputation (reputation records)
6. ClawContracts (service contract lifecycle)
7. ClawDAO (governance proposals, voting, treasury)

**Balance migration:**

1. Take a finalized snapshot of all Token balances from the event-sourced
   state at a published cut-off block.
2. Pause the old event-sourced wallet module (read-only mode).
3. Mint balances on ClawToken contract via a one-time migration script,
   verified by DAO multi-sig.
4. Verify on-chain total supply equals the snapshot total.

**Source-of-truth switch:**

1. Enable on-chain write path in Node services.
2. Start the Event Indexer against mainnet.
3. Verify Indexer state matches contract view functions for all modules.
4. Disable the old event-sourced write path for chain modules.
5. P2P modules (Markets, Node) continue unchanged.

## 4. Upgrade Strategy

- Version negotiation
- Backward compatibility for 1 minor version
- Emergency rollback policy

### 4.1 UUPS Proxy Upgrade Flow

All upgradeable contracts use the **UUPS proxy pattern** (OpenZeppelin).
The upgrade process is governed by the DAO:

1. A DAO proposal is submitted with the new implementation address and
   an upgrade rationale.
2. Standard governance voting period (configurable via ParamRegistry).
3. If approved, the upgrade transaction is queued in the **Timelock**
   contract with a 48-hour delay.
4. After the delay, any address can execute the queued upgrade.
5. The new implementation is verified on-chain (bytecode hash check).

**Pausable emergency:**

- The DAO multi-sig or designated emergency guardian can call `pause()` on
  any contract to halt state-mutating operations immediately.
- Pausing does not affect read operations (view functions, Indexer queries).
- Unpausing requires a DAO vote or guardian action + Timelock delay.

**Rollback:**

- If a critical bug is found post-upgrade, the DAO can deploy a corrective
  implementation and fast-track an upgrade via the emergency guardian role
  (bypasses Timelock with a reduced 6-hour delay).
