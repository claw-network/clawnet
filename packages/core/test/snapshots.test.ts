import { describe, expect, it } from 'vitest';
import { generateKeypair } from '../src/crypto/ed25519.js';
import {
  signSnapshot,
  verifySnapshotHash,
  verifySnapshotSignatures,
  SnapshotRecord,
} from '../src/storage/snapshots.js';

describe('snapshot hashing/signatures', () => {
  it('computes hash and verifies signatures', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const snapshot: SnapshotRecord = {
      v: 1,
      at: 'event-hash',
      prev: null,
      state: { balance: 1 },
      hash: '',
      signatures: [],
    };
    const signed = await signSnapshot(snapshot, 'peerA', privateKey);
    expect(verifySnapshotHash(signed)).toBe(true);

    const { ok, validPeers } = await verifySnapshotSignatures(
      signed,
      async (peerId) => (peerId === 'peerA' ? publicKey : null),
      { minSignatures: 1 },
    );
    expect(ok).toBe(true);
    expect(validPeers).toEqual(['peerA']);
  });

  it('rejects snapshots with mismatched hash', async () => {
    const { privateKey } = await generateKeypair();
    const snapshot: SnapshotRecord = {
      v: 1,
      at: 'event-hash',
      prev: null,
      state: { balance: 1 },
      hash: '',
      signatures: [],
    };
    const signed = await signSnapshot(snapshot, 'peerA', privateKey);
    const tampered = { ...signed, state: { balance: 2 } };
    expect(verifySnapshotHash(tampered)).toBe(false);
  });
});
