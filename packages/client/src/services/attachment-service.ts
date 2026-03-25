import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';

import { ErrorCodes, TelagentError } from '../protocol/index.js';

interface PendingUpload {
  objectKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  manifestHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  completed: boolean;
  completedAtMs?: number;
  checksum?: string;
}

export interface AttachmentServiceClock {
  now(): number;
}

const SystemClock: AttachmentServiceClock = {
  now: () => Date.now(),
};

const INIT_UPLOAD_TTL_SEC = 900;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

export class AttachmentService {
  private readonly uploads = new Map<string, PendingUpload>();
  private readonly clock: AttachmentServiceClock;
  private readonly storageDir: string;

  constructor(options?: { clock?: AttachmentServiceClock; storageDir?: string }) {
    this.clock = options?.clock ?? SystemClock;
    this.storageDir = options?.storageDir ?? '';
  }

  /** Derive a safe filename from an objectKey for on-disk storage. */
  private objectKeyToFilename(objectKey: string): string {
    return objectKey.replace(/[^A-Za-z0-9._-]/g, '_');
  }

  /** Save raw binary data for a completed upload. */
  async saveFile(objectKey: string, data: Buffer): Promise<void> {
    if (!this.storageDir) return;
    const filename = this.objectKeyToFilename(objectKey);
    await writeFile(join(this.storageDir, filename), data);
  }

  /** Read stored file bytes, or null if not found. */
  async readFile(objectKey: string): Promise<Buffer | null> {
    if (!this.storageDir) return null;
    const filename = this.objectKeyToFilename(objectKey);
    try {
      return await readFile(join(this.storageDir, filename));
    } catch {
      return null;
    }
  }

  /** Get the MIME content-type for a stored upload.
   * Falls back to deriving the type from the file extension so the correct
   * Content-Type is returned even after a server restart (when the in-memory
   * uploads map has been cleared).
   */
  getContentType(objectKey: string): string {
    const stored = this.uploads.get(objectKey)?.contentType;
    if (stored && stored !== 'application/octet-stream') return stored;
    // Derive from extension — objectKey preserves the original filename suffix.
    const ext = objectKey.split('.').pop()?.toLowerCase() ?? '';
    return MIME_BY_EXT[ext] ?? stored ?? 'application/octet-stream';
  }

  initUpload(input: {
    filename: string;
    contentType: string;
    sizeBytes: number;
    manifestHash: string;
  }): {
    objectKey: string;
    uploadUrl: string;
    expiresInSec: number;
  } {
    const safeFilename = this.toSafeFilename(input.filename);
    const nowMs = this.clock.now();
    const objectKey = `attachments/${nowMs}-${randomUUID()}-${safeFilename}`;

    this.uploads.set(objectKey, {
      objectKey,
      filename: safeFilename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      manifestHash: input.manifestHash,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + INIT_UPLOAD_TTL_SEC * 1000,
      completed: false,
    });

    return {
      objectKey,
      uploadUrl: `https://uploads.telagent.local/${encodeURIComponent(objectKey)}`,
      expiresInSec: INIT_UPLOAD_TTL_SEC,
    };
  }

  completeUpload(input: {
    objectKey: string;
    manifestHash: string;
    checksum: string;
    fileContentType?: string;
  }): {
    objectKey: string;
    manifestHash: string;
    checksum: string;
    completedAtMs: number;
  } {
    this.cleanupExpiredSessions();
    this.assertObjectKey(input.objectKey);
    this.assertChecksum(input.checksum);

    const upload = this.uploads.get(input.objectKey);
    if (!upload) {
      throw new TelagentError(ErrorCodes.NOT_FOUND, 'Upload session not found');
    }
    if (this.clock.now() > upload.expiresAtMs) {
      this.uploads.delete(input.objectKey);
      throw new TelagentError(ErrorCodes.UNPROCESSABLE, 'Upload session expired');
    }
    if (upload.manifestHash.toLowerCase() !== input.manifestHash.toLowerCase()) {
      throw new TelagentError(ErrorCodes.CONFLICT, 'Manifest hash mismatch');
    }
    if (upload.completed) {
      if (upload.checksum?.toLowerCase() === input.checksum.toLowerCase()) {
        return {
          objectKey: input.objectKey,
          manifestHash: upload.manifestHash,
          checksum: upload.checksum,
          completedAtMs: upload.completedAtMs ?? this.clock.now(),
        };
      }
      throw new TelagentError(ErrorCodes.CONFLICT, 'Upload already completed with different checksum');
    }

    upload.completed = true;
    upload.completedAtMs = this.clock.now();
    upload.checksum = input.checksum;
    if (input.fileContentType) {
      upload.contentType = input.fileContentType;
    }

    return {
      objectKey: input.objectKey,
      manifestHash: input.manifestHash,
      checksum: input.checksum,
      completedAtMs: upload.completedAtMs,
    };
  }

  cleanupExpiredSessions(nowMs = this.clock.now()): number {
    let removed = 0;
    for (const [objectKey, session] of this.uploads) {
      if (session.completed) {
        continue;
      }
      if (session.expiresAtMs <= nowMs) {
        this.uploads.delete(objectKey);
        removed++;
      }
    }
    return removed;
  }

  private assertObjectKey(objectKey: string): void {
    if (!objectKey.startsWith('attachments/')) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'objectKey must start with attachments/');
    }
  }

  private assertChecksum(checksum: string): void {
    const normalized = checksum.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'checksum must be 32-byte hex string');
    }
  }

  private toSafeFilename(filename: string): string {
    // basename() guards against path traversal (e.g. "../../etc/passwd" → "passwd").
    // Replace every character that is not URL- and FS-safe with an underscore.
    const normalized = basename(filename).replace(/[^A-Za-z0-9._-]/g, '_');
    // Reject empty strings and filenames that consist only of dots (".", "..", "...", …).
    if (!normalized || /^\.+$/.test(normalized)) {
      throw new TelagentError(ErrorCodes.VALIDATION, 'filename is invalid');
    }
    // Truncate to 100 chars so the generated objectKey (prefix ~63 chars) always
    // stays within the 255-byte per-component FS limit, even after ClawNet appends
    // a MIME extension suffix when storing the relayed attachment.
    return normalized.slice(0, 100);
  }
}
