/**
 * Incremental BLAKE3 hasher.
 * Wraps @noble/hashes blake3.create() to expose a stable streaming API.
 */

import { blake3 } from '@noble/hashes/blake3';
import { bytesToHex } from '../utils/bytes.js';

export interface Blake3Hasher {
  /** Feed bytes into the running hash. Returns `this` for chaining. */
  update(data: Uint8Array): this;
  /** Finalize and return the raw 32-byte digest. Idempotent. */
  digest(): Uint8Array;
  /** Finalize and return the hex-encoded 64-char digest. Idempotent. */
  hexDigest(): string;
}

/**
 * Create a new incremental BLAKE3 hasher.
 *
 * @example
 * ```ts
 * const h = createBlake3Hasher();
 * h.update(chunk1).update(chunk2);
 * const hash = h.hexDigest();
 * ```
 */
export function createBlake3Hasher(): Blake3Hasher {
  const h = blake3.create({});
  let finalized: Uint8Array | null = null;

  return {
    update(data: Uint8Array): Blake3Hasher {
      h.update(data);
      return this;
    },
    digest(): Uint8Array {
      if (!finalized) {
        finalized = h.digest();
      }
      return finalized;
    },
    hexDigest(): string {
      return bytesToHex(this.digest());
    },
  };
}
