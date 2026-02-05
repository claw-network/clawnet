import { describe, expect, it } from 'vitest';
import { generateKeypair } from '@clawtoken/core/crypto';
import {
  createDIDDocument,
  getPrimaryPublicKey,
  validateDIDDocument,
  MemoryDIDResolver,
} from '../src/identity/index.js';

describe('identity document', () => {
  it('creates and validates a DID document', async () => {
    const { publicKey } = await generateKeypair();
    const doc = createDIDDocument({ publicKey });
    const { valid, errors } = validateDIDDocument(doc);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
    const extracted = getPrimaryPublicKey(doc);
    expect(extracted).toEqual(publicKey);
  });

  it('resolves stored documents', async () => {
    const { publicKey } = await generateKeypair();
    const doc = createDIDDocument({ publicKey });
    const resolver = new MemoryDIDResolver();
    await resolver.store(doc);
    const resolved = await resolver.resolve(doc.id);
    expect(resolved?.id).toBe(doc.id);
  });
});
