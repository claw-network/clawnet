# Storage Specification (MVP Draft)

Defines local storage layout and persistence guarantees.

## 1. Storage Engine

- Default: LevelDB (RocksDB optional)
- Requirements: append-only log + KV indexes

### 1.1 Dual Storage Model (On-Chain Migration)

After the on-chain migration, ClawNet uses two storage backends:

| Backend | Purpose | Modules |
|---------|---------|---------|
| **LevelDB** | Append-only event log + KV indexes for P2P events | Markets, Node |
| **SQLite** (Event Indexer) | Materialized views of on-chain events for fast paginated queries | Wallet, Identity, Reputation, Contracts, DAO |

Chain modules no longer write to LevelDB. Their authoritative state lives
in the on-chain smart contracts; the SQLite Event Indexer polls chain events
and materializes them into queryable tables via `IndexerStore` +
`EventIndexer` + `IndexerQuery`.

## 2. Directory Layout

```
~/.clawnet/
  data/
    events.db
    state.db
    snapshots/
  indexer/
    indexer.sqlite
  logs/
  keys/
```

The `indexer/` directory stores the SQLite database used by the Event Indexer
to cache on-chain event data for chain modules.

## 3. Key Prefixes

- ev:<hash> -> event envelope bytes
- st:<module> -> module state snapshot
- ix:did:<did> -> list of event hashes
- ix:addr:<address> -> list of tx hashes
- ix:nonce:<did> -> last nonce
- meta:version -> schema version

> **On-chain note:** The key prefixes above apply to P2P modules only (Markets,
> Node). Chain modules (Wallet, Identity, Reputation, Contracts, DAO) no longer
> store events or state in LevelDB. Their data is read from contract view
> functions or the SQLite Event Indexer.

## 4. Event Log

- Immutable records
- Hash must match envelope hash
- Full nodes MUST NOT garbage collect confirmed events.
- Light nodes MAY prune per Section 10.

> **On-chain note:** The event log in LevelDB is only used for P2P modules.
> Chain module events are emitted by smart contracts and indexed into SQLite
> by the Event Indexer. The on-chain event log is immutable by nature of the
> blockchain.

## 5. State Snapshots

- Snapshot every 10,000 events or 1 hour (whichever comes first, configurable)
- Snapshot includes module state + last event hash

> **On-chain note:** State snapshots are only relevant for P2P modules (Markets,
> Node). Chain modules derive state from the smart contracts; there is no need
> to snapshot their state locally since the blockchain is the authoritative
> record.

Snapshot format (JSON + hash):

```json
{
  "v": 1,
  "at": "<event hash>",
  "prev": "<prev snapshot hash or null>",
  "state": { /* module state */ },
  "hash": "<sha256 of canonical snapshot without signatures or hash>",
  "signatures": [
    { "peer": "<peerId>", "sig": "<signature>" }
  ]
}
```

## 6. Snapshot Signing and Verification

- Snapshot hash MUST be computed over JCS canonical JSON without signatures.
- Signature domain separation: "clawnet:snapshot:v1:" + hash
- Each snapshot SHOULD include at least 1 peer signature.
- Peers MUST verify:
  - hash matches snapshot body
  - signatures are valid for the peer ID
  - prev links to the prior accepted snapshot
  - state reduces correctly from event log segment

Remote snapshot acceptance policy (light nodes):

- Require >= 2 distinct peer signatures
- Reject snapshots if peer signatures are not from eligible peers as defined by
  `docs/implementation/p2p-spec.md` (sybilPolicy allowlist/PoW/stake).
- Recompute hash before acceptance

Eligible peers are those authenticated via libp2p and either:
- present in a local allowlist/trust set, OR
- have passed the active sybil-resistance policy (PoW/stake) on public networks.

## 7. Indexes

- Indexes are derived and can be rebuilt
- External indexers are optional and non-authoritative

### 7.1 Event Indexer (Core Component)

The Event Indexer is a **core component** (not optional) for chain modules.
It consists of three layers:

| Component | Responsibility |
|-----------|----------------|
| `EventIndexer` | Polls on-chain events from the configured RPC endpoint at a regular interval |
| `IndexerStore` | Manages the SQLite schema, writes materialized rows, and tracks the last indexed block |
| `IndexerQuery` | Provides typed query methods (pagination, filtering) consumed by Node services |

The Indexer materializes events from all chain contracts (ClawToken,
ClawEscrow, ClawIdentity, ClawReputation, ClawContracts, ClawDAO,
ParamRegistry) into dedicated SQLite tables. If the SQLite database is lost
or corrupted, it can be fully rebuilt by re-indexing from the chain's genesis
block.

## 8. Migration

- Schema version stored in meta:version
- Migrations must be forward-only
- Node must refuse downgrade to older schema

## 9. Corruption Recovery

- If index corruption detected, rebuild from event log
- If event log corrupted, node enters quarantine mode

## 10. Light Node Pruning Rules

Light nodes MAY prune historical data while preserving verifiability:

- Keep the latest snapshot and all events after it.
- Keep event headers (hash, ts, issuer, type) for pruned history.
- Do not prune events tied to unresolved escrows, contracts, disputes, or
  governance decisions.
- Maintain a minimum history window (default 30 days or 100,000 events).
- If missing data is required, request it from peers via range requests.

## 11. Privacy

- Sensitive data must be encrypted or stored off-chain
- Only hashes stored in event log for large payloads
