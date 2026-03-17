import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { bytesToHex, hexToBytes } from '../utils/bytes.js';

export interface AesGcmEncrypted {
  nonceHex: string;
  ciphertextHex: string;
  tagHex: string;
}

export function encryptAes256Gcm(key: Uint8Array, plaintext: Uint8Array): AesGcmEncrypted {
  if (key.length !== 32) {
    throw new Error('AES-256-GCM requires 32-byte key');
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    nonceHex: bytesToHex(nonce),
    ciphertextHex: bytesToHex(ciphertext),
    tagHex: bytesToHex(tag),
  };
}

export function decryptAes256Gcm(
  key: Uint8Array,
  encrypted: AesGcmEncrypted,
): Uint8Array {
  if (key.length !== 32) {
    throw new Error('AES-256-GCM requires 32-byte key');
  }
  const nonce = hexToBytes(encrypted.nonceHex);
  const ciphertext = hexToBytes(encrypted.ciphertextHex);
  const tag = hexToBytes(encrypted.tagHex);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return new Uint8Array(plaintext);
}
