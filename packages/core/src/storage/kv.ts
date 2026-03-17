export type BatchOp =
  | { type: 'put'; key: string; value: Uint8Array }
  | { type: 'del'; key: string };

export interface KVStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, value: Uint8Array): Promise<void>;
  del(key: string): Promise<void>;
  iterator(prefix?: string): AsyncIterable<{ key: string; value: Uint8Array }>;
  close?(): Promise<void>;
  /** Atomic multi-key write. Falls back to sequential puts/dels when not supported. */
  batch?(ops: BatchOp[]): Promise<void>;
}
