import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { TelagentStoragePaths } from './telagent-paths.js';
import { writeSecretFile, type EncryptedRecord } from './secret-store.js';

/**
 * 使用 passphrase 加密助记词后安全存储
 * 加密方案：scrypt KDF => AES-256-GCM
 *
 * scrypt 参数：N=2^17, r=8, p=1 (OWASP 推荐)
 */
export async function saveMnemonic(
  paths: TelagentStoragePaths,
  mnemonic: string,
  passphrase: string,
): Promise<void> {
  const salt = randomBytes(32);
  const key = scryptSync(passphrase, salt, 32, { N: 2 ** 17, r: 8, p: 1 });
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const record: EncryptedRecord = {
    v: 1,
    kdf: 'scrypt',
    salt: salt.toString('hex'),
    nonce: nonce.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    tag: tag.toString('hex'),
    createdAt: new Date().toISOString(),
  };

  await writeSecretFile(paths.mnemonicFile, JSON.stringify(record, null, 2));
}

/**
 * 从文件读取并解密助记词
 */
export async function loadMnemonic(
  paths: TelagentStoragePaths,
  passphrase: string,
): Promise<string> {
  const raw = await readFile(paths.mnemonicFile, 'utf8');
  const record = JSON.parse(raw) as EncryptedRecord;

  if (record.v !== 1 || record.kdf !== 'scrypt' || !record.salt) {
    throw new Error('Unsupported mnemonic encryption format');
  }

  const salt = Buffer.from(record.salt, 'hex');
  const key = scryptSync(passphrase, salt, 32, { N: 2 ** 17, r: 8, p: 1 });
  const nonce = Buffer.from(record.nonce, 'hex');
  const ciphertext = Buffer.from(record.ciphertext, 'hex');
  const tag = Buffer.from(record.tag, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
