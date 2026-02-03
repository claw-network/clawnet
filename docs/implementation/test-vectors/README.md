# Test Vectors

These files provide deterministic vectors for MVP validation.
They are intended to be implementation-agnostic.

Files:

- ed25519.json
- sha256.json
- aes-256-gcm.json
- jcs.json
- verify.js (optional verification helper)
- generate.js (regenerate vectors)

To regenerate vectors:

```
node docs/implementation/test-vectors/generate.js
```

To verify with Node:

```
node docs/implementation/test-vectors/verify.js
```

Note: verify.js includes a minimal JCS canonicalizer sufficient for the
included vector but not a full JCS implementation.
