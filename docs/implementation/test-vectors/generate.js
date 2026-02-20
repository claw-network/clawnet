const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const outDir = __dirname;

function write(name, obj) {
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(obj, null, 2));
}

function base58Encode(buffer) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let x = BigInt('0x' + buffer.toString('hex'));
  let out = '';
  while (x > 0n) {
    const mod = x % 58n;
    out = alphabet[Number(mod)] + out;
    x = x / 58n;
  }
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    out = '1' + out;
  }
  return out;
}

function addressFromPub(pub) {
  const checksum = crypto.createHash('sha256').update(pub).digest().subarray(0, 4);
  const payload = Buffer.concat([Buffer.from([0x00]), pub, checksum]);
  return 'claw' + base58Encode(payload);
}

function generateEd25519() {
  const seed = Buffer.from('381ea641a651f1e2011b948ee45c69a989a9582d29d9512b60c6d6dd78bea9bc', 'hex');

  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed,
  ]);

  const keyPriv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const keyPub = crypto.createPublicKey(keyPriv);
  const spki = keyPub.export({ format: 'der', type: 'spki' });
  const pub = spki.subarray(spki.length - 32);

  const msg = Buffer.from('clawnet-test', 'utf8');
  const sig = crypto.sign(null, msg, keyPriv);

  write('ed25519.json', {
    name: 'ed25519-clawnet-test',
    privateKeyHex: seed.toString('hex'),
    publicKeyHex: pub.toString('hex'),
    messageHex: msg.toString('hex'),
    signatureHex: sig.toString('hex'),
    address: addressFromPub(pub),
  });
}

function generateSha256() {
  const input = Buffer.from('clawnet-test', 'utf8');
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  write('sha256.json', {
    input: 'clawnet-test',
    inputHex: input.toString('hex'),
    sha256Hex: hash,
  });
}

function generateAesGcm() {
  const key = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
  const nonce = Buffer.from('0f0e0d0c0b0a090807060504', 'hex');
  const plaintext = Buffer.from('clawnet-test', 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  write('aes-256-gcm.json', {
    keyHex: key.toString('hex'),
    nonceHex: nonce.toString('hex'),
    plaintext: 'clawnet-test',
    plaintextHex: plaintext.toString('hex'),
    ciphertextHex: ciphertext.toString('hex'),
    tagHex: tag.toString('hex'),
  });
}

function generateJcs() {
  write('jcs.json', {
    input: { b: 1, a: 'x', c: { d: 2, c: 1 } },
    canonical: '{"a":"x","b":1,"c":{"c":1,"d":2}}',
  });
}

function main() {
  generateEd25519();
  generateSha256();
  generateAesGcm();
  generateJcs();
}

main();
