import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bytesToUtf8 } from '../utils/bytes.js';
import { StoragePaths } from './paths.js';

export interface SnapshotSignature {
  peer: string;
  sig: string;
}

export interface SnapshotRecord {
  v: number;
  at: string;
  prev: string | null;
  state: Record<string, unknown>;
  hash: string;
  signatures: SnapshotSignature[];
}

export class SnapshotStore {
  private readonly dir: string;
  private readonly latestFile: string;

  constructor(paths: StoragePaths) {
    this.dir = paths.snapshots;
    this.latestFile = join(this.dir, 'latest');
  }

  async saveSnapshot(snapshot: SnapshotRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = this.snapshotPath(snapshot.hash);
    await writeFile(path, JSON.stringify(snapshot), 'utf8');
    await writeFile(this.latestFile, snapshot.hash, 'utf8');
  }

  async loadSnapshot(hash: string): Promise<SnapshotRecord | null> {
    const bytes = await this.loadSnapshotBytes(hash);
    if (!bytes) {
      return null;
    }
    try {
      return JSON.parse(bytesToUtf8(bytes)) as SnapshotRecord;
    } catch {
      return null;
    }
  }

  async loadSnapshotBytes(hash: string): Promise<Uint8Array | null> {
    try {
      const path = this.snapshotPath(hash);
      const buffer = await readFile(path);
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  async loadLatestSnapshot(): Promise<SnapshotRecord | null> {
    const latest = await this.loadLatestSnapshotBytes();
    if (!latest) {
      return null;
    }
    try {
      return JSON.parse(bytesToUtf8(latest.bytes)) as SnapshotRecord;
    } catch {
      return null;
    }
  }

  async loadLatestSnapshotBytes(): Promise<{ hash: string; bytes: Uint8Array } | null> {
    const hash = await this.readLatestHash();
    if (hash) {
      const bytes = await this.loadSnapshotBytes(hash);
      if (bytes) {
        return { hash, bytes };
      }
    }

    const fallback = await this.findLatestSnapshotFile();
    if (!fallback) {
      return null;
    }
    const bytes = await this.loadSnapshotBytes(fallback);
    if (!bytes) {
      return null;
    }
    return { hash: fallback, bytes };
  }

  private snapshotPath(hash: string): string {
    return join(this.dir, `${hash}.json`);
  }

  private async readLatestHash(): Promise<string | null> {
    try {
      const buffer = await readFile(this.latestFile);
      const value = bytesToUtf8(new Uint8Array(buffer)).trim();
      return value.length ? value : null;
    } catch {
      return null;
    }
  }

  private async findLatestSnapshotFile(): Promise<string | null> {
    try {
      const entries = await readdir(this.dir);
      let latestHash: string | null = null;
      let latestMtime = 0;
      for (const entry of entries) {
        if (!entry.endsWith('.json')) {
          continue;
        }
        const path = join(this.dir, entry);
        const stats = await stat(path);
        if (stats.mtimeMs > latestMtime) {
          latestMtime = stats.mtimeMs;
          latestHash = entry.slice(0, -'.json'.length);
        }
      }
      return latestHash;
    } catch {
      return null;
    }
  }
}
