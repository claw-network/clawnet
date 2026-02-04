import { Level } from 'level';
import { KVStore } from './kv.js';

export interface LevelStoreOptions {
  path: string;
}

function toUint8Array(value: Uint8Array | ArrayBuffer | Buffer): Uint8Array {
  if (value instanceof Uint8Array) {
    if (Buffer.isBuffer(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    return value;
  }
  return new Uint8Array(value);
}

export class LevelStore implements KVStore {
  private readonly db: Level<string, Uint8Array>;

  constructor(options: LevelStoreOptions) {
    this.db = new Level(options.path, { valueEncoding: 'view' });
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const value = await this.db.get(key);
      if (value === undefined || value === null) {
        return undefined;
      }
      return toUint8Array(value as Uint8Array | ArrayBuffer | Buffer);
    } catch (error) {
      if ((error as { code?: string }).code === 'LEVEL_NOT_FOUND') {
        return undefined;
      }
      throw error;
    }
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    await this.db.put(key, value);
  }

  async del(key: string): Promise<void> {
    await this.db.del(key);
  }

  async *iterator(prefix = ''): AsyncIterable<{ key: string; value: Uint8Array }> {
    const hasPrefix = prefix.length > 0;
    const iterator = this.db.iterator(
      hasPrefix
        ? {
            gte: prefix,
            lt: `${prefix}\xff`,
          }
        : undefined,
    );

    for await (const [key, value] of iterator) {
      if (value === undefined || value === null) {
        continue;
      }
      yield { key, value: toUint8Array(value as Uint8Array | ArrayBuffer | Buffer) };
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
