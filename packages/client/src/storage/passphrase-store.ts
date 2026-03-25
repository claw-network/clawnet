import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import type { TelagentStoragePaths } from './telagent-paths.js';
import { writeSecretFile, type EncryptedRecord } from './secret-store.js';

/**
 * 派生设备绑定密钥
 *
 * HKDF(SHA-256, machine-id || hostname || uid, "telagent-passphrase-encryption")
 *
 * 安全说明：
 * - 非高安全性方案（root 可以重建密钥）
 * - 防止 secrets 文件被拷贝到其他机器后直接使用
 * - v2 将引入系统 Keyring
 */
function deriveDeviceBoundKey(): Buffer {
  let machineId = 'unknown';
  try {
    // Linux: /etc/machine-id
    machineId = readFileSync('/etc/machine-id', 'utf8').trim();
  } catch {
    try {
      // macOS: IOPlatformUUID
      const { execSync } = require('node:child_process');
      machineId = execSync(
        "ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/{print $3}' | tr -d '\"'",
        { encoding: 'utf8' },
      ).trim();
    } catch { /* fallback to hostname */ }
  }

  const input = `${machineId}:${hostname()}:${userInfo().uid}`;
  return createHash('sha256')
    .update('telagent-passphrase-encryption')
    .update(input)
    .digest();
}

/**
 * 使用设备绑定密钥加密 passphrase 后存储
 */
export async function savePassphrase(
  paths: TelagentStoragePaths,
  passphrase: string,
): Promise<void> {
  const key = deriveDeviceBoundKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(passphrase, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const record: EncryptedRecord = {
    v: 1,
    kdf: 'scrypt',     // 标识加密方案（虽然此处用设备密钥非 scrypt）
    binding: 'device',  // 标识为设备绑定
    nonce: nonce.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    tag: tag.toString('hex'),
    createdAt: new Date().toISOString(),
  };

  await writeSecretFile(paths.passphraseFile, JSON.stringify(record, null, 2));
}

/**
 * 从文件读取并解密 passphrase
 * 返回 null 如果文件不存在或解密失败
 */
export async function loadPassphrase(paths: TelagentStoragePaths): Promise<string | null> {
  try {
    const raw = await readFile(paths.passphraseFile, 'utf8');
    const record = JSON.parse(raw) as EncryptedRecord;
    const key = deriveDeviceBoundKey();
    const nonce = Buffer.from(record.nonce, 'hex');
    const ciphertext = Buffer.from(record.ciphertext, 'hex');
    const tag = Buffer.from(record.tag, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;  // 文件不存在或解密失败（可能换了设备）
  }
}
