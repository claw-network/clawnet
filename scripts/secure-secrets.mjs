#!/usr/bin/env node
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  scryptSync,
  constants,
} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

const KDF_N = 16384;
const KDF_R = 8;
const KDF_P = 1;
const MAGIC = 'CLAW_SECRET_ENVELOPE_V1';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function printHelp() {
  process.stdout.write(`
Usage:
  node scripts/secure-secrets.mjs gen-keypair --public-key <path> --private-key <path>
  node scripts/secure-secrets.mjs refresh-manifest --manifest <file> [--roots infra/testnet,infra/devnet]
  node scripts/secure-secrets.mjs encrypt --input <file|dir> --output <file.enc> [--mode password|key] [--public-key <path>] [--password <value>]
  node scripts/secure-secrets.mjs decrypt --input <file.enc> --output <file|dir> [--private-key <path>] [--password <value>] [--private-key-passphrase <value>]
  node scripts/secure-secrets.mjs encrypt-manifest --manifest <file> --output <file.enc> [--mode password|key] [--public-key <path>] [--password <value>]

Examples:
  node scripts/secure-secrets.mjs refresh-manifest --manifest infra/testnet/scenarios/init/secret-files.txt
  node scripts/secure-secrets.mjs encrypt-manifest --manifest infra/testnet/scenarios/init/secret-files.txt --output infra/testnet/scenarios/init/secrets.bundle.enc
  node scripts/secure-secrets.mjs decrypt --input infra/testnet/scenarios/init/secrets.bundle.enc --output .
`);
}

const SENSITIVE_BASENAME_RE =
  /(^\.env$|\.env$|secrets\.env$|enodes\.env$|passphrase$|id_rsa$|id_ed25519$|server-access\.env$)/i;
const SENSITIVE_EXT_RE = /\.(pem|key|p12|pfx|kdbx|gpg|asc)$/i;
const SENSITIVE_PATH_RE = /(\/|^)(keystore|\.generated)(\/|$)|UTC--\d{4}-\d{2}-\d{2}/i;
const SECRET_VAR_RE =
  /(PRIVATE_KEY|SECRET|PASSWORD|PASSPHRASE|MNEMONIC|API_KEY|ACCESS_KEY|TOKEN|RPC_URL)\s*=/i;
const DEFAULT_REFRESH_ROOTS = ['infra/testnet', 'infra/devnet'];

async function promptHidden(question) {
  return await new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const stdin = process.stdin;
    const onData = (char) => {
      const ch = String(char);
      switch (ch) {
        case '\n':
        case '\r':
        case '\u0004':
          rl.output.write('\n');
          break;
        default:
          rl.output.write('*');
          break;
      }
    };
    process.stdout.write(question);
    stdin.on('data', onData);
    rl.question('', (answer) => {
      stdin.removeListener('data', onData);
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function normalizeRel(relPath) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error(`Unsafe path in payload: ${relPath}`);
  }
  return normalized;
}

async function collectDir(rootDir) {
  const entries = [];
  async function walk(currentDir) {
    const children = await fs.readdir(currentDir, { withFileTypes: true });
    for (const child of children) {
      const abs = path.join(currentDir, child.name);
      const rel = path.relative(rootDir, abs);
      if (child.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!child.isFile()) continue;
      const buf = await fs.readFile(abs);
      const st = await fs.stat(abs);
      entries.push({
        path: rel.replace(/\\/g, '/'),
        mode: st.mode,
        dataB64: buf.toString('base64'),
      });
    }
  }
  await walk(rootDir);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

async function buildPayloadFromInput(inputPath) {
  const abs = path.resolve(inputPath);
  const st = await fs.stat(abs);
  if (st.isFile()) {
    const data = await fs.readFile(abs);
    return {
      kind: 'file',
      source: path.basename(abs),
      file: { path: path.basename(abs), mode: st.mode, dataB64: data.toString('base64') },
    };
  }
  if (st.isDirectory()) {
    return {
      kind: 'dir',
      source: path.basename(abs),
      files: await collectDir(abs),
    };
  }
  throw new Error(`Unsupported input type: ${inputPath}`);
}

async function buildPayloadFromManifest(manifestPath) {
  const abs = path.resolve(manifestPath);
  const raw = await fs.readFile(abs, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const files = [];
  for (const rel of lines) {
    const filePath = path.resolve(rel);
    const st = await fs.stat(filePath);
    if (!st.isFile()) {
      throw new Error(`Manifest entry is not a file: ${rel}`);
    }
    const data = await fs.readFile(filePath);
    files.push({ path: rel.replace(/\\/g, '/'), mode: st.mode, dataB64: data.toString('base64') });
  }
  return {
    kind: 'bundle',
    source: manifestPath,
    files,
  };
}

async function readTextFileSafe(filePath, maxBytes = 1024 * 1024) {
  const st = await fs.stat(filePath);
  if (st.size > maxBytes) return null;
  const buf = await fs.readFile(filePath);
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}

function shouldSkipScanPath(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  if (!normalized) return true;
  if (normalized.includes('/node_modules/')) return true;
  if (normalized.includes('/dist/')) return true;
  if (normalized.includes('/build/')) return true;
  if (normalized.endsWith('.enc')) return true;
  if (normalized.endsWith('.md')) return true;
  if (normalized.endsWith('.mjs')) return true;
  if (normalized.endsWith('.ts')) return true;
  if (normalized.endsWith('.sh')) return true;
  return false;
}

async function isSensitiveFile(absPath, relPath) {
  const base = path.basename(relPath);
  const normalized = relPath.replace(/\\/g, '/');
  if (base.endsWith('.example') || base.endsWith('.sample')) return false;
  if (base === 'public-info.txt') return false;
  if (SENSITIVE_BASENAME_RE.test(base)) return true;
  if (SENSITIVE_EXT_RE.test(base)) return true;
  if (SENSITIVE_PATH_RE.test(normalized)) return true;
  if (shouldSkipScanPath(normalized)) return false;
  try {
    const text = await readTextFileSafe(absPath);
    if (!text) return false;
    return SECRET_VAR_RE.test(text);
  } catch {
    return false;
  }
}

async function refreshManifest(args) {
  const manifestPath = args.manifest;
  if (!manifestPath) {
    throw new Error('refresh-manifest requires --manifest.');
  }
  const roots = String(args.roots || DEFAULT_REFRESH_ROOTS.join(','))
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const repoRoot = process.cwd();
  const discovered = new Set();

  async function walkDir(rootAbs, currentAbs) {
    const entries = await fs.readdir(currentAbs, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(currentAbs, entry.name);
      const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        await walkDir(rootAbs, abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (await isSensitiveFile(abs, rel)) {
        discovered.add(rel);
      }
    }
  }

  for (const root of roots) {
    const rootAbs = path.resolve(root);
    try {
      const st = await fs.stat(rootAbs);
      if (!st.isDirectory()) continue;
      await walkDir(rootAbs, rootAbs);
    } catch {
      // ignore missing roots
    }
  }

  const sorted = Array.from(discovered).sort((a, b) => a.localeCompare(b));
  const content = [
    '# Auto-generated sensitive file manifest',
    '# Command: node scripts/secure-secrets.mjs refresh-manifest --manifest infra/testnet/scenarios/init/secret-files.txt --roots infra/testnet,infra/devnet',
    '# Do not put private keys into git unless encrypted.',
    ...sorted,
    '',
  ].join('\n');

  const manifestAbs = path.resolve(manifestPath);
  await ensureParentDir(manifestAbs);
  await fs.writeFile(manifestAbs, content);
  process.stdout.write(`Manifest updated: ${manifestPath} (${sorted.length} files)\n`);
}

function encryptWithKey(plainBytes, keyBytes) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
  const encrypted = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, encrypted, tag };
}

function decryptWithKey(ciphertext, keyBytes, iv, tag) {
  const decipher = createDecipheriv('aes-256-gcm', keyBytes, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function resolvePassword(args, forEncrypt) {
  if (typeof args.password === 'string' && args.password.length > 0) {
    return args.password;
  }
  const pass = await promptHidden('Enter password: ');
  if (!pass) throw new Error('Password is empty.');
  if (forEncrypt) {
    const confirm = await promptHidden('Confirm password: ');
    if (pass !== confirm) throw new Error('Password confirmation mismatch.');
  }
  return pass;
}

async function encryptPayload(payload, args) {
  const mode = String(args.mode || 'password').toLowerCase();
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  if (mode === 'password') {
    const password = await resolvePassword(args, true);
    const salt = randomBytes(16);
    const key = scryptSync(password, salt, 32, { N: KDF_N, r: KDF_R, p: KDF_P });
    const { iv, encrypted, tag } = encryptWithKey(plain, key);
    return {
      magic: MAGIC,
      mode,
      alg: 'aes-256-gcm',
      kdf: {
        name: 'scrypt',
        N: KDF_N,
        r: KDF_R,
        p: KDF_P,
        saltB64: salt.toString('base64'),
      },
      ivB64: iv.toString('base64'),
      tagB64: tag.toString('base64'),
      ciphertextB64: encrypted.toString('base64'),
      createdAt: new Date().toISOString(),
    };
  }

  if (mode === 'key') {
    const pubPath = args['public-key'];
    if (!pubPath) throw new Error('--public-key is required for key mode.');
    const pubPem = await fs.readFile(path.resolve(pubPath), 'utf8');
    const dataKey = randomBytes(32);
    const wrapped = publicEncrypt(
      { key: pubPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      dataKey,
    );
    const { iv, encrypted, tag } = encryptWithKey(plain, dataKey);
    return {
      magic: MAGIC,
      mode,
      alg: 'aes-256-gcm',
      keyWrap: 'rsa-oaep-sha256',
      wrappedKeyB64: wrapped.toString('base64'),
      ivB64: iv.toString('base64'),
      tagB64: tag.toString('base64'),
      ciphertextB64: encrypted.toString('base64'),
      createdAt: new Date().toISOString(),
    };
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

async function decryptEnvelope(envelope, args) {
  if (envelope.magic !== MAGIC) {
    throw new Error('Unknown envelope format.');
  }
  const iv = Buffer.from(envelope.ivB64, 'base64');
  const tag = Buffer.from(envelope.tagB64, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertextB64, 'base64');

  if (envelope.mode === 'password') {
    const password = await resolvePassword(args, false);
    const salt = Buffer.from(envelope.kdf.saltB64, 'base64');
    const key = scryptSync(password, salt, 32, {
      N: envelope.kdf.N,
      r: envelope.kdf.r,
      p: envelope.kdf.p,
    });
    return decryptWithKey(ciphertext, key, iv, tag);
  }

  if (envelope.mode === 'key') {
    const privateKeyPath = args['private-key'];
    if (!privateKeyPath) throw new Error('--private-key is required for key mode decrypt.');
    const privatePem = await fs.readFile(path.resolve(privateKeyPath), 'utf8');
    const wrapped = Buffer.from(envelope.wrappedKeyB64, 'base64');
    let dataKey;
    try {
      dataKey = privateDecrypt(
        {
          key: privatePem,
          passphrase:
            typeof args['private-key-passphrase'] === 'string'
              ? args['private-key-passphrase']
              : undefined,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        wrapped,
      );
    } catch {
      const passphrase = await promptHidden('Private key passphrase (if any): ');
      dataKey = privateDecrypt(
        {
          key: privatePem,
          passphrase: passphrase || undefined,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        wrapped,
      );
    }
    return decryptWithKey(ciphertext, dataKey, iv, tag);
  }

  throw new Error(`Unsupported envelope mode: ${envelope.mode}`);
}

async function writePayload(payload, outputPath) {
  const outAbs = path.resolve(outputPath);
  if (payload.kind === 'file') {
    const data = Buffer.from(payload.file.dataB64, 'base64');
    let target = outAbs;
    try {
      const st = await fs.stat(outAbs);
      if (st.isDirectory()) {
        target = path.join(outAbs, payload.file.path);
      }
    } catch {
      // ignore missing path
    }
    await ensureParentDir(target);
    await fs.writeFile(target, data);
    if (typeof payload.file.mode === 'number') {
      await fs.chmod(target, payload.file.mode & 0o777);
    }
    return;
  }

  if (payload.kind === 'dir' || payload.kind === 'bundle') {
    await fs.mkdir(outAbs, { recursive: true });
    for (const file of payload.files || []) {
      const rel = normalizeRel(file.path);
      const target = path.join(outAbs, rel);
      await ensureParentDir(target);
      await fs.writeFile(target, Buffer.from(file.dataB64, 'base64'));
      if (typeof file.mode === 'number') {
        await fs.chmod(target, file.mode & 0o777);
      }
    }
    return;
  }

  throw new Error(`Unsupported payload kind: ${payload.kind}`);
}

async function commandGenKeypair(args) {
  const publicKeyPath = args['public-key'];
  const privateKeyPath = args['private-key'];
  if (!publicKeyPath || !privateKeyPath) {
    throw new Error('gen-keypair requires --public-key and --private-key.');
  }
  const usePassphrase = String(args['encrypt-private'] || '').toLowerCase() === 'true';
  let passphrase;
  if (usePassphrase) {
    passphrase = await resolvePassword(args, true);
  }
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: Number.parseInt(String(args.bits || '4096'), 10),
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: passphrase
      ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }
      : { type: 'pkcs8', format: 'pem' },
  });
  const pubAbs = path.resolve(publicKeyPath);
  const priAbs = path.resolve(privateKeyPath);
  await ensureParentDir(pubAbs);
  await ensureParentDir(priAbs);
  await fs.writeFile(pubAbs, publicKey, { mode: 0o644 });
  await fs.writeFile(priAbs, privateKey, { mode: 0o600 });
  process.stdout.write(`Created public key: ${publicKeyPath}\n`);
  process.stdout.write(`Created private key: ${privateKeyPath}\n`);
}

async function commandEncrypt(args) {
  const inputPath = args.input;
  const outputPath = args.output;
  if (!inputPath || !outputPath) throw new Error('encrypt requires --input and --output.');
  const payload = await buildPayloadFromInput(inputPath);
  const envelope = await encryptPayload(payload, args);
  const outAbs = path.resolve(outputPath);
  await ensureParentDir(outAbs);
  await fs.writeFile(outAbs, JSON.stringify(envelope, null, 2));
  process.stdout.write(`Encrypted -> ${outputPath}\n`);
}

async function commandEncryptManifest(args) {
  const manifestPath = args.manifest;
  const outputPath = args.output;
  if (!manifestPath || !outputPath) {
    throw new Error('encrypt-manifest requires --manifest and --output.');
  }
  const payload = await buildPayloadFromManifest(manifestPath);
  const envelope = await encryptPayload(payload, args);
  const outAbs = path.resolve(outputPath);
  await ensureParentDir(outAbs);
  await fs.writeFile(outAbs, JSON.stringify(envelope, null, 2));
  process.stdout.write(`Encrypted manifest bundle -> ${outputPath}\n`);
}

async function commandDecrypt(args) {
  const inputPath = args.input;
  const outputPath = args.output;
  if (!inputPath || !outputPath) throw new Error('decrypt requires --input and --output.');
  const inAbs = path.resolve(inputPath);
  const raw = await fs.readFile(inAbs, 'utf8');
  const envelope = JSON.parse(raw);
  const plain = await decryptEnvelope(envelope, args);
  const payload = JSON.parse(plain.toString('utf8'));
  await writePayload(payload, outputPath);
  process.stdout.write(`Decrypted -> ${outputPath}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || cmd === '--help') {
    printHelp();
    process.exit(0);
  }

  if (cmd === 'gen-keypair') {
    await commandGenKeypair(args);
    return;
  }
  if (cmd === 'refresh-manifest') {
    await refreshManifest(args);
    return;
  }
  if (cmd === 'encrypt') {
    await commandEncrypt(args);
    return;
  }
  if (cmd === 'encrypt-manifest') {
    await commandEncryptManifest(args);
    return;
  }
  if (cmd === 'decrypt') {
    await commandDecrypt(args);
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
