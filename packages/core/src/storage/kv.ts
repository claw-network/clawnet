export interface KVStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, value: Uint8Array): Promise<void>;
  del(key: string): Promise<void>;
  iterator(prefix?: string): AsyncIterable<{ key: string; value: Uint8Array }>;
}
