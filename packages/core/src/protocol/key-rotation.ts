import { canonicalizeBytes } from '../crypto/jcs.js';
import { signEvent, eventHashHex } from './event-hash.js';
import { KeyRotationReason } from '../crypto/rotation.js';
import { EventStore } from '../storage/event-store.js';

export interface KeyRotationEventPayload {
  oldKeyId: string;
  newKeyId: string;
  rotatedAt: string;
  reason: KeyRotationReason;
}

export interface KeyRotationEventEnvelope {
  v: 1;
  type: 'crypto.key_rotate';
  issuer: string;
  ts: number;
  nonce: number;
  payload: KeyRotationEventPayload;
  sig: string;
  hash: string;
}

export function createKeyRotationEvent(
  issuer: string,
  nonce: number,
  payload: KeyRotationEventPayload,
  ts: number = Date.now(),
): KeyRotationEventEnvelope {
  return {
    v: 1,
    type: 'crypto.key_rotate',
    issuer,
    ts,
    nonce,
    payload,
    sig: '',
    hash: '',
  };
}

export async function signKeyRotationEvent(
  envelope: KeyRotationEventEnvelope,
  privateKey: Uint8Array,
): Promise<KeyRotationEventEnvelope> {
  const hash = eventHashHex(envelope);
  const sig = await signEvent(envelope, privateKey);
  return {
    ...envelope,
    hash,
    sig,
  };
}

export function encodeKeyRotationEvent(envelope: KeyRotationEventEnvelope): Uint8Array {
  return canonicalizeBytes(envelope);
}

export async function recordKeyRotationEvent(
  eventStore: EventStore,
  envelope: KeyRotationEventEnvelope,
): Promise<boolean> {
  if (!envelope.hash) {
    throw new Error('rotation event must include hash');
  }
  const bytes = encodeKeyRotationEvent(envelope);
  return eventStore.appendEvent(envelope.hash, bytes);
}
