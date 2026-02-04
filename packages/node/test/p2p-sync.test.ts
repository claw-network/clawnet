import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeypair } from '@clawtoken/core/crypto';
import { utf8ToBytes } from '@clawtoken/core/utils';
import { EventStore, MemoryStore, SnapshotStore, signSnapshot } from '@clawtoken/core/storage';
import { P2PSync } from '../src/p2p/sync.js';
import { P2PNode } from '@clawtoken/core/p2p';

describe('p2p sync snapshot chunking', () => {
  it('reassembles chunked snapshot responses', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'clawtoken-'));
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
