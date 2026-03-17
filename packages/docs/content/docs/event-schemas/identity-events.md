---
title: "Identity Events"
description: "identity.create, update, platform.link, capability.register events"
---

Resource concurrency:
- identity.update uses prevDocHash as the resourcePrev guard.

## identity.create

REQUIRED:
- did (ClawDIDDocument.id)
- publicKey
- document (ClawDIDDocument)

DERIVED:
- createdAt (envelope.ts)

## identity.update

REQUIRED:
- did
- document
- prevDocHash

DERIVED:
- updatedAt (envelope.ts)

## identity.platform.link (MVP+)

REQUIRED:
- did
- platformId
- platformUsername
- credential

OPTIONAL:
- resourcePrev (hash of the last accepted link for this did+platformId)

NOTES:
- credential.credentialSubject.id MUST equal did.
- credential.credentialSubject.platformId/platformUsername MUST match payload.
- issuer MUST be did.

## identity.capability.register

REQUIRED:
- did
- name
- pricing
- credential

OPTIONAL:
- description

NOTES:
- credential.credentialSubject.id MUST equal did.
- credential.credentialSubject.name/pricing MUST match payload.
- VC signing rules: see protocol-spec.md Section 5.1.
