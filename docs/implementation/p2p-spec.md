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

- payload MUST be canonical bytes of the event envelope
- sig MUST be signed by peer key

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

## 9. NAT Traversal

- Hole punching supported
- Relay optional and community-run

## 10. Metrics

Nodes MAY expose local metrics but MUST NOT require central telemetry.
