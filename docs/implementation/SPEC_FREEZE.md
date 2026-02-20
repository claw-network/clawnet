# Spec Freeze (MVP)

Date: 2026-02-03
Version: v1.0.0-mvp
Status: Frozen for implementation

## Scope (Documents Locked)

- docs/implementation/protocol-spec.md
- docs/implementation/crypto-spec.md
- docs/implementation/p2p-spec.md
- docs/implementation/p2p-spec.fbs
- docs/implementation/storage-spec.md
- docs/implementation/economics.md
- docs/implementation/security.md
- docs/implementation/testing-plan.md
- docs/implementation/rollout.md
- docs/implementation/event-schemas/*.md
- docs/api/openapi.yaml
- docs/implementation/tasks/min-api-draft.md

## Constraints

- Smallest unit = 1 Token.
- Minimum fee = 1 Token.
- Minimum transfer/escrow amount = 1 Token.
- P2P contentType = application/clawnet-stream (FlatBuffers only).

## Change Control

- Any change requires: issue + RFC + version bump + changelog entry.
- Breaking change requires: new topic prefix and contentType version suffix.

## Sign-off

- [ ] Protocol Lead: __________________ (Date: ____-__-__)
- [ ] Security Lead: __________________ (Date: ____-__-__)
- [ ] Engineering Lead: ______________ (Date: ____-__-__)
