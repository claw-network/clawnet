/**
 * @file did-address.ts
 * @description DID ↔ EVM address mapping utilities.
 *
 * Provides bidirectional mapping between:
 *   - did:claw: identifiers (Ed25519 public key, multibase base58btc)
 *   - ClawNet native addresses (claw + base58btc(version + pubkey + checksum))
 *   - EVM addresses (for on-chain contract interactions)
 *
 * Usage:
 *   npx hardhat run scripts/did-address.ts
 *   npx ts-node --esm scripts/did-address.ts <did:claw:z6Mk...>
 *
 * Also exported as a library for programmatic use.
 */

import { keccak256, sha256, getBytes, hexlify, toUtf8Bytes } from "ethers";

// ─── Base58 ──────────────────────────────────────────────────────────

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Encode a Uint8Array to base58 string. */
export function base58Encode(input: Uint8Array): string {
  if (input.length === 0) return "";

  // Count leading zeros
  let zeros = 0;
  while (zeros < input.length && input[zeros] === 0) zeros++;

  // Convert to bigint
  let num = 0n;
  for (const byte of input) {
    num = num * 256n + BigInt(byte);
  }

  // Convert to base58
  const chars: string[] = [];
  while (num > 0n) {
    const mod = Number(num % 58n);
    chars.unshift(BASE58_ALPHABET[mod]);
    num = num / 58n;
  }

  // Prepend '1' for each leading zero byte
  for (let i = 0; i < zeros; i++) {
    chars.unshift("1");
  }

  return chars.join("");
}

/** Decode a base58 string to Uint8Array. */
export function base58Decode(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);

  // Count leading '1's (zero bytes)
  let zeros = 0;
  while (zeros < input.length && input[zeros] === "1") zeros++;

  // Convert from base58 to bigint
  let num = 0n;
  for (const char of input) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * 58n + BigInt(idx);
  }

  // Convert bigint to bytes
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num = num >> 8n;
  }

  // Prepend zero bytes
  const result = new Uint8Array(zeros + bytes.length);
  result.set(new Uint8Array(bytes), zeros);
  return result;
}

// ─── Multibase ───────────────────────────────────────────────────────

/** Encode bytes as multibase base58btc (prefix 'z'). */
export function multibaseEncode(data: Uint8Array): string {
  return "z" + base58Encode(data);
}

/** Decode a multibase base58btc string (must start with 'z'). */
export function multibaseDecode(multibase: string): Uint8Array {
  if (!multibase.startsWith("z")) {
    throw new Error("Only base58btc multibase (prefix 'z') is supported");
  }
  return base58Decode(multibase.slice(1));
}

// ─── DID Utilities ───────────────────────────────────────────────────

/** Extract the Ed25519 public key bytes from a did:claw: string. */
export function didToPublicKey(did: string): Uint8Array {
  if (!did.startsWith("did:claw:")) {
    throw new Error(`Invalid DID format: must start with "did:claw:". Got: ${did}`);
  }
  const multibase = did.slice("did:claw:".length);
  return multibaseDecode(multibase);
}

/** Create a did:claw: string from Ed25519 public key bytes. */
export function publicKeyToDid(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, got ${publicKey.length}`);
  }
  return "did:claw:" + multibaseEncode(publicKey);
}

// ─── ClawNet Native Address ──────────────────────────────────────────

const ADDRESS_VERSION = 0x00;

/**
 * Derive a ClawNet native address from an Ed25519 public key.
 * Format: "claw" + base58btc(version + publicKey + checksum)
 * Version byte = 0x00
 * Checksum = first 4 bytes of SHA-256(publicKey)
 */
export function publicKeyToClawAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, got ${publicKey.length}`);
  }

  // SHA-256 checksum (single hash, NOT double like Bitcoin)
  const hashHex = sha256(publicKey);
  const hashBytes = getBytes(hashHex);
  const checksum = hashBytes.slice(0, 4);

  // version (1) + publicKey (32) + checksum (4) = 37 bytes
  const payload = new Uint8Array(37);
  payload[0] = ADDRESS_VERSION;
  payload.set(publicKey, 1);
  payload.set(checksum, 33);

  return "claw" + base58Encode(payload);
}

/** Parse a ClawNet native address back to Ed25519 public key bytes. */
export function clawAddressToPublicKey(address: string): Uint8Array {
  if (!address.startsWith("claw")) {
    throw new Error(`Invalid ClawNet address: must start with "claw". Got: ${address}`);
  }

  const encoded = address.slice(4); // strip "claw" prefix
  const payload = base58Decode(encoded);

  if (payload.length !== 37) {
    throw new Error(`Invalid address payload: expected 37 bytes, got ${payload.length}`);
  }

  const version = payload[0];
  if (version !== ADDRESS_VERSION) {
    throw new Error(`Unsupported address version: ${version}`);
  }

  const publicKey = payload.slice(1, 33);
  const checksum = payload.slice(33, 37);

  // Verify checksum
  const hashHex = sha256(publicKey);
  const hashBytes = getBytes(hashHex);
  const expectedChecksum = hashBytes.slice(0, 4);

  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expectedChecksum[i]) {
      throw new Error("Address checksum mismatch");
    }
  }

  return publicKey;
}

// ─── EVM Address Derivation ──────────────────────────────────────────

/**
 * Derive an EVM-compatible address from an Ed25519 public key.
 * Uses keccak256(publicKey) and takes the last 20 bytes — same approach as
 * Ethereum uses for secp256k1 (but here applied to Ed25519 keys).
 *
 * NOTE: This is a deterministic one-way mapping used for on-chain DID ↔ address
 * association. It does NOT create a valid secp256k1 key pair.
 */
export function publicKeyToEvmAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, got ${publicKey.length}`);
  }
  const hash = keccak256(publicKey);
  // Take last 20 bytes (rightmost)
  return "0x" + hash.slice(-40);
}

// ─── DID Hash (for on-chain usage) ──────────────────────────────────

/**
 * Compute the DID hash used in ClawIdentity.sol.
 * didHash = keccak256(bytes(did:claw:...))
 */
export function didToHash(did: string): string {
  return keccak256(toUtf8Bytes(did));
}

// ─── All-in-one mapping ─────────────────────────────────────────────

export interface AddressMapping {
  did: string;
  publicKeyHex: string;
  clawAddress: string;
  evmAddress: string;
  didHash: string;
}

/** Given a DID string, derive all address formats. */
export function mapDid(did: string): AddressMapping {
  const publicKey = didToPublicKey(did);
  return {
    did,
    publicKeyHex: hexlify(publicKey),
    clawAddress: publicKeyToClawAddress(publicKey),
    evmAddress: publicKeyToEvmAddress(publicKey),
    didHash: didToHash(did),
  };
}

/** Given a hex public key, derive all address formats. */
export function mapPublicKey(publicKeyHex: string): AddressMapping {
  const publicKey = getBytes(publicKeyHex);
  const did = publicKeyToDid(publicKey);
  return {
    did,
    publicKeyHex: hexlify(publicKey),
    clawAddress: publicKeyToClawAddress(publicKey),
    evmAddress: publicKeyToEvmAddress(publicKey),
    didHash: didToHash(did),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Demo with test vector
    console.log("DID ↔ Address Mapping Tool\n");
    console.log("Usage: npx ts-node scripts/did-address.ts <did:claw:...>");
    console.log("       npx ts-node scripts/did-address.ts --pubkey <hex>");
    console.log("       npx ts-node scripts/did-address.ts --address <claw...>\n");
    console.log("─── Demo with test vector ───\n");

    const testPubKey = "28e4b24dc96e47a480a4c74fb70e7635ae2a4c5330ef7d6a8ec79dc46a57931b";
    const mapping = mapPublicKey("0x" + testPubKey);
    console.log(`  Public Key: ${mapping.publicKeyHex}`);
    console.log(`  DID:        ${mapping.did}`);
    console.log(`  ClawAddr:   ${mapping.clawAddress}`);
    console.log(`  EVM Addr:   ${mapping.evmAddress}`);
    console.log(`  DID Hash:   ${mapping.didHash}`);

    // Verify against known test vector address
    const expectedAddr = "claw1K1ZonSqQDEoAufMT6pHz5GFU3A94pQvZxBPYHMiA5K2R2Gkhn";
    console.log(`\n  Expected:   ${expectedAddr}`);
    console.log(`  Match:      ${mapping.clawAddress === expectedAddr ? "✅" : "❌"}`);
    return;
  }

  if (args[0] === "--pubkey" && args[1]) {
    const hex = args[1].startsWith("0x") ? args[1] : "0x" + args[1];
    const mapping = mapPublicKey(hex);
    console.log(JSON.stringify(mapping, null, 2));
  } else if (args[0] === "--address" && args[1]) {
    const publicKey = clawAddressToPublicKey(args[1]);
    const mapping = mapPublicKey(hexlify(publicKey));
    console.log(JSON.stringify(mapping, null, 2));
  } else if (args[0].startsWith("did:claw:")) {
    const mapping = mapDid(args[0]);
    console.log(JSON.stringify(mapping, null, 2));
  } else {
    console.error("Unrecognized input. Use --pubkey <hex>, --address <claw...>, or did:claw:...");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
