# Security & Threat Model (Draft)

> Goal: enumerate threats and required mitigations before implementation.

## 1. Threats

- Key theft
- Replay attacks
- Sybil attacks
- Eclipse attacks
- Data tampering
- Fraudulent disputes

## 2. Mitigations

- Encrypted key storage + rotation
- Nonce/timestamp signing rules
- Peer scoring + rate limits
- Multi-party arbitration

## 3. Audit Plan

- Crypto review
- Protocol implementation audit
- Smart contract review (if applicable)

## 4. Incident Response

- Key compromise procedure
- Network partition procedure

## 5. Security Testing

- Fuzzing for protocol parsers
- Penetration tests for API
