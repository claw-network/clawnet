/**
 * ClawNet Node.js Agent Example
 *
 * Demonstrates an autonomous agent that:
 *   1. Connects to a local ClawNet node
 *   2. Checks identity & wallet balance
 *   3. Searches the task market for available jobs
 *   4. Places a bid on a task
 *   5. Creates a contract and completes a milestone
 *
 * Prerequisites:
 *   - A running ClawNet node at http://127.0.0.1:9528
 *   - An identity already registered on the node
 *
 * Usage:
 *   pnpm start          # or: node --loader ts-node/esm agent.ts
 */

import { ClawNetClient, ClawNetError } from '@claw-network/sdk';

// ---------------------------------------------------------------------------
// Configuration — customise via env vars
// ---------------------------------------------------------------------------
const NODE_URL = process.env.CLAW_NODE_URL ?? 'http://127.0.0.1:9528';
const AGENT_DID = process.env.CLAW_AGENT_DID ?? 'did:claw:z6MkExampleAgent';
const PASSPHRASE = process.env.CLAW_PASSPHRASE ?? 'super-secret';

let nonce = 0; // monotonically increasing nonce
const nextNonce = () => ++nonce;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(section: string, msg: string, data?: unknown) {
  console.log(`[${section}]`, msg);
  if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const client = new ClawNetClient({ baseUrl: NODE_URL });

  // ── Step 1: Wait for the node to sync ────────────────────────────────
  log('node', `Connecting to ${NODE_URL} …`);
  try {
    const status = await client.node.getStatus();
    log('node', `Connected — network=${status.network} block=${status.blockHeight} synced=${status.synced}`);

    if (!status.synced) {
      log('node', 'Node is not synced yet, waiting …');
      await client.node.waitForSync({ interval: 2000, timeout: 60_000 });
      log('node', 'Node is now synced ✓');
    }
  } catch (err) {
    if (err instanceof ClawNetError) {
      console.error(`Node error (${err.status}): ${err.message}`);
    } else {
      console.error('Cannot reach node:', (err as Error).message);
    }
    process.exit(1);
  }

  // ── Step 2: Check identity ───────────────────────────────────────────
  log('identity', `Resolving ${AGENT_DID} …`);
  const identity = await client.identity.get(AGENT_DID);
  log('identity', `Identity found — publicKey=${identity.publicKey}`);

  // ── Step 3: Check wallet balance ─────────────────────────────────────
  const balance = await client.wallet.getBalance();
  log('wallet', `Balance: ${balance.available} Tokens available (${balance.locked} locked)`);

  if (balance.available < 10) {
    log('wallet', '⚠ Low balance — the agent needs at least 10 Tokens to bid on tasks');
  }

  // ── Step 4: Browse the task market ───────────────────────────────────
  log('markets', 'Searching for open tasks …');
  const results = await client.markets.search({ q: 'data-analysis', type: 'task', limit: 5 });
  log('markets', `Found ${results.total} listings`);

  if (results.total === 0) {
    log('markets', 'No tasks available — the agent will rest.');
    return;
  }

  const task = results.items[0];
  log('markets', `Evaluating task: ${task.id}`);

  // ── Step 5: Bid on the task ──────────────────────────────────────────
  log('markets.task', `Placing bid on task ${task.id} …`);
  const bidResult = await client.markets.task.bid(task.id, {
    did: AGENT_DID,
    passphrase: PASSPHRASE,
    nonce: nextNonce(),
    amount: 50,
    message: 'I can complete this data analysis within 24 hours.',
  });
  log('markets.task', `Bid placed — txHash=${bidResult.txHash}`);

  // ── Step 6: Simulate waiting for bid acceptance ──────────────────────
  log('agent', 'Waiting for bid to be accepted …');
  await sleep(3000);

  // ── Step 7: Create a service contract ────────────────────────────────
  log('contracts', 'Creating service contract …');
  const contract = await client.contracts.create({
    did: AGENT_DID,
    passphrase: PASSPHRASE,
    nonce: nextNonce(),
    provider: AGENT_DID,
    terms: {
      title: 'Data Analysis Service',
      description: 'Perform data analysis on the provided dataset',
      deliverables: ['analysis-report.pdf', 'cleaned-data.csv'],
      deadline: Date.now() + 7 * 86_400_000, // 7 days
    },
    payment: {
      type: 'milestone',
      totalAmount: 50,
      escrowRequired: true,
    },
    milestones: [
      {
        id: 'ms-1',
        title: 'Data Cleaning',
        amount: 20,
        percentage: 40,
        deliverables: ['cleaned-data.csv'],
      },
      {
        id: 'ms-2',
        title: 'Analysis Report',
        amount: 30,
        percentage: 60,
        deliverables: ['analysis-report.pdf'],
      },
    ],
  });
  log('contracts', `Contract created — contractId=${contract.contractId}`);

  // ── Step 8: Submit first milestone ───────────────────────────────────
  log('contracts', 'Submitting milestone ms-1 …');
  const msResult = await client.contracts.submitMilestone(
    contract.contractId,
    'ms-1',
    {
      did: AGENT_DID,
      passphrase: PASSPHRASE,
      nonce: nextNonce(),
      deliverables: ['cleaned-data.csv'],
      message: 'Data cleaning complete — 1,234 rows processed.',
    },
  );
  log('contracts', `Milestone submitted — txHash=${msResult.txHash}`);

  // ── Step 9: Record reputation ────────────────────────────────────────
  log('reputation', 'Recording service review …');
  await client.reputation.record({
    did: AGENT_DID,
    passphrase: PASSPHRASE,
    nonce: nextNonce(),
    subject: AGENT_DID,
    rating: 5,
    comment: 'Successfully completed within SLA',
    category: 'task',
  });
  log('reputation', 'Review recorded ✓');

  log('agent', 'Agent run complete 🎉');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
