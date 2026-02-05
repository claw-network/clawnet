import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { ApiServer } from '../src/api/server.js';
import {
  createKeyRecord,
  EventStore,
  MemoryStore,
  resolveStoragePaths,
  saveKeyRecord,
} from '@clawtoken/core';
import { generateKeypair } from '@clawtoken/core/crypto';
import { addressFromDid, didFromPublicKey } from '@clawtoken/core/identity';

describe('wallet api', () => {
  let api: ApiServer;
  let baseUrl: string;
  let tempDir: string;
  let did: string;
  let passphrase: string;
  let published: Record<string, unknown>[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawtoken-wallet-api-'));
    passphrase = 'test-passphrase-123';
    const { publicKey, privateKey } = await generateKeypair();
    did = didFromPublicKey(publicKey);
    const record = createKeyRecord(publicKey, privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    const paths = resolveStoragePaths(tempDir);
    await saveKeyRecord(paths, record);

    published = [];
    const eventStore = new EventStore(new MemoryStore());
    api = new ApiServer(
      { host: '127.0.0.1', port: 0, dataDir: tempDir },
      {
        publishEvent: async (envelope) => {
          published.push(envelope);
          return `hash-${published.length}`;
        },
        eventStore,
      },
    );
    await api.start();
    const address = (api as unknown as { server: { address: () => AddressInfo } }).server.address();
    baseUrl = `http://${address.address}:${address.port}`;
  });

  afterEach(async () => {
    await api.stop();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns zero balance when no events', async () => {
    const res = await fetch(`${baseUrl}/api/wallet/balance?did=${encodeURIComponent(did)}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { balance: number };
    expect(json.balance).toBe(0);
  });

  it('publishes wallet.transfer events', async () => {
    const receiver = await generateKeypair();
    const receiverDid = didFromPublicKey(receiver.publicKey);
    const to = addressFromDid(receiverDid);

    const res = await fetch(`${baseUrl}/api/wallet/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did,
        passphrase,
        to,
        amount: 1,
        fee: 1,
        nonce: 1,
      }),
    });
    expect(res.status).toBe(200);
    expect(published[0]?.type).toBe('wallet.transfer');
  });

  it('publishes escrow create and fund events', async () => {
    const receiver = await generateKeypair();
    const receiverDid = didFromPublicKey(receiver.publicKey);
    const beneficiary = addressFromDid(receiverDid);

    const createRes = await fetch(`${baseUrl}/api/wallet/escrow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did,
        passphrase,
        beneficiary,
        amount: 2,
        releaseRules: [{ id: 'rule-1' }],
        escrowId: 'escrow-1',
        nonce: 2,
        autoFund: false,
      }),
    });
    expect(createRes.status).toBe(201);
    expect(published[0]?.type).toBe('wallet.escrow.create');

    const prev = published[0]?.hash as string;
    const fundRes = await fetch(`${baseUrl}/api/wallet/escrow/escrow-1/fund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did,
        passphrase,
        amount: 2,
        resourcePrev: prev,
        nonce: 3,
      }),
    });
    expect(fundRes.status).toBe(200);
    expect(published[1]?.type).toBe('wallet.escrow.fund');
  });

  it('rejects escrow fund requests with invalid payloads', async () => {
    const missingRes = await fetch(`${baseUrl}/api/wallet/escrow/escrow-1/fund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ did, passphrase }),
    });
    expect(missingRes.status).toBe(400);
    expect((await missingRes.json()).error).toBe('missing_required_fields');
    expect(published.length).toBe(0);

    const invalidNonceRes = await fetch(`${baseUrl}/api/wallet/escrow/escrow-1/fund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did,
        passphrase,
        amount: 1,
        resourcePrev: 'hash-1',
        nonce: 0,
      }),
    });
    expect(invalidNonceRes.status).toBe(400);
    expect((await invalidNonceRes.json()).error).toBe('invalid_nonce');
    expect(published.length).toBe(0);

    const invalidAmountRes = await fetch(`${baseUrl}/api/wallet/escrow/escrow-1/fund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did,
        passphrase,
        amount: 0,
        resourcePrev: 'hash-1',
        nonce: 1,
      }),
    });
    expect(invalidAmountRes.status).toBe(400);
    expect((await invalidAmountRes.json()).error).toBe('amount must be >= 1');
    expect(published.length).toBe(0);

    const unknownKey = await generateKeypair();
    const unknownDid = didFromPublicKey(unknownKey.publicKey);
    const unknownKeyRes = await fetch(`${baseUrl}/api/wallet/escrow/escrow-1/fund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: unknownDid,
        passphrase,
        amount: 1,
        resourcePrev: 'hash-1',
        nonce: 1,
      }),
    });
    expect(unknownKeyRes.status).toBe(400);
    expect((await unknownKeyRes.json()).error).toBe('key_unavailable');
    expect(published.length).toBe(0);
  });

  it('publishes escrow release and refund events', async () => {
    const releaseRes = await fetch(`${baseUrl}/api/wallet/escrow/escrow-1/release`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did,
        passphrase,
        amount: 1,
        resourcePrev: 'hash-1',
        ruleId: 'rule-1',
        nonce: 4,
      }),
    });
    expect(releaseRes.status).toBe(200);
    expect(published[0]?.type).toBe('wallet.escrow.release');

    const refundRes = await fetch(`${baseUrl}/api/wallet/escrow/escrow-1/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did,
        passphrase,
        amount: 1,
        resourcePrev: 'hash-2',
        reason: 'cancelled',
        nonce: 5,
      }),
    });
    expect(refundRes.status).toBe(200);
    expect(published[1]?.type).toBe('wallet.escrow.refund');
  });
});
