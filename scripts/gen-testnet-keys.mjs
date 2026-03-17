#!/usr/bin/env node
/**
 * Generate all keys needed for a fresh ClawNet testnet deployment.
 * Derives Ethereum addresses from private keys using secp256k1 + keccak256.
 *
 * Usage: node scripts/gen-testnet-keys.mjs > infra/testnet/deployments/secrets.env
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Keccak-256 (Ethereum uses keccak, not SHA3-256)
// Node.js does not expose raw keccak — we implement the sponge directly
// using the Keccak-f[1600] permutation. However, that is complex.
// Instead, we'll use the fact that Geth + ethers can derive the address,
// and we just need to produce valid secp256k1 private keys.
//
// But we DO need addresses to build genesis.json.
// So let's use Node.js `crypto.createHash('sha3-256')` ... wait, Ethereum
// uses *original* Keccak-256, NOT NIST SHA3-256 (they differ in padding).
//
// Workaround: use SubtleCrypto + a tiny keccak implementation.
// ---------------------------------------------------------------------------

// Tiny Keccak-256 implementation (Ethereum-compatible)
// Based on https://github.com/nicolo-ribaudo/keccak-wasm-256 (public domain)
const KECCAK_ROUNDS = 24;
const RC = [
  1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n,
  0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x8an, 0x88n, 0x80008009n, 0x8000000an,
  0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n,
];
const ROT = [
  [0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]
];

function keccak256(data) {
  const rate = 136; // 1088 bits / 8
  const cap = 64;   // 512 bits / 8
  const state = new BigUint64Array(25);
  
  // Pad: data || 0x01 || 0x00...00 || 0x80
  const padLen = rate - (data.length % rate);
  const padded = Buffer.alloc(data.length + padLen);
  data.copy(padded);
  padded[data.length] = 0x01;
  padded[padded.length - 1] |= 0x80;
  
  // Absorb
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      state[i] ^= padded.readBigUInt64LE(off + i * 8);
    }
    keccakf(state);
  }
  
  // Squeeze (32 bytes)
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) {
    out.writeBigUInt64LE(state[i], i * 8);
  }
  return out;
}

function keccakf(A) {
  for (let round = 0; round < KECCAK_ROUNDS; round++) {
    // θ
    const C = new BigUint64Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x+5] ^ A[x+10] ^ A[x+15] ^ A[x+20];
    const D = new BigUint64Array(5);
    for (let x = 0; x < 5; x++) D[x] = C[(x+4)%5] ^ rot64(C[(x+1)%5], 1);
    for (let i = 0; i < 25; i++) A[i] ^= D[i % 5];
    
    // ρ and π
    const B = new BigUint64Array(25);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        B[y*5 + ((2*x+3*y)%5)] = rot64(A[x + y*5], ROT[x][y]);
    
    // χ
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        A[x + y*5] = B[x + y*5] ^ ((~B[((x+1)%5) + y*5]) & B[((x+2)%5) + y*5]);
    
    // ι
    A[0] ^= RC[round];
  }
}

function rot64(x, n) {
  n = BigInt(n);
  return ((x << n) | (x >> (64n - n))) & 0xFFFFFFFFFFFFFFFFn;
}

// ---------------------------------------------------------------------------
// Derive Ethereum address from private key
// ---------------------------------------------------------------------------
function privateKeyToAddress(privKeyHex) {
  const privKeyBuf = Buffer.from(privKeyHex.replace('0x', ''), 'hex');
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(privKeyBuf);
  const pubKey = ecdh.getPublicKey(null, 'uncompressed'); // 65 bytes: 04 + x + y
  const pubKeyBody = pubKey.slice(1); // 64 bytes
  
  const hash = keccak256(pubKeyBody);
  const address = '0x' + hash.slice(12).toString('hex');
  return toChecksumAddress(address);
}

function toChecksumAddress(address) {
  const addr = address.toLowerCase().replace('0x', '');
  const hash = keccak256(Buffer.from(addr, 'utf8')).toString('hex');
  let result = '0x';
  for (let i = 0; i < 40; i++) {
    result += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const labels = ['VALIDATOR_1', 'VALIDATOR_2', 'VALIDATOR_3', 'DEPLOYER', 'TREASURY'];
const wallets = {};

for (const label of labels) {
  const privKey = '0x' + crypto.randomBytes(32).toString('hex');
  const address = privateKeyToAddress(privKey);
  wallets[label] = { address, privateKey: privKey };
}

const passphrase = crypto.randomBytes(24).toString('base64url');
const apiKey = crypto.randomBytes(32).toString('hex');
const validatorPassword = 'clawnet-' + crypto.randomBytes(8).toString('hex');

// Output as .env format
console.log('# ============================================================================');
console.log('# ClawNet Testnet — Secrets (generated ' + new Date().toISOString() + ')');
console.log('# WARNING: NEVER commit this file to version control!');
console.log('# ============================================================================');
console.log('');
for (const label of labels) {
  console.log(`${label}_ADDRESS=${wallets[label].address}`);
  console.log(`${label}_PRIVATE_KEY=${wallets[label].privateKey}`);
  console.log('');
}
console.log(`CLAW_PASSPHRASE=${passphrase}`);
console.log(`CLAW_API_KEY=${apiKey}`);
console.log(`VALIDATOR_PASSWORD=${validatorPassword}`);
console.log('');
console.log('# Server assignments:');
console.log(`# Server A (<SERVER_A_IP>): VALIDATOR_1`);
console.log(`# Server B (<SERVER_B_IP>): VALIDATOR_2`);
console.log(`# Server C (<SERVER_C_IP>): VALIDATOR_3`);
