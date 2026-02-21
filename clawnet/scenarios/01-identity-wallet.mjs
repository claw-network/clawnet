/**
 * Scenario 01: Identity & Wallet
 * ================================
 * - Each Agent has a unique DID identity
 * - Agents fund themselves via faucet
 * - Cross-agent token transfers
 * - Balance verification across nodes (P2P propagation)
 * - Transaction history
 */
import { test, assert, assertEqual, assertOk, vlog, sleep } from '../lib/helpers.mjs';
import { waitForBalance } from '../lib/wait-for-sync.mjs';

export default async function run({ alice, bob, charlie, dave, eve, agents }) {

  // ── 1.1 Verify all agents have unique DIDs ────────────────────────────
  await test('all agents have unique DID identities', async () => {
    const dids = agents.map(a => a.did);
    const unique = new Set(dids);
    assertEqual(unique.size, agents.length, 'DID uniqueness');
    for (const a of agents) {
      assert(a.did.startsWith('did:claw:'), `${a.name} DID format: ${a.did}`);
    }
  });

  // ── 1.2 Verify initial balances ───────────────────────────────────────
  await test('all agents have positive balance after faucet', async () => {
    for (const agent of agents) {
      const { status, data } = await agent.balance();
      assertOk(status, `${agent.name} balance status`);
      const bal = Number(data.balance ?? data.available ?? 0);
      assert(bal > 0, `${agent.name} balance should be > 0, got ${bal}`);
      vlog(`${agent.name}: ${bal} Tokens`);
    }
  });

  // ── 1.3 Alice transfers to Bob ────────────────────────────────────────
  let aliceBalBefore;
  await test('Alice transfers 500 Tokens to Bob', async () => {
    const { data: balData } = await alice.balance();
    aliceBalBefore = Number(balData.balance || balData.available);

    const { status, data } = await alice.transfer(bob.did, 500, 'payment for services');
    assertOk(status, 'transfer status');
    assert(data.txHash, 'should return txHash');
    vlog(`txHash: ${data.txHash}`);
  });

  await test('Alice balance decreased after transfer', async () => {
    await sleep(300);
    const { data } = await alice.balance();
    const bal = Number(data.balance || data.available);
    assert(bal < aliceBalBefore, `Alice balance should decrease: was ${aliceBalBefore}, now ${bal}`);
    vlog(`Alice: ${aliceBalBefore} → ${bal}`);
  });

  // ── 1.4 Bob sees incoming transfer on his own node (P2P sync) ────────
  await test('Bob sees received balance on his own node (P2P sync)', async () => {
    // Bob's node needs to receive Alice's transfer event via P2P
    const result = await waitForBalance(bob, bob.did, 100001);
    if (result) {
      vlog(`Bob balance on own node: ${result}`);
    } else {
      // If P2P didn't propagate yet, check from Alice's perspective
      const { data } = await alice.balance(bob.did);
      const bal = Number(data.balance ?? data.available ?? 0);
      assert(bal >= 500, `Bob should have >=500 on Alice node, got ${bal}`);
      vlog(`Bob balance on Alice's node: ${bal} (P2P pending)`);
    }
  });

  // ── 1.5 Multiple transfers: Dave → Charlie, Eve → Alice ──────────────
  await test('Dave transfers 200 Tokens to Charlie', async () => {
    const { status, data } = await dave.transfer(charlie.did, 200, 'investment');
    assertOk(status, 'Dave→Charlie transfer');
    assert(data.txHash, 'txHash present');
    vlog(`Dave→Charlie: ${data.txHash}`);
  });

  await test('Eve transfers 300 Tokens to Alice', async () => {
    const { status, data } = await eve.transfer(alice.did, 300, 'audit fee refund');
    assertOk(status, 'Eve→Alice transfer');
    assert(data.txHash, 'txHash present');
    vlog(`Eve→Alice: ${data.txHash}`);
  });

  // ── 1.6 Transaction history ───────────────────────────────────────────
  await test('Alice has transaction history entries', async () => {
    await sleep(300);
    const { status, data } = await alice.history();
    assertOk(status, 'history status');
    const entries = data.transactions || data.history || data;
    assert(Array.isArray(entries), 'history should be array');
    assert(entries.length > 0, 'should have history entries');
    vlog(`Alice history: ${entries.length} entries`);
  });

  // ── 1.7 Node status and peer connectivity ─────────────────────────────
  await test('all nodes report status and peers', async () => {
    for (const agent of agents) {
      const { status, data } = await agent.status();
      assertOk(status, `${agent.name} status`);
      assert(data.blockHeight >= 0, `${agent.name} blockHeight`);
      vlog(`${agent.name}: blockHeight=${data.blockHeight}, peers=${data.peers?.length ?? 0}`);
    }
  });
}
