const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

function verifyEd25519() {
  const v = readJson('ed25519.json');
  const priv = Buffer.from(v.privateKeyHex, 'hex');
  const pub = Buffer.from(v.publicKeyHex, 'hex');
  const msg = Buffer.from(v.messageHex, 'hex');

  // PKCS8 and SPKI headers for Ed25519
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    priv,
  ]);
  const spki = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    pub,
  ]);

  const keyPriv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const keyPub = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const sig = crypto.sign(null, msg, keyPriv);
  const ok = crypto.verify(null, msg, keyPub, Buffer.from(v.signatureHex, 'hex'));

  return ok && hex(sig) === v.signatureHex;
}

function verifySha256() {
  const v = readJson('sha256.json');
  const hash = crypto.createHash('sha256').update(Buffer.from(v.inputHex, 'hex')).digest('hex');
  return hash === v.sha256Hex;
}

function verifyAesGcm() {
  const v = readJson('aes-256-gcm.json');
  const key = Buffer.from(v.keyHex, 'hex');
  const nonce = Buffer.from(v.nonceHex, 'hex');
  const plaintext = Buffer.from(v.plaintextHex, 'hex');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return hex(ciphertext) === v.ciphertextHex && hex(tag) === v.tagHex;
}

function verifyJcs() {
  const v = readJson('jcs.json');
  return stableStringify(v.input) === v.canonical;
}

const results = {
  ed25519: verifyEd25519(),
  sha256: verifySha256(),
  aes_256_gcm: verifyAesGcm(),
  jcs: verifyJcs(),
};

const ok = Object.values(results).every(Boolean);
console.log(results);
process.exit(ok ? 0 : 1);
