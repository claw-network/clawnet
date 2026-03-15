import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeypair } from '../src/crypto/ed25519.js';
import {
  createKeyRecord,
  decryptKeyRecord,
  loadKeyRecord,
  saveKeyRecord,
} from '../src/storage/keystore.js';
import { resolveStoragePaths } from '../src/storage/paths.js';
import { bytesToHex } from '../src/utils/bytes.js';

let tempDir: string | null = null;

async function createPaths() {
  tempDir = await mkdtemp(join(tmpdir(), 'clawnet-keys-'));
  return resolveStoragePaths(tempDir);
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('keystore', () => {
  it('encrypts, persists, and decrypts private keys', { timeout: 30_000 }, async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const passphrase = 'correct horse battery staple';
    const record = createKeyRecord(publicKey, privateKey, passphrase);

    const paths = await createPaths();
    await saveKeyRecord(paths, record);

    const loaded = await loadKeyRecord(paths, record.id);
    const decrypted = await decryptKeyRecord(loaded, passphrase);
    expect(bytesToHex(decrypted)).toBe(bytesToHex(privateKey));
  });
});
