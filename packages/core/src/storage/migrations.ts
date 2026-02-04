import { bytesToUtf8, utf8ToBytes } from '../utils/bytes.js';
import { KVStore } from './kv.js';

export const META_SCHEMA_VERSION_KEY = 'meta:version';
export const DEFAULT_SCHEMA_VERSION = 1;

export interface StorageMigration {
  version: number;
  up: (store: KVStore) => Promise<void>;
}

function encodeNumber(value: number): Uint8Array {
  return utf8ToBytes(JSON.stringify(value));
}

function decodeNumber(value?: Uint8Array): number | null {
  if (!value) return null;
  return JSON.parse(bytesToUtf8(value)) as number;
}

export async function getSchemaVersion(store: KVStore): Promise<number | null> {
  const raw = await store.get(META_SCHEMA_VERSION_KEY);
  return decodeNumber(raw);
}

export async function setSchemaVersion(store: KVStore, version: number): Promise<void> {
  await store.put(META_SCHEMA_VERSION_KEY, encodeNumber(version));
}

export async function ensureSchemaVersion(
  store: KVStore,
  targetVersion: number = DEFAULT_SCHEMA_VERSION,
  migrations: StorageMigration[] = [],
): Promise<number> {
  const current = (await getSchemaVersion(store)) ?? 0;
  if (current > targetVersion) {
    throw new Error(`Refuse downgrade schema from ${current} to ${targetVersion}`);
  }

  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  let latest = current;
  for (const migration of ordered) {
    if (migration.version <= latest) {
      continue;
    }
    if (migration.version > targetVersion) {
      break;
    }
    await migration.up(store);
    await setSchemaVersion(store, migration.version);
    latest = migration.version;
  }

  if (latest === 0 && targetVersion === DEFAULT_SCHEMA_VERSION && ordered.length === 0) {
    await setSchemaVersion(store, targetVersion);
    return targetVersion;
  }

  if (latest < targetVersion && ordered.length === 0) {
    await setSchemaVersion(store, targetVersion);
    return targetVersion;
  }

  return (await getSchemaVersion(store)) ?? latest;
}
