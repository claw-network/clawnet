import { x25519 } from '@noble/curves/ed25519';

export interface X25519Keypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export function generateX25519Keypair(): X25519Keypair {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function x25519PublicKeyFromPrivateKey(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

export function x25519SharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey);
}
