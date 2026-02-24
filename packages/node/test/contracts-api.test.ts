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
} from '@claw-network/core';
import { generateKeypair } from '@claw-network/core/crypto';
import { didFromPublicKey } from '@claw-network/core/identity';
import { createContractActivateEnvelope } from '@claw-network/protocol';

async function readData<T>(res: Response): Promise<T> {
  const payload = (await res.json()) as { data?: T };
  return (payload.data ?? payload) as T;
}

describe('contracts api', () => {
  let api: ApiServer;
  let baseUrl: string;
  let tempDir: string;
  let clientDid: string;
  let providerDid: string;
  let clientKey: Uint8Array;
  let providerKey: Uint8Array;
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

  const createContractViaApi = async (milestones?: Array<Record<string, unknown>>) => {
    const contractId = `contract-${Math.random().toString(16).slice(2)}`;
    const res = await fetch(`${baseUrl}/api/v1/contracts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: clientDid,
        passphrase,
        provider: providerDid,
        contractId,
        terms: { title: 'Test Contract' },
        milestones,
        nonce: 1,
      }),
    });
    expect(res.status).toBe(201);
    const json = await readData<{ id?: string; contractId?: string }>(res);
    const createHash = published[published.length - 1]?.hash as string | undefined;
    expect(createHash).toBeTruthy();
    return {
      contractId: json.id ?? json.contractId ?? contractId,
      createHash: createHash as string,
    };
  };

  const activateContract = async (contractId: string, resourcePrev: string) => {
    const envelope = await createContractActivateEnvelope({
      issuer: clientDid,
      privateKey: clientKey,
      contractId,
      resourcePrev,
      ts: Date.now(),
      nonce: 2,
    });
    await appendEnvelope(envelope as EventEnvelope);
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawnet-contracts-api-'));
    passphrase = 'test-passphrase-123';

    const client = await generateKeypair();
    const provider = await generateKeypair();
    clientDid = didFromPublicKey(client.publicKey);
    providerDid = didFromPublicKey(provider.publicKey);
    clientKey = client.privateKey;
    providerKey = provider.privateKey;

    const paths = resolveStoragePaths(tempDir);
    const clientRecord = createKeyRecord(client.publicKey, client.privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    const providerRecord = createKeyRecord(provider.publicKey, provider.privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    await saveKeyRecord(paths, clientRecord);
    await saveKeyRecord(paths, providerRecord);

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

  it('lists created contracts', async () => {
    await createContractViaApi();
    const res = await fetch(`${baseUrl}/api/v1/contracts`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id?: string; contractId?: string }> };
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('signs contracts with both parties', async () => {
    const { contractId, createHash } = await createContractViaApi();

    const clientRes = await fetch(`${baseUrl}/api/v1/contracts/${contractId}/actions/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: clientDid,
        passphrase,
        prev: createHash,
        nonce: 2,
      }),
    });
    expect(clientRes.status).toBe(200);

    const providerRes = await fetch(`${baseUrl}/api/v1/contracts/${contractId}/actions/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: providerDid,
        passphrase,
        prev: (await readData<{ txHash?: string }>(clientRes)).txHash,
        nonce: 3,
      }),
    });
    expect(providerRes.status).toBe(200);
    const json = await readData<{ status: string; signatures?: unknown[] }>(providerRes);
    expect(json.status).toBe('signed');
  });

  it('activates contracts', async () => {
    const { contractId, createHash } = await createContractViaApi();

    const clientRes = await fetch(`${baseUrl}/api/v1/contracts/${contractId}/actions/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: clientDid,
        passphrase,
        prev: createHash,
        nonce: 2,
      }),
    });

    const providerRes = await fetch(`${baseUrl}/api/v1/contracts/${contractId}/actions/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: providerDid,
        passphrase,
        prev: (await readData<{ txHash?: string }>(clientRes)).txHash,
        nonce: 3,
      }),
    });

    const fundRes = await fetch(`${baseUrl}/api/v1/contracts/${contractId}/actions/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: clientDid,
        passphrase,
        prev: (await readData<{ txHash?: string }>(providerRes)).txHash,
        amount: 10,
        nonce: 4,
      }),
    });
    expect(fundRes.status).toBe(200);
    const json = await readData<{ status?: string }>(fundRes);
    expect(typeof json.status).toBe('string');
  });

  it('submits and approves milestones', async () => {
    const { contractId, createHash } = await createContractViaApi([
      { id: 'milestone-1', title: 'Phase 1' },
    ]);
    await activateContract(contractId, createHash);

    const submitRes = await fetch(
      `${baseUrl}/api/v1/contracts/${contractId}/milestones/0/actions/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          did: providerDid,
          passphrase,
          submissionId: 'submission-1',
          notes: 'done',
          prev: createHash,
          nonce: 5,
        }),
      },
    );
    expect(submitRes.status).toBe(200);
    const submitted = await readData<{ status?: string; txHash?: string }>(submitRes);
    expect(submitted.status).toBe('submitted');
    const submitTxHash = submitted.txHash;

    const approveRes = await fetch(
      `${baseUrl}/api/v1/contracts/${contractId}/milestones/0/actions/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          did: clientDid,
          passphrase,
          feedback: 'looks good',
          prev: submitTxHash,
          nonce: 6,
        }),
      },
    );
    expect(approveRes.status).toBe(200);
    const approved = await readData<{ status?: string }>(approveRes);
    expect(approved.status).toBe('approved');
  });

  it('rejects milestones after submission', async () => {
    const { contractId, createHash } = await createContractViaApi([
      { id: 'milestone-2', title: 'Phase 2' },
    ]);
    await activateContract(contractId, createHash);

    await fetch(`${baseUrl}/api/v1/contracts/${contractId}/milestones/0/actions/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: providerDid,
        passphrase,
        notes: 'ready',
        prev: createHash,
        nonce: 7,
      }),
    });

    const rejectRes = await fetch(
      `${baseUrl}/api/v1/contracts/${contractId}/milestones/0/actions/reject`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          did: clientDid,
          passphrase,
          feedback: 'needs changes',
          prev: createHash,
          nonce: 8,
        }),
      },
    );
    expect(rejectRes.status).toBe(200);
    const rejected = await readData<{ status?: string }>(rejectRes);
    expect(rejected.status).toBe('rejected');
  });

  it('opens and resolves disputes', async () => {
    const { contractId, createHash } = await createContractViaApi();
    await activateContract(contractId, createHash);

    const openRes = await fetch(`${baseUrl}/api/v1/contracts/${contractId}/actions/dispute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: clientDid,
        passphrase,
        reason: 'scope mismatch',
        description: 'terms not met',
        prev: createHash,
        nonce: 9,
      }),
    });
    expect(openRes.status).toBe(200);
    const opened = await readData<{ status?: string }>(openRes);
    expect(opened.status).toBe('open');

    const resolveRes = await fetch(`${baseUrl}/api/v1/contracts/${contractId}/actions/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: providerDid,
        passphrase,
        resolution: 'settled',
        prev: createHash,
        nonce: 10,
      }),
    });
    expect(resolveRes.status).toBe(200);
    const resolved = await readData<{ status?: string }>(resolveRes);
    expect(resolved.status).toBe('resolved');
  });

  it('executes settlements', async () => {
    const { contractId, createHash } = await createContractViaApi();

    const settleRes = await fetch(`${baseUrl}/api/v1/contracts/${contractId}/actions/terminate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: clientDid,
        passphrase,
        settlement: {
          type: 'settlement',
          amount: 5,
        },
        notes: 'agreed',
        prev: createHash,
        nonce: 11,
      }),
    });
    expect(settleRes.status).toBe(200);
    const settled = await readData<{ status?: string }>(settleRes);
    expect(settled.status).toBe('terminated');
  });
});
