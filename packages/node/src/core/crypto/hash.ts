import { blake3 } from '@noble/hashes/blake3';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '../utils/bytes.js';

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256Bytes(data));
}

export function blake3Bytes(data: Uint8Array): Uint8Array {
  return blake3(data);
}

export function blake3Hex(data: Uint8Array): string {
  return bytesToHex(blake3Bytes(data));
}
