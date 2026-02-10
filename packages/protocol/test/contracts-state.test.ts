import { describe, expect, it } from 'vitest';
import { generateKeypair } from '@clawtoken/core/crypto';
import { didFromPublicKey } from '@clawtoken/core/identity';
import {
  applyContractEvent,
  createContractActivateEnvelope,
  createContractCreateEnvelope,
  createContractDisputeOpenEnvelope,
  createContractDisputeResolveEnvelope,
  createContractMilestoneApproveEnvelope,
  createContractMilestoneSubmitEnvelope,
  createContractSignEnvelope,
  createContractState,
} from '../src/contracts/index.js';

describe('contract state', () => {
  it('applies create, sign, activate, milestone, dispute events', async () => {
    const clientKeys = await generateKeypair();
    const providerKeys = await generateKeypair();
    const clientDid = didFromPublicKey(clientKeys.publicKey);
    const providerDid = didFromPublicKey(providerKeys.publicKey);

    const createEnvelope = await createContractCreateEnvelope({
      issuer: clientDid,
      privateKey: clientKeys.privateKey,
      contractId: 'contract-1',
      parties: {
        client: { did: clientDid },
        provider: { did: providerDid },
      },
      service: {},
      terms: { title: 'Test Contract' },
      payment: { escrowRequired: true },
      timeline: {},
      milestones: [{ id: 'milestone-1' }],
      ts: Date.now(),
      nonce: 1,
      resourcePrev: null,
    });

    let state = createContractState();
    state = applyContractEvent(state, createEnvelope);
    const created = state.contracts['contract-1'];
    expect(created).toBeTruthy();
    expect(created.status).toBe('draft');

    const signClient = await createContractSignEnvelope({
      issuer: clientDid,
      privateKey: clientKeys.privateKey,
      contractId: 'contract-1',
      resourcePrev: createEnvelope.hash as string,
      signer: clientDid,
      ts: Date.now(),
      nonce: 2,
    });

    state = applyContractEvent(state, signClient);
    expect(state.contracts['contract-1'].status).toBe('pending_signature');
    expect(state.contracts['contract-1'].signatures.length).toBe(1);

    const signProvider = await createContractSignEnvelope({
      issuer: providerDid,
      privateKey: providerKeys.privateKey,
      contractId: 'contract-1',
      resourcePrev: signClient.hash as string,
      signer: providerDid,
      ts: Date.now(),
      nonce: 1,
    });

    state = applyContractEvent(state, signProvider);
    expect(state.contracts['contract-1'].status).toBe('pending_funding');
    expect(state.contracts['contract-1'].signatures.length).toBe(2);

    const activateEnvelope = await createContractActivateEnvelope({
      issuer: clientDid,
      privateKey: clientKeys.privateKey,
      contractId: 'contract-1',
      resourcePrev: signProvider.hash as string,
      escrowId: 'escrow-1',
      ts: Date.now(),
      nonce: 3,
    });

    state = applyContractEvent(state, activateEnvelope);
    expect(state.contracts['contract-1'].status).toBe('active');
    expect(state.contracts['contract-1'].escrowId).toBe('escrow-1');

    const milestoneSubmit = await createContractMilestoneSubmitEnvelope({
      issuer: providerDid,
      privateKey: providerKeys.privateKey,
      contractId: 'contract-1',
      resourcePrev: activateEnvelope.hash as string,
      milestoneId: 'milestone-1',
      submissionId: 'submission-1',
      notes: 'done',
      ts: Date.now(),
      nonce: 2,
    });

    state = applyContractEvent(state, milestoneSubmit);
    const milestone = state.contracts['contract-1'].milestones[0];
    expect(milestone.status).toBe('submitted');
    expect(milestone.submissions?.[0]?.submittedBy).toBe(providerDid);

    const milestoneApprove = await createContractMilestoneApproveEnvelope({
      issuer: clientDid,
      privateKey: clientKeys.privateKey,
      contractId: 'contract-1',
      resourcePrev: milestoneSubmit.hash as string,
      milestoneId: 'milestone-1',
      notes: 'ok',
      ts: Date.now(),
      nonce: 4,
    });

    state = applyContractEvent(state, milestoneApprove);
    expect(state.contracts['contract-1'].milestones[0].status).toBe('approved');
    expect(state.contracts['contract-1'].status).toBe('completed');

    const disputeOpen = await createContractDisputeOpenEnvelope({
      issuer: clientDid,
      privateKey: clientKeys.privateKey,
      contractId: 'contract-1',
      resourcePrev: milestoneApprove.hash as string,
      reason: 'issue',
      description: 'mismatch',
      ts: Date.now(),
      nonce: 5,
    });

    state = applyContractEvent(state, disputeOpen);
    expect(state.contracts['contract-1'].status).toBe('disputed');
    expect(state.contracts['contract-1'].dispute?.status).toBe('open');
    expect(state.contracts['contract-1'].dispute?.initiator).toBe(clientDid);

    const disputeResolve = await createContractDisputeResolveEnvelope({
      issuer: providerDid,
      privateKey: providerKeys.privateKey,
      contractId: 'contract-1',
      resourcePrev: disputeOpen.hash as string,
      resolution: 'resolved',
      notes: 'settled',
      ts: Date.now(),
      nonce: 3,
    });

    state = applyContractEvent(state, disputeResolve);
    expect(state.contracts['contract-1'].status).toBe('completed');
    expect(state.contracts['contract-1'].dispute?.status).toBe('resolved');
  });

  it('rejects events with mismatched resourcePrev', async () => {
    const clientKeys = await generateKeypair();
    const providerKeys = await generateKeypair();
    const clientDid = didFromPublicKey(clientKeys.publicKey);
    const providerDid = didFromPublicKey(providerKeys.publicKey);

    const createEnvelope = await createContractCreateEnvelope({
      issuer: clientDid,
      privateKey: clientKeys.privateKey,
      contractId: 'contract-2',
      parties: {
        client: { did: clientDid },
        provider: { did: providerDid },
      },
      service: {},
      terms: { title: 'Test Contract' },
      payment: { escrowRequired: false },
      timeline: {},
      ts: Date.now(),
      nonce: 1,
      resourcePrev: null,
    });

    let state = createContractState();
    state = applyContractEvent(state, createEnvelope);

    const signEnvelope = await createContractSignEnvelope({
      issuer: clientDid,
      privateKey: clientKeys.privateKey,
      contractId: 'contract-2',
      resourcePrev: 'bad-prev',
      signer: clientDid,
      ts: Date.now(),
      nonce: 2,
    });

    expect(() => applyContractEvent(state, signEnvelope)).toThrow('resourcePrev does not match');
  });
});
