import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

export function hkdfSha256(
  ikm: Uint8Array,
  salt?: Uint8Array,
  info?: Uint8Array,
  length = 32,
): Uint8Array {
  return hkdf(sha256, ikm, salt, info, length);
}
