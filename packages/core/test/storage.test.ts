import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LevelStore } from '../src/storage/level.js';

let tempDir: string | null = null;

async function createStore(): Promise<LevelStore> {
  tempDir = await mkdtemp(join(tmpdir(), 'clawtoken-level-'));
  return new LevelStore({ path: join(tempDir, 'events.db') });
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('LevelStore', () => {
  it('persists key/value pairs and iterates by prefix', async () => {
    const store = await createStore();
    await store.put('ev:1', new Uint8Array([1]));
    await store.put('ev:2', new Uint8Array([2]));
    await store.put('st:1', new Uint8Array([3]));

    const value = await store.get('ev:1');
    expect(value).toEqual(new Uint8Array([1]));

    const keys: string[] = [];
    for await (const entry of store.iterator('ev:')) {
      keys.push(entry.key);
    }
    expect(keys.sort()).toEqual(['ev:1', 'ev:2']);

    await store.del('ev:1');
    const missing = await store.get('ev:1');
    expect(missing).toBeUndefined();

    await store.close?.();
  });
});
