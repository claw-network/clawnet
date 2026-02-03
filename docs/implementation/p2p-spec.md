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

PeerId validation:
- Implementations MUST verify that the peerId is derived from the presented
  public key per libp2p multihash rules for Ed25519 keys.

### 2.1 Peer Rotation Announcement

Rotation records are RequestMessage bodies (see Section 4.1) and broadcast on
`/clawtoken/1.0.0/requests`.

## 3. Topics

- /clawtoken/1.0.0/events
- /clawtoken/1.0.0/requests
- /clawtoken/1.0.0/responses

## 4. Message Envelope

The P2P envelope MUST be encoded as FlatBuffers with content type
`application/clawtoken-stream`. JSON envelopes are not supported.

Schema file:
- `docs/implementation/p2p-spec.fbs`

FlatBuffers schema (excerpt):

```fbs
table P2PEnvelope {
  v:ushort;
  topic:string;
  sender:string;
  ts:ulong;
  contentType:string; // MUST be "application/clawtoken-stream"
  payload:[ubyte];
  sig:string;         // base58btc Ed25519 signature
}
```

### 4.2 Codegen & Language Support

Supported targets (MVP):
- TypeScript/JavaScript (Node)
- Go
- Rust
- Python (optional tooling)

Code generation examples (flatc >= 23.5):

```bash
# TypeScript (ES module output)
flatc --ts --gen-mutable --gen-object-api -o packages/protocol/src/p2p docs/implementation/p2p-spec.fbs

# Go
flatc --go -o packages/protocol/src/p2p docs/implementation/p2p-spec.fbs

# Rust
flatc --rust -o packages/protocol/src/p2p docs/implementation/p2p-spec.fbs

# Python (optional tooling)
flatc --python -o tools/p2p_schema docs/implementation/p2p-spec.fbs
```

### 4.3 Version Compatibility

- Schema versioning: bump `p2p-spec.fbs` with SemVer in a changelog entry.
- Backward compatibility: only add new fields with default values; never rename
  or change field types in place.
- Forward compatibility: consumers MUST ignore unknown fields and preserve
  unknown data if re-encoding is required.
- Breaking changes require a new topic prefix (e.g., `/clawtoken/2.0.0/*`) and
  a new content type version suffix (`application/clawtoken-stream;v=2`).

Encoding rules:
- Message envelope MUST be serialized as FlatBuffers with the schema above.
- payload is raw bytes; its meaning depends on the topic (Section 4.1).
- FlatBuffers builders MUST NOT force default values; serialization MUST be
  deterministic for identical inputs.

Signature rules:
- sig MUST be signed by peer key.
- Signing bytes are: "clawtoken:p2p:v1:" + FlatBuffers bytes of the envelope
  with sig set to empty.

### 4.1 Payload Message Types (FlatBuffers)

- /events: payload MUST be the canonical bytes of the full event envelope
  (including sig and hash) as defined in `protocol-spec.md`.
- /requests: payload MUST be a FlatBuffers RequestMessage.
- /responses: payload MUST be a FlatBuffers ResponseMessage.

FlatBuffers schema (excerpt):

```fbs
enum RequestType : byte { range_request = 1, peer_rotate = 2, pow_ticket = 3, stake_proof = 4 }
enum ResponseType : byte { range_response = 1 }

table RequestMessage {
  type:RequestType;
  rangeRequest:RangeRequest;
  peerRotate:PeerRotate;
  powTicket:PowTicket;
  stakeProof:StakeProof;
}

table ResponseMessage {
  type:ResponseType;
  rangeResponse:RangeResponse;
}
```

Only the field corresponding to `type` MUST be set; all other fields MUST be null.

## 5. Discovery

- DHT (Kademlia) required
- Bootstrap list optional and community-run
- Nodes MUST function with empty bootstrap in private networks

## 6. Sync Strategy

- Gossip new events over /events
- Range request for missing events
- Snapshot sync for cold start

### 6.1 Range Request

Range requests/responses are carried in RequestMessage/ResponseMessage payloads.

FlatBuffers schema (excerpt):

```fbs
table RangeRequest {
  from:string;  // event hash
  limit:uint;
}

table EventBytes {
  data:[ubyte];
}

table RangeResponse {
  events:[EventBytes]; // canonical event bytes
  cursor:string;
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

PoW tickets are RequestMessage bodies (PowTicket) announced over
`/clawtoken/1.0.0/requests`.

Validation:
- hash MUST have at least `difficulty` leading zero bits.
- ts MUST be within MAX_CLOCK_SKEW_MS (see protocol-spec constants).
- sig MUST verify for the peer key.
- PoW signing bytes: FlatBuffers bytes of PowTicket with sig empty, prefixed by
  "clawtoken:pow:v1:".

PoW hash bytes:
- "clawtoken:pow:v1:" + FlatBuffers bytes of PowTicket with hash/sig empty.
- hash MUST equal lowercase hex SHA-256 of the PoW hash bytes.

### 8.3 Stake Proof

Stake proofs are RequestMessage bodies (StakeProof) announced over
`/clawtoken/1.0.0/requests`.

Validation:
- stakeEvent MUST exist in the local event log.
- stakeEvent MUST be a `wallet.stake` from the controller DID.
- stake amount MUST be >= minStake.
- sig MUST verify for the peer key.
- sigController MUST verify for the controller DID key over the stake proof body.
  This serves as the only binding between peerId and controller DID for stake
  gating; no separate peerId↔DID mapping is required.

Stake proof signing bytes:
- FlatBuffers bytes of StakeProof with sig/sigController empty, prefixed by
  "clawtoken:stakeproof:v1:".

FlatBuffers schema (excerpt):

```fbs
table PeerRotate {
  old:string;
  new:string;
  ts:ulong;
  sig:string;
  sigNew:string;
}

table PowTicket {
  peer:string;
  ts:ulong;
  nonce:string;
  difficulty:uint;
  hash:string;
  sig:string;
}

table StakeProof {
  peer:string;
  controller:string;   // did:claw
  stakeEvent:string;   // event hash
  minStake:string;     // token
  sig:string;
  sigController:string;
}
```

## 9. NAT Traversal

- Hole punching supported
- Relay optional and community-run

## 10. Metrics

Nodes MAY expose local metrics but MUST NOT require central telemetry.
