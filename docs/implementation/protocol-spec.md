# Protocol Specification (MVP Draft)

This document defines the minimum protocol rules so any node can independently
validate state. All statements using MUST/SHOULD are normative.

## 0. Terms

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

## 2. Data Types

- Timestamp: milliseconds since Unix epoch.
- Amount: unsigned integer string in microtoken (1e-6 Token).
- DID: "did:claw:" + multibase(base58btc(Ed25519 public key)).
- Address: "claw" + base58check payload.
- Hash: lowercase hex SHA-256 digest.
- ID: ASCII string, max length 64.

## 3. Event Envelope

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
- ts MUST be within +/- 10 minutes of local time, otherwise quarantine.
- nonce MUST be strictly increasing per issuer.
- payload MUST conform to the event type schema.
- prev MAY reference the last accepted event hash for issuer.
- sig MUST be a detached signature over canonical bytes (see Section 4).
- pub MUST match issuer DID.
- hash MUST be SHA-256(canonical bytes without hash field).

## 4. Canonical Serialization and Signing

- Canonical JSON MUST follow JCS (RFC 8785).
- The signing bytes are JCS(envelope without sig and hash fields).
- Domain separation MUST prepend the ASCII string:
  "clawtoken:event:v1:" before hashing for signature.

Signature verification:

- Extract pub key from envelope.pub (multibase).
- Verify signature over the canonical bytes with domain separation.

## 5. Replay Protection

- Each issuer maintains a monotonic nonce.
- Nodes MUST reject events where nonce <= last_accepted_nonce for issuer.
- Nodes MAY keep a small acceptance window (e.g., last 5 nonces) for out-of-order
  delivery but MUST NOT accept duplicates.

## 6. Event Types and Schemas (MVP)

### 6.1 identity.create

```json
{
  "did": "did:claw:...",
  "publicKey": "<multibase>",
  "document": { /* DID doc */ }
}
```

Rules:

- did MUST be derived from publicKey per crypto-spec.
- document MUST be signed by issuer.

### 6.2 identity.update

```json
{
  "did": "did:claw:...",
  "document": { /* new DID doc */ },
  "prevDocHash": "<hash>"
}
```

Rules:

- prevDocHash MUST match current document hash.
- Update MUST be signed by a key authorized in current doc.

### 6.3 wallet.transfer

```json
{
  "from": "claw1...",
  "to": "claw1...",
  "amount": "1000000",
  "fee": "1000",
  "memo": "optional"
}
```

Rules:

- Issuer MUST control the from address.
- Balance MUST be >= amount + fee.
- fee MUST be >= minimum fee.

### 6.4 wallet.escrow.create

```json
{
  "escrowId": "escrow_...",
  "depositor": "claw1...",
  "beneficiary": "claw1...",
  "amount": "1000000",
  "rules": [ /* release rules */ ]
}
```

### 6.5 wallet.escrow.release

```json
{
  "escrowId": "escrow_...",
  "amount": "500000",
  "ruleId": "rule_1"
}
```

### 6.6 market.listing.publish

```json
{
  "listingId": "listing_...",
  "market": "info|task|capability",
  "data": { /* listing body */ }
}
```

Rules:

- listingId MUST be unique.
- data MUST include pricing and seller DID.

### 6.7 market.order.create

```json
{
  "orderId": "order_...",
  "listingId": "listing_...",
  "buyer": "did:claw:...",
  "price": "1000000"
}
```

### 6.8 contract.create / contract.sign / contract.complete

- contract.create MUST be signed by initiator.
- contract.sign MUST be signed by the signer DID.
- contract.complete MUST be signed by both parties or authorized arbiter.

### 6.9 reputation.record

```json
{
  "target": "did:claw:...",
  "dimension": "transaction|quality|fulfillment|social|behavior",
  "score": 0,
  "ref": "<event hash>"
}
```

Rules:

- ref MUST point to a valid completed event.
- record MUST be verifiable by any node.

## 7. Validation Pipeline

Nodes MUST validate events in this order:

1. Schema validation
2. Signature verification
3. Authorization check (issuer allowed to act)
4. Replay protection (nonce)
5. State precondition checks
6. State transition application

If any step fails, the event MUST be rejected.

## 8. Reducers and State

- Reducers MUST be deterministic and pure.
- Reducers MUST be versioned.

Conflicts:

- Two events with same nonce from same issuer: keep lower hash, reject other.
- identity.update conflicts: require prevDocHash match, else reject.

## 9. Finality (MVP)

- An event is considered confirmed after N confirmations (default N=3).
- High-value operations MAY require higher N or arbitration.

## 10. Payload Size Limits

- Envelope size MUST be <= 1 MB.
- Larger payloads MUST be stored out-of-band (IPFS/content hash)
  with hash reference in payload.

## 11. Versioning and Upgrades

- Envelope v indicates protocol version.
- Nodes MUST reject unknown major versions.
- Minor versions SHOULD be backward compatible.

## 12. Decentralization Guarantees

- No event type requires a central sequencer.
- Indexers are optional and non-authoritative.
- Any node can validate from the event log alone.

## 13. Conformance Tests

- Canonical serialization test vectors
- Signature verification tests
- Reducer determinism tests
- Multi-node replay and conflict tests
