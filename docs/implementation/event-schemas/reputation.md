# Reputation Event Schemas

## reputation.record

REQUIRED:
- target
- dimension
- score
- ref

OPTIONAL:
- comment
- aspects (keys: communication|quality|timeliness|professionalism, values 1-5)

DERIVED:
- createdAt (envelope.ts)
