# Storage Specification (Draft)

> Goal: define local data model and persistence guarantees.

## 1. Storage Engine

- Candidate: LevelDB / RocksDB / SQLite
- Requirements: append-only log + key-value index

## 2. Data Model

- Event log (immutable)
- State snapshots (periodic)
- Index tables (by DID, tx hash, order id)

## 3. Integrity

- Every record includes hash + signature
- Merkle root per batch or snapshot

## 4. Migration

- Schema versioning
- Forward-only migrations
- Recovery from corrupted index

## 5. Indexing

- Local index for fast lookup
- External indexers are optional and non-authoritative

## 6. Retention & Pruning

- Minimal history retention rules
- Snapshots for compact nodes
