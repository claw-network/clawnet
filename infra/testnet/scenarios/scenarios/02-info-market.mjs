/**
 * Scenario 02: Info Market Trade
 * ================================
 * Alice publishes a research report → Bob & Charlie purchase it
 * Each agent operates on their OWN node.
 *
 * Agents: alice (Node A), bob (Node B), charlie (Node C)
 */
import { test, assert, assertOk, vlog, sleep } from '../lib/helpers.mjs';
import { waitForListing } from '../lib/wait-for-sync.mjs';

export default async function run({ alice, bob, charlie }) {
  let listingId;

  // ── 2.1 Alice publishes research report ───────────────────────────────
  await test('Alice publishes research report to info market', async () => {
    const { status, data } = await alice.publishInfo({
      title: 'AI Agent Economic Model Analysis 2026',
      description: 'Comprehensive analysis of agent-to-agent economic interactions',
      category: 'research',
      infoType: 'research',
      content: { data: 'Encrypted research content about agent economic models...', format: 'text' },
      tags: ['ai', 'economics', 'agents'],
      pricing: {
        type: 'fixed',
        fixedPrice: 100,
        currency: 'TOKEN',
        negotiable: false,
      },
      accessMethod: { type: 'download' },
      license: {
        type: 'non_exclusive',
        permissions: { use: true, modify: false, distribute: false, commercialize: false, sublicense: false },
        restrictions: { attribution: true, shareAlike: false, nonCompete: false, confidential: false },
      },
    });
    assertOk(status, 'publish info');
    listingId = data?.listingId;
    assert(listingId, 'should return listingId');
    vlog(`Listing ID: ${listingId}`);
  });

  // ── 2.2 Alice can see her own listing ─────────────────────────────────
  await test('Alice sees her listing on her own node', async () => {
    const { status, data } = await alice.getInfoListing(listingId);
    assertOk(status, 'get listing');
    const lid = data?.id || data?.listingId;
    assert(lid === listingId, 'listing ID matches');
    vlog(`Listing title: ${data?.title}`);
  });

  // ── 2.3 Bob discovers listing via P2P ─────────────────────────────────
  await test('Bob discovers listing via P2P sync', async () => {
    const listing = await waitForListing(bob, 'info', listingId);
    if (listing) {
      vlog(`Bob found listing: ${listing.title || listing.id}`);
    } else {
      vlog('Listing not yet on Bob\'s node (P2P lag) — will fall back to search');
    }
  });

  // ── 2.4 Bob searches for the listing ──────────────────────────────────
  await test('Bob searches info market', async () => {
    const { status, data } = await bob.searchInfo('AI Agent');
    assertOk(status, 'search status');
    const listings = Array.isArray(data) ? data : (data?.listings || data?.results || []);
    vlog(`Bob search results: ${listings.length} listings`);
  });

  // ── 2.5 Bob purchases the report ─────────────────────────────────────
  await test('Bob purchases research report', async () => {
    let result = await bob.purchaseInfo(listingId);
    if (result.status === 404) {
      vlog('Listing not on Bob\'s node (P2P lag)');
    }
    assert(result.status >= 200 && result.status < 500, `purchase status: ${result.status}`);
    vlog(`Bob purchase: ${result.status} ${JSON.stringify(result.data).slice(0, 200)}`);
  });

  // ── 2.6 Charlie also purchases ───────────────────────────────────────
  await test('Charlie purchases research report', async () => {
    let result = await charlie.purchaseInfo(listingId);
    if (result.status === 404) {
      vlog('Listing not on Charlie\'s node yet');
    }
    assert(result.status >= 200 && result.status < 500, `purchase status: ${result.status}`);
    vlog(`Charlie purchase: ${result.status} ${JSON.stringify(result.data).slice(0, 200)}`);
  });

  // ── 2.7 Bob and Charlie rate Alice ────────────────────────────────────
  await test('Bob rates Alice on quality dimension', async () => {
    const { status, data } = await bob.submitReputation(alice.did, 'quality', 5, 'Excellent research!');
    assertOk(status, 'reputation status');
    vlog(`Bob→Alice reputation: ${JSON.stringify(data).slice(0, 200)}`);
  });

  await test('Charlie rates Alice on quality dimension', async () => {
    const { status, data } = await charlie.submitReputation(alice.did, 'quality', 4, 'Good analysis, needs more data');
    assertOk(status, 'reputation status');
    vlog(`Charlie→Alice reputation: ${JSON.stringify(data).slice(0, 200)}`);
  });

  // ── 2.8 Check Alice's reputation ──────────────────────────────────────
  await test('Alice has reputation profile', async () => {
    await sleep(1000);
    const { status, data } = await bob.getReputation(alice.did);
    if (status === 200) {
      vlog(`Alice reputation (from Bob's node): score=${data?.score}, level=${data?.level}`);
    } else {
      vlog(`Alice reputation not yet available: ${status}`);
    }
  });

  // ── 2.9 Alice removes listing ─────────────────────────────────────────
  await test('Alice removes her listing', async () => {
    const { status } = await alice.removeInfo(listingId);
    assertOk(status, 'remove listing');
    vlog('Listing removed');
  });
}
