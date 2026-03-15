import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeypair } from '@claw-network/core/crypto';
import { utf8ToBytes } from '@claw-network/core/utils';
import { EventStore, MemoryStore, SnapshotStore, signSnapshot } from '@claw-network/core/storage';
import { eventHashHex } from '@claw-network/core/protocol';
import { P2PSync } from '../src/p2p/sync.js';
import type { P2PNode } from '@claw-network/core/p2p';

// Use dynamic import for canonicalize since it's a CJS module
import canonicalizeModule from 'canonicalize';
const canonicalize = canonicalizeModule as unknown as (input: unknown) => string;

/**
 * Create a valid event with correct hash and canonical JCS bytes.
 * EventStore.appendEvent validates:
 *   1. envelope = JSON.parse(eventBytes)
 *   2. eventHashHex(envelope) === envelope.hash === passed hash
 *   3. canonicalizeBytes(envelope) === eventBytes
 */
function makeEvent(body: Record<string, unknown>): { hash: string; bytes: Uint8Array } {
  // eventHashHex strips hash/sig from envelope, then SHA-256(JCS(rest))
  const hash = eventHashHex(body);
  const envelope = { ...body, hash };
  // Must be JCS-canonical bytes of the full envelope
  const bytes = utf8ToBytes(canonicalize(envelope));
  return { hash, bytes };
}

describe('p2p sync snapshot chunking', () => {
  it('reassembles chunked snapshot responses', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'clawnet-'));
    const snapshotStore = new SnapshotStore({
      root: tempRoot,
      data: join(tempRoot, 'data'),
      logs: join(tempRoot, 'logs'),
      keys: join(tempRoot, 'keys'),
      snapshots: join(tempRoot, 'data', 'snapshots'),
      eventsDb: join(tempRoot, 'data', 'events.db'),
      stateDb: join(tempRoot, 'data', 'state.db'),
      configFile: join(tempRoot, 'config.yaml'),
    });

    const eventStore = new EventStore(new MemoryStore());
    const { privateKey, publicKey } = await generateKeypair();

    const signed = await signSnapshot(
      {
        v: 1,
        at: 'event-hash',
        prev: null,
        state: { counter: 1, note: 'chunked' },
        hash: '',
        signatures: [],
      },
      'peerA',
      privateKey,
    );

    const bytes = utf8ToBytes(JSON.stringify(signed));
    const chunkSize = 20;
    const chunkCount = Math.ceil(bytes.length / chunkSize);

    const sync = new P2PSync(
      {
        subscribe: async () => () => {},
        publish: async () => [],
        getPeerPublicKey: async () => null,
      } as unknown as P2PNode,
      eventStore,
      snapshotStore,
      {
        peerId: 'self',
        peerPrivateKey: privateKey,
        resolvePeerPublicKey: async (peerId) => (peerId === 'peerA' ? publicKey : null),
        maxSnapshotBytes: chunkSize,
        maxSnapshotTotalBytes: bytes.length,
        minSnapshotSignatures: 1,
        sybilPolicy: 'none',
        verifySnapshotState: false,
      },
    );

    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, bytes.length);
      const chunk = bytes.subarray(start, end);
      await (sync as any).applySnapshotResponse({
        hash: signed.hash,
        snapshot: chunk,
        totalBytes: bytes.length,
        chunkIndex: i,
        chunkCount,
      });
    }

    const latest = await snapshotStore.loadLatestSnapshot();
    expect(latest?.hash).toBe(signed.hash);
    expect(latest?.state).toEqual(signed.state);

    await rm(tempRoot, { recursive: true, force: true });
  });
});

describe('p2p sync snapshot state verification', () => {
  it('accepts snapshot when verifySnapshotState=true and events match (at = last event hash)', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'clawnet-'));
    const snapshotStore = new SnapshotStore({
      root: tempRoot,
      data: join(tempRoot, 'data'),
      logs: join(tempRoot, 'logs'),
      keys: join(tempRoot, 'keys'),
      snapshots: join(tempRoot, 'data', 'snapshots'),
      eventsDb: join(tempRoot, 'data', 'events.db'),
      stateDb: join(tempRoot, 'data', 'state.db'),
      configFile: join(tempRoot, 'config.yaml'),
    });

    const memStore = new MemoryStore();
    const eventStore = new EventStore(memStore);
    const { privateKey, publicKey } = await generateKeypair();

    // Append events so the event store has content
    const e1 = makeEvent({ type: 'test', ts: 1 });
    const e2 = makeEvent({ type: 'test', ts: 2 });
    await eventStore.appendEvent(e1.hash, e1.bytes);
    await eventStore.appendEvent(e2.hash, e2.bytes);

    // The snapshot's `at` field must be the hash of the last event it covers
    const lastEventHash = await eventStore.getLatestEventHash();
    expect(lastEventHash).toBe(e2.hash);

    const signed = await signSnapshot(
      {
        v: 1,
        at: lastEventHash!,  // at = last event hash, not a timestamp
        prev: null,
        state: { counter: 2 },
        hash: '',
        signatures: [],
      },
      'peerA',
      privateKey,
    );

    const bytes = utf8ToBytes(JSON.stringify(signed));

    const sync = new P2PSync(
      {
        subscribe: async () => () => {},
        publish: async () => [],
        getPeerPublicKey: async () => null,
      } as unknown as P2PNode,
      eventStore,
      snapshotStore,
      {
        peerId: 'self',
        peerPrivateKey: privateKey,
        resolvePeerPublicKey: async (peerId) => (peerId === 'peerA' ? publicKey : null),
        maxSnapshotBytes: bytes.length,
        maxSnapshotTotalBytes: bytes.length * 2,
        minSnapshotSignatures: 1,
        sybilPolicy: 'none',
        verifySnapshotState: true,
        validateSnapshotState: async (_snapshot, events) => {
          // Simple validation: we got some events
          return events.length === 2;
        },
      },
    );

    await (sync as any).applySnapshotResponse({
      hash: signed.hash,
      snapshot: bytes,
      totalBytes: bytes.length,
      chunkIndex: 0,
      chunkCount: 1,
    });

    const latest = await snapshotStore.loadLatestSnapshot();
    expect(latest?.hash).toBe(signed.hash);

    await rm(tempRoot, { recursive: true, force: true });
  });

  it('rejects snapshot when verifySnapshotState=true and at field does not match any event hash', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'clawnet-'));
    const snapshotStore = new SnapshotStore({
      root: tempRoot,
      data: join(tempRoot, 'data'),
      logs: join(tempRoot, 'logs'),
      keys: join(tempRoot, 'keys'),
      snapshots: join(tempRoot, 'data', 'snapshots'),
      eventsDb: join(tempRoot, 'data', 'events.db'),
      stateDb: join(tempRoot, 'data', 'state.db'),
      configFile: join(tempRoot, 'config.yaml'),
    });

    const memStore = new MemoryStore();
    const eventStore = new EventStore(memStore);
    const { privateKey, publicKey } = await generateKeypair();

    const e1 = makeEvent({ type: 'test', ts: 1 });
    await eventStore.appendEvent(e1.hash, e1.bytes);

    // Snapshot at = bogus value that doesn't match any event hash
    const signed = await signSnapshot(
      {
        v: 1,
        at: 'nonexistent-hash',
        prev: null,
        state: { counter: 1 },
        hash: '',
        signatures: [],
      },
      'peerA',
      privateKey,
    );

    const bytes = utf8ToBytes(JSON.stringify(signed));

    const sync = new P2PSync(
      {
        subscribe: async () => () => {},
        publish: async () => [],
        getPeerPublicKey: async () => null,
      } as unknown as P2PNode,
      eventStore,
      snapshotStore,
      {
        peerId: 'self',
        peerPrivateKey: privateKey,
        resolvePeerPublicKey: async (peerId) => (peerId === 'peerA' ? publicKey : null),
        maxSnapshotBytes: bytes.length,
        maxSnapshotTotalBytes: bytes.length * 2,
        minSnapshotSignatures: 1,
        sybilPolicy: 'none',
        verifySnapshotState: true,
        validateSnapshotState: async () => true, // would accept, but events won't collect
      },
    );

    await (sync as any).applySnapshotResponse({
      hash: signed.hash,
      snapshot: bytes,
      totalBytes: bytes.length,
      chunkIndex: 0,
      chunkCount: 1,
    });

    // Should NOT have been saved because collectEventsForSnapshot returns null
    const latest = await snapshotStore.loadLatestSnapshot();
    expect(latest).toBeNull();

    await rm(tempRoot, { recursive: true, force: true });
  });
});
