import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  canonicalizeJson,
  decryptAes256Gcm,
  didFromPublicKey,
  eventHashHex,
  eventSigningBytes,
  hexToBytes,
  publicKeyFromAddress,
  sha256Hex,
  signBytes,
  verifySignature,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const vectorsDir = join(repoRoot, 'docs', 'implementation', 'test-vectors');

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(vectorsDir, name), 'utf8')) as T;
}

describe('crypto vectors', () => {
  it('ed25519 matches vector', async () => {
    const v = readJson<{
      privateKeyHex: string;
      publicKeyHex: string;
      messageHex: string;
      signatureHex: string;
      address: string;
    }>('ed25519.json');

    const privateKey = hexToBytes(v.privateKeyHex);
    const publicKey = hexToBytes(v.publicKeyHex);
    const message = hexToBytes(v.messageHex);
    const signature = await signBytes(message, privateKey);

    expect(bytesToHex(signature)).toBe(v.signatureHex);
    await expect(verifySignature(signature, message, publicKey)).resolves.toBe(true);

    const did = didFromPublicKey(publicKey);
    const address = v.address;
    const recovered = publicKeyFromAddress(address);
    expect(bytesToHex(recovered)).toBe(bytesToHex(publicKey));
    expect(did.startsWith('did:claw:')).toBe(true);
  });

  it('sha256 matches vector', () => {
    const v = readJson<{ inputHex: string; sha256Hex: string }>('sha256.json');
    const hash = sha256Hex(hexToBytes(v.inputHex));
    expect(hash).toBe(v.sha256Hex);
  });

  it('jcs matches vector', () => {
    const v = readJson<{ input: unknown; canonical: string }>('jcs.json');
    expect(canonicalizeJson(v.input)).toBe(v.canonical);
  });

  it('aes-256-gcm decrypts vector', () => {
    const v = readJson<{
      keyHex: string;
      nonceHex: string;
      ciphertextHex: string;
      tagHex: string;
      plaintextHex: string;
    }>('aes-256-gcm.json');
    const plaintext = decryptAes256Gcm(hexToBytes(v.keyHex), {
      nonceHex: v.nonceHex,
      ciphertextHex: v.ciphertextHex,
      tagHex: v.tagHex,
    });
    expect(bytesToHex(plaintext)).toBe(v.plaintextHex);
  });

  it('event hash/signing bytes are deterministic', () => {
    const envelope = {
      v: 1,
      type: 'wallet.transfer',
      issuer: 'did:claw:zExample',
      ts: 1700000000000,
      nonce: 1,
      payload: { from: 'clawExample', to: 'clawExample2', amount: '1' },
      sig: 'sig',
      hash: 'hash',
    };
    const hash1 = eventHashHex(envelope);
    const hash2 = eventHashHex({ ...envelope, sig: 'other', hash: 'other' });
    expect(hash1).toBe(hash2);

    const signBytes = eventSigningBytes(envelope);
    expect(signBytes.length).toBe(32);
  });
});
