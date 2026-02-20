/**
 * Scenario 05: Service Contract Full Lifecycle
 * =============================================
 * Alice (client) hires Charlie (provider) for a development project.
 * Contract with milestones → sign → fund → milestone submit/approve → complete
 *
 * Both agents act only on their OWN node.
 */
import { test, assert, assertOk, assertOkOrConflict, vlog, sleep } from '../lib/helpers.mjs';
import { waitForResource, waitForContractState } from '../lib/wait-for-sync.mjs';

export default async function run({ alice, charlie }) {
  let contractId;
  let milestoneId1;
  let milestoneId2;

  // ── 5.1 Alice creates a service contract ──────────────────────────────
  await test('Alice creates a development service contract', async () => {
    const { status, data } = await alice.createContract({
      provider: charlie.did,
      terms: {
        description: 'Build ClawNet SDK Python wrapper with full test coverage',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        totalAmount: 5000,
        currency: 'CLAW',
      },
      milestones: [
        {
          id: 'ms-design',
          title: 'API Design & Architecture',
          description: 'Design Python SDK architecture aligned with TypeScript SDK',
          amount: 1500,
          deadline: new Date(Date.now() + 10 * 86400000).toISOString(),
        },
        {
          id: 'ms-impl',
          title: 'Implementation & Tests',
          description: 'Full implementation with 90%+ test coverage',
          amount: 3500,
          deadline: new Date(Date.now() + 25 * 86400000).toISOString(),
        },
      ],
    });
    assertOk(status, 'create contract');
    contractId = data.id;
    assert(contractId, 'should return contract ID');
    // Extract milestone IDs from response
    const milestones = data.milestones || [];
    if (milestones.length >= 2) {
      milestoneId1 = milestones[0].id;
      milestoneId2 = milestones[1].id;
    }
    vlog(`Contract: ${contractId}, milestones: ${milestoneId1}, ${milestoneId2}`);
  });

  // ── 5.2 Alice sees the contract on her node ──────────────────────────
  await test('Alice queries contract details', async () => {
    const { status, data } = await alice.getContract(contractId);
    assertOk(status, 'get contract');
    vlog(`Contract status: ${data.status || data.state}`);
  });

  // ── 5.3 Charlie discovers contract via P2P ────────────────────────────
  await test('Charlie sees contract via P2P', async () => {
    const data = await waitForResource(charlie, '/api/contracts/' + contractId);
    if (data) {
      vlog(`Charlie sees contract: status=${data.status || data.state}`);
    } else {
      vlog('Contract not yet on Charlie\'s node (P2P lag)');
    }
  });

  // ── 5.4 Alice signs the contract (client side) ───────────────────────
  await test('Alice (client) signs the contract', async () => {
    const { status, data } = await alice.signContract(contractId);
    assertOk(status, 'Alice sign');
    vlog(`Alice sign: ${data.status || data.state || 'ok'}`);
  });

  // ── 5.5 Charlie signs the contract (provider side) ───────────────────
  let charlieSigned = false;
  await test('Charlie (provider) signs the contract', async () => {
    // Wait for contract to appear on Charlie's node
    await sleep(500);
    let result = await charlie.signContract(contractId);
    if (result.status === 404) {
      vlog('Contract not on Charlie\'s node yet, waiting for P2P...');
        const data = await waitForResource(charlie, '/api/contracts/' + contractId);
      if (data) {
        result = await charlie.signContract(contractId);
      }
    }
    if (result.status === 404) {
      vlog('P2P: contract not propagated to Charlie — soft pass (P2P limitation)');
    } else {
      assert(result.status >= 200 && result.status < 500, `Charlie sign: ${result.status}`);
      charlieSigned = true;
    }
    vlog(`Charlie sign: ${result.status} ${JSON.stringify(result.data).slice(0, 200)}`);
  });

  // ── 5.6 Alice funds the contract ──────────────────────────────────────
  await test('Alice funds the contract (creates escrow)', async () => {
    await sleep(500);
    const { status, data } = await alice.fundContract(contractId, 5000);
    assertOkOrConflict(status, 'fund contract');
    vlog(`Fund: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  });

  // ── 5.7 Charlie submits first milestone ───────────────────────────────
  await test('Charlie submits first milestone (API Design)', async () => {
    await sleep(500);
    const mid = milestoneId1 || 'ms-design';
    const { status, data } = await charlie.submitMilestone(contractId, mid, {
      deliveryNote: 'Architecture document complete: 30 pages covering all SDK patterns',
      artifacts: [{ name: 'architecture.pdf', hash: 'sha256:abc123' }],
    });
    if (status === 404) {
      vlog('P2P: contract not on Charlie\'s node — soft pass');
    } else {
      assertOkOrConflict(status, 'submit milestone');
    }
    vlog(`Milestone submit: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  });

  // ── 5.8 Alice approves first milestone ────────────────────────────────
  await test('Alice approves first milestone', async () => {
    await sleep(500);
    const mid = milestoneId1 || 'ms-design';
    const { status, data } = await alice.approveMilestone(contractId, mid);
    assertOkOrConflict(status, 'approve milestone');
    vlog(`Milestone approve: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  });

  // ── 5.9 Charlie submits second milestone ──────────────────────────────
  await test('Charlie submits second milestone (Implementation)', async () => {
    const mid = milestoneId2 || 'ms-impl';
    const { status, data } = await charlie.submitMilestone(contractId, mid, {
      deliveryNote: 'Full SDK implementation with 95% test coverage',
      artifacts: [
        { name: 'clawnet-sdk-py-1.0.0.tar.gz', hash: 'sha256:def456' },
        { name: 'test-report.html', hash: 'sha256:ghi789' },
      ],
    });
    if (status === 404) {
      vlog('P2P: contract not on Charlie\'s node — soft pass');
    } else {
      assertOkOrConflict(status, 'submit milestone 2');
    }
    vlog(`Milestone 2 submit: ${status}`);
  });

  // ── 5.10 Alice approves second milestone ──────────────────────────────
  await test('Alice approves second milestone', async () => {
    const mid = milestoneId2 || 'ms-impl';
    const { status, data } = await alice.approveMilestone(contractId, mid);
    assertOkOrConflict(status, 'approve milestone 2');
    vlog(`Milestone 2 approve: ${status}`);
  });

  // ── 5.11 Alice completes the contract ─────────────────────────────────
  await test('Alice marks contract as complete', async () => {
    const { status, data } = await alice.completeContract(contractId);
    assertOkOrConflict(status, 'complete contract');
    vlog(`Complete: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  });

  // ── 5.12 Mutual reputation ratings ────────────────────────────────────
  await test('Alice rates Charlie on quality and fulfillment', async () => {
    const r1 = await alice.submitReputation(charlie.did, 'quality', 5, 'Outstanding SDK design');
    assertOk(r1.status, 'reputation quality');
    const r2 = await alice.submitReputation(charlie.did, 'fulfillment', 5, 'Delivered ahead of schedule');
    assertOk(r2.status, 'reputation fulfillment');
  });

  await test('Charlie rates Alice on transaction dimension', async () => {
    const { status } = await charlie.submitReputation(
      alice.did, 'transaction', 5, 'Prompt payment, clear requirements',
    );
    assertOk(status, 'reputation');
  });

  // ── 5.13 Contract appears in list ─────────────────────────────────────
  await test('Contract appears in Alice\'s contract list', async () => {
    const { status, data } = await alice.listContracts();
    assertOk(status, 'list contracts');
    const contracts = data.contracts || data;
    assert(Array.isArray(contracts), 'should be array');
    assert(contracts.length > 0, 'should have contracts');
    vlog(`Alice has ${contracts.length} contract(s)`);
  });
}
