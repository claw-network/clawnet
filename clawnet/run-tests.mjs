#!/usr/bin/env node
/**
 * ClawNet Full-Scenario Test Runner
 * ==================================
 * Runs all (or selected) E2E scenarios across a 5-node Agent network.
 *
 * Usage:
 *   node run-tests.mjs                # run all scenarios
 *   node run-tests.mjs --verbose      # detailed output
 *   node run-tests.mjs --scenario 01  # single scenario
 *   node run-tests.mjs --scenario 02,03  # multiple scenarios
 */
import { Agent } from './lib/client.mjs';
import { log, vlog, setVerbose, printResults, getResults, sleep } from './lib/helpers.mjs';
import { waitForAllNodes } from './lib/wait-for-sync.mjs';

// ── Parse CLI args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
setVerbose(verbose);

const scenarioArg = args.find(a => a.startsWith('--scenario='))?.split('=')[1];
const scenarioFilter = scenarioArg ? scenarioArg.split(',').map(s => s.trim()) : null;

// ── Create Agents ───────────────────────────────────────────────────────
export const alice   = new Agent('alice',   'http://localhost:9600', 'alice-agent-passphrase');
export const bob     = new Agent('bob',     'http://localhost:9601', 'bob-agent-passphrase');
export const charlie = new Agent('charlie', 'http://localhost:9602', 'charlie-agent-passphrase');
export const dave    = new Agent('dave',    'http://localhost:9603', 'dave-agent-passphrase');
export const eve     = new Agent('eve',     'http://localhost:9604', 'eve-agent-passphrase');

export const agents = [alice, bob, charlie, dave, eve];

// ── Scenario registry ───────────────────────────────────────────────────
const scenarios = [
  { id: '01', name: 'Identity & Wallet',     module: './scenarios/01-identity-wallet.mjs' },
  { id: '02', name: 'Info Market Trade',     module: './scenarios/02-info-market.mjs' },
  { id: '03', name: 'Task Market Flow',      module: './scenarios/03-task-market.mjs' },
  { id: '04', name: 'Capability Market',     module: './scenarios/04-capability-market.mjs' },
  { id: '05', name: 'Service Contract',      module: './scenarios/05-service-contract.mjs' },
  { id: '06', name: 'Contract Dispute',      module: './scenarios/06-contract-dispute.mjs' },
  { id: '07', name: 'DAO Governance',        module: './scenarios/07-dao-governance.mjs' },
  { id: '08', name: 'Cross-Node Sync',       module: './scenarios/08-cross-node-sync.mjs' },
  { id: '09', name: 'Full Economic Cycle',   module: './scenarios/09-economic-cycle.mjs' },
];

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();

  log('================================================================');
  log('     ClawNet Full-Scenario E2E Test Suite');
  log('     5 Agents: Alice, Bob, Charlie, Dave, Eve');
  log('================================================================');
  log('');

  // 1. Wait for all nodes to be healthy
  log('Waiting for all nodes to be healthy...');
  try {
    await waitForAllNodes(agents, 120000);
  } catch (e) {
    log('FATAL: ' + e.message);
    process.exit(2);
  }
  log('All nodes healthy.\n');

  // 2. Initialize agent identities
  log('Initializing agent identities...');
  for (const agent of agents) {
    await agent.init();
    vlog(`${agent.name}: ${agent.did}`);
  }
  log('All agents initialized.\n');

  // 3. Fund all agents via faucet
  log('Funding agents via dev faucet...');
  for (const agent of agents) {
    const { status, data } = await agent.faucet(100000);
    if (status !== 200 && status !== 201) {
      log(`WARNING: faucet failed for ${agent.name}: ${status} ${JSON.stringify(data)}`);
    } else {
      vlog(`${agent.name}: funded ${data.amount} CLAW`);
    }
  }
  // Small wait for state to settle
  await sleep(2000);

  // Verify balances
  for (const agent of agents) {
    const { data } = await agent.balance();
    vlog(`${agent.name} balance: ${JSON.stringify(data)}`);
  }
  log('All agents funded.\n');

  // 4. Run scenarios
  const toRun = scenarioFilter
    ? scenarios.filter(s => scenarioFilter.some(f => s.id.includes(f) || s.name.toLowerCase().includes(f.toLowerCase())))
    : scenarios;

  for (const scenario of toRun) {
    log(`\n${'━'.repeat(60)}`);
    log(`  Scenario ${scenario.id}: ${scenario.name}`);
    log(`${'━'.repeat(60)}`);
    try {
      const mod = await import(scenario.module);
      await mod.default({ alice, bob, charlie, dave, eve, agents });
    } catch (err) {
      log(`  SCENARIO ERROR: ${err.message}`);
      if (verbose && err.stack) log(err.stack);
    }
  }

  // 5. Results
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`\nTotal time: ${elapsed}s`);
  printResults();

  const { failed } = getResults();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
