#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ClawTokenNode, DEFAULT_P2P_SYNC_CONFIG, DEFAULT_SYNC_RUNTIME_CONFIG } from '@clawtoken/node';
import {
  addressFromDid,
  bytesToUtf8,
  decryptKeyRecord,
  didFromPublicKey,
  EventStore,
  keyIdFromPublicKey,
  loadKeyRecord,
  LevelStore,
  publicKeyFromDid,
  publicKeyFromPrivateKey,
  resolveStoragePaths,
  verifyCapabilityCredential,
} from '@clawtoken/core';
import {
  applyWalletEvent,
  CapabilityCredential,
  createIdentityCapabilityRegisterEnvelope,
  createWalletEscrowCreateEnvelope,
  createWalletEscrowFundEnvelope,
  createWalletEscrowRefundEnvelope,
  createWalletEscrowReleaseEnvelope,
  createWalletTransferEnvelope,
  createWalletState,
  getWalletBalance,
} from '@clawtoken/protocol';

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const command = argv[0];
  if (!command || command === 'daemon' || command.startsWith('-')) {
    const node = new ClawTokenNode(parseDaemonArgs(argv));
    process.on('SIGINT', () => void shutdown(node, 'SIGINT'));
    process.on('SIGTERM', () => void shutdown(node, 'SIGTERM'));
    void node.start().catch((error) => {
      console.error('[clawtoken] failed to start:', error);
      process.exit(1);
    });
    return;
  }
  if (command === 'identity') {
    const subcommand = argv[1];
    const subArgs = argv.slice(2);
    if (subcommand === 'capability-register') {
      await runCapabilityRegister(subArgs);
      return;
    }
    fail(`unknown identity subcommand: ${subcommand ?? ''}`);
  }
  if (command === 'balance') {
    await runBalance(argv.slice(1));
    return;
  }
  if (command === 'transfer') {
    await runTransfer(argv.slice(1));
    return;
  }
  if (command === 'escrow') {
    const subcommand = argv[1];
    const subArgs = argv.slice(2);
    if (subcommand === 'create') {
      await runEscrowCreate(subArgs);
      return;
    }
    if (subcommand === 'fund') {
      await runEscrowFund(subArgs);
      return;
    }
    if (subcommand === 'release') {
      await runEscrowRelease(subArgs);
      return;
    }
    if (subcommand === 'refund') {
      await runEscrowRefund(subArgs);
      return;
    }
    fail(`unknown escrow subcommand: ${subcommand ?? ''}`);
  }
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

async function runBalance(rawArgs: string[]): Promise<void> {
  const parsed = parseBalanceArgs(rawArgs);
  const target = parsed.address ?? addressFromDid(parsed.did);
  const paths = resolveStoragePaths(parsed.dataDir);
  const store = new LevelStore({ path: paths.eventsDb });
  const eventStore = new EventStore(store);
  try {
    const state = await buildWalletState(eventStore);
    const balance = getWalletBalance(state, target);
    const total =
      BigInt(balance.available) +
      BigInt(balance.pending) +
      BigInt(balance.locked.escrow) +
      BigInt(balance.locked.governance);
    console.log(
      JSON.stringify(
        {
          address: target,
          balance: total.toString(),
          available: balance.available,
          pending: balance.pending,
          locked: balance.locked.escrow,
        },
        null,
        2,
      ),
    );
  } finally {
    await store.close();
  }
}

type NodeFactory = (config: unknown) => {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  publishEvent: (envelope: Record<string, unknown>) => Promise<string>;
};

const defaultNodeFactory: NodeFactory = (config) => new ClawTokenNode(config);

async function runTransfer(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseTransferArgs(rawArgs);
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);
  const derivedDid = didFromPublicKey(await publicKeyFromPrivateKey(privateKey));
  if (derivedDid !== parsed.did) {
    fail('private key does not match did');
  }
  const from = addressFromDid(parsed.did);
  const to = resolveAddress(parsed.to);
  if (!to) {
    fail('invalid --to');
  }

  const envelope = await createWalletTransferEnvelope({
    issuer: parsed.did,
    privateKey,
    from,
    to,
    amount: parsed.amount,
    fee: parsed.fee ?? '1',
    memo: parsed.memo,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published wallet.transfer ${hash}`);
  } finally {
    await node.stop();
  }
}

async function runEscrowCreate(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseEscrowCreateArgs(rawArgs);
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);
  const derivedDid = didFromPublicKey(await publicKeyFromPrivateKey(privateKey));
  if (derivedDid !== parsed.did) {
    fail('private key does not match did');
  }
  const depositor = addressFromDid(parsed.did);
  const beneficiary = resolveAddress(parsed.beneficiary);
  if (!beneficiary) {
    fail('invalid --beneficiary');
  }
  const escrowId = parsed.escrowId ?? `escrow-${Date.now()}`;
  const createEnvelope = await createWalletEscrowCreateEnvelope({
    issuer: parsed.did,
    privateKey,
    escrowId,
    depositor,
    beneficiary,
    amount: parsed.amount,
    releaseRules: parsed.releaseRules,
    resourcePrev: parsed.resourcePrev,
    arbiter: parsed.arbiter,
    refundRules: parsed.refundRules,
    expiresAt: parsed.expiresAt,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(createEnvelope);
    console.log(`[clawtoken] published wallet.escrow.create ${hash}`);
    if (parsed.autoFund) {
      const fundEnvelope = await createWalletEscrowFundEnvelope({
        issuer: parsed.did,
        privateKey,
        escrowId,
        resourcePrev: hash,
        amount: parsed.amount,
        ts: parsed.ts ?? Date.now(),
        nonce: parsed.nonce + 1,
        prev: hash,
      });
      const fundHash = await node.publishEvent(fundEnvelope);
      console.log(`[clawtoken] published wallet.escrow.fund ${fundHash}`);
    }
  } finally {
    await node.stop();
  }
}

async function runEscrowFund(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseEscrowActionArgs(rawArgs);
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);
  const envelope = await createWalletEscrowFundEnvelope({
    issuer: parsed.did,
    privateKey,
    escrowId: parsed.escrowId,
    resourcePrev: parsed.resourcePrev,
    amount: parsed.amount,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published wallet.escrow.fund ${hash}`);
  } finally {
    await node.stop();
  }
}

async function runEscrowRelease(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseEscrowActionArgs(rawArgs);
  if (!parsed.ruleId) {
    fail('missing --rule-id');
  }
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);
  const envelope = await createWalletEscrowReleaseEnvelope({
    issuer: parsed.did,
    privateKey,
    escrowId: parsed.escrowId,
    resourcePrev: parsed.resourcePrev,
    amount: parsed.amount,
    ruleId: parsed.ruleId,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published wallet.escrow.release ${hash}`);
  } finally {
    await node.stop();
  }
}

async function runEscrowRefund(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseEscrowActionArgs(rawArgs);
  if (!parsed.reason) {
    fail('missing --reason');
  }
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);
  const envelope = await createWalletEscrowRefundEnvelope({
    issuer: parsed.did,
    privateKey,
    escrowId: parsed.escrowId,
    resourcePrev: parsed.resourcePrev,
    amount: parsed.amount,
    reason: parsed.reason,
    evidence: parsed.evidence,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published wallet.escrow.refund ${hash}`);
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

function parseBalanceArgs(rawArgs: string[]) {
  let did: string | undefined;
  let address: string | undefined;
  let dataDir: string | undefined;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--address': {
        address = rawArgs[++i];
        break;
      }
      case '--data-dir': {
        dataDir = rawArgs[++i];
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (!did && !address) {
    fail('missing --did or --address');
  }

  return { did: did ?? '', address, dataDir };
}

function parseTransferArgs(rawArgs: string[]) {
  let did: string | undefined;
  let passphrase: string | undefined;
  let keyId: string | undefined;
  let to: string | undefined;
  let amount: string | undefined;
  let fee: string | undefined;
  let memo: string | undefined;
  let nonce: number | undefined;
  let prev: string | undefined;
  let ts: number | undefined;
  let dataDir: string | undefined;
  const listen: string[] = [];
  const bootstrap: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--passphrase': {
        passphrase = rawArgs[++i];
        break;
      }
      case '--key-id': {
        keyId = rawArgs[++i];
        break;
      }
      case '--to': {
        to = rawArgs[++i];
        break;
      }
      case '--amount': {
        amount = rawArgs[++i];
        break;
      }
      case '--fee': {
        fee = rawArgs[++i];
        break;
      }
      case '--memo': {
        memo = rawArgs[++i];
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
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (!did) {
    fail('missing --did');
  }
  if (!passphrase) {
    fail('missing --passphrase');
  }
  if (!to) {
    fail('missing --to');
  }
  if (!amount) {
    fail('missing --amount');
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
    passphrase,
    keyId: keyId ?? '',
    to,
    amount,
    fee,
    memo,
    nonce,
    prev,
    ts,
    dataDir,
    nodeConfig,
  };
}

function parseEscrowCreateArgs(rawArgs: string[]) {
  let did: string | undefined;
  let passphrase: string | undefined;
  let keyId: string | undefined;
  let beneficiary: string | undefined;
  let amount: string | undefined;
  let releaseRulesRaw: string | undefined;
  let escrowId: string | undefined;
  let resourcePrev: string | null | undefined;
  let arbiter: string | undefined;
  let refundRulesRaw: string | undefined;
  let expiresAt: number | undefined;
  let nonce: number | undefined;
  let prev: string | undefined;
  let ts: number | undefined;
  let dataDir: string | undefined;
  let autoFund = true;
  const listen: string[] = [];
  const bootstrap: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--passphrase': {
        passphrase = rawArgs[++i];
        break;
      }
      case '--key-id': {
        keyId = rawArgs[++i];
        break;
      }
      case '--beneficiary': {
        beneficiary = rawArgs[++i];
        break;
      }
      case '--amount': {
        amount = rawArgs[++i];
        break;
      }
      case '--release-rules': {
        releaseRulesRaw = rawArgs[++i];
        break;
      }
      case '--escrow-id': {
        escrowId = rawArgs[++i];
        break;
      }
      case '--resource-prev': {
        const value = rawArgs[++i];
        resourcePrev = value === 'null' ? null : value;
        break;
      }
      case '--arbiter': {
        arbiter = rawArgs[++i];
        break;
      }
      case '--refund-rules': {
        refundRulesRaw = rawArgs[++i];
        break;
      }
      case '--expires-at': {
        expiresAt = parseNonNegativeInt(rawArgs[++i], '--expires-at');
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
      case '--no-auto-fund': {
        autoFund = false;
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
  if (!passphrase) {
    fail('missing --passphrase');
  }
  if (!beneficiary) {
    fail('missing --beneficiary');
  }
  if (!amount) {
    fail('missing --amount');
  }
  if (!releaseRulesRaw) {
    fail('missing --release-rules');
  }
  if (nonce === undefined) {
    fail('missing --nonce');
  }

  let releaseRules: Record<string, unknown>[];
  try {
    releaseRules = JSON.parse(releaseRulesRaw) as Record<string, unknown>[];
  } catch {
    fail('invalid --release-rules (must be JSON array)');
  }
  let refundRules: Record<string, unknown>[] | undefined;
  if (refundRulesRaw) {
    try {
      refundRules = JSON.parse(refundRulesRaw) as Record<string, unknown>[];
    } catch {
      fail('invalid --refund-rules (must be JSON array)');
    }
  }

  const nodeConfig = parseDaemonArgs([
    ...(dataDir ? ['--data-dir', dataDir] : []),
    ...listen.flatMap((entry) => ['--listen', entry]),
    ...bootstrap.flatMap((entry) => ['--bootstrap', entry]),
  ]);

  return {
    did,
    passphrase,
    keyId: keyId ?? '',
    beneficiary,
    amount,
    releaseRules,
    escrowId,
    resourcePrev,
    arbiter,
    refundRules,
    expiresAt,
    nonce,
    prev,
    ts,
    dataDir,
    autoFund,
    nodeConfig,
  };
}

function parseEscrowActionArgs(rawArgs: string[]) {
  let did: string | undefined;
  let passphrase: string | undefined;
  let keyId: string | undefined;
  let escrowId: string | undefined;
  let amount: string | undefined;
  let resourcePrev: string | undefined;
  let ruleId: string | undefined;
  let reason: string | undefined;
  let evidenceRaw: string | undefined;
  let nonce: number | undefined;
  let prev: string | undefined;
  let ts: number | undefined;
  let dataDir: string | undefined;
  const listen: string[] = [];
  const bootstrap: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--passphrase': {
        passphrase = rawArgs[++i];
        break;
      }
      case '--key-id': {
        keyId = rawArgs[++i];
        break;
      }
      case '--escrow-id': {
        escrowId = rawArgs[++i];
        break;
      }
      case '--amount': {
        amount = rawArgs[++i];
        break;
      }
      case '--resource-prev': {
        resourcePrev = rawArgs[++i];
        break;
      }
      case '--rule-id': {
        ruleId = rawArgs[++i];
        break;
      }
      case '--reason': {
        reason = rawArgs[++i];
        break;
      }
      case '--evidence': {
        evidenceRaw = rawArgs[++i];
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
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (!did) {
    fail('missing --did');
  }
  if (!passphrase) {
    fail('missing --passphrase');
  }
  if (!escrowId) {
    fail('missing --escrow-id');
  }
  if (!amount) {
    fail('missing --amount');
  }
  if (!resourcePrev) {
    fail('missing --resource-prev');
  }
  if (nonce === undefined) {
    fail('missing --nonce');
  }

  let evidence: Record<string, unknown>[] | undefined;
  if (evidenceRaw) {
    try {
      evidence = JSON.parse(evidenceRaw) as Record<string, unknown>[];
    } catch {
      fail('invalid --evidence (must be JSON array)');
    }
  }

  const nodeConfig = parseDaemonArgs([
    ...(dataDir ? ['--data-dir', dataDir] : []),
    ...listen.flatMap((entry) => ['--listen', entry]),
    ...bootstrap.flatMap((entry) => ['--bootstrap', entry]),
  ]);

  return {
    did,
    passphrase,
    keyId: keyId ?? '',
    escrowId,
    amount,
    resourcePrev,
    ruleId,
    reason,
    evidence,
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
clawtoken balance [options]
clawtoken transfer [options]
clawtoken escrow create|fund|release|refund [options]

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

Balance options:
  --did <did>                    DID to query balance for
  --address <addr>               Address to query balance for
  --data-dir <path>              Override storage root

Transfer options:
  --did <did>                    Issuer DID
  --passphrase <text>            Passphrase to decrypt key record
  --key-id <id>                  Key record id in keystore (optional)
  --to <did|addr>                Recipient DID or address
  --amount <n>                   Transfer amount (Token)
  --fee <n>                      Fee amount (Token, default 1)
  --memo <text>                  Optional memo
  --nonce <n>                    Monotonic nonce for issuer
  --prev <hash>                  Optional previous event hash
  --ts <ms>                      Override timestamp (default: now)
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)

Escrow create options:
  --did <did>                    Issuer DID (depositor)
  --passphrase <text>            Passphrase to decrypt key record
  --key-id <id>                  Key record id in keystore (optional)
  --beneficiary <did|addr>       Beneficiary DID or address
  --amount <n>                   Escrow amount (Token)
  --release-rules <json>         JSON array of release rules
  --escrow-id <id>               Optional escrow id
  --resource-prev <hash|null>    Optional resourcePrev (use "null" for null)
  --arbiter <addr>               Optional arbiter address
  --refund-rules <json>          JSON array of refund rules
  --expires-at <ms>              Optional expiry timestamp
  --nonce <n>                    Monotonic nonce for issuer
  --prev <hash>                  Optional previous event hash
  --ts <ms>                      Override timestamp (default: now)
  --no-auto-fund                 Skip auto escrow.fund
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)

Escrow fund/release/refund options:
  --did <did>                    Issuer DID
  --passphrase <text>            Passphrase to decrypt key record
  --key-id <id>                  Key record id in keystore (optional)
  --escrow-id <id>               Escrow id
  --amount <n>                   Amount (Token)
  --resource-prev <hash>         Resource previous hash
  --rule-id <id>                 Release rule id (release only)
  --reason <text>                Refund reason (refund only)
  --evidence <json>              JSON array of evidence (refund only)
  --nonce <n>                    Monotonic nonce for issuer
  --prev <hash>                  Optional previous event hash
  --ts <ms>                      Override timestamp (default: now)
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)
  -h, --help                     Show help
`);
}

function resolveAddress(value: string): string | null {
  if (!value) {
    return null;
  }
  if (value.startsWith('did:claw:')) {
    try {
      return addressFromDid(value);
    } catch {
      return null;
    }
  }
  return value;
}

async function resolvePrivateKey(
  dataDir: string | undefined,
  keyId: string,
  passphrase: string,
): Promise<Uint8Array> {
  const paths = resolveStoragePaths(dataDir);
  const record = await loadKeyRecord(paths, keyId);
  return decryptKeyRecord(record, passphrase);
}

async function buildWalletState(eventStore: EventStore) {
  let state = createWalletState();
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      state = applyWalletEvent(state, envelope);
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return state;
}

function parseEvent(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    return JSON.parse(bytesToUtf8(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
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

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entrypoint && import.meta.url === entrypoint) {
  void main().catch((error) => {
    console.error('[clawtoken] fatal error:', error);
    process.exit(1);
  });
}

export {
  main,
  runBalance,
  runTransfer,
  runEscrowCreate,
  runEscrowFund,
  runEscrowRelease,
  runEscrowRefund,
};
