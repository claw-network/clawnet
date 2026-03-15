import { base58btcDecode, base58btcEncode, multibaseDecode, multibaseEncode } from '../encoding/base58.js';
import { sha256Bytes } from '../crypto/hash.js';
import { bytesToHex } from '../utils/bytes.js';

const DID_PREFIX = 'did:claw:';
const ADDRESS_PREFIX = 'claw';
const ADDRESS_VERSION = 0x00;

export function didFromPublicKey(publicKey: Uint8Array): string {
  return `${DID_PREFIX}${multibaseEncode(publicKey)}`;
}

export function publicKeyFromDid(did: string): Uint8Array {
  if (!did.startsWith(DID_PREFIX)) {
    throw new Error('Invalid did:claw prefix');
  }
  return multibaseDecode(did.slice(DID_PREFIX.length));
}

export function addressFromPublicKey(publicKey: Uint8Array): string {
  const checksum = sha256Bytes(publicKey).slice(0, 4);
  const body = new Uint8Array(1 + publicKey.length + checksum.length);
  body[0] = ADDRESS_VERSION;
  body.set(publicKey, 1);
  body.set(checksum, 1 + publicKey.length);
  return `${ADDRESS_PREFIX}${base58btcEncode(body)}`;
}

export function publicKeyFromAddress(address: string): Uint8Array {
  if (!address.startsWith(ADDRESS_PREFIX)) {
    throw new Error('Invalid claw address prefix');
  }
  const decoded = base58btcDecode(address.slice(ADDRESS_PREFIX.length));
  if (decoded.length < 1 + 32 + 4) {
    throw new Error('Invalid address length');
  }
  if (decoded[0] !== ADDRESS_VERSION) {
    throw new Error('Unsupported address version');
  }
  const publicKey = decoded.slice(1, decoded.length - 4);
  const checksum = decoded.slice(decoded.length - 4);
  const expected = sha256Bytes(publicKey).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) {
      throw new Error(
        `Invalid address checksum (expected ${bytesToHex(expected)}, got ${bytesToHex(checksum)})`,
      );
    }
  }
  return publicKey;
}

export function addressFromDid(did: string): string {
  return addressFromPublicKey(publicKeyFromDid(did));
}
