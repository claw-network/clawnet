import { KVStore } from './kv.js';

export class MemoryStore implements KVStore {
  private store = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array | undefined> {
    return this.store.get(key);
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async *iterator(prefix = ''): AsyncIterable<{ key: string; value: Uint8Array }> {
    for (const [key, value] of this.store.entries()) {
      if (!prefix || key.startsWith(prefix)) {
        yield { key, value };
      }
    }
  }
}
