---
title: "Crypto Specification"
description: "Ed25519, X25519, SHA-256, AES-256-GCM, Argon2id cryptographic primitives"
---

Defines cryptographic primitives, key formats, and signing rules.
All parameters are defaults unless overridden by DAO governance.

## 1. Algorithms (MVP)

- Signatures: Ed25519
- Key agreement: X25519
- Hashing: SHA-256 (protocol), BLAKE3 (content)
- Symmetric encryption: AES-256-GCM
- KDF: Argon2id (passwords), HKDF-SHA256 (derivations)

## 2. Key Formats

### 2.1 Public Keys

- Encoding: multibase base58btc
- Example: z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH

### 2.2 Private Keys

- Stored encrypted at rest
- Encryption: AES-256-GCM
- Key derivation: Argon2id with salt

### 2.3 Key IDs

- Key ID = SHA-256(multibase(publicKey))
- Used for rotation and audit

## 3. DID Derivation

- DID method: did:claw
- DID = "did:claw:" + multibase(base58btc(Ed25519 public key))
- DID document MUST include verification methods for keys in use

## 4. Address Derivation

- Address = "claw" + base58btc(version + publicKey + checksum)
- Version byte = 0x00
- Checksum = first 4 bytes of SHA-256(publicKey)
- Note: this is not Bitcoin base58check (single SHA-256 checksum only).

## 5. Signing Rules

- Detached Ed25519 signatures
- Signing payload = "clawnet:event:v1:" + JCS(envelope without sig/hash)
- Signature encoded as base58btc

## 6. Encryption At Rest

### 6.1 Argon2id Defaults

- time cost: 3
- memory: 65536 KB
- parallelism: 4
- output length: 32 bytes

### 6.2 AES-256-GCM Defaults

- nonce: 12 bytes random
- tag: 16 bytes

Stored format:

```json
{
  "kdf": "argon2id",
  "salt": "<base64>",
  "nonce": "<base64>",
  "ciphertext": "<base64>",
  "tag": "<base64>"
}
```

## 7. Key Rotation

- Operational keys SHOULD rotate every 90 days or 100k signatures
- Rotation events MUST be recorded in the event log
- Old keys remain valid for verification, not for signing

## 8. Social Recovery

- Recovery uses Shamir secret sharing (t of n)
- Guardians MUST be independent DIDs
- Recovery events MUST be signed by at least t guardians

## 9. Test Vectors (MVP)

Test vectors are stored in `docs/implementation/test-vectors/`:

- ed25519.json
- sha256.json
- aes-256-gcm.json
- jcs.json

An optional verification helper is provided:

```
node docs/implementation/test-vectors/verify.js
```

## 10. Security Considerations

- Never sign non-canonical bytes
- Reject signatures from keys not authorized by DID document
- Enforce password length >= 12
