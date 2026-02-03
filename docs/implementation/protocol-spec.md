# Protocol Specification (Draft)

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
- No central sequencer exists. Ordering is established by local validation rules
  and optional finality heuristics.

## 2. Event Envelope

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
- ts MUST be milliseconds since epoch.
- nonce MUST be strictly increasing per issuer.
- payload MUST conform to the event type schema.
- prev MAY reference the last accepted event hash for issuer.
- sig MUST be a detached signature over canonical bytes (see Section 3).
- pub MUST match issuer DID.
- hash MUST be SHA-256(canonical bytes without hash field).

## 3. Canonical Serialization and Signing

- Canonical JSON MUST follow JCS (RFC 8785).
- The signing bytes are JCS(envelope without sig and hash fields).
- Domain separation MUST prepend the ASCII string:
  "clawtoken:event:v1:" before hashing for signature.

Signature verification:

- Extract pub key from envelope.pub (multibase).
- Verify signature over the canonical bytes with domain separation.

## 4. Replay Protection

- Each issuer maintains a monotonic nonce.
- Nodes MUST reject events where nonce <= last_accepted_nonce for issuer.
- Nodes MAY keep a short window to tolerate minor reordering but MUST NOT accept
  duplicate nonces.

## 5. Event Types and Minimal Schemas

### 5.1 identity.create

Required payload fields:

```json
{
  "did": "did:claw:...",
  "publicKey": "<multibase>",
  "document": { /* DID doc */ }
}
```

Rules:

- did MUST be derived from publicKey per crypto-spec.
- document MUST be signed by the same issuer.

### 5.2 identity.update

```json
{
  "did": "did:claw:...",
  "document": { /* new DID doc */ },
  "prevDocHash": "<hash>"
}
```

Rules:

- prevDocHash MUST match the current document hash.
- Update MUST be signed by a key authorized in current document.

### 5.3 wallet.transfer

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

- Amounts use microtoken integer strings.
- Issuer MUST control the from address.
- Balance MUST be >= amount + fee.

### 5.4 wallet.escrow.create

```json
{
  "escrowId": "escrow_...",
  "depositor": "claw1...",
  "beneficiary": "claw1...",
  "amount": "1000000",
  "rules": [ /* release rules */ ]
}
```

### 5.5 wallet.escrow.release

```json
{
  "escrowId": "escrow_...",
  "amount": "500000",
  "ruleId": "rule_1"
}
```

### 5.6 market.listing.publish

```json
{
  "listingId": "listing_...",
  "market": "info|task|capability",
  "data": { /* listing body */ }
}
```

### 5.7 market.order.create

```json
{
  "orderId": "order_...",
  "listingId": "listing_...",
  "buyer": "did:claw:...",
  "price": "1000000"
}
```

### 5.8 contract.create / contract.sign / contract.complete

Minimal rules:

- contract.create MUST be signed by initiator
- contract.sign MUST be signed by the signer DID
- contract.complete MUST be signed by both parties or authorized arbiter

### 5.9 reputation.record

```json
{
  "target": "did:claw:...",
  "dimension": "transaction|quality|fulfillment|social|behavior",
  "score": 0,
  "ref": "<event hash>"
}
```

Rules:

- ref MUST point to a valid event (e.g. completed order or contract).
- reputation.record MUST be verifiable by any node.

## 6. Validation Pipeline

Nodes MUST validate events in this order:

1. Schema validation
2. Signature verification
3. Authorization check (issuer allowed to act)
4. Replay protection (nonce)
5. State precondition checks
6. State transition application

If any step fails, the event MUST be rejected.

## 7. State Reducers

- Reducers MUST be deterministic.
- Reducers MUST be pure: same input log -> same state.
- Reducers MUST be versioned.

Conflicts:

- Two events with same nonce from same issuer: keep the lower hash and reject
  the other.
- Identity update conflicts: require prevDocHash match, else reject.

## 8. Finality (MVP)

MVP finality is probabilistic:

- An event is considered "confirmed" after N confirmations (default N=3).
- Confirmation counts are derived from peer acknowledgements and local sync.
- For high-value events, nodes MAY require higher N or arbitration.

## 9. Payload Size Limits

- Envelope size MUST be <= 1 MB.
- Larger payloads MUST be stored out-of-band (IPFS or content-addressed storage)
  with hash reference inside payload.

## 10. Versioning and Upgrades

- Envelope v indicates protocol version.
- Nodes MUST reject events with unknown major versions.
- Minor versions SHOULD be backward compatible.
- Upgrade policy is defined in rollout.md.

## 11. Decentralization Guarantees

- No event type requires a central sequencer.
- Indexers are optional and non-authoritative.
- Any node can validate from the event log alone.

## 12. Conformance Tests

- Canonical serialization test vectors
- Signature verification tests
- Reducer determinism tests
- Multi-node replay and conflict tests
