import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface IdentityCacheEntry {
  did: string;
  didHash: string;
  controller: string;
  publicKey: string;
  isActive: boolean;
  resolvedAtMs: number;
  address: string;
  activeKey: string;
}

export interface IdentityCacheData {
  version: 1;
  entries: Record<string, IdentityCacheEntry>;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class IdentityCache {
  private data: IdentityCacheData = { version: 1, entries: {} };
  private dirty = false;
  private readonly filePath: string;

  constructor(cacheDir: string) {
    this.filePath = resolve(cacheDir, 'identity-cache.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as IdentityCacheData;
      if (parsed.version === 1 && parsed.entries) {
        this.data = parsed;
      }
    } catch {
      // no cache or corrupted — start fresh
    }
  }

  get(did: string): IdentityCacheEntry | undefined {
    const entry = this.data.entries[did];
    if (!entry) return undefined;
    if (Date.now() - entry.resolvedAtMs > CACHE_TTL_MS) {
      delete this.data.entries[did];
      this.dirty = true;
      return undefined;
    }
    return entry;
  }

  set(entry: IdentityCacheEntry): void {
    this.data.entries[entry.did] = entry;
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    // Evict expired entries before flushing
    const now = Date.now();
    for (const [did, entry] of Object.entries(this.data.entries)) {
      if (now - entry.resolvedAtMs > CACHE_TTL_MS) {
        delete this.data.entries[did];
      }
    }
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    this.dirty = false;
  }
}
