import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { mkdir, chmod, stat } from 'node:fs/promises';
import { getGlobalLogger } from '../logger.js';

const DIR_MODE_OWNER_ONLY = 0o700;   // rwx------

export interface TelagentStoragePaths {
  root: string;              // ~/.telagent
  config: string;            // ~/.telagent/config.yaml
  secrets: string;           // ~/.telagent/secrets/
  keys: string;              // ~/.telagent/keys/
  data: string;              // ~/.telagent/data/
  logs: string;              // ~/.telagent/logs/
  cache: string;             // ~/.telagent/cache/
  // 具体文件
  mnemonicFile: string;      // ~/.telagent/secrets/mnemonic.enc
  passphraseFile: string;    // ~/.telagent/secrets/passphrase.enc
  signerKeyFile: string;     // ~/.telagent/secrets/signer-key.enc
  mailboxDb: string;         // ~/.telagent/data/mailbox.sqlite
  groupIndexerDb: string;    // ~/.telagent/data/group-indexer.sqlite
  contactsDb: string;        // ~/.telagent/data/contacts.sqlite
  profileFile: string;       // ~/.telagent/data/profile.json
  peerProfilesDb: string;    // ~/.telagent/data/peer-profiles.sqlite
  avatarFile: string;        // ~/.telagent/data/profile-avatar.bin
  attachmentsDir: string;    // ~/.telagent/data/attachments/
  peerAvatarsDir: string;    // ~/.telagent/data/peer-avatars/
  clawnetSeqFile: string;    // ~/.telagent/data/clawnet-seq.json
}

export function defaultTelagentHome(): string {
  return process.env.TELAGENT_HOME ?? resolve(homedir(), '.telagent');
}

export function resolveTelagentPaths(root?: string): TelagentStoragePaths {
  const r = root ?? defaultTelagentHome();
  const secrets = resolve(r, 'secrets');
  return {
    root: r,
    config: resolve(r, 'config.yaml'),
    secrets,
    keys: resolve(r, 'keys'),
    data: resolve(r, 'data'),
    logs: resolve(r, 'logs'),
    cache: resolve(r, 'cache'),
    mnemonicFile: resolve(secrets, 'mnemonic.enc'),
    passphraseFile: resolve(secrets, 'passphrase.enc'),
    signerKeyFile: resolve(secrets, 'signer-key.enc'),
    mailboxDb: resolve(r, 'data', 'mailbox.sqlite'),
    groupIndexerDb: resolve(r, 'data', 'group-indexer.sqlite'),
    contactsDb: resolve(r, 'data', 'contacts.sqlite'),
    profileFile: resolve(r, 'data', 'profile.json'),
    peerProfilesDb: resolve(r, 'data', 'peer-profiles.sqlite'),
    avatarFile: resolve(r, 'data', 'profile-avatar.bin'),
    attachmentsDir: resolve(r, 'data', 'attachments'),
    peerAvatarsDir: resolve(r, 'data', 'peer-avatars'),
    clawnetSeqFile: resolve(r, 'data', 'clawnet-seq.json'),
  };
}

export async function ensureTelagentDirs(paths: TelagentStoragePaths): Promise<void> {
  for (const dir of [paths.root, paths.secrets, paths.keys, paths.data, paths.logs, paths.cache, paths.attachmentsDir, paths.peerAvatarsDir]) {
    await mkdir(dir, { recursive: true });
  }
  // 对 root 和 secrets 强制设置严格权限
  await chmod(paths.root, DIR_MODE_OWNER_ONLY);
  await chmod(paths.secrets, DIR_MODE_OWNER_ONLY);
  await chmod(paths.keys, DIR_MODE_OWNER_ONLY);
}

/**
 * 启动时校验 secrets/ 目录权限
 * 如果权限过宽（如 0o644），尝试修复；修复失败则拒绝启动
 */
export async function verifySecretsPermissions(paths: TelagentStoragePaths): Promise<void> {
  // Docker 容器中以 root 运行时跳过权限校验（RFC §5.4 权限异常处理表）
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    return;  // 容器环境，使用环境变量传递 secrets
  }

  for (const dir of [paths.root, paths.secrets]) {
    try {
      const s = await stat(dir);
      const mode = s.mode & 0o777;

      // 检查文件 owner 是否为当前用户（RFC §5.4：root 创建后切换用户场景）
      if (process.getuid && s.uid !== process.getuid()) {
        getGlobalLogger().warn(
          `[telagent] WARNING: ${dir} is owned by uid ${s.uid}, but running as uid ${process.getuid()}. ` +
          'This may cause permission errors. Consider running: chown -R $(whoami) ' + dir,
        );
      }

      if (mode & 0o077) {  // group/other 有任何权限
        try {
          await chmod(dir, DIR_MODE_OWNER_ONLY);
        } catch {
          throw new Error(
            `[SECURITY] ${dir} has insecure permissions (${mode.toString(8)}). ` +
            `Expected 0700. Please run: chmod 700 ${dir}`
          );
        }
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') continue;
      throw error;
    }
  }
}
