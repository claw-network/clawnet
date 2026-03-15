import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig } from '../src/storage/config.js';
import { resolveStoragePaths } from '../src/storage/paths.js';

let tempDir: string | null = null;

async function createPaths() {
  tempDir = await mkdtemp(join(tmpdir(), 'clawnet-config-'));
  return resolveStoragePaths(tempDir);
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('config', () => {
  it('loads defaults and persists changes', async () => {
    const paths = await createPaths();
    const config = await loadConfig(paths);
    expect(config.network).toBe('devnet');

    const updated = { ...config, network: 'testnet' as const };
    await saveConfig(paths, updated);

    const loaded = await loadConfig(paths);
    expect(loaded.network).toBe('testnet');
  });
});
