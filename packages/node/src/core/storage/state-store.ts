import { bytesToUtf8, utf8ToBytes } from '../utils/bytes.js';
import { KVStore } from './kv.js';

const PREFIX_STATE = 'st:';

export interface ModuleStateRecord<T = unknown> {
  at: string | null;
  state: T;
}

function encodeJson(value: unknown): Uint8Array {
  return utf8ToBytes(JSON.stringify(value));
}

function decodeJson<T>(value: Uint8Array | undefined, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(bytesToUtf8(value)) as T;
}

export class StateStore {
  constructor(private readonly store: KVStore) {}

  async getModuleState<T = unknown>(module: string): Promise<ModuleStateRecord<T> | null> {
    const value = await this.store.get(`${PREFIX_STATE}${module}`);
    if (!value) {
      return null;
    }
    return decodeJson(value, null as ModuleStateRecord<T> | null);
  }

  async setModuleState<T = unknown>(
    module: string,
    state: T,
    at: string | null,
  ): Promise<void> {
    const record: ModuleStateRecord<T> = { at, state };
    await this.store.put(`${PREFIX_STATE}${module}`, encodeJson(record));
  }

  async deleteModuleState(module: string): Promise<void> {
    await this.store.del(`${PREFIX_STATE}${module}`);
  }

  async listModules(): Promise<string[]> {
    const modules: string[] = [];
    for await (const { key } of this.store.iterator(PREFIX_STATE)) {
      modules.push(key.slice(PREFIX_STATE.length));
    }
    return modules;
  }
}
