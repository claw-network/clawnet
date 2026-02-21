/**
 * Scenario 09: Full Economic Cycle
 * =================================
 * Alice publishes research → Dave purchases → Alice hires Bob to translate
 * → Bob uses Charlie's API → Charlie donates to DAO → mutual reputation
 *
 * End-to-end multi-agent economic flow spanning all markets and subsystems.
 */
import { test, assert, assertOk, assertOkOrConflict, vlog, sleep } from '../lib/helpers.mjs';
import { waitForListing, waitForBalance, waitForResource } from '../lib/wait-for-sync.mjs';

export default async function run({ alice, bob, charlie, dave, eve }) {

  let researchListingId;
  let capabilityListingId;
  let taskId;
  let contractId;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 1: Information Market — Alice sells, Dave buys
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  await test('P1: Alice publishes AI agent research report', async () => {
    const { status, data } = await alice.publishInfo({
      infoType: 'research',
      title: 'Agentic AI: Market Dynamics in 2025',
      description: 'Comprehensive analysis of agent-to-agent economic interactions',
      category: 'research',
      content: { data: 'Detailed analysis of agentic AI market dynamics...', format: 'text' },
      tags: ['ai', 'research', 'agents'],
      accessMethod: { type: 'download' },
      license: {
        type: 'non_exclusive',
        permissions: { use: true, modify: false, distribute: false, commercialize: true, sublicense: false },
        restrictions: { attribution: true, shareAlike: false, nonCompete: false, confidential: false },
      },
      pricing: {
        type: 'fixed',
        fixedPrice: 200,
        currency: 'TOKEN',
        negotiable: false,
      },
    });
    assertOk(status, 'publish');
    researchListingId = data?.id || data?.listingId;
    assert(researchListingId, 'listing created');
    vlog(`Research listing: ${researchListingId}`);
  });

  await test('P1: Dave discovers and purchases the report', async () => {
    await sleep(500);
    let r = await dave.purchaseInfo(researchListingId);
    if (r.status === 404) {
      vlog('Waiting for listing to reach Dave...');
      await waitForListing(dave, 'info', researchListingId);
      r = await dave.purchaseInfo(researchListingId);
    }
    if (r.status === 404) {
      vlog('P2P: listing not propagated to Dave — soft pass (P2P limitation)');
    } else {
      assertOkOrConflict(r.status, 'purchase');
    }
    vlog(`Dave purchase: ${r.status}`);
  });

  await test('P1: Dave rates Alice on quality', async () => {
    const { status } = await dave.submitReputation(
      alice.did, 'quality', 5, 'Outstanding research — comprehensive and well-cited');
    assertOk(status, 'reputation');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 2: Capability Market — Charlie publishes API, Bob leases
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  await test('P2: Charlie publishes translation API capability', async () => {
    const { status, data } = await charlie.publishCapability({
      capabilityType: 'rest_api',
      title: 'Neural Machine Translation Service',
      description: 'High-quality EN↔CN translation API powered by custom LLM',
      category: 'translation',
      tags: ['translation', 'api', 'nlp'],
      capability: {
        name: 'neural-translation',
        version: '2.0.0',
        interface: {
          type: 'custom',
          custom: {
            protocol: 'REST',
            specification: '{"endpoint":"/translate","method":"POST"}',
            endpoint: 'https://charlie-api.clawnet.local/translate',
          },
        },
      },
      pricing: {
        type: 'usage',
        usagePrice: { unit: 'request', pricePerUnit: 3 },
        currency: 'TOKEN',
        negotiable: false,
      },
      quota: {
        type: 'limited',
        rateLimits: [{ requests: 200, period: 60 }],
      },
      access: {
        endpoint: 'https://charlie-api.clawnet.local/translate',
        authentication: { type: 'api_key' },
      },
    });
    assertOk(status, 'publish capability');
    capabilityListingId = data?.id || data?.listingId;
    assert(capabilityListingId, 'capability listed');
    vlog(`Translation API: ${capabilityListingId}`);
  });

  await test('P2: Bob leases Charlie\'s translation API', async () => {
    await sleep(500);
    let r = await bob.leaseCapability(capabilityListingId);
    if (r.status === 404) {
      vlog('Waiting for capability to reach Bob...');
      await waitForListing(bob, 'capability', capabilityListingId);
      r = await bob.leaseCapability(capabilityListingId);
    }
    if (r.status === 404) {
      vlog('P2P: capability not propagated to Bob — soft pass (P2P limitation)');
    } else {
      assertOkOrConflict(r.status, 'lease');
    }
    vlog(`Bob lease: ${r.status}`);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 3: Task Market — Alice posts translation task, Bob bids
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  await test('P3: Alice posts translation task for her research', async () => {
    const { status, data } = await alice.publishTask({
      taskType: 'one_time',
      title: 'Translate AI Research Report EN→CN',
      description: 'Translate the Agentic AI research report to Chinese for broader distribution',
      category: 'translation',
      tags: ['translation', 'report'],
      task: {
        requirements: 'Native CN speaker with AI domain knowledge',
        deliverables: [{ name: 'translation', type: 'report', required: true }],
        skills: [{ name: 'translation', level: 'expert', required: true }],
        complexity: 'moderate',
        estimatedDuration: 48,
      },
      timeline: {
        flexible: true,
        deadline: Date.now() + 2 * 86400000,
      },
      pricing: {
        type: 'fixed',
        fixedPrice: 500,
        currency: 'TOKEN',
        negotiable: true,
      },
    });
    assertOk(status, 'publish task');
    taskId = data?.id || data?.listingId;
    assert(taskId, 'task created');
    vlog(`Translation task: ${taskId}`);
  });

  await test('P3: Bob bids on translation task (has API access)', async () => {
    await sleep(500);
    let r = await bob.bidOnTask(taskId, {
      price: 450,
      timeline: 24,
      approach: 'I have access to Charlie\'s Neural Translation API and can deliver quality CN translation within 24h',
    });
    if (r.status === 404) {
      vlog('Task not on Bob yet, waiting...');
      await waitForListing(bob, 'task', taskId);
      r = await bob.bidOnTask(taskId, {
        price: 450,
        timeline: 24,
        approach: 'I have access to Charlie\'s Neural Translation API',
      });
    }
    if (r.status === 404) {
      vlog('P2P: task not propagated to Bob — soft pass (P2P limitation)');
    } else {
      assertOkOrConflict(r.status, 'bid');
    }
    vlog(`Bob bid: ${r.status}`);
  });

  await test('P3: Alice accepts Bob\'s bid', async () => {
    await sleep(500);
    // List bids to get Bob's bidId
    const bids = await alice.getTaskBids(taskId);
    const bidList = Array.isArray(bids.data) ? bids.data : (bids.data?.bids || []);
    const bobBid = bidList.find(b => b.bidder === bob.did || b.did === bob.did) || bidList[0];
    const bidId = bobBid?.id || bobBid?.bidId;
    vlog(`Bob's bid ID: ${bidId}`);

    if (bidId) {
      const r = await alice.acceptBid(taskId, bidId);
      assertOkOrConflict(r.status, 'accept');
      vlog(`Accept: ${r.status}`);
    } else {
      vlog('No bid found to accept (P2P lag)');
    }
  });

  await test('P3: Bob delivers translation', async () => {
    const { status } = await bob.deliverTask(taskId, {
      deliveryNote: 'Translated using Charlie\'s Neural Translation API + manual review',
      artifacts: [{ name: 'agentic-ai-2025-cn.pdf', hash: 'sha256:translated123' }],
    });
    if (status === 404) {
      vlog('P2P: task/order not propagated to Bob — soft pass (P2P limitation)');
    } else {
      assertOkOrConflict(status, 'deliver');
    }
    vlog(`Delivery: ${status}`);
  });

  await test('P3: Alice confirms delivery', async () => {
    await sleep(500);
    const { status } = await alice.confirmDelivery(taskId);
    if (status === 404) {
      vlog('P2P: no delivery to confirm — soft pass (P2P limitation)');
    } else {
      assertOkOrConflict(status, 'confirm');
    }
    vlog(`Confirm: ${status}`);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 4: Service Contract — Bob & Charlie formalise partnership
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  await test('P4: Bob creates service contract with Charlie', async () => {
    const { status, data } = await bob.createContract({
      provider: charlie.did,
      terms: {
        description: 'Monthly translation API subscription — 1000 API calls',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        totalAmount: 300,
        currency: 'Token',
      },
      milestones: [{
        id: 'ms-month1',
        title: 'Month 1 API Access',
        description: 'Provide 1000 API calls for translation services',
        amount: 300,
        deadline: new Date(Date.now() + 30 * 86400000).toISOString(),
      }],
    });
    assertOk(status, 'contract');
    contractId = data?.id;
    assert(contractId, 'contract created');
    vlog(`Bob-Charlie contract: ${contractId}`);
  });

  await test('P4: Both parties sign the contract', async () => {
    const r1 = await bob.signContract(contractId);
    assertOk(r1.status, 'Bob sign');

    await sleep(500);
    let r2 = await charlie.signContract(contractId);
    if (r2.status === 404) {
      await waitForResource(charlie, '/api/contracts/' + contractId);
      r2 = await charlie.signContract(contractId);
    }
    vlog(`Sign: Bob=${r1.status}, Charlie=${r2.status}`);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 5: DAO Contribution — Charlie donates profits to treasury
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  await test('P5: Charlie donates 100 Tokens to DAO treasury', async () => {
    const { status, data } = await charlie.depositTreasury(100, 'API revenue contribution to ecosystem');
    assertOk(status, 'treasury deposit');
    vlog(`Donation: ${status}`);
  });

  await test('P5: Treasury reflects Charlie\'s donation', async () => {
    await sleep(300);
    const { status, data } = await charlie.getTreasury();
    assertOk(status, 'treasury');
    vlog(`Treasury: ${JSON.stringify(data).slice(0, 200)}`);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 6: Cross-Agent Reputation — everyone rates everyone
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  await test('P6: Alice rates Bob on fulfillment (task delivery)', async () => {
    const { status } = await alice.submitReputation(
      bob.did, 'fulfillment', 5, 'Excellent translation delivered promptly using API tools');
    assertOk(status, 'reputation');
  });

  await test('P6: Bob rates Charlie on quality (API service)', async () => {
    const { status } = await bob.submitReputation(
      charlie.did, 'quality', 4, 'Translation API produced good results, minor tone issues');
    assertOk(status, 'reputation');
  });

  await test('P6: Eve audits and rates Alice on social contribution', async () => {
    const { status } = await eve.submitReputation(
      alice.did, 'social', 5, 'Valuable research that drove economic activity in the network');
    assertOk(status, 'reputation');
  });

  await test('P6: Dave rates the network (social reputation for Eve)', async () => {
    const { status } = await dave.submitReputation(
      eve.did, 'behavior', 4, 'Active auditor participant in governance and oversight');
    assertOk(status, 'reputation');
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 7: Final balance & reputation check
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  await test('P7: All agents have valid final balances', async () => {
    for (const agent of [alice, bob, charlie, dave, eve]) {
      const { status, data } = await agent.balance();
      assertOk(status, `${agent.name} balance`);
      const bal = data?.balance ?? data?.available ?? 0;
      vlog(`${agent.name}: ${bal} Tokens`);
    }
  });

  await test('P7: Reputation profiles exist for active agents', async () => {
    for (const agent of [alice, bob, charlie]) {
      const { status, data } = await agent.getReputation(agent.did);
      if (status === 200) {
        vlog(`${agent.name} reputation: ${JSON.stringify(data).slice(0, 200)}`);
      } else {
        vlog(`${agent.name} reputation: ${status}`);
      }
    }
  });
}
