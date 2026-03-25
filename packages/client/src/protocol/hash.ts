import { keccak256, toUtf8Bytes } from 'ethers';

import type { AgentDID } from './types.js';

export function isDidClaw(value: string): value is AgentDID {
  return /^did:claw:[A-Za-z0-9]+$/.test(value);
}

export function hashDid(did: AgentDID): string {
  return keccak256(toUtf8Bytes(did));
}

export function ensureHex32(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${field} must be bytes32 hex string`);
  }
  return value;
}
