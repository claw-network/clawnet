import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { argon2id } from '@noble/hashes/argon2';
import { sha256Hex } from '../crypto/hash.js';
import { initKeyRotationState, KeyRotationState } from '../crypto/rotation.js';
import { multibaseEncode } from '../encoding/base58.js';
import { bytesToBase64, base64ToBytes, utf8ToBytes } from '../utils/bytes.js';
import { StoragePaths, ensureStorageDirs } from './paths.js';

export interface KeyDerivationParams {
  t: number;
  m: number;
  p: number;
  dkLen: number;
}

export const DEFAULT_KDF_PARAMS: KeyDerivationParams = {
  t: 3,
  m: 65536,
  p: 4,
  dkLen: 32,
};

export const MIN_PASSPHRASE_LENGTH = 12;

export interface EncryptedKeyMaterial {
  kdf: 'argon2id';
  params: KeyDerivationParams;
  salt: string; // base64
  nonce: string; // base64
  ciphertext: string; // base64
  tag: string; // base64
}

export interface KeyRecord {
  v: 1;
  id: string;
  type: 'ed25519';
  publicKey: string; // multibase
  encryptedPrivateKey: EncryptedKeyMaterial;
  createdAt: string;
  rotation?: KeyRotationState;
}

function deriveKey(passphrase: string, salt: Uint8Array, params: KeyDerivationParams): Uint8Array {
  return argon2id(passphrase, salt, {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: params.dkLen,
  });
}

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
}

function encryptAes256Gcm(key: Uint8Array, plaintext: Uint8Array): {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
} {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    nonce: new Uint8Array(nonce),
    ciphertext: new Uint8Array(ciphertext),
    tag: new Uint8Array(tag),
  };
}

function decryptAes256Gcm(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array,
): Uint8Array {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(Buffer.from(tag));
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return new Uint8Array(plaintext);
}

export function keyIdFromPublicKey(publicKey: Uint8Array): string {
  const multibase = multibaseEncode(publicKey);
  return sha256Hex(utf8ToBytes(multibase));
}

export function encryptPrivateKey(
  privateKey: Uint8Array,
  passphrase: string,
  params: KeyDerivationParams = DEFAULT_KDF_PARAMS,
): EncryptedKeyMaterial {
  assertPassphrase(passphrase);
  const salt = randomBytes(16);
  const key = deriveKey(passphrase, salt, params);
  const { nonce, ciphertext, tag } = encryptAes256Gcm(key, privateKey);
  return {
    kdf: 'argon2id',
    params,
    salt: bytesToBase64(salt),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
    tag: bytesToBase64(tag),
  };
}

export function decryptPrivateKey(
  encrypted: EncryptedKeyMaterial,
  passphrase: string,
): Uint8Array {
  assertPassphrase(passphrase);
  const salt = base64ToBytes(encrypted.salt);
  const key = deriveKey(passphrase, salt, encrypted.params);
  const nonce = base64ToBytes(encrypted.nonce);
  const ciphertext = base64ToBytes(encrypted.ciphertext);
  const tag = base64ToBytes(encrypted.tag);
  return decryptAes256Gcm(key, nonce, ciphertext, tag);
}

export function createKeyRecord(
  publicKey: Uint8Array,
  privateKey: Uint8Array,
  passphrase: string,
  params: KeyDerivationParams = DEFAULT_KDF_PARAMS,
): KeyRecord {
  assertPassphrase(passphrase);
  const publicKeyMb = multibaseEncode(publicKey);
  const createdAt = new Date().toISOString();
  return {
    v: 1,
    id: keyIdFromPublicKey(publicKey),
    type: 'ed25519',
    publicKey: publicKeyMb,
    encryptedPrivateKey: encryptPrivateKey(privateKey, passphrase, params),
    createdAt,
    rotation: initKeyRotationState(createdAt),
  };
}

export async function saveKeyRecord(paths: StoragePaths, record: KeyRecord): Promise<string> {
  await ensureStorageDirs(paths);
  const filename = join(paths.keys, `${record.id}.json`);
  await writeFile(filename, JSON.stringify(record, null, 2), 'utf8');
  return filename;
}

export async function loadKeyRecord(paths: StoragePaths, id: string): Promise<KeyRecord> {
  const filename = join(paths.keys, `${id}.json`);
  const raw = await readFile(filename, 'utf8');
  return JSON.parse(raw) as KeyRecord;
}

export async function listKeyRecords(paths: StoragePaths): Promise<KeyRecord[]> {
  await ensureStorageDirs(paths);
  let entries: string[] = [];
  try {
    entries = await readdir(paths.keys);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const records: KeyRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    try {
      const raw = await readFile(join(paths.keys, entry), 'utf8');
      records.push(JSON.parse(raw) as KeyRecord);
    } catch {
      continue;
    }
  }
  return records;
}

export async function decryptKeyRecord(
  record: KeyRecord,
  passphrase: string,
): Promise<Uint8Array> {
  return decryptPrivateKey(record.encryptedPrivateKey, passphrase);
}
