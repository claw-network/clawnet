import { bytesToUtf8, utf8ToBytes } from '../utils/bytes.js';
import { KVStore } from './kv.js';

const QUARANTINE_KEY = 'meta:quarantine';

export interface QuarantineRecord {
  at: string;
  reason: string;
}

export async function getQuarantineStatus(store: KVStore): Promise<QuarantineRecord | null> {
  const raw = await store.get(QUARANTINE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(bytesToUtf8(raw)) as QuarantineRecord;
  } catch {
    return null;
  }
}

export async function enterQuarantine(store: KVStore, reason: string): Promise<void> {
  const record: QuarantineRecord = {
    at: new Date().toISOString(),
    reason,
  };
  await store.put(QUARANTINE_KEY, utf8ToBytes(JSON.stringify(record)));
}

export async function clearQuarantine(store: KVStore): Promise<void> {
  await store.del(QUARANTINE_KEY);
}
