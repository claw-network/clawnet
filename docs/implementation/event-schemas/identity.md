# Identity Event Schemas

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

## identity.capability.register

REQUIRED:
- did
- name
- pricing

OPTIONAL:
- description
