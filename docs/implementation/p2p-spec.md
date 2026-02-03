# P2P Specification (MVP Draft)

Defines network behavior for interoperable nodes. No privileged nodes.

## 1. libp2p Stack

- Transport: TCP (required), QUIC (optional)
- Security: Noise
- Multiplexing: Yamux
- Pubsub: Gossipsub

## 2. Peer Identity

- Peer ID derived from node Ed25519 public key
- Node keypair is distinct from wallet/identity keys
- Nodes MAY rotate peer keys but MUST announce rotation

### 2.1 Peer Rotation Announcement

Rotation records are signed by the old peer key and broadcast on
`/clawtoken/1.0.0/requests`:

```json
{
  "type": "peer.rotate",
  "old": "<oldPeerId>",
  "new": "<newPeerId>",
  "ts": 1700000000000,
  "sig": "<signature by old peer key>",
  "sigNew": "<optional signature by new peer key>"
}
```

## 3. Topics

- /clawtoken/1.0.0/events
- /clawtoken/1.0.0/requests
- /clawtoken/1.0.0/responses

## 4. Message Envelope

```json
{
  "v": 1,
  "topic": "/clawtoken/1.0.0/events",
  "sender": "<peerId>",
  "ts": 1700000000000,
  "payload": "<bytes>",
  "sig": "<signature>"
}
```

- payload MUST be JCS canonical bytes of the full event envelope (including sig and hash)
- sig MUST be signed by peer key
- Message envelope MUST be serialized with JCS (RFC 8785).
- payload is base64 (RFC 4648) of the canonical event bytes.
- sig is base58btc of Ed25519 signature over:
  "clawtoken:p2p:v1:" + JCS(envelope without sig).

## 5. Discovery

- DHT (Kademlia) required
- Bootstrap list optional and community-run
- Nodes MUST function with empty bootstrap in private networks

## 6. Sync Strategy

- Gossip new events over /events
- Range request for missing events
- Snapshot sync for cold start

### 6.1 Range Request

```json
{
  "type": "range.request",
  "from": "<event hash>",
  "limit": 1000
}
```

Response:

```json
{
  "type": "range.response",
  "events": ["<event bytes>"],
  "cursor": "<next hash>"
}
```

## 7. Anti-Spam

- Rate limit per peer
- Maximum envelope size 1 MB
- Peer scoring (drop low-scoring peers)

## 8. Sybil Resistance (optional)

- Proof-of-work tickets or stake gating MAY be enabled by DAO
- MUST be optional for private networks

### 8.1 Sybil Policy Modes

Nodes MUST expose a local sybilPolicy configuration:

- none: no gating; peer-count finality MUST NOT be used.
- allowlist: only peers in a local allowlist are eligible.
- pow: peers must present a valid PoW ticket.
- stake: peers must present a valid stake proof.

Eligible peers are those that pass the active policy above. Peer-count finality
MUST only count eligible peers.

### 8.2 PoW Ticket

PoW tickets are announced over `/clawtoken/1.0.0/requests`:

```json
{
  "type": "pow.ticket",
  "peer": "<peerId>",
  "ts": 1700000000000,
  "nonce": "<random>",
  "difficulty": 20,
  "hash": "<sha256 of 'clawtoken:pow:v1:' + peerId + ts + nonce>",
  "sig": "<signature by peer key>"
}
```

Validation:
- hash MUST have at least `difficulty` leading zero bits.
- ts MUST be within MAX_CLOCK_SKEW_MS (see protocol-spec constants).
- sig MUST verify for the peer key.

### 8.3 Stake Proof

Stake proofs are announced over `/clawtoken/1.0.0/requests`:

```json
{
  "type": "stake.proof",
  "peer": "<peerId>",
  "stakeEvent": "<event hash>",
  "minStake": "<microtoken>",
  "sig": "<signature by peer key>"
}
```

Validation:
- stakeEvent MUST exist in the local event log.
- stakeEvent MUST be a `wallet.stake` from the same controller DID.
- stake amount MUST be >= minStake.

## 9. NAT Traversal

- Hole punching supported
- Relay optional and community-run

## 10. Metrics

Nodes MAY expose local metrics but MUST NOT require central telemetry.
