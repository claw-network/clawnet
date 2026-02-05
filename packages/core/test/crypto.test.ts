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
  hkdfSha256,
  mnemonicToEntropy,
  mnemonicToSeedSync,
  entropyToMnemonic,
  validateMnemonic,
  publicKeyFromAddress,
  sha256Hex,
  signBytes,
  verifySignature,
  generateX25519Keypair,
  x25519SharedSecret,
  splitSecret,
  combineShares,
} from '../src/index.js';
import { randomBytes } from 'node:crypto';

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

  it('bip39 mnemonic vectors match', () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const entropy = mnemonicToEntropy(mnemonic);
    expect(bytesToHex(entropy)).toBe('00000000000000000000000000000000');
    expect(entropyToMnemonic(entropy)).toBe(mnemonic);
    expect(validateMnemonic(mnemonic)).toBe(true);

    const seed = mnemonicToSeedSync(mnemonic, 'TREZOR');
    expect(bytesToHex(seed)).toBe(
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e5349553' +
        '1f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
    );
  });

  it('hkdf-sha256 matches RFC 5869 vector', () => {
    const ikm = hexToBytes('0b'.repeat(22));
    const salt = hexToBytes('000102030405060708090a0b0c');
    const info = hexToBytes('f0f1f2f3f4f5f6f7f8f9');
    const okm = hkdfSha256(ikm, salt, info, 42);
    expect(bytesToHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf' +
        '34007208d5b887185865',
    );
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
    expect(signBytes.length).toBeGreaterThan(32);
  });

  it('x25519 shared secrets match', () => {
    const alice = generateX25519Keypair();
    const bob = generateX25519Keypair();
    const secretA = x25519SharedSecret(alice.privateKey, bob.publicKey);
    const secretB = x25519SharedSecret(bob.privateKey, alice.publicKey);
    expect(bytesToHex(secretA)).toBe(bytesToHex(secretB));
  });

  it('shamir split/combine recovers secret', () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, 3, 5);
    const recovered = combineShares([shares[0], shares[2], shares[4]]);
    expect(bytesToHex(recovered)).toBe(bytesToHex(secret));
  });
});
