import canonicalizeModule from 'canonicalize';
import { utf8ToBytes } from '../utils/bytes.js';

const canonicalize = canonicalizeModule as unknown as (input: unknown) => string | undefined;

export function canonicalizeJson(input: unknown): string {
  const out = canonicalize(input);
  if (out === undefined) {
    throw new Error('Unable to canonicalize input');
  }
  return out;
}

export function canonicalizeBytes(input: unknown): Uint8Array {
  return utf8ToBytes(canonicalizeJson(input));
}
