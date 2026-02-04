import { canonicalizeBytes } from '../crypto/jcs.js';
import { sha256Bytes, sha256Hex } from '../crypto/hash.js';
import { concatBytes, utf8ToBytes } from '../utils/bytes.js';
import { signBase58, verifyBase58 } from '../crypto/ed25519.js';

export const EVENT_DOMAIN_PREFIX = 'clawtoken:event:v1:';

export type EventEnvelope = Record<string, unknown>;

export function stripSigHash(envelope: EventEnvelope): EventEnvelope {
  const { sig: _sig, hash: _hash, ...rest } = envelope as Record<string, unknown>;
  return rest;
}

export function canonicalEventBytes(envelope: EventEnvelope): Uint8Array {
  return canonicalizeBytes(stripSigHash(envelope));
}

export function eventHashBytes(envelope: EventEnvelope): Uint8Array {
  return sha256Bytes(canonicalEventBytes(envelope));
}

export function eventHashHex(envelope: EventEnvelope): string {
  return sha256Hex(canonicalEventBytes(envelope));
}

export function eventSigningBytes(envelope: EventEnvelope): Uint8Array {
  const canonical = canonicalEventBytes(envelope);
  const prefix = utf8ToBytes(EVENT_DOMAIN_PREFIX);
  return sha256Bytes(concatBytes(prefix, canonical));
}

export async function signEvent(envelope: EventEnvelope, privateKey: Uint8Array): Promise<string> {
  return signBase58(eventSigningBytes(envelope), privateKey);
}

export async function verifyEventSignature(
  envelope: EventEnvelope,
  signatureBase58: string,
  publicKey: Uint8Array,
): Promise<boolean> {
  return verifyBase58(signatureBase58, eventSigningBytes(envelope), publicKey);
}
