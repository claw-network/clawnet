import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/storage/memory.js';
import {
  ensureSchemaVersion,
  getSchemaVersion,
  setSchemaVersion,
} from '../src/storage/migrations.js';


describe('storage migrations', () => {
  it('initializes schema version on empty store', async () => {
    const store = new MemoryStore();
    const version = await ensureSchemaVersion(store);
    expect(version).toBe(1);
    expect(await getSchemaVersion(store)).toBe(1);
  });

  it('applies migrations in order', async () => {
    const store = new MemoryStore();
    await setSchemaVersion(store, 1);

    const applied: number[] = [];
    const version = await ensureSchemaVersion(store, 2, [
      {
        version: 2,
        up: async () => {
          applied.push(2);
        },
      },
    ]);

    expect(version).toBe(2);
    expect(applied).toEqual([2]);
    expect(await getSchemaVersion(store)).toBe(2);
  });
});
