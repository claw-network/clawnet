import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createKeyRecord,
  resolveStoragePaths,
  saveKeyRecord,
  EventStore,
  LevelStore,
} from '../../core/src/index.js';
import { generateKeypair } from '../../core/src/crypto/ed25519.js';
import { didFromPublicKey, addressFromDid } from '../../core/src/identity/did.js';
import { canonicalizeBytes } from '../../core/src/crypto/jcs.js';
import { runBalance, runTransfer } from '../src/cli.js';
import { createWalletEscrowCreateEnvelope } from '../../protocol/src/wallet/events.js';

describe('cli transfer/balance', () => {
  let tempDir: string;
  let did: string;
  let passphrase: string;
  let privateKey: Uint8Array;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawtoken-cli-'));
    passphrase = 'test-passphrase-123';
    const keypair = await generateKeypair();
    did = didFromPublicKey(keypair.publicKey);
    privateKey = keypair.privateKey;
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

  it('prints balance from local event log', async () => {
    const paths = resolveStoragePaths(tempDir);
    const store = new LevelStore({ path: paths.eventsDb });
    const eventStore = new EventStore(store);

    const depositor = addressFromDid(did);
    const envelope = await createWalletEscrowCreateEnvelope({
      issuer: did,
      privateKey,
      escrowId: 'escrow-1',
      depositor,
      beneficiary: depositor,
      amount: '5',
      releaseRules: [{ id: 'rule-1' }],
      ts: Date.now(),
      nonce: 1,
    });
    const bytes = canonicalizeBytes(envelope);
    await eventStore.appendEvent(envelope.hash as string, bytes);
    await store.close();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runBalance(['--did', did, '--data-dir', tempDir]);
    expect(logSpy).toHaveBeenCalled();
    const output = String(logSpy.mock.calls[0][0]);
    expect(output).toContain('"balance"');
    logSpy.mockRestore();
  });

  it('publishes wallet.transfer via CLI', async () => {
    const receiver = await generateKeypair();
    const to = addressFromDid(didFromPublicKey(receiver.publicKey));
    const node = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      publishEvent: vi.fn(async () => 'hash-1'),
    };

    await runTransfer(
      [
        '--did',
        did,
        '--passphrase',
        passphrase,
        '--to',
        to,
        '--amount',
        '2',
        '--fee',
        '1',
        '--nonce',
        '1',
        '--data-dir',
        tempDir,
      ],
      { createNode: () => node },
    );

    expect(node.publishEvent).toHaveBeenCalledTimes(1);
    const published = node.publishEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(published.type).toBe('wallet.transfer');
  });
});
