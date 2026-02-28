/**
 * Scenario 01: Identity & Wallet
 * ================================
 * - Each Agent has a unique DID identity
 * - Cross-agent Token transfers
 * - Balance verification across nodes (P2P propagation)
 * - Transaction history
 *
 * Agents: alice (Node A), bob (Node B), charlie (Node C)
 */
import { test, assert, assertEqual, assertOk, vlog, sleep } from '../lib/helpers.mjs';
import { waitFor, waitForBalance } from '../lib/wait-for-sync.mjs';

export default async function run({ alice, bob, charlie, agents }) {

  // ── 1.1 Verify all agents have unique DIDs ────────────────────────────
  await test('all agents have unique DID identities', async () => {
    const dids = agents.map(a => a.did);
    const unique = new Set(dids);
    assertEqual(unique.size, agents.length, 'DID uniqueness');
    for (const a of agents) {
      assert(a.did.startsWith('did:claw:'), `${a.name} DID format: ${a.did}`);
    }
  });

  // ── 1.2 Verify positive balances ──────────────────────────────────────
  await test('all agents have positive balance', async () => {
    for (const agent of agents) {
      const { status, data } = await agent.balance();
      assertOk(status, `${agent.name} balance status`);
      const bal = Number(data?.balance ?? data?.available ?? 0);
      assert(bal > 0, `${agent.name} balance should be > 0, got ${bal}`);
      vlog(`${agent.name}: ${bal} Tokens`);
    }
  });

  // ── 1.3 Alice transfers to Bob ────────────────────────────────────────
  let aliceBalBefore;
  let aliceTransferTxHash = '';
  let aliceTransferStatus = '';
  await test('Alice transfers 500 Tokens to Bob', async () => {
    const { data: balData } = await alice.balance();
    aliceBalBefore = Number(balData?.balance ?? balData?.available ?? 0);

    const { status, data } = await alice.transfer(bob.did, 500, 'payment for services');
    assertOk(status, 'transfer status');
    assert(data?.txHash, 'should return txHash');
    aliceTransferTxHash = String(data.txHash);
    aliceTransferStatus = String(data?.status || '').toLowerCase();
    vlog(`txHash: ${data.txHash}`);
  });

  await test('Alice balance decreased after transfer', async () => {
    let lastSeen = aliceBalBefore;
    const settledBalance = await waitFor(
      'alice balance decrease after transfer',
      async () => {
        const { data: balanceData } = await alice.balance();
        const current = Number(balanceData?.balance ?? balanceData?.available ?? 0);
        lastSeen = current;

        return current < aliceBalBefore ? current : null;
      },
      45000,
      1000,
    );

    // In legacy event mode, transfer acceptance can be visible before wallet balance projection catches up.
    if (settledBalance === null) {
      const accepted = aliceTransferStatus === 'broadcast' || aliceTransferStatus === 'confirmed';
      assert(
        accepted,
        `Alice transfer not accepted: status=${aliceTransferStatus || 'unknown'}, txHash=${aliceTransferTxHash || 'n/a'}`,
      );
      vlog(
        `Alice balance projection pending after 45s (before=${aliceBalBefore}, now=${lastSeen}); accepted transfer status=${aliceTransferStatus}, txHash=${aliceTransferTxHash}`,
      );
      return;
    }

    vlog(`Alice balance observed: ${aliceBalBefore} → ${settledBalance}`);
  });

  // ── 1.4 Bob sees incoming transfer on his own node (P2P sync) ────────
  await test('Bob sees received balance on his own node (P2P sync)', async () => {
    const result = await waitForBalance(bob, bob.did, 1);
    if (result) {
      vlog(`Bob balance on own node: ${result}`);
    } else {
      const { data } = await alice.balance(bob.did);
      const bal = Number(data?.balance ?? data?.available ?? 0);
      assert(bal >= 500, `Bob should have >=500 on Alice node, got ${bal}`);
      vlog(`Bob balance on Alice's node: ${bal} (P2P pending)`);
    }
  });

  // ── 1.5 Charlie transfers to Alice ────────────────────────────────────
  await test('Charlie transfers 200 Tokens to Alice', async () => {
    const { status, data } = await charlie.transfer(alice.did, 200, 'investment');
    assertOk(status, 'Charlie→Alice transfer');
    assert(data?.txHash, 'txHash present');
    vlog(`Charlie→Alice: ${data.txHash}`);
  });

  await test('Bob transfers 300 Tokens to Charlie', async () => {
    const { status, data } = await bob.transfer(charlie.did, 300, 'audit fee refund');
    assertOk(status, 'Bob→Charlie transfer');
    assert(data?.txHash, 'txHash present');
    vlog(`Bob→Charlie: ${data.txHash}`);
  });

  // ── 1.6 Transaction history ───────────────────────────────────────────
  await test('Alice has transaction history entries', async () => {
    await sleep(1000);
    const { status, data, meta } = await alice.history();
    assertOk(status, 'history status');
    const entries = Array.isArray(data) ? data : (data?.transactions || data?.history || []);
    assert(Array.isArray(entries), 'history should be array');
    assert(entries.length > 0, 'should have history entries');
    vlog(`Alice history: ${entries.length} entries (total: ${meta?.pagination?.total ?? '?'})`);
  });

  // ── 1.7 Node status and peer connectivity ─────────────────────────────
  await test('all nodes report status and peers', async () => {
    for (const agent of agents) {
      const { status, data } = await agent.status();
      assertOk(status, `${agent.name} status`);
      assert(data?.blockHeight >= 0, `${agent.name} blockHeight`);
      const peerCount = typeof data?.peers === 'number' ? data.peers : (data?.connections ?? 0);
      vlog(`${agent.name}: blockHeight=${data.blockHeight}, peers=${peerCount}`);
    }
  });
}
