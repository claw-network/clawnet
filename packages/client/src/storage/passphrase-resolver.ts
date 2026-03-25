import type { TelagentStoragePaths } from './telagent-paths.js';
import { loadPassphrase } from './passphrase-store.js';

/**
 * Passphrase 解析优先级（RFC §5.4）：
 *
 * 1. 环境变量 TELAGENT_CLAWNET_PASSPHRASE → 最高优先
 * 2. 本地加密文件 ~/.telagent/secrets/passphrase.enc → 设备绑定密钥解密
 * 3. 以上均无 → 返回 null（后续由 discoverOrStartClawNet 决定是否拒绝启动）
 */
export async function resolvePassphrase(
  paths: TelagentStoragePaths,
): Promise<string | null> {
  // 1. 环境变量
  const envPassphrase = process.env.TELAGENT_CLAWNET_PASSPHRASE;
  if (envPassphrase) {
    return envPassphrase;
  }

  // 2. 加密文件
  const stored = await loadPassphrase(paths);
  if (stored) {
    return stored;
  }

  // 3. 未找到
  return null;
}
