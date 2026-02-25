#!/usr/bin/env node
/**
 * ClawNet Testnet — Full Scenario E2E Test Runner
 * =================================================
 * Executes 9 business scenarios against a live 3-node testnet.
 *
 * Usage:
 *   node run-tests.mjs                        # run all scenarios
 *   node run-tests.mjs --scenario 01,02       # run specific scenarios
 *   node run-tests.mjs --verbose              # verbose output
 *
 * Configuration:
 *   1. Copy .env.example → .env and fill in real values.
 *   2. Ensure bootstrap-mint.ts has funded each node's wallet.
 *   3. Run this script from infra/testnet/scenarios/.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from './lib/client.mjs';
import {
  setVerbose,
  vlog,
  sleep,
  assert,
  getResults,
  resetResults,
  printResults,
} from './lib/helpers.mjs';
import { waitForAllNodes } from './lib/wait-for-sync.mjs';

// ---------------------------------------------------------------------------
// Load .env (minimal parser — no external deps)
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = resolve(__dirname, '.env');
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    console.warn('⚠  No .env file found — using process environment only.');
  }
}
loadEnv();

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
setVerbose(verbose);

const scenarioFilter = (() => {
  const f = args.find((a) => a.startsWith('--scenario'));
  if (!f) return null;
  // --scenario=01,02 or --scenario 01,02
  const val = f.includes('=') ? f.split('=')[1] : args[args.indexOf(f) + 1];
  return val ? val.split(',').map((s) => s.trim()) : null;
})();

// ---------------------------------------------------------------------------
// Agent setup — 3 testnet nodes
// ---------------------------------------------------------------------------
const NODE_A_URL = process.env.NODE_A_URL || 'https://node-a.clawnetd.com';
const NODE_B_URL = process.env.NODE_B_URL || 'https://node-b.clawnetd.com';
const NODE_C_URL = process.env.NODE_C_URL || 'https://node-c.clawnetd.com';

const ALICE_PASS   = process.env.ALICE_PASSPHRASE   || '';
const BOB_PASS     = process.env.BOB_PASSPHRASE     || '';
const CHARLIE_PASS = process.env.CHARLIE_PASSPHRASE || '';

const MIN_BALANCE = parseInt(process.env.MIN_BALANCE || '10000', 10);

const alice   = new Agent('alice',   NODE_A_URL, ALICE_PASS);
const bob     = new Agent('bob',     NODE_B_URL, BOB_PASS);
const charlie = new Agent('charlie', NODE_C_URL, CHARLIE_PASS);

const agents = [alice, bob, charlie];

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------
const SCENARIOS = [
  { id: '01', name: 'Identity & Wallet',       file: './scenarios/01-identity-wallet.mjs' },
  { id: '02', name: 'Info Market',              file: './scenarios/02-info-market.mjs' },
  { id: '03', name: 'Task Market',              file: './scenarios/03-task-market.mjs' },
  { id: '04', name: 'Capability Market',        file: './scenarios/04-capability-market.mjs' },
  { id: '05', name: 'Service Contract',         file: './scenarios/05-service-contract.mjs' },
  { id: '06', name: 'Contract Dispute',         file: './scenarios/06-contract-dispute.mjs' },
  { id: '07', name: 'DAO Governance',           file: './scenarios/07-dao-governance.mjs' },
  { id: '08', name: 'Cross-Node Sync',          file: './scenarios/08-cross-node-sync.mjs' },
  { id: '09', name: 'Full Economic Cycle',      file: './scenarios/09-economic-cycle.mjs' },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ClawNet Testnet — Full Scenario E2E Test Suite         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Validate passphrases
  for (const a of agents) {
    if (!a.passphrase) {
      console.error(`✗ ${a.name}: missing passphrase — set ${a.name.toUpperCase()}_PASSPHRASE in .env`);
      process.exit(1);
    }
  }

  // 2. Wait for all nodes to be healthy
  console.log('Waiting for all nodes to be healthy...');
  const healthy = await waitForAllNodes(agents, 60000);
  if (!healthy) {
    console.error('✗ One or more nodes are unreachable. Aborting.');
    for (const a of agents) {
      const { status } = await a.status();
      console.error(`  ${a.name} (${a.baseUrl}): ${status === 200 ? 'OK' : 'UNREACHABLE'}`);
    }
    process.exit(1);
  }
  console.log('All nodes healthy ✓\n');

  // 3. Initialise identities (GET /identities/self)
  console.log('Initialising agent identities...');
  for (const a of agents) {
    await a.init();
    if (!a.did) {
      console.error(`✗ ${a.name}: failed to obtain DID from ${a.baseUrl}`);
      process.exit(1);
    }
    console.log(`  ${a.name}: ${a.did}`);
  }
  console.log('');

  // 4. Check minimum balances
  console.log('Checking balances...');
  let balanceOk = true;
  for (const a of agents) {
    const { status, data } = await a.balance();
    const bal = Number(data?.balance ?? data?.available ?? 0);
    const ok = bal >= MIN_BALANCE;
    if (!ok) balanceOk = false;
    console.log(`  ${a.name}: ${bal} Tokens ${ok ? '✓' : '✗ (below ' + MIN_BALANCE + ')'}`);
  }
  if (!balanceOk) {
    console.warn('\n⚠  Some agents have insufficient balance.');
    console.warn('   Run bootstrap-mint.ts to fund node wallets before testing.');
    console.warn('   Continuing anyway — some scenarios may fail.\n');
  }
  console.log('');

  // 5. Run scenarios
  const scenariosToRun = scenarioFilter
    ? SCENARIOS.filter((s) => scenarioFilter.includes(s.id))
    : SCENARIOS;

  for (const scenario of scenariosToRun) {
    console.log(`── Scenario ${scenario.id}: ${scenario.name} ──────────────────`);
    try {
      const mod = await import(scenario.file);
      const run = mod.default || mod.run;
      await run({ alice, bob, charlie, agents });
    } catch (err) {
      console.log(`  ✗ Scenario ${scenario.id} crashed: ${err.message}`);
      if (verbose) console.log(err.stack);
    }
    console.log('');
  }

  // 6. Results
  printResults();
  const { failed } = getResults();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
