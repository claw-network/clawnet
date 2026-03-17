/**
 * Disk-based blob staging for the delivery stream.
 *
 * Chunks are appended to a temp file under `<blobDir>/<deliverableId>.blob.tmp`.
 * On stream completion the file is renamed to `<deliverableId>.blob`.
 * A background sweeper removes stale files older than TTL.
 *
 * Phase 3: replaces the previous in-memory-only approach so arbitration
 * can replay original data post-delivery.
 */

import { open, rename, unlink, readdir, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileHandle } from 'node:fs/promises';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export interface BlobStageOptions {
  /** Directory for blob temp files. Will be created if missing. */
  blobDir: string;
  /** TTL for completed blobs in ms (default: 24 hours). */
  ttlMs?: number;
}

export interface BlobWriter {
  /** Append a chunk. */
  append(data: Uint8Array): Promise<void>;
  /** Finalize: rename .tmp → .blob, return final path. */
  finalize(): Promise<string>;
  /** Abort: remove the temp file. */
  abort(): Promise<void>;
}

/**
 * Create a new blob writer for a deliverable.
 * Caller must call `finalize()` or `abort()` to clean up.
 */
export async function createBlobWriter(
  deliverableId: string,
  opts: BlobStageOptions,
): Promise<BlobWriter> {
  await mkdir(opts.blobDir, { recursive: true });

  const safeId = deliverableId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const tmpPath = join(opts.blobDir, `${safeId}.blob.tmp`);
  const finalPath = join(opts.blobDir, `${safeId}.blob`);

  let fh: FileHandle | null = await open(tmpPath, 'w');

  return {
    async append(data: Uint8Array): Promise<void> {
      if (!fh) throw new Error('BlobWriter already closed');
      await fh.write(data);
    },

    async finalize(): Promise<string> {
      if (fh) {
        await fh.close();
        fh = null;
      }
      await rename(tmpPath, finalPath);
      return finalPath;
    },

    async abort(): Promise<void> {
      if (fh) {
        await fh.close();
        fh = null;
      }
      try { await unlink(tmpPath); } catch { /* may not exist */ }
    },
  };
}

/**
 * Start a periodic sweeper that removes `.blob` files older than TTL.
 * Returns a cleanup function to stop the sweeper.
 */
export function startBlobSweeper(opts: BlobStageOptions): () => void {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;

  const sweep = async () => {
    try {
      const entries = await readdir(opts.blobDir);
      const now = Date.now();
      for (const entry of entries) {
        if (!entry.endsWith('.blob') && !entry.endsWith('.blob.tmp')) continue;
        const full = join(opts.blobDir, entry);
        try {
          const st = await stat(full);
          if (now - st.mtimeMs > ttl) {
            await unlink(full);
          }
        } catch { /* file may have been removed */ }
      }
    } catch { /* blobDir may not exist yet */ }
  };

  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);

  return () => clearInterval(timer);
}
