#!/usr/bin/env node
// ============================================================================
// ClawToken Local Testnet Launcher
// ============================================================================
// Starts multiple ClawToken nodes locally on different ports for integration
// testing. No Docker required.
//
// Usage:
//   node scripts/testnet-local.mjs              # 3 nodes (default)
//   node scripts/testnet-local.mjs --nodes 5    # 5 nodes
//   node scripts/testnet-local.mjs --clean      # wipe data dirs first
//
// Nodes:
//   Node 0 (bootstrap):  API 9528, P2P 9540
//   Node 1:              API 9530, P2P 9541
//   Node 2:              API 9532, P2P 9542
//   ...
//
// Stop: Ctrl+C (graceful shutdown of all nodes)
// ============================================================================

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Config ──────────────────────────────────────────────────────────────────
const DEFAULT_NODE_COUNT = 3;
const BASE_API_PORT = 9528;
const BASE_P2P_PORT = 9540;
const DATA_ROOT = resolve(ROOT, '.testnet');
const DAEMON_PATH = resolve(ROOT, 'packages/node/dist/daemon.js');

// ── Parse args ──────────────────────────────────────────────────────────────
let nodeCount = DEFAULT_NODE_COUNT;
let clean = false;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--nodes') {
    nodeCount = parseInt(process.argv[++i], 10);
  } else if (process.argv[i] === '--clean') {
    clean = true;
  }
}

if (clean && existsSync(DATA_ROOT)) {
  console.log(`[testnet] Cleaning ${DATA_ROOT}`);
  rmSync(DATA_ROOT, { recursive: true, force: true });
}

// ── State ───────────────────────────────────────────────────────────────────
const processes = [];
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[testnet] Shutting down all nodes...');
  for (const proc of processes) {
    try {
      proc.kill('SIGTERM');
    } catch {
      // already dead
    }
  }
  setTimeout(() => {
    for (const proc of processes) {
      try {
        proc.kill('SIGKILL');
      } catch {
        // already dead
      }
    }
    process.exit(0);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Launch nodes ────────────────────────────────────────────────────────────
function startNode(index, bootstrapAddr) {
  const apiPort = BASE_API_PORT + index * 2;
  const p2pPort = BASE_P2P_PORT + index;
  const dataDir = resolve(DATA_ROOT, `node-${index}`);

  mkdirSync(dataDir, { recursive: true });

  const args = [
    DAEMON_PATH,
    '--data-dir', dataDir,
    '--api-host', '127.0.0.1',
    '--api-port', String(apiPort),
    '--listen', `/ip4/127.0.0.1/tcp/${p2pPort}`,
    '--health-interval-ms', '10000',
  ];

  if (bootstrapAddr) {
    args.push('--bootstrap', bootstrapAddr);
  }

  const label = index === 0 ? 'bootstrap' : `peer-${index}`;
  console.log(`[testnet] Starting ${label}: API=:${apiPort} P2P=:${p2pPort} data=${dataDir}`);

  const proc = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development' },
  });

  proc.stdout.on('data', (data) => {
    for (const line of data.toString().split('\n').filter(Boolean)) {
      console.log(`[${label}] ${line}`);
    }
  });

  proc.stderr.on('data', (data) => {
    for (const line of data.toString().split('\n').filter(Boolean)) {
      console.error(`[${label}] ${line}`);
    }
  });

  proc.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`[${label}] exited with code ${code}`);
    }
  });

  processes.push(proc);
  return { apiPort, p2pPort, proc, label };
}

// ── Wait for node API to be ready ───────────────────────────────────────────
async function waitForNode(apiPort, label, timeoutMs = 30000) {
  const url = `http://127.0.0.1:${apiPort}/api/node/status`;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const status = await resp.json();
        console.log(`[testnet] ${label} ready — peers: ${status.peers ?? 0}, events: ${status.blockHeight ?? 0}`);
        return status;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`[testnet] ${label} failed to start within ${timeoutMs}ms`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[testnet] Launching ${nodeCount}-node local testnet`);
  console.log(`[testnet] Data root: ${DATA_ROOT}`);
  console.log('');

  // Start bootstrap node (no bootstrap addr)
  const bootstrap = startNode(0, null);
  const bootstrapStatus = await waitForNode(bootstrap.apiPort, bootstrap.label);

  // For peers to connect, they need the bootstrap multiaddr with peerId.
  // The status endpoint should report the peer's DID. But we need the actual
  // libp2p peer ID from the bootstrap multiaddr. For local testing without
  // peerId in bootstrap, we rely on the --bootstrap flag which the daemon
  // uses with @libp2p/bootstrap (it will connect and discover via DHT).
  const bootstrapMultiaddr = `/ip4/127.0.0.1/tcp/${bootstrap.p2pPort}`;

  // Start peer nodes
  for (let i = 1; i < nodeCount; i++) {
    // Stagger starts slightly to avoid port conflicts
    await new Promise((r) => setTimeout(r, 1000));
    const peer = startNode(i, bootstrapMultiaddr);
    await waitForNode(peer.apiPort, peer.label);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ClawToken Local Testnet Running');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  for (let i = 0; i < nodeCount; i++) {
    const apiPort = BASE_API_PORT + i * 2;
    const label = i === 0 ? 'bootstrap' : `peer-${i}`;
    console.log(`  ${label.padEnd(12)} → http://127.0.0.1:${apiPort}/api/node/status`);
  }
  console.log('');
  console.log('  Press Ctrl+C to stop all nodes');
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('[testnet] Fatal:', err.message);
  shutdown();
});
