import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export interface StoragePaths {
  root: string;
  data: string;
  logs: string;
  keys: string;
  snapshots: string;
  eventsDb: string;
  stateDb: string;
  configFile: string;
}

export function defaultStorageRoot(): string {
  return process.env.CLAWNET_HOME ?? resolve(homedir(), '.clawnet');
}

export function resolveStoragePaths(root: string = defaultStorageRoot()): StoragePaths {
  const data = resolve(root, 'data');
  const logs = resolve(root, 'logs');
  const keys = resolve(root, 'keys');
  const snapshots = resolve(data, 'snapshots');

  return {
    root,
    data,
    logs,
    keys,
    snapshots,
    eventsDb: resolve(data, 'events.db'),
    stateDb: resolve(data, 'state.db'),
    configFile: resolve(root, 'config.yaml'),
  };
}

export async function ensureStorageDirs(paths: StoragePaths): Promise<void> {
  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.data, { recursive: true });
  await mkdir(paths.logs, { recursive: true });
  await mkdir(paths.keys, { recursive: true });
  await mkdir(paths.snapshots, { recursive: true });
}
