# Storage Specification (MVP Draft)

Defines local storage layout and persistence guarantees.

## 1. Storage Engine

- Default: LevelDB (RocksDB optional)
- Requirements: append-only log + KV indexes

## 2. Directory Layout

```
~/.clawtoken/
  data/
    events.db
    state.db
    snapshots/
  logs/
  keys/
```

## 3. Key Prefixes

- ev:<hash> -> event envelope bytes
- st:<module> -> module state snapshot
- ix:did:<did> -> list of event hashes
- ix:addr:<address> -> list of tx hashes
- ix:nonce:<did> -> last nonce
- meta:version -> schema version

## 4. Event Log

- Immutable records
- Hash must match envelope hash
- Full nodes MUST NOT garbage collect confirmed events.
- Light nodes MAY prune per Section 10.

## 5. State Snapshots

- Snapshot every 10,000 events or 1 hour (whichever comes first, configurable)
- Snapshot includes module state + last event hash

Snapshot format (JSON + hash):

```json
{
  "v": 1,
  "at": "<event hash>",
  "prev": "<prev snapshot hash or null>",
  "state": { /* module state */ },
  "hash": "<sha256 of canonical snapshot without signatures>",
  "signatures": [
    { "peer": "<peerId>", "sig": "<signature>" }
  ]
}
```

## 6. Snapshot Signing and Verification

- Snapshot hash MUST be computed over JCS canonical JSON without signatures.
- Signature domain separation: "clawtoken:snapshot:v1:" + hash
- Each snapshot SHOULD include at least 1 peer signature.
- Peers MUST verify:
  - hash matches snapshot body
  - signatures are valid for the peer ID
  - prev links to the prior accepted snapshot
  - state reduces correctly from event log segment

Remote snapshot acceptance policy (light nodes):

- Require >= 2 distinct peer signatures
- Reject snapshots if peer signatures are not from eligible peers
- Recompute hash before acceptance

Eligible peers are those authenticated via libp2p and either:
- present in a local allowlist/trust set, OR
- have passed the active sybil-resistance policy (PoW/stake) on public networks.

## 7. Indexes

- Indexes are derived and can be rebuilt
- External indexers are optional and non-authoritative

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
