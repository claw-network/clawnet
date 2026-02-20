import { describe, expect, it } from 'vitest';
import { generateKeypair } from '@claw-network/core/crypto';
import { didFromPublicKey } from '@claw-network/core/identity';
import {
  // Voting
  tokenVotingPower,
  reputationMultiplier,
  lockupMultiplier,
  calculateVotingPower,
  calculateEffectiveVotingPower,
  delegationMatchesScope,
  hasCircularDelegation,
  // Events
  createDaoProposalCreateEnvelope,
  createDaoProposalAdvanceEnvelope,
  createDaoVoteCastEnvelope,
  createDaoDelegateSetEnvelope,
  createDaoDelegateRevokeEnvelope,
  createDaoTimelockQueueEnvelope,
  createDaoTimelockExecuteEnvelope,
  createDaoTimelockCancelEnvelope,
  createDaoTreasuryDepositEnvelope,
  createDaoTreasurySpendEnvelope,
  // State
  createDaoState,
  applyDaoEvent,
  getProposal,
  listProposals,
  getProposalVotes,
  getDelegationsFrom,
  getDelegationsTo,
  getTimelockEntry,
  listTimelockEntries,
  getTreasury,
  checkProposalResult,
  // Store
  MemoryDaoStore,
  // Types
  PROPOSAL_THRESHOLDS,
  type Delegation,
} from '../src/dao/index.js';

// ───── Voting Power Calculation ─────────────────────────────────────

describe('dao voting power', () => {
  it('tokenVotingPower returns sqrt of balance', () => {
    expect(tokenVotingPower('0')).toBe(0);
    expect(tokenVotingPower('100')).toBe(10);
    expect(tokenVotingPower('10000')).toBe(100);
    expect(tokenVotingPower('1000000')).toBe(1000);
  });

  it('reputationMultiplier scales linearly from 1.0 to 2.0', () => {
    expect(reputationMultiplier(0)).toBe(1.0);
    expect(reputationMultiplier(500)).toBe(1.5);
    expect(reputationMultiplier(1000)).toBe(2.0);
    // clamped
    expect(reputationMultiplier(-10)).toBe(1.0);
    expect(reputationMultiplier(2000)).toBe(2.0);
  });

  it('lockupMultiplier scales linearly from 1.0 to 3.0', () => {
    expect(lockupMultiplier(0)).toBe(1.0);
    expect(lockupMultiplier(-1)).toBe(1.0);
    const twoYearsMs = 2 * 365.25 * 24 * 60 * 60 * 1000;
    expect(lockupMultiplier(twoYearsMs)).toBe(2.0);
    const fourYearsMs = 4 * 365.25 * 24 * 60 * 60 * 1000;
    expect(lockupMultiplier(fourYearsMs)).toBe(3.0);
    // beyond 4 years is clamped
    expect(lockupMultiplier(fourYearsMs * 2)).toBe(3.0);
  });

  it('calculateVotingPower computes full formula', () => {
    const result = calculateVotingPower({
      tokenBalance: '10000',
      lockedTokens: '0',
      lockupDurationMs: 0,
      reputationScore: 0,
      delegatedPower: 0,
    });
    // sqrt(10000) * 1.0 + 0 = 100
    expect(result.tokenPower).toBe(100);
    expect(result.totalPower).toBe(100);
  });

  it('calculateVotingPower includes reputation and lockup', () => {
    const twoYearsMs = 2 * 365.25 * 24 * 60 * 60 * 1000;
    const result = calculateVotingPower({
      tokenBalance: '10000',
      lockedTokens: '10000',
      lockupDurationMs: twoYearsMs,
      reputationScore: 500,
      delegatedPower: 50,
    });
    // tokenPower = sqrt(10000) = 100
    // lockedPower = sqrt(10000) = 100
    // lockupMul = 2.0
    // repMul = 1.5
    // base = (100 + 100 * (2.0 - 1)) * 1.5 = (100 + 100) * 1.5 = 300
    // total = 300 + 50 = 350
    expect(result.tokenPower).toBe(100);
    expect(result.lockupMultiplier).toBe(2.0);
    expect(result.reputationMultiplier).toBe(1.5);
    expect(result.delegatedPower).toBe(50);
    expect(result.totalPower).toBe(350);
  });
});

describe('delegation matching', () => {
  const baseDelegation: Delegation = {
    delegator: 'did:claw:a',
    delegate: 'did:claw:b',
    scope: { all: true },
    percentage: 100,
    createdAt: 1000,
  };

  it('matches when scope.all is true', () => {
    expect(delegationMatchesScope(baseDelegation, 'parameter_change')).toBe(true);
  });

  it('does not match revoked delegations', () => {
    const revoked = { ...baseDelegation, revokedAt: 2000 };
    expect(delegationMatchesScope(revoked, 'parameter_change')).toBe(false);
  });

  it('matches when proposalTypes includes the type', () => {
    const scoped: Delegation = {
      ...baseDelegation,
      scope: { proposalTypes: ['treasury_spend', 'signal'] },
    };
    expect(delegationMatchesScope(scoped, 'treasury_spend')).toBe(true);
    expect(delegationMatchesScope(scoped, 'protocol_upgrade')).toBe(false);
  });

  it('does not match expired delegations', () => {
    const expired: Delegation = {
      ...baseDelegation,
      expiresAt: 1, // in the past
    };
    expect(delegationMatchesScope(expired, 'parameter_change')).toBe(false);
  });
});

describe('calculateEffectiveVotingPower', () => {
  it('reduces power by outgoing delegations', () => {
    const d: Delegation = {
      delegator: 'a',
      delegate: 'b',
      scope: { all: true },
      percentage: 50,
      createdAt: 1000,
    };
    const effective = calculateEffectiveVotingPower({
      ownPower: 100,
      outgoingDelegations: [d],
      incomingDelegations: [],
      proposalType: 'signal',
    });
    expect(effective).toBe(50);
  });

  it('increases power by incoming delegations', () => {
    const d: Delegation = {
      delegator: 'b',
      delegate: 'a',
      scope: { all: true },
      percentage: 50,
      createdAt: 1000,
    };
    const effective = calculateEffectiveVotingPower({
      ownPower: 100,
      outgoingDelegations: [],
      incomingDelegations: [{ delegation: d, delegatorPower: 200 }],
      proposalType: 'signal',
    });
    // 100 + 200 * 50% = 200
    expect(effective).toBe(200);
  });
});

describe('hasCircularDelegation', () => {
  it('detects A→B→A cycle', () => {
    const delegations: Delegation[] = [
      {
        delegator: 'B',
        delegate: 'A',
        scope: { all: true },
        percentage: 100,
        createdAt: 1000,
      },
    ];
    expect(hasCircularDelegation('A', 'B', delegations)).toBe(true);
  });

  it('returns false when no cycle', () => {
    const delegations: Delegation[] = [
      {
        delegator: 'B',
        delegate: 'C',
        scope: { all: true },
        percentage: 100,
        createdAt: 1000,
      },
    ];
    expect(hasCircularDelegation('A', 'B', delegations)).toBe(false);
  });
});

// ───── Event Creation ───────────────────────────────────────────────

describe('dao event creation', () => {
  it('creates proposal create envelope', async () => {
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);

    const envelope = await createDaoProposalCreateEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      proposalId: 'prop-1',
      proposalType: 'signal',
      title: 'Test Proposal',
      description: 'A test proposal',
      actions: [{ type: 'parameter_change', target: 'fee', currentValue: 1, newValue: 2 }],
      discussionPeriod: 0,
      votingPeriod: 86400000,
      timelockDelay: 0,
      ts: 1000,
      nonce: 1,
    });

    expect(envelope.type).toBe('dao.proposal.create');
    expect(envelope.issuer).toBe(did);
    expect(envelope.sig).toBeTruthy();
    expect(envelope.hash).toBeTruthy();
    expect((envelope.payload as Record<string, unknown>).proposalId).toBe('prop-1');
  });

  it('creates vote cast envelope', async () => {
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);

    const envelope = await createDaoVoteCastEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      proposalId: 'prop-1',
      option: 'for',
      power: '100',
      ts: 2000,
      nonce: 1,
    });

    expect(envelope.type).toBe('dao.vote.cast');
    expect((envelope.payload as Record<string, unknown>).option).toBe('for');
    expect((envelope.payload as Record<string, unknown>).power).toBe('100');
  });

  it('creates delegation set envelope', async () => {
    const issuerKeys = await generateKeypair();
    const delegateKeys = await generateKeypair();
    const issuer = didFromPublicKey(issuerKeys.publicKey);
    const delegate = didFromPublicKey(delegateKeys.publicKey);

    const envelope = await createDaoDelegateSetEnvelope({
      issuer,
      privateKey: issuerKeys.privateKey,
      delegate,
      scope: { all: true },
      percentage: 50,
      ts: 1000,
      nonce: 1,
    });

    expect(envelope.type).toBe('dao.delegate.set');
    expect((envelope.payload as Record<string, unknown>).delegate).toBe(delegate);
    expect((envelope.payload as Record<string, unknown>).percentage).toBe(50);
  });

  it('creates treasury deposit envelope', async () => {
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);

    const envelope = await createDaoTreasuryDepositEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      amount: '1000',
      source: 'fee_collection',
      ts: 1000,
      nonce: 1,
    });

    expect(envelope.type).toBe('dao.treasury.deposit');
    expect((envelope.payload as Record<string, unknown>).amount).toBe('1000');
  });
});

// ───── State Reducer ────────────────────────────────────────────────

describe('dao state reducer', () => {
  it('creates proposal and tracks it in state', async () => {
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);

    const env = await createDaoProposalCreateEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      proposalId: 'prop-1',
      proposalType: 'signal',
      title: 'Test',
      description: 'A test',
      actions: [{ type: 'parameter_change', target: 'fee', currentValue: 1, newValue: 2 }],
      discussionPeriod: 1000,
      votingPeriod: 5000,
      timelockDelay: 0,
      ts: 1000,
      nonce: 1,
    });

    let state = createDaoState();
    state = applyDaoEvent(state, env);

    const proposal = getProposal(state, 'prop-1');
    expect(proposal).toBeDefined();
    expect(proposal!.title).toBe('Test');
    // discussionPeriod=1000 > 0, so auto-transitions to 'discussion'
    expect(proposal!.status).toBe('discussion');
    expect(proposal!.proposer).toBe(did);

    const proposals = listProposals(state);
    expect(proposals.length).toBe(1);
  });

  it('advances proposal status', async () => {
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);

    const createEnv = await createDaoProposalCreateEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      proposalId: 'prop-1',
      proposalType: 'signal',
      title: 'Test',
      description: 'A test',
      actions: [{ type: 'parameter_change', target: 'fee', currentValue: 1, newValue: 2 }],
      discussionPeriod: 1000,
      votingPeriod: 5000,
      timelockDelay: 0,
      ts: 1000,
      nonce: 1,
    });

    let state = createDaoState();
    state = applyDaoEvent(state, createEnv);

    // discussionPeriod=1000 > 0, auto-transitions to 'discussion', advance to voting
    const advanceEnv = await createDaoProposalAdvanceEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      proposalId: 'prop-1',
      newStatus: 'voting',
      resourcePrev: createEnv.hash,
      ts: 2000,
      nonce: 2,
    });
    state = applyDaoEvent(state, advanceEnv);

    const proposal = getProposal(state, 'prop-1');
    expect(proposal!.status).toBe('voting');
  });

  it('records votes and tallies them', async () => {
    const proposerKeys = await generateKeypair();
    const voterKeys = await generateKeypair();
    const proposer = didFromPublicKey(proposerKeys.publicKey);
    const voter = didFromPublicKey(voterKeys.publicKey);

    const createEnv = await createDaoProposalCreateEnvelope({
      issuer: proposer,
      privateKey: proposerKeys.privateKey,
      proposalId: 'prop-1',
      proposalType: 'signal',
      title: 'Test',
      description: 'Test',
      actions: [{ type: 'parameter_change', target: 'fee', currentValue: 1, newValue: 2 }],
      discussionPeriod: 1000,
      votingPeriod: 86400000,
      timelockDelay: 0,
      ts: 1000,
      nonce: 1,
    });

    let state = createDaoState();
    state = applyDaoEvent(state, createEnv);

    // Auto-transitioned to 'discussion'; advance to 'voting'
    const advVot = await createDaoProposalAdvanceEnvelope({
      issuer: proposer,
      privateKey: proposerKeys.privateKey,
      proposalId: 'prop-1',
      newStatus: 'voting',
      resourcePrev: createEnv.hash,
      ts: 3000,
      nonce: 2,
    });
    state = applyDaoEvent(state, advVot);

    const voteEnv = await createDaoVoteCastEnvelope({
      issuer: voter,
      privateKey: voterKeys.privateKey,
      proposalId: 'prop-1',
      option: 'for',
      power: '500',
      reason: 'good idea',
      ts: 4000,
      nonce: 1,
    });
    state = applyDaoEvent(state, voteEnv);

    const votes = getProposalVotes(state, 'prop-1');
    expect(votes.length).toBe(1);
    expect(votes[0].option).toBe('for');
    expect(votes[0].power).toBe('500');

    const proposal = getProposal(state, 'prop-1');
    expect(proposal!.votes.for).toBe('500');
    expect(proposal!.votes.against).toBe('0');
  });

  it('handles delegation set and revoke', async () => {
    const delegatorKeys = await generateKeypair();
    const delegateKeys = await generateKeypair();
    const delegator = didFromPublicKey(delegatorKeys.publicKey);
    const delegate = didFromPublicKey(delegateKeys.publicKey);

    const setEnv = await createDaoDelegateSetEnvelope({
      issuer: delegator,
      privateKey: delegatorKeys.privateKey,
      delegate,
      scope: { all: true },
      percentage: 50,
      ts: 1000,
      nonce: 1,
    });

    let state = createDaoState();
    state = applyDaoEvent(state, setEnv);

    let from = getDelegationsFrom(state, delegator);
    expect(from.length).toBe(1);
    expect(from[0].percentage).toBe(50);

    let to = getDelegationsTo(state, delegate);
    expect(to.length).toBe(1);

    // Revoke
    const revokeEnv = await createDaoDelegateRevokeEnvelope({
      issuer: delegator,
      privateKey: delegatorKeys.privateKey,
      delegate,
      ts: 2000,
      nonce: 2,
    });
    state = applyDaoEvent(state, revokeEnv);

    // getDelegationsFrom filters out revoked delegations
    from = getDelegationsFrom(state, delegator);
    expect(from.length).toBe(0);
  });

  it('handles treasury deposit', async () => {
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);

    const deposit = await createDaoTreasuryDepositEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      amount: '5000',
      source: 'fee_collection',
      ts: 1000,
      nonce: 1,
    });

    let state = createDaoState();
    state = applyDaoEvent(state, deposit);

    const treasury = getTreasury(state);
    expect(treasury.balance).toBe('5000');
  });

  it('handles treasury spend', async () => {
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);
    const recipientKeys = await generateKeypair();
    const recipient = didFromPublicKey(recipientKeys.publicKey);

    const deposit = await createDaoTreasuryDepositEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      amount: '10000',
      source: 'fee_collection',
      ts: 1000,
      nonce: 1,
    });

    let state = createDaoState();
    state = applyDaoEvent(state, deposit);

    const spend = await createDaoTreasurySpendEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      proposalId: 'prop-1',
      recipient,
      amount: '3000',
      purpose: 'development grant',
      ts: 2000,
      nonce: 2,
    });
    state = applyDaoEvent(state, spend);

    const treasury = getTreasury(state);
    expect(treasury.balance).toBe('7000');
    expect(treasury.totalSpent).toBe('3000');
  });

  it('handles timelock queue, execute, cancel', async () => {
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);

    const queueEnv = await createDaoTimelockQueueEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      actionId: 'act-1',
      proposalId: 'prop-1',
      action: { type: 'parameter_change', target: 'fee', currentValue: 1, newValue: 2 },
      executeAfter: 10000,
      ts: 1000,
      nonce: 1,
    });

    let state = createDaoState();
    state = applyDaoEvent(state, queueEnv);

    let entry = getTimelockEntry(state, 'act-1');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('queued');

    const entries = listTimelockEntries(state);
    expect(entries.length).toBe(1);

    // Execute
    const execEnv = await createDaoTimelockExecuteEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      actionId: 'act-1',
      ts: 11000,
      nonce: 2,
    });
    state = applyDaoEvent(state, execEnv);

    entry = getTimelockEntry(state, 'act-1');
    expect(entry!.status).toBe('executed');

    // Queue another and cancel
    const queueEnv2 = await createDaoTimelockQueueEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      actionId: 'act-2',
      proposalId: 'prop-2',
      action: { type: 'parameter_change', target: 'fee', currentValue: 2, newValue: 3 },
      executeAfter: 20000,
      ts: 12000,
      nonce: 3,
    });
    state = applyDaoEvent(state, queueEnv2);

    const cancelEnv = await createDaoTimelockCancelEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      actionId: 'act-2',
      reason: 'changed mind',
      ts: 13000,
      nonce: 4,
    });
    state = applyDaoEvent(state, cancelEnv);

    const entry2 = getTimelockEntry(state, 'act-2');
    expect(entry2!.status).toBe('cancelled');
  });
});

// ───── MemoryDaoStore ───────────────────────────────────────────────

describe('MemoryDaoStore', () => {
  it('wraps state with async interface', async () => {
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);

    const store = new MemoryDaoStore();

    const createEnv = await createDaoProposalCreateEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      proposalId: 'prop-1',
      proposalType: 'treasury_spend',
      title: 'Fund Project',
      description: 'Fund an ecosystem project',
      actions: [{ type: 'treasury_spend', recipient: did, amount: '1000', token: 'CLAW', purpose: 'dev' }],
      discussionPeriod: 86400000,
      votingPeriod: 259200000,
      timelockDelay: 86400000,
      ts: 1000,
      nonce: 1,
    });

    await store.applyEvent(createEnv);

    const proposal = await store.getProposal('prop-1');
    expect(proposal).toBeDefined();
    expect(proposal!.type).toBe('treasury_spend');

    const proposals = await store.listProposals();
    expect(proposals.length).toBe(1);

    const treasury = await store.getTreasury();
    expect(treasury.balance).toBe('0');
  });

  it('applyEvents handles batch', async () => {
    const keys = await generateKeypair();
    const did = didFromPublicKey(keys.publicKey);

    const store = new MemoryDaoStore();

    const deposit1 = await createDaoTreasuryDepositEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      amount: '1000',
      source: 'fees',
      ts: 1000,
      nonce: 1,
    });
    const deposit2 = await createDaoTreasuryDepositEnvelope({
      issuer: did,
      privateKey: keys.privateKey,
      amount: '2000',
      source: 'fees',
      ts: 2000,
      nonce: 2,
    });

    await store.applyEvents([deposit1, deposit2]);

    const treasury = await store.getTreasury();
    expect(treasury.balance).toBe('3000');
  });
});

// ───── Thresholds ───────────────────────────────────────────────────

describe('PROPOSAL_THRESHOLDS', () => {
  it('has all 5 proposal types', () => {
    expect(Object.keys(PROPOSAL_THRESHOLDS)).toEqual(
      expect.arrayContaining([
        'parameter_change',
        'treasury_spend',
        'protocol_upgrade',
        'emergency',
        'signal',
      ]),
    );
  });

  it('protocol_upgrade has strictest thresholds', () => {
    const pu = PROPOSAL_THRESHOLDS.protocol_upgrade;
    const pc = PROPOSAL_THRESHOLDS.parameter_change;
    expect(pu.passThreshold).toBeGreaterThan(pc.passThreshold);
    expect(pu.quorum).toBeGreaterThan(pc.quorum);
    expect(pu.createThreshold).toBeGreaterThan(pc.createThreshold);
  });

  it('emergency has zero thresholds', () => {
    const em = PROPOSAL_THRESHOLDS.emergency;
    expect(em.createThreshold).toBe(0);
    expect(em.passThreshold).toBe(0);
    expect(em.quorum).toBe(0);
  });
});
