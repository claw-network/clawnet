import { randomBytes } from 'node:crypto';

const GF_SIZE = 256;
const GF_EXP = new Uint8Array(GF_SIZE * 2);
const GF_LOG = new Uint8Array(GF_SIZE);

(function initGfTables() {
  let x = 1;
  for (let i = 0; i < GF_SIZE - 1; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    const x2 = x << 1;
    const reduced = (x2 & 0x100) ? (x2 ^ 0x11b) : x2;
    x = reduced ^ x;
  }
  for (let i = GF_SIZE - 1; i < GF_EXP.length; i++) {
    GF_EXP[i] = GF_EXP[i - (GF_SIZE - 1)];
  }
})();

function gfAdd(a: number, b: number): number {
  return a ^ b;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfDiv(a: number, b: number): number {
  if (a === 0) return 0;
  if (b === 0) throw new Error('division by zero in GF(256)');
  return GF_EXP[GF_LOG[a] + (GF_SIZE - 1) - GF_LOG[b]];
}

function evalPolynomial(coeffs: Uint8Array, x: number): number {
  let result = 0;
  let power = 1;
  for (let i = 0; i < coeffs.length; i++) {
    result = gfAdd(result, gfMul(coeffs[i], power));
    power = gfMul(power, x);
  }
  return result;
}

function assertShareCount(threshold: number, shareCount: number): void {
  if (threshold < 2) {
    throw new Error('threshold must be at least 2');
  }
  if (shareCount < threshold) {
    throw new Error('shareCount must be >= threshold');
  }
  if (shareCount > 255) {
    throw new Error('shareCount must be <= 255');
  }
}

export function splitSecret(
  secret: Uint8Array,
  threshold: number,
  shareCount: number,
  rng: (size: number) => Uint8Array = randomBytes,
): Uint8Array[] {
  if (secret.length === 0) {
    throw new Error('secret must not be empty');
  }
  assertShareCount(threshold, shareCount);

  const shares: Uint8Array[] = [];
  for (let i = 1; i <= shareCount; i++) {
    shares.push(new Uint8Array(secret.length + 1));
    shares[i - 1][0] = i;
  }

  for (let byteIndex = 0; byteIndex < secret.length; byteIndex++) {
    const coeffs = new Uint8Array(threshold);
    coeffs[0] = secret[byteIndex];
    if (threshold > 1) {
      const random = rng(threshold - 1);
      coeffs.set(random, 1);
    }
    for (let shareIndex = 0; shareIndex < shareCount; shareIndex++) {
      const x = shares[shareIndex][0];
      shares[shareIndex][byteIndex + 1] = evalPolynomial(coeffs, x);
    }
  }

  return shares;
}

function decodeShare(share: Uint8Array): { id: number; data: Uint8Array } {
  if (share.length < 2) {
    throw new Error('share length too small');
  }
  const id = share[0];
  if (id === 0) {
    throw new Error('share id must be non-zero');
  }
  return { id, data: share.subarray(1) };
}

export function combineShares(shares: Uint8Array[]): Uint8Array {
  if (shares.length < 2) {
    throw new Error('at least two shares are required');
  }

  const decoded = shares.map(decodeShare);
  const length = decoded[0].data.length;
  const seen = new Set<number>();
  for (const share of decoded) {
    if (share.data.length !== length) {
      throw new Error('all shares must have the same length');
    }
    if (seen.has(share.id)) {
      throw new Error('duplicate share id');
    }
    seen.add(share.id);
  }

  const secret = new Uint8Array(length);

  for (let byteIndex = 0; byteIndex < length; byteIndex++) {
    let value = 0;
    for (let i = 0; i < decoded.length; i++) {
      const xi = decoded[i].id;
      const yi = decoded[i].data[byteIndex];
      let num = 1;
      let den = 1;
      for (let j = 0; j < decoded.length; j++) {
        if (i === j) continue;
        const xj = decoded[j].id;
        num = gfMul(num, xj);
        den = gfMul(den, gfAdd(xj, xi));
      }
      const lagrange = gfDiv(num, den);
      value = gfAdd(value, gfMul(yi, lagrange));
    }
    secret[byteIndex] = value;
  }

  return secret;
}
