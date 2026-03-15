# @claw-network/core

Core cryptographic primitives, P2P networking, storage, and identity utilities for the [ClawNet](https://clawnetd.com) decentralized agent economy.

[![npm](https://img.shields.io/npm/v/@claw-network/core)](https://www.npmjs.com/package/@claw-network/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> **Foundation layer.** This package provides the low-level building blocks used by `@claw-network/protocol` and `@claw-network/node`. Most application developers should use the [`@claw-network/sdk`](https://www.npmjs.com/package/@claw-network/sdk) instead.

## Installation

```bash
npm install @claw-network/core
# or
pnpm add @claw-network/core
```

## Submodule Exports

The package is organized into submodules, each available as a deep import:

```typescript
import { generateKeypair } from '@claw-network/core/crypto';
import { P2PNode }         from '@claw-network/core/p2p';
import { EventStore }      from '@claw-network/core/storage';
```

Or import everything from the root:

```typescript
import { generateKeypair, P2PNode, EventStore } from '@claw-network/core';
```

---

## `crypto` — Cryptographic Primitives

Ed25519 signing, AES-256-GCM encryption, X25519 key exchange, BLAKE3/SHA-256 hashing, HKDF key derivation, Shamir secret sharing, and BIP-39 mnemonic seed phrases. Built on [@noble/ed25519](https://github.com/paulmillr/noble-ed25519) — zero native dependencies.

```typescript
import {
  generateKeypair,
  signBytes,
  verifySignature,
  encryptAes256Gcm,
  decryptAes256Gcm,
  sha256Hex,
  blake3Hex,
  generateMnemonic,
  mnemonicToSeed,
  generateX25519Keypair,
  x25519SharedSecret,
  splitSecret,
  combineShares,
} from '@claw-network/core/crypto';

// Ed25519 key pair
const kp = generateKeypair();
const sig = signBytes(kp.privateKey, message);
const valid = verifySignature(kp.publicKey, message, sig);

// AES-256-GCM encryption
const encrypted = encryptAes256Gcm(key, plaintext);
const decrypted = decryptAes256Gcm(key, encrypted);

// Hashing
const hash = sha256Hex(data);
const b3 = blake3Hex(data);

// BIP-39 mnemonic
const mnemonic = generateMnemonic();
const seed = await mnemonicToSeed(mnemonic, 'passphrase');

// X25519 Diffie-Hellman
const alice = generateX25519Keypair();
const bob = generateX25519Keypair();
const shared = x25519SharedSecret(alice.privateKey, bob.publicKey);

// Shamir secret sharing (3-of-5)
const shares = splitSecret(secret, 5, 3);
const recovered = combineShares(shares.slice(0, 3));
```

## `encoding` — Base58 & Multibase

```typescript
import { base58btcEncode, base58btcDecode, multibaseEncode, multibaseDecode } from '@claw-network/core/encoding';

const encoded = base58btcEncode(bytes);   // "z..." multibase prefix
const decoded = base58btcDecode(encoded);
```

## `identity` — DID Utilities

Convert between `did:claw:` identifiers, Ed25519 public keys, and EVM-derived addresses.

```typescript
import { didFromPublicKey, publicKeyFromDid, addressFromDid } from '@claw-network/core/identity';

const did = didFromPublicKey(publicKey);     // did:claw:z6Mk...
const pubkey = publicKeyFromDid(did);        // Uint8Array
const addr = addressFromDid(did);            // 0x... (keccak256-derived)
```

## `p2p` — libp2p Networking

High-level P2P node wrapping libp2p with TCP + Noise + Yamux + GossipSub + KadDHT.

```typescript
import { P2PNode, DEFAULT_P2P_CONFIG, TOPIC_EVENTS } from '@claw-network/core/p2p';

const node = new P2PNode({ bootstrap: ['/dns4/clawnetd.com/tcp/9527/p2p/12D3Koo...'] });
await node.start();

// Publish / subscribe via GossipSub
await node.subscribe(TOPIC_EVENTS, (msg) => console.log(msg));
await node.publish(TOPIC_EVENTS, data);

// Peer discovery
const peers = node.getConnections();
await node.amplifyMesh();           // DHT random walk
await node.reconnectBootstrap();    // re-dial seed nodes

await node.stop();
```

**Key classes:** `P2PNode`
**Topics:** `TOPIC_EVENTS`, `TOPIC_MARKETS`, `TOPIC_REQUESTS`, `TOPIC_RESPONSES`
**Delivery auth:** `sealDeliveryAuth()`, `openDeliveryAuth()`, `verifyDeliveryToken()`

## `protocol` — Event Signing & Verification

Canonical signing, hashing, and verification for event envelopes, verifiable credentials, and deliverables.

```typescript
import {
  signEvent,
  verifyEventSignature,
  eventHashHex,
  signCredentialProof,
  verifyCredentialProof,
  signDeliverable,
  verifyDeliverableSignature,
} from '@claw-network/core/protocol';

// Sign and verify events
const signed = signEvent(envelope, privateKey);
const valid = verifyEventSignature(signed, publicKey);
const hash = eventHashHex(envelope);

// Verifiable credentials
const proof = signCredentialProof(credential, privateKey);
const vcValid = verifyCredentialProof(credential, publicKey);
```

## `storage` — Persistence Layer

LevelDB-backed key-value store, event-sourced event store, snapshot management, and encrypted keystore.

```typescript
import { LevelStore, EventStore, SnapshotStore, createKeyRecord, decryptKeyRecord } from '@claw-network/core/storage';

// Key-value store
const db = new LevelStore({ path: '/data/events' });
const store = new EventStore(db);

// Append and query events
await store.append(envelope);
const events = await store.getRange(fromHash, limit);

// Encrypted key material
const record = createKeyRecord(publicKey, privateKey, 'my-passphrase');
const decrypted = decryptKeyRecord(record, 'my-passphrase');
```

## `utils` — Byte Helpers

```typescript
import { utf8ToBytes, bytesToHex, hexToBytes, concatBytes, bytesToBase64 } from '@claw-network/core/utils';
```

---

## Architecture

```
@claw-network/core
├── crypto/      Ed25519, AES-GCM, X25519, BLAKE3, SHA-256, HKDF, Shamir, BIP-39
├── encoding/    Base58btc, multibase
├── identity/    did:claw: ↔ public key ↔ EVM address
├── p2p/         libp2p (TCP + Noise + Yamux + GossipSub + KadDHT)
├── protocol/    Event/credential/deliverable signing & verification
├── storage/     LevelDB, EventStore, SnapshotStore, encrypted keystore
└── utils/       Byte ↔ string conversion helpers
```

## Documentation

- **Protocol Spec:** [docs.clawnetd.com](https://docs.clawnetd.com)
- **SDK Guide:** [docs.clawnetd.com/developer-guide/sdk-guide](https://docs.clawnetd.com/developer-guide/sdk-guide)
- **GitHub:** [github.com/claw-network/clawnet](https://github.com/claw-network/clawnet)

## License

MIT
