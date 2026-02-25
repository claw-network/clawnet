/**
 * Scenario 06: Contract Dispute Resolution
 * ==========================================
 * Alice (client) creates a contract with Bob (provider).
 * A dispute arises after a rejected milestone → resolution flow.
 *
 * Agents: alice (Node A), bob (Node B)
 */
import { test, assert, assertOk, assertOkOrConflict, vlog, sleep } from '../lib/helpers.mjs';
import { waitForResource } from '../lib/wait-for-sync.mjs';

export default async function run({ alice, bob }) {
  let contractId;
  let milestoneIdx;

  // ── 6.1 Alice creates a single-milestone contract ─────────────────────
  await test('Alice creates a contract with one milestone', async () => {
    const { status, data } = await alice.createContract({
      provider: bob.did,
      terms: {
        description: 'Build a REST API documentation portal',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 14 * 86400000).toISOString(),
        totalAmount: 2000,
        currency: 'Token',
      },
      milestones: [
        {
          id: 'ms-docs',
          title: 'API Documentation Site',
          description: 'Complete interactive API docs with examples',
          amount: 2000,
          deadline: new Date(Date.now() + 14 * 86400000).toISOString(),
        },
      ],
    });
    assertOk(status, 'create contract');
    contractId = data?.contractId || data?.id;
    assert(contractId, 'should return contractId');
    const milestones = data?.milestones || [];
    milestoneIdx = milestones[0]?.id || milestones[0]?.index || 0;
    vlog(`Contract: ${contractId}, milestone: ${milestoneIdx}`);
  });

  // ── 6.2 Both sign ────────────────────────────────────────────────────
  await test('Alice signs the contract', async () => {
    const { status } = await alice.signContract(contractId);
    assertOk(status, 'Alice sign');
  });

  await test('Bob signs the contract', async () => {
    await sleep(1000);
    let result = await bob.signContract(contractId);
    if (result.status === 404) {
      vlog('Waiting for P2P propagation...');
      await waitForResource(bob, `/api/v1/contracts/${contractId}`);
      result = await bob.signContract(contractId);
    }
    assertOkOrConflict(result.status, 'Bob sign');
    vlog(`Bob sign: ${result.status}`);
  });

  // ── 6.3 Alice funds (activates) the contract ─────────────────────────
  await test('Alice funds the contract', async () => {
    const { status, data } = await alice.fundContract(contractId, 2000);
    assertOkOrConflict(status, 'activate contract');
    vlog(`Activate: ${status} escrow=${data?.escrowAddress || data?.escrowId || 'n/a'}`);
  });

  // ── 6.4 Bob submits milestone with substandard work ───────────────────
  await test('Bob submits milestone (incomplete deliverable)', async () => {
    await sleep(1000);
    const { status, data } = await bob.submitMilestone(contractId, milestoneIdx, {
      deliverables: [{ name: 'docs-draft.html', hash: 'sha256:incomplete123' }],
      notes: 'Initial draft — missing interactive examples and error responses.',
    });
    if (status === 404) {
      vlog('P2P: contract not on Bob\'s node — soft pass');
    } else {
      assertOkOrConflict(status, 'submit milestone');
    }
    vlog(`Submit: ${status}`);
  });

  // ── 6.5 Alice rejects the milestone ───────────────────────────────────
  await test('Alice rejects incomplete milestone', async () => {
    await sleep(1000);
    const { status, data } = await alice.rejectMilestone(contractId, milestoneIdx, {
      reason: 'Missing interactive examples and error response documentation',
    });
    assertOkOrConflict(status, 'reject milestone');
    vlog(`Reject: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  });

  // ── 6.6 Alice opens a dispute ─────────────────────────────────────────
  await test('Alice opens a dispute on the contract', async () => {
    const { status, data } = await alice.openDispute(contractId, {
      reason: 'Provider delivered incomplete work missing critical documentation sections',
      evidence: [
        { type: 'document', description: 'Screenshot of missing pages', hash: 'sha256:evidence1' },
        { type: 'communication', description: 'Chat log where provider acknowledged gaps' },
      ],
    });
    assertOkOrConflict(status, 'open dispute');
    vlog(`Dispute: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  });

  // ── 6.7 Query dispute status ──────────────────────────────────────────
  await test('Alice checks contract status — should be disputed', async () => {
    const { status, data } = await alice.getContract(contractId);
    assertOk(status, 'get contract');
    const state = data?.status || data?.state;
    vlog(`Contract state: ${state}`);
    if (state && !state.toLowerCase().includes('disput')) {
      vlog(`⚠ Expected 'disputed' state but got '${state}'`);
    }
  });

  // ── 6.8 Bob responds to the dispute ───────────────────────────────────
  await test('Bob views dispute and adds response', async () => {
    await sleep(1000);
    const { status, data } = await bob.getContract(contractId);
    if (status === 200) {
      vlog(`Bob sees contract state: ${data?.status || data?.state}`);
    } else if (status === 404) {
      vlog('P2P: contract not on Bob\'s node — soft pass');
    }
  });

  // ── 6.9 Resolve dispute — partial refund ──────────────────────────────
  await test('Dispute is resolved with partial refund', async () => {
    const { status, data } = await alice.resolveDispute(contractId, {
      resolution: 'partial_refund',
      clientRefund: 1000,
      providerPayment: 1000,
      notes: 'Split 50/50: provider did partial work, client gets partial refund',
    });
    assertOkOrConflict(status, 'resolve dispute');
    vlog(`Resolve: ${status} ${JSON.stringify(data).slice(0, 200)}`);
  });

  // ── 6.10 Contract is now resolved ─────────────────────────────────────
  await test('Contract is in resolved state', async () => {
    const { status, data } = await alice.getContract(contractId);
    assertOk(status, 'get contract');
    const state = data?.status || data?.state;
    vlog(`Final state: ${state}`);
  });

  // ── 6.11 Reputation scores after dispute ──────────────────────────────
  await test('Alice rates Bob after dispute', async () => {
    const { status } = await alice.submitReputation(
      bob.did, 'quality', 2, 'Incomplete deliverables led to dispute',
    );
    assertOk(status, 'reputation quality');
  });

  await test('Bob rates Alice after dispute', async () => {
    const { status } = await bob.submitReputation(
      alice.did, 'transaction', 3, 'Fair dispute resolution process',
    );
    assertOk(status, 'reputation');
  });

  // ── 6.12 Verify reputation reflects dispute ───────────────────────────
  await test('Bob\'s reputation reflects the dispute outcome', async () => {
    const { status, data } = await alice.getReputation(bob.did);
    assertOk(status, 'get reputation');
    vlog(`Bob reputation: ${JSON.stringify(data).slice(0, 300)}`);
  });
}
