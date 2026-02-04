#!/usr/bin/env node

import {
  ClawTokenNode,
  DEFAULT_P2P_SYNC_CONFIG,
  DEFAULT_SYNC_RUNTIME_CONFIG,
} from '@clawtoken/node';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

const config = parseArgs(args);
const node = new ClawTokenNode(config);

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void node.start().catch((error) => {
  console.error('[clawtoken] failed to start:', error);
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[clawtoken] received ${signal}, stopping...`);
  await node.stop();
  process.exit(0);
}

function parseArgs(rawArgs: string[]) {
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

function printHelp(): void {
  console.log(`
clawtoken daemon [options]

Options:
  --data-dir <path>            Override storage root
  --listen <multiaddr>         Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>      Add a bootstrap peer multiaddr (repeatable)
  --range-interval-ms <ms>     Range sync interval (default: ${DEFAULT_SYNC_RUNTIME_CONFIG.rangeIntervalMs})
  --snapshot-interval-ms <ms>  Snapshot sync interval (default: ${DEFAULT_SYNC_RUNTIME_CONFIG.snapshotIntervalMs})
  --no-range-on-start          Disable initial range sync request
  --no-snapshot-on-start       Disable initial snapshot sync request
  --sybil-policy <mode>        Sybil policy: none|allowlist|pow|stake (default: ${DEFAULT_P2P_SYNC_CONFIG.sybilPolicy})
  --allowlist <peerId,...>     Comma-separated peerIds (repeatable)
  --pow-ttl-ms <ms>            PoW ticket TTL (default: ${DEFAULT_P2P_SYNC_CONFIG.powTicketTtlMs})
  --stake-ttl-ms <ms>          Stake proof TTL (default: ${DEFAULT_P2P_SYNC_CONFIG.stakeProofTtlMs})
  --min-pow-difficulty <n>     Minimum PoW difficulty (default: ${DEFAULT_P2P_SYNC_CONFIG.minPowDifficulty})
  --min-snapshot-signatures <n> Minimum eligible snapshot signatures (default: ${DEFAULT_P2P_SYNC_CONFIG.minSnapshotSignatures})
  -h, --help                   Show help
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
