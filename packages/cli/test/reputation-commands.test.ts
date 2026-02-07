import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createKeyRecord,
  EventStore,
  LevelStore,
  resolveStoragePaths,
  saveKeyRecord,
} from '../../core/src/index.js';
import { generateKeypair } from '../../core/src/crypto/ed25519.js';
import { didFromPublicKey } from '../../core/src/identity/did.js';
import { canonicalizeBytes } from '../../core/src/crypto/jcs.js';
import { createReputationRecordEnvelope } from '../../protocol/src/reputation/events.js';
import { runReputation, runReputationRecord } from '../src/cli.js';

describe('cli reputation', () => {
  let tempDir: string;
  let did: string;
  let passphrase: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawtoken-reputation-cli-'));
    passphrase = 'test-passphrase-123';
    const keypair = await generateKeypair();
    did = didFromPublicKey(keypair.publicKey);
    const record = createKeyRecord(keypair.publicKey, keypair.privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    const paths = resolveStoragePaths(tempDir);
    await saveKeyRecord(paths, record);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prints reputation profile from local event log', async () => {
    const paths = resolveStoragePaths(tempDir);
    const store = new LevelStore({ path: paths.eventsDb });
    const eventStore = new EventStore(store);

    const issuerKeys = await generateKeypair();
    const targetKeys = await generateKeypair();
    const issuer = didFromPublicKey(issuerKeys.publicKey);
    const target = didFromPublicKey(targetKeys.publicKey);

    const envelope = await createReputationRecordEnvelope({
      issuer,
      privateKey: issuerKeys.privateKey,
      target,
      dimension: 'quality',
      score: 800,
      ref: 'contract-1',
      ts: Date.now(),
      nonce: 1,
    });
    const bytes = canonicalizeBytes(envelope);
    await eventStore.appendEvent(envelope.hash as string, bytes);
    await store.close();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runReputation(['--did', target, '--data-dir', tempDir]);
    expect(logSpy).toHaveBeenCalled();
    const output = String(logSpy.mock.calls[0][0]);
    expect(output).toContain('"score"');
    logSpy.mockRestore();
  });

  it('publishes reputation.record via CLI', async () => {
    const targetKeys = await generateKeypair();
    const target = didFromPublicKey(targetKeys.publicKey);

    const node = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      publishEvent: vi.fn(async () => 'hash-1'),
    };

    await runReputationRecord(
      [
        '--did',
        did,
        '--passphrase',
        passphrase,
        '--target',
        target,
        '--dimension',
        'quality',
        '--score',
        '700',
        '--ref',
        'contract-2',
        '--comment',
        'solid work',
        '--aspects',
        '{"quality":5,"communication":4}',
        '--nonce',
        '1',
        '--data-dir',
        tempDir,
      ],
      { createNode: () => node },
    );

    expect(node.publishEvent).toHaveBeenCalledTimes(1);
    const published = node.publishEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(published.type).toBe('reputation.record');
  });
});
