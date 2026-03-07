#!/usr/bin/env node
// ==============================================================================
// Generate QBFT genesis extradata from validator addresses
// ==============================================================================
// Usage:
//   node scripts/gen-qbft-extradata.mjs 0xAddr1 0xAddr2 0xAddr3 [...]
//
// QBFT extradata format:
//   32 bytes vanity + RLP([sorted_validators, votes=[], round=0, seals=[]])
// ==============================================================================

const validators = process.argv.slice(2);
if (validators.length === 0) {
  console.error('Usage: node gen-qbft-extradata.mjs 0xAddr1 0xAddr2 ...');
  process.exit(1);
}

// Validate and normalize addresses (lowercase, no 0x, sorted)
const addrs = validators.map((a) => {
  const clean = a.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    console.error(`Invalid address: ${a}`);
    process.exit(1);
  }
  return clean;
});
addrs.sort();

// RLP encoding helpers
function rlpEncodeBytes(hex) {
  const len = hex.length / 2;
  if (len === 1 && parseInt(hex, 16) < 0x80) return hex;
  if (len <= 55) return (0x80 + len).toString(16).padStart(2, '0') + hex;
  const lenHex = len.toString(16);
  const lenBytes = lenHex.length % 2 === 0 ? lenHex : '0' + lenHex;
  return (0xb7 + lenBytes.length / 2).toString(16).padStart(2, '0') + lenBytes + hex;
}

function rlpEncodeList(items) {
  const payload = items.join('');
  const payloadLen = payload.length / 2;
  if (payloadLen <= 55) return (0xc0 + payloadLen).toString(16).padStart(2, '0') + payload;
  const lenHex = payloadLen.toString(16);
  const lenBytes = lenHex.length % 2 === 0 ? lenHex : '0' + lenHex;
  return (0xf7 + lenBytes.length / 2).toString(16).padStart(2, '0') + lenBytes + payload;
}

// Encode each validator address as RLP bytes (20 bytes each)
const rlpAddrs = addrs.map((a) => rlpEncodeBytes(a));

// Build QBFT extradata: vanity + RLP([validators_list, votes=[], round=0, seals=[]])
const vanity = '0'.repeat(64); // 32 bytes
const validatorsList = rlpEncodeList(rlpAddrs);
const emptyList = 'c0'; // RLP for []
const zeroInt = '80'; // RLP for integer 0
const outer = rlpEncodeList([validatorsList, emptyList, zeroInt, emptyList]);

const extradata = '0x' + vanity + outer;

console.log(extradata);
console.log();
console.log('Validators (sorted):');
addrs.forEach((a) => console.log(`  0x${a}`));
console.log(`\nTotal bytes: ${(extradata.length - 2) / 2}`);
