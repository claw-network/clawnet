import { describe, expect, it } from 'vitest';
import { generateKeypair } from '@clawtoken/core/crypto';
import { addressFromDid, didFromPublicKey } from '@clawtoken/core/identity';
import { verifyEventSignature } from '@clawtoken/core/protocol';
import {
  createWalletEscrowCreateEnvelope,
  createWalletTransferEnvelope,
} from '../src/wallet/events.js';

describe('wallet events', () => {
  it('creates and signs wallet.transfer envelopes', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const did = didFromPublicKey(publicKey);
    const from = addressFromDid(did);
    const { publicKey: receiverKey } = await generateKeypair();
    const receiverDid = didFromPublicKey(receiverKey);
    const to = addressFromDid(receiverDid);

    const envelope = await createWalletTransferEnvelope({
      issuer: did,
      privateKey,
      from,
      to,
      amount: '10',
      fee: '1',
      ts: Date.now(),
      nonce: 1,
    });

    expect(envelope.type).toBe('wallet.transfer');
    expect(await verifyEventSignature(envelope, envelope.sig as string, publicKey)).toBe(true);
  });

  it('rejects invalid transfer amounts', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const did = didFromPublicKey(publicKey);
    const from = addressFromDid(did);
    const { publicKey: receiverKey } = await generateKeypair();
    const receiverDid = didFromPublicKey(receiverKey);
    const to = addressFromDid(receiverDid);

    await expect(
      createWalletTransferEnvelope({
        issuer: did,
        privateKey,
        from,
        to,
        amount: '0',
        fee: '1',
        ts: Date.now(),
        nonce: 2,
      }),
    ).rejects.toThrow('amount must be >= 1');
  });

  it('creates escrow.create envelopes', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    const did = didFromPublicKey(publicKey);
    const depositor = addressFromDid(did);
    const { publicKey: beneficiaryKey } = await generateKeypair();
    const beneficiaryDid = didFromPublicKey(beneficiaryKey);
    const beneficiary = addressFromDid(beneficiaryDid);

    const envelope = await createWalletEscrowCreateEnvelope({
      issuer: did,
      privateKey,
      escrowId: 'escrow-1',
      depositor,
      beneficiary,
      amount: 5,
      releaseRules: [{ id: 'rule-1', type: 'manual' }],
      ts: Date.now(),
      nonce: 3,
    });

    expect(envelope.type).toBe('wallet.escrow.create');
  });
});
