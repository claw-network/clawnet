const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Map<string, number>(
  ALPHABET.split('').map((char, index) => [char, index]),
);

export function base58btcEncode(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return '';
  }
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    digits.push(0);
  }
  return digits
    .reverse()
    .map((digit) => ALPHABET[digit])
    .join('');
}

export function base58btcDecode(input: string): Uint8Array {
  if (input.length === 0) {
    return new Uint8Array();
  }
  const bytes: number[] = [0];
  for (const char of input) {
    const value = ALPHABET_MAP.get(char);
    if (value === undefined) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < input.length && input[i] === '1'; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export function multibaseEncode(bytes: Uint8Array): string {
  return `z${base58btcEncode(bytes)}`;
}

export function multibaseDecode(input: string): Uint8Array {
  if (!input.startsWith('z')) {
    throw new Error('multibase string must start with z');
  }
  return base58btcDecode(input.slice(1));
}
