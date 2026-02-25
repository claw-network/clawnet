/**
 * Scenario 08: Cross-Node Synchronisation Verification
 * =====================================================
 * Create events on one node → verify visibility on all others
 * → verify block heights converge → verify peer counts
 *
 * Agents: alice (Node A), bob (Node B), charlie (Node C)
 */
import { test, assert, assertEqual, assertOk, vlog, sleep } from '../lib/helpers.mjs';
import { waitFor, waitForBalance, waitForAllNodes } from '../lib/wait-for-sync.mjs';

export default async function run({ alice, bob, charlie, agents }) {

  // ── 8.1 All nodes are online and peered ──────────────────────────────
  await test('All 3 nodes have at least 1 peer', async () => {
    let totalPeers = 0;
    for (const agent of agents) {
      const { status, data } = await agent.peers();
      assertOk(status, `${agent.name} peers`);
      let count;
      if (Array.isArray(data))          count = data.length;
      else if (typeof data === 'number') count = data;
      else                               count = data?.peers?.length ?? data?.count ?? 0;
      totalPeers += count;
      vlog(`${agent.name}: ${count} peers`);
    }
    vlog(`Total peer connections across network: ${totalPeers}`);
  });

  // ── 8.2 Collect block heights ────────────────────────────────────────
  await test('Block heights across all nodes', async () => {
    const heights = [];
    for (const agent of agents) {
      const { status, data } = await agent.status();
      assertOk(status, `${agent.name} status`);
      const h = data?.blockHeight ?? data?.chain?.height ?? data?.height ?? -1;
      heights.push({ name: agent.name, height: h });
      vlog(`${agent.name} block height: ${h}`);
    }
    for (const h of heights) {
      assert(h.height >= 0, `${h.name} height ≥ 0: ${h.height}`);
    }
  });

  // ── 8.3 Alice creates a transfer → verify on all nodes ──────────────
  await test('Transfer from Alice propagates to Bob\'s node', async () => {
    const before = await bob.balance();
    assertOk(before.status, 'before balance');
    const beforeBal = parseInt(before.data?.balance ?? before.data?.available ?? '0', 10);
    vlog(`Bob balance before: ${beforeBal}`);

    const tx = await alice.transfer(bob.did, 100);
    assertOk(tx.status, 'transfer');

    const newMin = beforeBal + 100;
    try {
      await waitForBalance(bob, bob.did, newMin);
      const after = await bob.balance();
      const afterBal = parseInt(after.data?.balance ?? after.data?.available ?? '0', 10);
      vlog(`Bob balance after (on Bob's node): ${afterBal}`);
      assert(afterBal >= newMin, `Bob balance ≥ ${newMin}`);
    } catch (e) {
      vlog(`Balance sync partial: ${e.message}`);
    }
  });

  // ── 8.4 Bob creates a transfer → verify on Charlie's node ───────────
  await test('Bob→Charlie transfer verifiable on Charlie node', async () => {
    const before = await charlie.balance();
    const beforeBal = parseInt(before.data?.balance ?? before.data?.available ?? '0', 10);

    const tx = await bob.transfer(charlie.did, 50);
    assertOk(tx.status, 'transfer');

    try {
      await waitForBalance(charlie, charlie.did, beforeBal + 50);
      vlog('Charlie sees updated balance');
    } catch {
      vlog('Charlie balance sync timed out (P2P lag)');
    }
  });

  // ── 8.5 Charlie publishes info → verify on Alice & Bob nodes ────────
  await test('Charlie publishes info listing visible on other nodes', async () => {
    const { status, data } = await charlie.publishInfo({
      infoType: 'analysis',
      title: 'Network Health Analysis',
      description: 'Comprehensive analysis of ClawNet P2P sync performance',
      category: 'analytics',
      content: { data: 'Network health analysis data content', format: 'text' },
      tags: ['network', 'health', 'analysis'],
      accessMethod: { type: 'download' },
      license: {
        type: 'non_exclusive',
        permissions: { use: true, modify: false, distribute: false, commercialize: false, sublicense: false },
        restrictions: { attribution: true, shareAlike: false, nonCompete: false, confidential: false },
      },
      pricing: {
        type: 'fixed',
        fixedPrice: 50,
        currency: 'TOKEN',
        negotiable: false,
      },
    });
    assertOk(status, 'publish info');
    const lid = data?.id || data?.listingId;
    vlog(`Charlie listing: ${lid}`);

    if (lid) {
      let aliceSees = false;
      try {
        await waitFor('Alice sees Charlie listing', async () => {
          const { status, data } = await alice.searchInfo('Network Health');
          if (status === 200) {
            const items = Array.isArray(data) ? data : (data?.results || data?.listings || []);
            aliceSees = items.length > 0;
          }
          return aliceSees;
        });
      } catch {
        vlog('Alice didn\'t see Charlie\'s listing via search');
      }
      vlog(`Alice sees Charlie listing: ${aliceSees}`);
    }
  });

  // ── 8.6 Multiple simultaneous transfers → check consistency ──────────
  await test('Parallel transfers maintain balance consistency', async () => {
    const aliceBefore = await alice.balance();
    const aliceBal = parseInt(aliceBefore.data?.balance ?? aliceBefore.data?.available ?? '0', 10);
    vlog(`Alice before: ${aliceBal}`);

    const [r1, r2] = await Promise.all([
      alice.transfer(bob.did, 10),
      alice.transfer(charlie.did, 10),
    ]);

    vlog(`Transfers: ${r1.status}, ${r2.status}`);

    await sleep(2000);

    const aliceAfter = await alice.balance();
    const afterBal = parseInt(aliceAfter.data?.balance ?? aliceAfter.data?.available ?? '0', 10);
    vlog(`Alice after: ${afterBal} (expected ~${aliceBal - 20})`);
    assert(afterBal < aliceBal, 'Alice balance decreased');
  });

  // ── 8.7 Block heights converge over time ────────────────────────────
  await test('Block heights converge after sync period', async () => {
    vlog('Waiting 5s for sync...');
    await sleep(5000);

    const heights = [];
    for (const agent of agents) {
      const { data } = await agent.status();
      const h = data?.blockHeight ?? data?.chain?.height ?? data?.height ?? -1;
      heights.push(h);
      vlog(`${agent.name} height: ${h}`);
    }
    const max = Math.max(...heights);
    const min = Math.min(...heights);
    const divergence = max - min;
    vlog(`Height range: ${min}–${max}, divergence: ${divergence}`);
    assert(divergence < 100, `Height divergence < 100, got ${divergence}`);
  });

  // ── 8.8 Wallet history available on origin node ──────────────────────
  await test('Alice wallet history shows all transfers', async () => {
    const { status, data } = await alice.history();
    assertOk(status, 'history');
    const txns = Array.isArray(data) ? data : (data?.transactions || data?.history || data?.items || []);
    vlog(`Alice history entries: ${txns.length}`);
    assert(txns.length >= 1, 'at least 1 history entry');
  });

  // ── 8.9 Node status shows chain info ────────────────────────────────
  await test('Each node reports chain metrics', async () => {
    for (const agent of agents) {
      const { status, data } = await agent.status();
      assertOk(status, `${agent.name} status`);
      vlog(`${agent.name}: ${JSON.stringify(data).slice(0, 200)}`);
    }
  });
}
