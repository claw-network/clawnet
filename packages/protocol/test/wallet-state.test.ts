import { describe, expect, it } from 'vitest';
import { generateKeypair } from '@claw-network/core/crypto';
import { addressFromDid, didFromPublicKey } from '@claw-network/core/identity';
import {
  createWalletEscrowCreateEnvelope,
  createWalletEscrowFundEnvelope,
  createWalletEscrowReleaseEnvelope,
  createWalletTransferEnvelope,
} from '../src/wallet/events.js';
import { applyWalletEvent, createWalletState, getWalletBalance } from '../src/wallet/state.js';

describe('wallet state', () => {
  it('applies transfer events', async () => {
    const sender = await generateKeypair();
    const receiver = await generateKeypair();
    const senderDid = didFromPublicKey(sender.publicKey);
    const receiverDid = didFromPublicKey(receiver.publicKey);
    const from = addressFromDid(senderDid);
    const to = addressFromDid(receiverDid);

    let state = createWalletState();
    state.balances[from] = {
      available: '20',
      pending: '0',
      locked: { escrow: '0', governance: '0' },
    };

    const envelope = await createWalletTransferEnvelope({
      issuer: senderDid,
      privateKey: sender.privateKey,
      from,
      to,
      amount: '10',
      fee: '1',
      ts: Date.now(),
      nonce: 1,
    });

    state = applyWalletEvent(state, envelope);
    expect(getWalletBalance(state, from).available).toBe('9');
    expect(getWalletBalance(state, to).available).toBe('10');
  });

  it('applies escrow fund and release', async () => {
    const depositorKeys = await generateKeypair();
    const beneficiaryKeys = await generateKeypair();
    const depositorDid = didFromPublicKey(depositorKeys.publicKey);
    const beneficiaryDid = didFromPublicKey(beneficiaryKeys.publicKey);
    const depositor = addressFromDid(depositorDid);
    const beneficiary = addressFromDid(beneficiaryDid);

    let state = createWalletState();
    state.balances[depositor] = {
      available: '20',
      pending: '0',
      locked: { escrow: '0', governance: '0' },
    };

    const escrowCreate = await createWalletEscrowCreateEnvelope({
      issuer: depositorDid,
      privateKey: depositorKeys.privateKey,
      escrowId: 'escrow-1',
      depositor,
      beneficiary,
      amount: '10',
      releaseRules: [{ id: 'rule-1' }],
      ts: Date.now(),
      nonce: 1,
    });
    state = applyWalletEvent(state, escrowCreate);

    const escrowFund = await createWalletEscrowFundEnvelope({
      issuer: depositorDid,
      privateKey: depositorKeys.privateKey,
      escrowId: 'escrow-1',
      resourcePrev: escrowCreate.hash as string,
      amount: '10',
      ts: Date.now(),
      nonce: 2,
    });
    state = applyWalletEvent(state, escrowFund);
    expect(getWalletBalance(state, depositor).available).toBe('10');
    expect(getWalletBalance(state, depositor).locked.escrow).toBe('10');

    const escrowRelease = await createWalletEscrowReleaseEnvelope({
      issuer: depositorDid,
      privateKey: depositorKeys.privateKey,
      escrowId: 'escrow-1',
      resourcePrev: escrowFund.hash as string,
      amount: '10',
      ruleId: 'rule-1',
      ts: Date.now(),
      nonce: 3,
    });
    state = applyWalletEvent(state, escrowRelease);
    expect(getWalletBalance(state, depositor).locked.escrow).toBe('0');
    expect(getWalletBalance(state, beneficiary).available).toBe('10');
  });
});
