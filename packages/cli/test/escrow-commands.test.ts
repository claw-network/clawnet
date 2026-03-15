import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addressFromDid,
  createKeyRecord,
  didFromPublicKey,
  generateKeypair,
  resolveStoragePaths,
  saveKeyRecord,
} from '../../core/src/index.js';
import {
  runEscrowCreate,
  runEscrowFund,
  runEscrowRelease,
  runEscrowRefund,
} from '../src/cli.js';

describe('cli escrow commands', () => {
  let tempDir: string;
  let did: string;
  let passphrase: string;
  let published: Record<string, unknown>[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawnet-cli-'));
    passphrase = 'test-passphrase-123';
    const { publicKey, privateKey } = await generateKeypair();
    did = didFromPublicKey(publicKey);
    const record = createKeyRecord(publicKey, privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    const paths = resolveStoragePaths(tempDir);
    await saveKeyRecord(paths, record);
    published = [];
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('publishes escrow.create', async () => {
    const beneficiary = addressFromDid(did);
    const node = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      publishEvent: vi.fn(async (envelope: Record<string, unknown>) => {
        published.push(envelope);
        return 'hash-1';
      }),
    };

    await runEscrowCreate(
      [
        '--did',
        did,
        '--passphrase',
        passphrase,
        '--beneficiary',
        beneficiary,
        '--amount',
        '10',
        '--release-rules',
        '[{"id":"rule-1"}]',
        '--nonce',
        '1',
        '--no-auto-fund',
        '--data-dir',
        tempDir,
      ],
      { createNode: () => node },
    );

    expect(node.publishEvent).toHaveBeenCalledTimes(1);
    expect(published[0]?.type).toBe('wallet.escrow.create');
  });

  it('publishes escrow.fund', async () => {
    const node = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      publishEvent: vi.fn(async (envelope: Record<string, unknown>) => {
        published.push(envelope);
        return 'hash-2';
      }),
    };

    await runEscrowFund(
      [
        '--did',
        did,
        '--passphrase',
        passphrase,
        '--escrow-id',
        'escrow-1',
        '--amount',
        '5',
        '--resource-prev',
        'hash-1',
        '--nonce',
        '2',
        '--data-dir',
        tempDir,
      ],
      { createNode: () => node },
    );

    expect(node.publishEvent).toHaveBeenCalledTimes(1);
    expect(published[0]?.type).toBe('wallet.escrow.fund');
  });

  it('publishes escrow.release and escrow.refund', async () => {
    const node = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      publishEvent: vi.fn(async (envelope: Record<string, unknown>) => {
        published.push(envelope);
        return `hash-${published.length + 1}`;
      }),
    };

    await runEscrowRelease(
      [
        '--did',
        did,
        '--passphrase',
        passphrase,
        '--escrow-id',
        'escrow-1',
        '--amount',
        '3',
        '--resource-prev',
        'hash-1',
        '--rule-id',
        'rule-1',
        '--nonce',
        '3',
        '--data-dir',
        tempDir,
      ],
      { createNode: () => node },
    );

    await runEscrowRefund(
      [
        '--did',
        did,
        '--passphrase',
        passphrase,
        '--escrow-id',
        'escrow-1',
        '--amount',
        '2',
        '--resource-prev',
        'hash-2',
        '--reason',
        'cancelled',
        '--nonce',
        '4',
        '--data-dir',
        tempDir,
      ],
      { createNode: () => node },
    );

    expect(published[0]?.type).toBe('wallet.escrow.release');
    expect(published[1]?.type).toBe('wallet.escrow.refund');
  });
});
