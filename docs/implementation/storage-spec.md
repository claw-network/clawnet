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
- meta:version -> schema version

## 4. Event Log

- Immutable records
- Hash must match envelope hash
- Garbage collection not permitted for confirmed events

## 5. State Snapshots

- Snapshot every 10,000 events (configurable)
- Snapshot includes module state + last event hash

Snapshot format (JSON + hash):

```json
{
  "v": 1,
  "at": "<event hash>",
  "state": { /* module state */ }
}
```

## 6. Indexes

- Indexes are derived and can be rebuilt
- External indexers are optional and non-authoritative

## 7. Migration

- Schema version stored in meta:version
- Migrations must be forward-only
- Node must refuse downgrade to older schema

## 8. Corruption Recovery

- If index corruption detected, rebuild from event log
- If event log corrupted, node enters quarantine mode

## 9. Privacy

- Sensitive data must be encrypted or stored off-chain
- Only hashes stored in event log for large payloads
