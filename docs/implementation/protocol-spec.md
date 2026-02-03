# Protocol Specification (MVP Draft)

This document defines the minimum protocol rules so any node can independently
validate state. All statements using MUST/SHOULD are normative.

## 0. Conventions

- MUST, SHOULD, MAY are as defined in RFC 2119.
- Event: an authenticated state transition message.
- Node: a participant that validates events and maintains local state.
- Canonical serialization: deterministic byte encoding used for signing.

## 1. System Model

- The protocol is event-sourced.
- Nodes store an append-only event log and derive state via deterministic reducers.
- There is no central sequencer. Ordering is established by local validation
  rules and optional finality heuristics.
- Indexers are optional and non-authoritative.

## 2. Constants (MVP defaults)

- MAX_EVENT_SIZE = 1_000_000 bytes
- MAX_CLOCK_SKEW_MS = 10 * 60 * 1000
- NONCE_WINDOW = 5 (out-of-order tolerance window)
- FINALITY_TIME_MS = 30 * 60 * 1000
- FINALITY_TIERS (amount -> peer count):
  - <= 100_000_000 microtoken (100 Token): N=3
  - <= 1_000_000_000 microtoken (1,000 Token): N=5
  - > 1_000_000_000 microtoken: N=7
- DEFAULT_FINALITY_N = 3 (used when event has no amount)

All constants are DAO-controlled unless marked fixed.

## 3. Data Types

- Timestamp: milliseconds since Unix epoch.
- Amount: unsigned integer string in microtoken (1e-6 Token).
- DID: "did:claw:" + multibase(base58btc(Ed25519 public key)).
- Address: "claw" + base58(version + publicKey + checksum).
- Checksum: first 4 bytes of SHA-256(publicKey).
- Hash: lowercase hex SHA-256 digest.
- ID: ASCII string, max length 64.

## 4. Event Envelope

All protocol events MUST be wrapped in an envelope:

```json
{
  "v": 1,
  "type": "wallet.transfer",
  "issuer": "did:claw:...",
  "ts": 1700000000000,
  "nonce": 42,
  "payload": { /* type-specific */ },
  "prev": "<optional previous event hash>",
  "sig": "<detached signature>",
  "pub": "<issuer public key>",
  "hash": "<sha256 of canonical bytes>"
}
```

Rules:

- v MUST be the protocol version.
- issuer MUST be a valid did:claw DID.
- ts MUST be within +/- MAX_CLOCK_SKEW_MS or be quarantined.
- nonce MUST be strictly increasing per issuer.
- payload MUST conform to the event type schema.
- prev MAY reference the last accepted event hash for issuer.
- sig MUST be a detached signature over canonical bytes (see Section 5).
- pub MUST match issuer DID.
- hash MUST be SHA-256(canonical bytes without sig and hash fields).

## 5. Canonical Serialization and Signing

- Canonical JSON MUST follow JCS (RFC 8785).
- The signing bytes are JCS(envelope without sig and hash fields).
- Domain separation MUST prepend the ASCII string:
  "clawtoken:event:v1:" before hashing for signature.
- Event hash MUST be SHA-256(JCS(envelope without sig and hash fields)).

Signature verification:

- Extract pub key from envelope.pub (multibase).
- Verify signature over canonical bytes with domain separation.

## 6. Replay Protection

- Each issuer maintains a monotonic nonce.
- Nodes MUST track committedNonce per issuer (highest contiguous accepted nonce).
- Nodes MUST reject events where nonce <= committedNonce.
- Nodes MAY buffer events with nonce in (committedNonce, committedNonce + NONCE_WINDOW].
- Buffered events MUST be applied in nonce order once gaps are filled.
- Events beyond the NONCE_WINDOW MUST be rejected.

## 7. Event Types (Aligned with WALLET/MARKETS/CONTRACTS)

The following event names align with:
- `docs/WALLET.md` (transactions, escrow, permissions)
- `docs/MARKETS.md` (listing, order, bid, submission, dispute)
- `docs/SERVICE_CONTRACTS.md` (contract lifecycle, milestones, disputes)

### 7.1 Identity

- identity.create (MVP)
- identity.update (MVP)
- identity.platform.link (MVP+)
- identity.capability.register (MVP)

### 7.2 Wallet (TransactionType alignment)

- wallet.transfer (MVP)
- wallet.escrow.create (MVP)
- wallet.escrow.fund (MVP)
- wallet.escrow.release (MVP)
- wallet.escrow.refund (MVP)
- wallet.escrow.dispute (MVP+)
- wallet.stake (MVP+)
- wallet.unstake (MVP+)
- wallet.governance.lock (MVP+)
- wallet.governance.unlock (MVP+)
- wallet.fee (system)
- wallet.reward (system)
- wallet.mint (system)
- wallet.burn (system)

### 7.3 Markets

- market.listing.publish (MVP)
- market.listing.update (MVP)
- market.listing.remove (MVP+)
- market.order.create (MVP)
- market.order.update (MVP)
- market.bid.submit (Task market, MVP+)
- market.bid.accept (Task market, MVP+)
- market.bid.reject (Task market, MVP+)
- market.bid.withdraw (Task market, MVP+)
- market.submission.submit (Task market, MVP+)
- market.submission.review (Task market, MVP+)
- market.subscription.start (Info market, MVP+)
- market.subscription.cancel (Info market, MVP+)
- market.capability.lease.start (Capability market, MVP+)
- market.capability.lease.pause (Capability market, MVP+)
- market.capability.lease.resume (Capability market, MVP+)
- market.capability.lease.terminate (Capability market, MVP+)
- market.capability.invoke (Capability usage record, MVP+)
- market.dispute.open (MVP+)
- market.dispute.response (MVP+)
- market.dispute.resolve (MVP+)

### 7.4 Service Contracts

- contract.create (MVP)
- contract.negotiate.offer (MVP+)
- contract.negotiate.counter (MVP+)
- contract.negotiate.accept (MVP+)
- contract.sign (MVP)
- contract.activate (MVP)
- contract.milestone.submit (MVP+)
- contract.milestone.approve (MVP+)
- contract.milestone.reject (MVP+)
- contract.complete (MVP)
- contract.dispute.open (MVP+)
- contract.dispute.resolve (MVP+)
- contract.settlement.execute (MVP+)
- contract.terminate (MVP)

### 7.5 Reputation

- reputation.record (MVP)

## 8. Detailed Event Schemas (Field-Level Alignment)

Field-level schemas are maintained in dedicated files for versioning and reuse:

- `docs/implementation/event-schemas/identity.md`
- `docs/implementation/event-schemas/wallet.md`
- `docs/implementation/event-schemas/markets.md`
- `docs/implementation/event-schemas/contracts.md`
- `docs/implementation/event-schemas/reputation.md`

## 9. Validation Pipeline

Nodes MUST validate events in this order:

1. Schema validation
2. Signature verification
3. Authorization check (issuer allowed to act)
4. Replay protection (nonce)
5. State precondition checks
6. State transition application

If any step fails, the event MUST be rejected.

Authorization rules (examples):
- For wallet.transfer, issuer MUST control the from account (DID or address).

## 10. Reducers and State

- Reducers MUST be deterministic and pure.
- Reducers MUST be versioned.
- State is derived solely from validated events.

Conflict rules:

- Two events with same nonce from same issuer: keep lower hash, reject other.
- identity.update conflicts: require prevDocHash match, else reject.
- order update conflicts: accept only valid forward transitions.
- Resource conflicts: for any event that mutates a resource identified by a
  stable id (e.g., escrowId, contractId, orderId, listingId, leaseId, disputeId),
  payload MUST include resourcePrev (hash of last accepted event for that
  resource). If the resource already exists and resourcePrev is missing or does
  not match, reject. For create events, resourcePrev MAY be omitted or null.
  If two events share the same resourcePrev, keep lower hash and reject others.

## 11. Finality (MVP)

- An event is considered confirmed after:
  - observed from N distinct peers according to FINALITY_TIERS OR
  - FINALITY_TIME_MS without conflicting events.
- Tiered N is based on event amount (see Section 2).
- Arbitration MAY be triggered when conflicting events exist.
- If an event has no amount field, use DEFAULT_FINALITY_N.
- Peer-count finality MUST only be used when sybil resistance is enabled
  (PoW/stake) or peers are from a local allowlist. Otherwise, nodes MUST
  fall back to time-based finality only. See `docs/implementation/p2p-spec.md`
  Section 8 for eligible peer policy.

These thresholds are local policy and DAO-controlled. Recommendation adopted:
use tiered N (3/5/7) based on amount with optional arbitration on disputes.

## 12. Payload Size Limits

- Envelope size MUST be <= MAX_EVENT_SIZE.
- Larger payloads MUST be stored out-of-band (IPFS/content hash)
  with hash reference in payload.

## 13. Versioning and Upgrades

- Envelope v indicates protocol version.
- Nodes MUST reject unknown major versions.
- Minor versions SHOULD be backward compatible.

## 14. Decentralization Guarantees

- No event type requires a central sequencer.
- Indexers are optional and non-authoritative.
- Any node can validate from the event log alone.

## 15. Conformance Tests

- Canonical serialization test vectors
- Signature verification tests
- Reducer determinism tests
- Multi-node replay and conflict tests
