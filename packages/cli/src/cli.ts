#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { ClawTokenNode, DEFAULT_P2P_SYNC_CONFIG, DEFAULT_SYNC_RUNTIME_CONFIG } from '@clawtoken/node';
import {
  decryptKeyRecord,
  didFromPublicKey,
  loadKeyRecord,
  publicKeyFromPrivateKey,
  resolveStoragePaths,
  verifyCapabilityCredential,
} from '@clawtoken/core';
import { CapabilityCredential, createIdentityCapabilityRegisterEnvelope } from '@clawtoken/protocol';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const command = args[0];
if (!command || command === 'daemon' || command.startsWith('-')) {
  const node = new ClawTokenNode(parseDaemonArgs(args));
  process.on('SIGINT', () => void shutdown(node, 'SIGINT'));
  process.on('SIGTERM', () => void shutdown(node, 'SIGTERM'));
  void node.start().catch((error) => {
    console.error('[clawtoken] failed to start:', error);
    process.exit(1);
  });
} else if (command === 'identity') {
  const subcommand = args[1];
  const subArgs = args.slice(2);
  if (subcommand === 'capability-register') {
    void runCapabilityRegister(subArgs).catch((error) => {
      console.error('[clawtoken] capability register failed:', error);
      process.exit(1);
    });
  } else {
    fail(`unknown identity subcommand: ${subcommand ?? ''}`);
  }
} else {
  fail(`unknown command: ${command}`);
}

async function shutdown(node: ClawTokenNode, signal: string): Promise<void> {
  console.log(`[clawtoken] received ${signal}, stopping...`);
  await node.stop();
  process.exit(0);
}

async function runCapabilityRegister(rawArgs: string[]): Promise<void> {
  const parsed = parseCapabilityRegisterArgs(rawArgs);
  const credentialRaw = await readFile(parsed.credentialPath, 'utf8');
  const credential = JSON.parse(credentialRaw) as CapabilityCredential;
  if (!credential?.credentialSubject) {
    fail('invalid credential JSON');
  }
  if (!(await verifyCapabilityCredential(credential))) {
    fail('credential proof or issuer invalid');
  }

  const subject = credential.credentialSubject;
  if (!subject?.name || !subject?.pricing) {
    fail('credential subject missing name or pricing');
  }

  const paths = resolveStoragePaths(parsed.dataDir);
  const record = await loadKeyRecord(paths, parsed.keyId);
  const privateKey = await decryptKeyRecord(record, parsed.passphrase);
  const derivedDid = didFromPublicKey(await publicKeyFromPrivateKey(privateKey));
  if (derivedDid !== parsed.did) {
    fail('private key does not match did');
  }

  const envelope = await createIdentityCapabilityRegisterEnvelope({
    did: parsed.did,
    privateKey,
    name: subject.name,
    pricing: subject.pricing,
    description: subject.description,
    credential,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = new ClawTokenNode(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published identity.capability.register ${hash}`);
  } finally {
    await node.stop();
  }
}

function parseDaemonArgs(rawArgs: string[]) {
  const config: {
    dataDir?: string;
    p2p?: { listen?: string[]; bootstrap?: string[] };
    sync?: {
      rangeIntervalMs?: number;
      snapshotIntervalMs?: number;
      requestRangeOnStart?: boolean;
      requestSnapshotOnStart?: boolean;
      sybilPolicy?: 'none' | 'allowlist' | 'pow' | 'stake';
      allowlist?: string[];
      powTicketTtlMs?: number;
      stakeProofTtlMs?: number;
      minPowDifficulty?: number;
      minSnapshotSignatures?: number;
    };
  } = {};

  const listen: string[] = [];
  const bootstrap: string[] = [];
  const allowlist: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === 'daemon') {
      continue;
    }
    switch (arg) {
      case '--data-dir': {
        config.dataDir = rawArgs[++i];
        break;
      }
      case '--listen': {
        const value = rawArgs[++i];
        if (value) {
          listen.push(value);
        }
        break;
      }
      case '--bootstrap': {
        const value = rawArgs[++i];
        if (value) {
          bootstrap.push(value);
        }
        break;
      }
      case '--range-interval-ms': {
        const value = parseNonNegativeInt(rawArgs[++i], '--range-interval-ms');
        config.sync = { ...config.sync, rangeIntervalMs: value };
        break;
      }
      case '--snapshot-interval-ms': {
        const value = parseNonNegativeInt(rawArgs[++i], '--snapshot-interval-ms');
        config.sync = { ...config.sync, snapshotIntervalMs: value };
        break;
      }
      case '--sybil-policy': {
        const value = rawArgs[++i];
        if (!value || !isSybilPolicy(value)) {
          fail(`invalid --sybil-policy: ${value ?? ''}`);
        }
        config.sync = { ...config.sync, sybilPolicy: value };
        break;
      }
      case '--allowlist': {
        const value = rawArgs[++i];
        if (value) {
          allowlist.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
        }
        break;
      }
      case '--pow-ttl-ms': {
        const value = parseNonNegativeInt(rawArgs[++i], '--pow-ttl-ms');
        config.sync = { ...config.sync, powTicketTtlMs: value };
        break;
      }
      case '--stake-ttl-ms': {
        const value = parseNonNegativeInt(rawArgs[++i], '--stake-ttl-ms');
        config.sync = { ...config.sync, stakeProofTtlMs: value };
        break;
      }
      case '--min-pow-difficulty': {
        const value = parseNonNegativeInt(rawArgs[++i], '--min-pow-difficulty');
        config.sync = { ...config.sync, minPowDifficulty: value };
        break;
      }
      case '--min-snapshot-signatures': {
        const value = parsePositiveInt(rawArgs[++i], '--min-snapshot-signatures');
        config.sync = { ...config.sync, minSnapshotSignatures: value };
        break;
      }
      case '--no-range-on-start': {
        config.sync = { ...config.sync, requestRangeOnStart: false };
        break;
      }
      case '--no-snapshot-on-start': {
        config.sync = { ...config.sync, requestSnapshotOnStart: false };
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (listen.length) {
    config.p2p = { ...config.p2p, listen };
  }
  if (bootstrap.length) {
    config.p2p = { ...config.p2p, bootstrap };
  }
  if (allowlist.length) {
    config.sync = { ...config.sync, allowlist };
  }

  return config;
}

function parseCapabilityRegisterArgs(rawArgs: string[]) {
  const listen: string[] = [];
  const bootstrap: string[] = [];
  let dataDir: string | undefined;
  let did: string | undefined;
  let keyId: string | undefined;
  let passphrase: string | undefined;
  let credentialPath: string | undefined;
  let nonce: number | undefined;
  let prev: string | undefined;
  let ts: number | undefined;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--data-dir': {
        dataDir = rawArgs[++i];
        break;
      }
      case '--listen': {
        const value = rawArgs[++i];
        if (value) {
          listen.push(value);
        }
        break;
      }
      case '--bootstrap': {
        const value = rawArgs[++i];
        if (value) {
          bootstrap.push(value);
        }
        break;
      }
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--key-id': {
        keyId = rawArgs[++i];
        break;
      }
      case '--passphrase': {
        passphrase = rawArgs[++i];
        break;
      }
      case '--credential': {
        credentialPath = rawArgs[++i];
        break;
      }
      case '--nonce': {
        nonce = parsePositiveInt(rawArgs[++i], '--nonce');
        break;
      }
      case '--prev': {
        prev = rawArgs[++i];
        break;
      }
      case '--ts': {
        ts = parseNonNegativeInt(rawArgs[++i], '--ts');
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (!did) {
    fail('missing --did');
  }
  if (!keyId) {
    fail('missing --key-id');
  }
  if (!passphrase) {
    fail('missing --passphrase');
  }
  if (!credentialPath) {
    fail('missing --credential');
  }
  if (nonce === undefined) {
    fail('missing --nonce');
  }

  const nodeConfig = parseDaemonArgs([
    ...(dataDir ? ['--data-dir', dataDir] : []),
    ...listen.flatMap((entry) => ['--listen', entry]),
    ...bootstrap.flatMap((entry) => ['--bootstrap', entry]),
  ]);

  return {
    did,
    keyId,
    passphrase,
    credentialPath,
    nonce,
    prev,
    ts,
    dataDir,
    nodeConfig,
  };
}

function printHelp(): void {
  console.log(`
clawtoken daemon [options]
clawtoken identity capability-register [options]

Daemon options:
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)
  --range-interval-ms <ms>       Range sync interval (default: ${DEFAULT_SYNC_RUNTIME_CONFIG.rangeIntervalMs})
  --snapshot-interval-ms <ms>    Snapshot sync interval (default: ${DEFAULT_SYNC_RUNTIME_CONFIG.snapshotIntervalMs})
  --no-range-on-start            Disable initial range sync request
  --no-snapshot-on-start         Disable initial snapshot sync request
  --sybil-policy <mode>          Sybil policy: none|allowlist|pow|stake (default: ${DEFAULT_P2P_SYNC_CONFIG.sybilPolicy})
  --allowlist <peerId,...>       Comma-separated peerIds (repeatable)
  --pow-ttl-ms <ms>              PoW ticket TTL (default: ${DEFAULT_P2P_SYNC_CONFIG.powTicketTtlMs})
  --stake-ttl-ms <ms>            Stake proof TTL (default: ${DEFAULT_P2P_SYNC_CONFIG.stakeProofTtlMs})
  --min-pow-difficulty <n>       Minimum PoW difficulty (default: ${DEFAULT_P2P_SYNC_CONFIG.minPowDifficulty})
  --min-snapshot-signatures <n>  Minimum eligible snapshot signatures (default: ${DEFAULT_P2P_SYNC_CONFIG.minSnapshotSignatures})

Capability register options:
  --did <did>                    Issuer DID for the capability
  --key-id <id>                  Key record id in keystore
  --passphrase <text>            Passphrase to decrypt key record
  --credential <path>            JSON credential file (CapabilityCredential)
  --nonce <n>                    Monotonic nonce for issuer
  --prev <hash>                  Optional previous event hash
  --ts <ms>                      Override timestamp (default: now)
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)
  -h, --help                     Show help
`);
}

function isSybilPolicy(value: string): value is 'none' | 'allowlist' | 'pow' | 'stake' {
  return value === 'none' || value === 'allowlist' || value === 'pow' || value === 'stake';
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  if (value === undefined) {
    fail(`missing value for ${flag}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    fail(`invalid ${flag}: ${value}`);
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = parseNonNegativeInt(value, flag);
  if (parsed < 1) {
    fail(`invalid ${flag}: ${value}`);
  }
  return parsed;
}

function fail(message: string): never {
  console.error(`[clawtoken] ${message}`);
  process.exit(1);
}
