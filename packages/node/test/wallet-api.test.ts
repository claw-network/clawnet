import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { ApiServer } from '../src/api/server.js';
import {
  canonicalizeBytes,
  createKeyRecord,
  EventEnvelope,
  eventHashHex,
  EventStore,
  MemoryStore,
  resolveStoragePaths,
  saveKeyRecord,
} from '@clawnet/core';
import { generateKeypair } from '@clawnet/core/crypto';
import { addressFromDid, didFromPublicKey } from '@clawnet/core/identity';

describe('wallet api', () => {
  let api: ApiServer;
  let baseUrl: string;
  let tempDir: string;
  let did: string;
  let passphrase: string;
  let published: Record<string, unknown>[];
  let eventStore: EventStore;

  const appendEnvelope = async (envelope: EventEnvelope): Promise<string> => {
    const hash =
      typeof envelope.hash === 'string' && envelope.hash.length > 0
        ? envelope.hash
        : eventHashHex(envelope);
    if (!envelope.hash) {
      envelope.hash = hash;
    }
    const bytes = canonicalizeBytes(envelope);
    await eventStore.appendEvent(hash, bytes);
    return hash;
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawnet-wallet-api-'));
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
    eventStore = new EventStore(new MemoryStore());
    api = new ApiServer(
      { host: '127.0.0.1', port: 0, dataDir: tempDir },
      {
        publishEvent: async (envelope) => {
          const hash = await appendEnvelope(envelope as EventEnvelope);
          published.push(envelope);
          return hash;
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

  it('rejects transfer with missing fields', async () => {
    const res = await fetch(`${baseUrl}/api/wallet/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ did }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('INVALID_REQUEST');
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
    expect((await missingRes.json()).error.code).toBe('INVALID_REQUEST');
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
    expect((await invalidNonceRes.json()).error.code).toBe('INVALID_REQUEST');
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
    const invalidAmountJson = await invalidAmountRes.json();
    expect(invalidAmountJson.error.code).toBe('INVALID_REQUEST');
    expect(invalidAmountJson.error.message).toBe('amount must be >= 1');
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
    expect((await unknownKeyRes.json()).error.code).toBe('INVALID_REQUEST');
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

  it('expires escrows and publishes refund events', async () => {
    const receiver = await generateKeypair();
    const receiverDid = didFromPublicKey(receiver.publicKey);
    const beneficiary = addressFromDid(receiverDid);
    const expiresAt = Date.now() - 60_000;

    const createRes = await fetch(`${baseUrl}/api/wallet/escrow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did,
        passphrase,
        beneficiary,
        amount: 2,
        releaseRules: [{ id: 'rule-1' }],
        escrowId: 'escrow-expire',
        expiresAt,
        nonce: 6,
      }),
    });
    expect(createRes.status).toBe(201);

    const expireRes = await fetch(`${baseUrl}/api/wallet/escrow/escrow-expire/expire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did,
        passphrase,
        nonce: 8,
      }),
    });
    expect(expireRes.status).toBe(200);
    expect(published[published.length - 1]?.type).toBe('wallet.escrow.refund');
  });
});
