---
title: "Security & Threat Model"
description: "Seven threat categories with mitigations, audit plan, incident response"
---

## 1. Threats

- Key theft
- Replay and double-spend
- Sybil attacks
- Eclipse attacks
- Data tampering
- Fraudulent disputes
- Malicious indexers

## 2. Mitigations

- Encrypted key storage + rotation
- Strict nonce + timestamp validation
- Peer scoring and rate limits
- Multi-party arbitration for disputes
- Indexer outputs are non-authoritative

## 3. Security Requirements

- All events MUST be signed and verified
- Nonces MUST be monotonic per issuer
- Nodes MUST reject invalid signatures and schema violations

## 4. Audit Plan

- Crypto review before testnet
- Protocol implementation audit before mainnet
- Smart contract audit if on-chain components are used

## 5. Incident Response

- Key compromise: rotate keys, publish revocation event
- Network partition: freeze high-value operations
- High-value = top finality tier (see FINALITY_TIERS). Nodes SHOULD reject
  new high-value transfers during partition detection and rely on
  time-based finality only until the partition clears.
- Critical bug: emergency DAO vote to pause affected modules

## 6. Security Testing

- Fuzz parsers for event envelopes
- Adversarial multi-node tests
- Pen tests for API surfaces
