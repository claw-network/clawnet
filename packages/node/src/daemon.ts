#!/usr/bin/env node

import { ClawTokenNode } from './index.js';
import { createLogger } from './logger.js';
import { loadConfig, resolveStoragePaths } from '@clawtoken/core/storage';

interface DaemonArgs {
  dataDir?: string;
  noApi: boolean;
  apiHost?: string;
  apiPort?: number;
  listen: string[];
  bootstrap: string[];
  healthIntervalMs: number;
}

function parseArgs(argv: string[]): DaemonArgs {
  let dataDir: string | undefined;
  let noApi = false;
  let apiHost: string | undefined;
  let apiPort: number | undefined;
  const listen: string[] = [];
  const bootstrap: string[] = [];
  let healthIntervalMs = 30_000;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--data-dir') {
      dataDir = argv[++i];
      continue;
    }
    if (arg === '--no-api') {
      noApi = true;
      continue;
    }
    if (arg === '--api-host') {
      apiHost = argv[++i];
      continue;
    }
    if (arg === '--api-port') {
      apiPort = Number.parseInt(argv[++i] ?? '', 10);
      continue;
    }
    if (arg === '--listen') {
      const value = argv[++i];
      if (value) {
        listen.push(value);
      }
      continue;
    }
    if (arg === '--bootstrap') {
      const value = argv[++i];
      if (value) {
        bootstrap.push(value);
      }
      continue;
    }
    if (arg === '--health-interval-ms') {
      healthIntervalMs = Number.parseInt(argv[++i] ?? '', 10);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    console.error(`[clawtokend] unknown option: ${arg}`);
    process.exit(1);
  }

  if (Number.isNaN(healthIntervalMs) || healthIntervalMs < 0) {
    console.error('[clawtokend] invalid --health-interval-ms');
    process.exit(1);
  }

  return {
    dataDir,
    noApi,
    apiHost,
    apiPort,
    listen,
    bootstrap,
    healthIntervalMs,
  };
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  await startDaemon(argv, { attachSignals: true });
}

export async function startDaemon(
  argv: string[],
  options: { attachSignals?: boolean } = {},
): Promise<{
  node: ClawTokenNode;
  logger: ReturnType<typeof createLogger>;
  stop: () => Promise<void>;
}> {
  const args = parseArgs(argv);
  const paths = resolveStoragePaths(args.dataDir);
  const config = await loadConfig(paths);
  const logger = createLogger({
    level: config.logging?.level ?? 'info',
    file: config.logging?.file,
  });

  const node = new ClawTokenNode({
    dataDir: args.dataDir,
    api: {
      enabled: args.noApi ? false : true,
      host: args.apiHost,
      port: args.apiPort,
    },
    p2p: {
      listen: args.listen.length ? args.listen : config.p2p?.listen,
      bootstrap: args.bootstrap.length ? args.bootstrap : config.p2p?.bootstrap,
    },
  });

  if (options.attachSignals !== false) {
    process.on('SIGINT', () => void shutdown(node, 'SIGINT', logger));
    process.on('SIGTERM', () => void shutdown(node, 'SIGTERM', logger));
  }

  await node.start();
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('clawtokend');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`Data Dir: ${paths.root}`);
  logger.info(`Peer Id: ${node.getPeerId() ?? 'unknown'}`);
  logger.info(`Network: ${config.network}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let healthTimer: NodeJS.Timeout | undefined;
  if (args.healthIntervalMs > 0) {
    healthTimer = setInterval(() => {
      const health = node.getHealth();
      if (health.ok) {
        logger.debug('[clawtokend] health ok', health.checks);
      } else {
        logger.warn('[clawtokend] health check failed', health.checks);
      }
    }, args.healthIntervalMs);
    healthTimer.unref();
  }

  const stop = async (): Promise<void> => {
    if (healthTimer) {
      clearInterval(healthTimer);
      healthTimer = undefined;
    }
    await node.stop();
  };

  return { node, logger, stop };
}

async function shutdown(
  node: ClawTokenNode,
  signal: string,
  logger?: ReturnType<typeof createLogger>,
): Promise<void> {
  if (logger) {
    logger.info(`[clawtokend] received ${signal}, stopping...`);
  } else {
    console.log(`[clawtokend] received ${signal}, stopping...`);
  }
  await node.stop();
  process.exit(0);
}

function printHelp(): void {
  console.log(`
clawtokend [options]

Options:
  --data-dir <path>          Override storage root
  --no-api                   Disable local API server
  --api-host <host>          API host (default: 127.0.0.1)
  --api-port <port>          API port (default: 9528)
  --listen <multiaddr>       Add libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>    Add bootstrap peer multiaddr (repeatable)
  --health-interval-ms <ms>  Health check interval (default: 30000, 0 to disable)
  -h, --help                 Show help
`);
}

void main().catch((error) => {
  console.error('[clawtokend] fatal error:', error);
  process.exit(1);
});
