import { readFile, writeFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import { ensureStorageDirs, StoragePaths } from './paths.js';

export interface NodeConfig {
  v: 1;
  network: 'mainnet' | 'testnet' | 'devnet';
  p2p?: {
    listen?: string[];
    bootstrap?: string[];
  };
  logging?: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
  };
  storage?: {
    root?: string;
  };
}

export const DEFAULT_CONFIG: NodeConfig = {
  v: 1,
  network: 'devnet',
  p2p: {
    listen: ['/ip4/0.0.0.0/tcp/9527'],
    bootstrap: [],
  },
  logging: {
    level: 'info',
  },
};

function mergeConfig(base: NodeConfig, overrides: Partial<NodeConfig>): NodeConfig {
  return {
    ...base,
    ...overrides,
    p2p: {
      ...base.p2p,
      ...overrides.p2p,
    },
    logging: {
      ...base.logging,
      ...overrides.logging,
    },
    storage: {
      ...base.storage,
      ...overrides.storage,
    },
  };
}

export async function loadConfig(
  paths: StoragePaths,
  defaults: NodeConfig = DEFAULT_CONFIG,
): Promise<NodeConfig> {
  await ensureStorageDirs(paths);
  try {
    const raw = await readFile(paths.configFile, 'utf8');
    const parsed = (parse(raw) ?? {}) as Partial<NodeConfig>;
    return mergeConfig(defaults, parsed);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return defaults;
    }
    throw error;
  }
}

export async function saveConfig(paths: StoragePaths, config: NodeConfig): Promise<void> {
  await ensureStorageDirs(paths);
  const content = stringify(config);
  await writeFile(paths.configFile, content, 'utf8');
}

export async function initConfig(paths: StoragePaths, config?: NodeConfig): Promise<NodeConfig> {
  const value = config ?? DEFAULT_CONFIG;
  await ensureStorageDirs(paths);
  await writeFile(paths.configFile, stringify(value), 'utf8');
  return value;
}

export async function ensureConfig(paths: StoragePaths, defaults?: NodeConfig): Promise<NodeConfig> {
  const config = await loadConfig(paths, defaults ?? DEFAULT_CONFIG);
  await saveConfig(paths, config);
  return config;
}
