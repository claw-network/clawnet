import { writeFile, stat, chmod, rename, unlink } from 'node:fs/promises';

const FILE_MODE_OWNER_ONLY = 0o600;  // rw-------

/**
 * 安全写入文件：先写临时文件 → chmod → rename（原子操作）
 * 解决"写入后再改权限"之间的竞态窗口问题
 */
export async function writeSecretFile(filePath: string, content: string | Buffer): Promise<void> {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  try {
    // 1. 创建临时文件
    await writeFile(tmpPath, '', { mode: FILE_MODE_OWNER_ONLY, flag: 'wx' });

    // 2. 防御性权限检查（umask 可能导致偏移）
    const s = await stat(tmpPath);
    const actualMode = s.mode & 0o777;
    if (actualMode !== FILE_MODE_OWNER_ONLY) {
      await chmod(tmpPath, FILE_MODE_OWNER_ONLY);
    }

    // 3. 写入实际内容
    await writeFile(tmpPath, content, { mode: FILE_MODE_OWNER_ONLY });

    // 4. 原子 rename
    await rename(tmpPath, filePath);
  } catch (error) {
    try { await unlink(tmpPath); } catch { /* ignore cleanup failure */ }
    throw error;
  }
}

/**
 * 通用加密记录格式
 */
export interface EncryptedRecord {
  v: 1;
  kdf: 'scrypt';
  binding?: 'device';  // passphrase 使用设备绑定密钥
  salt?: string;        // hex（scrypt kdf 用）
  nonce: string;        // hex
  ciphertext: string;   // hex
  tag: string;          // hex
  createdAt: string;    // ISO 8601
}
