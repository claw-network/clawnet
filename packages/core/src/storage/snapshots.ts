import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalizeBytes } from '../crypto/jcs.js';
import { sha256Hex } from '../crypto/hash.js';
import { signBase58, verifyBase58 } from '../crypto/ed25519.js';
import { concatBytes, utf8ToBytes, bytesToUtf8 } from '../utils/bytes.js';
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

export const SNAPSHOT_DOMAIN_PREFIX = 'clawtoken:snapshot:v1:';

export function snapshotBody(snapshot: SnapshotRecord): {
  v: number;
  at: string;
  prev: string | null;
  state: Record<string, unknown>;
} {
  return {
    v: snapshot.v,
    at: snapshot.at,
    prev: snapshot.prev,
    state: snapshot.state,
  };
}

export function snapshotHashHex(snapshot: SnapshotRecord): string {
  const canonical = canonicalizeBytes(snapshotBody(snapshot));
  return sha256Hex(canonical);
}

export function snapshotSigningBytesFromHash(hash: string): Uint8Array {
  return concatBytes(utf8ToBytes(SNAPSHOT_DOMAIN_PREFIX), utf8ToBytes(hash));
}

export function snapshotSigningBytes(snapshot: SnapshotRecord): Uint8Array {
  return snapshotSigningBytesFromHash(snapshotHashHex(snapshot));
}

export function verifySnapshotHash(snapshot: SnapshotRecord): boolean {
  return snapshot.hash === snapshotHashHex(snapshot);
}

export async function signSnapshot(
  snapshot: SnapshotRecord,
  peerId: string,
  privateKey: Uint8Array,
): Promise<SnapshotRecord> {
  const hash = snapshotHashHex(snapshot);
  const sig = await signBase58(snapshotSigningBytesFromHash(hash), privateKey);
  const signatures = [...(snapshot.signatures ?? []), { peer: peerId, sig }];
  return {
    ...snapshot,
    hash,
    signatures,
  };
}

export async function verifySnapshotSignatures(
  snapshot: SnapshotRecord,
  resolvePeerPublicKey: (peerId: string) => Promise<Uint8Array | null>,
  options: { minSignatures?: number } = {},
): Promise<{ ok: boolean; validPeers: string[] }> {
  const minSignatures = options.minSignatures ?? 1;
  const signingBytes = snapshotSigningBytesFromHash(snapshot.hash);
  const seen = new Set<string>();
  const validPeers: string[] = [];
  for (const entry of snapshot.signatures ?? []) {
    if (!entry?.peer || !entry?.sig || seen.has(entry.peer)) {
      continue;
    }
    const publicKey = await resolvePeerPublicKey(entry.peer);
    if (!publicKey) {
      continue;
    }
    const ok = await verifyBase58(entry.sig, signingBytes, publicKey);
    if (ok) {
      seen.add(entry.peer);
      validPeers.push(entry.peer);
    }
  }
  return { ok: validPeers.length >= minSignatures, validPeers };
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
