#!/usr/bin/env node
/**
 * Performance Benchmark — Migrated REST Routes
 *
 * Measures latency and throughput of all on-chain-proxied routes against
 * a running clawnetd node.  Outputs a Markdown table suitable for
 * inclusion in migration docs.
 *
 * Prerequisites:
 *   - clawnetd running with chain config (hardhat or devnet)
 *   - A funded signer (deployer account)
 *
 * Usage:
 *   node scripts/benchmark-routes.mjs [--base-url http://127.0.0.1:9528] [--iterations 20]
 *
 * Output:
 *   Prints Markdown table to stdout.
 *   Writes JSON results to benchmark-results.json.
 */

import { writeFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function arg(name, fallback) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const BASE_URL = arg('--base-url', 'http://127.0.0.1:9528');
const ITERATIONS = Number(arg('--iterations', '20'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function measure(label, method, path, body) {
  const url = `${BASE_URL}${path}`;
  const opts = { method, headers: { 'content-type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);

  const times = [];
  let lastStatus = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    try {
      const res = await fetch(url, opts);
      lastStatus = res.status;
      await res.text(); // consume body
    } catch (err) {
      lastStatus = 0;
    }
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const min = times[0];
  const max = times[times.length - 1];
  const avg = times.reduce((s, t) => s + t, 0) / times.length;
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];

  return { label, method, path, status: lastStatus, iterations: ITERATIONS, min, max, avg, p50, p95, p99 };
}

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const DID = 'did:claw:benchmark-test';
const ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // hardhat #0

const routes = [
  // Wallet — READ
  { label: 'wallet/balance', method: 'GET', path: `/api/wallet/balance?did=${DID}` },
  { label: 'wallet/history', method: 'GET', path: `/api/wallet/transactions?did=${DID}&limit=10` },

  // Wallet — WRITE
  {
    label: 'wallet/transfer',
    method: 'POST',
    path: '/api/wallet/transfer',
    body: { did: DID, passphrase: 'test', to: ADDR, amount: 1, fee: 0, nonce: Date.now() },
  },

  // Identity — READ
  { label: 'identity/resolve', method: 'GET', path: `/api/identity/${encodeURIComponent(DID)}` },

  // Reputation — READ
  { label: 'reputation/profile', method: 'GET', path: `/api/reputation/${encodeURIComponent(DID)}` },

  // Contracts — READ
  { label: 'contracts/list', method: 'GET', path: '/api/contracts?limit=10' },

  // DAO — READ
  { label: 'dao/proposals', method: 'GET', path: '/api/dao/proposals?limit=10' },
  { label: 'dao/treasury', method: 'GET', path: '/api/dao/treasury' },
  { label: 'dao/params', method: 'GET', path: '/api/dao/params' },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n## Performance Benchmark\n`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Iterations per route: ${ITERATIONS}\n`);

  // Check connectivity
  try {
    await fetch(`${BASE_URL}/api/status`);
  } catch {
    console.error(`ERROR: Cannot reach ${BASE_URL}/api/status — is clawnetd running?`);
    process.exit(1);
  }

  const results = [];

  for (const route of routes) {
    const result = await measure(route.label, route.method, route.path, route.body);
    results.push(result);
    console.log(`  ✓ ${result.label}: avg=${result.avg.toFixed(1)}ms p95=${result.p95.toFixed(1)}ms`);
  }

  // Markdown table
  console.log(`\n| Route | Method | Status | Avg (ms) | P50 (ms) | P95 (ms) | P99 (ms) | Min (ms) | Max (ms) |`);
  console.log(`|-------|--------|--------|----------|----------|----------|----------|----------|----------|`);
  for (const r of results) {
    console.log(
      `| ${r.label} | ${r.method} | ${r.status} | ${r.avg.toFixed(1)} | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.p99.toFixed(1)} | ${r.min.toFixed(1)} | ${r.max.toFixed(1)} |`,
    );
  }

  // JSON output
  writeFileSync('benchmark-results.json', JSON.stringify(results, null, 2));
  console.log(`\nResults written to benchmark-results.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
