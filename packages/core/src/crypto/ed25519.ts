import * as ed25519 from '@noble/ed25519';
import { base58btcDecode, base58btcEncode } from '../encoding/base58.js';

export interface Keypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export async function generateKeypair(): Promise<Keypair> {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

export async function publicKeyFromPrivateKey(privateKey: Uint8Array): Promise<Uint8Array> {
  return ed25519.getPublicKeyAsync(privateKey);
}

export async function signBytes(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  return ed25519.signAsync(message, privateKey);
}

export async function verifySignature(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  return ed25519.verifyAsync(signature, message, publicKey);
}

export async function signBase58(message: Uint8Array, privateKey: Uint8Array): Promise<string> {
  const sig = await signBytes(message, privateKey);
  return base58btcEncode(sig);
}

export async function verifyBase58(
  signatureBase58: string,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  const sig = base58btcDecode(signatureBase58);
  return verifySignature(sig, message, publicKey);
}
