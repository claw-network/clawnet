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
  eventHashHex,
} from '@clawnet/core';
import { canonicalizeBytes, generateKeypair } from '@clawnet/core/crypto';
import { didFromPublicKey } from '@clawnet/core/identity';
import { MarketSearchStore } from '@clawnet/protocol';
import type { EventEnvelope } from '@clawnet/core/protocol';

const pricing = {
  type: 'fixed',
  fixedPrice: '10',
  negotiable: false,
  currency: 'TOKEN',
};

describe('task market api', () => {
  let api: ApiServer;
  let baseUrl: string;
  let tempDir: string;
  let clientDid: string;
  let workerDid: string;
  let passphrase: string;
  let published: Record<string, unknown>[];
  let eventStore: EventStore;
  let marketStore: MarketSearchStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawnet-task-api-'));
    passphrase = 'test-passphrase-123';

    const clientKeys = await generateKeypair();
    clientDid = didFromPublicKey(clientKeys.publicKey);
    const workerKeys = await generateKeypair();
    workerDid = didFromPublicKey(workerKeys.publicKey);

    const paths = resolveStoragePaths(tempDir);
    const clientRecord = createKeyRecord(clientKeys.publicKey, clientKeys.privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    const workerRecord = createKeyRecord(workerKeys.publicKey, workerKeys.privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    await saveKeyRecord(paths, clientRecord);
    await saveKeyRecord(paths, workerRecord);

    published = [];
    eventStore = new EventStore(new MemoryStore());
    marketStore = new MarketSearchStore(new MemoryStore());
    await marketStore.loadFromStore();

    api = new ApiServer(
      { host: '127.0.0.1', port: 0, dataDir: tempDir },
      {
        publishEvent: async (envelope) => {
          published.push(envelope);
          const hash = typeof envelope.hash === 'string' && envelope.hash.length > 0
            ? envelope.hash
            : eventHashHex(envelope as EventEnvelope);
          await eventStore.appendEvent(hash, canonicalizeBytes(envelope));
          await marketStore.applyEvent(envelope as EventEnvelope);
          return hash;
        },
        eventStore,
        marketStore,
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

  it('publishes task listing', async () => {
    const res = await fetch(`${baseUrl}/api/markets/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: clientDid,
        passphrase,
        title: 'Analysis task',
        description: 'Analyze data',
        category: 'data',
        tags: ['analysis'],
        pricing,
        visibility: 'public',
        taskType: 'one_time',
        task: {
          requirements: 'Analyze dataset',
          deliverables: [
            { name: 'Report', type: 'report', required: true, acceptanceCriteria: ['summary'] },
          ],
          skills: [
            { name: 'analysis', level: 'intermediate', required: true },
          ],
          complexity: 'simple',
          estimatedDuration: 3600,
        },
        timeline: { flexible: true },
        nonce: 1,
      }),
    });
    expect(res.status).toBe(201);
    expect(published[0]?.type).toBe('market.listing.publish');
  });

  it('submits and accepts a bid', async () => {
    const publishRes = await fetch(`${baseUrl}/api/markets/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: clientDid,
        passphrase,
        title: 'Analysis task',
        description: 'Analyze data',
        category: 'data',
        tags: ['analysis'],
        pricing,
        visibility: 'public',
        taskType: 'one_time',
        task: {
          requirements: 'Analyze dataset',
          deliverables: [
            { name: 'Report', type: 'report', required: true, acceptanceCriteria: ['summary'] },
          ],
          skills: [
            { name: 'analysis', level: 'intermediate', required: true },
          ],
          complexity: 'simple',
          estimatedDuration: 3600,
        },
        timeline: { flexible: true },
        nonce: 1,
      }),
    });
    expect(publishRes.status).toBe(201);
    const publishJson = (await publishRes.json()) as { listingId: string };

    const bidRes = await fetch(`${baseUrl}/api/markets/tasks/${publishJson.listingId}/bids`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: workerDid,
        passphrase,
        price: '12',
        timeline: 3600,
        approach: 'I will analyze',
        nonce: 1,
      }),
    });
    expect(bidRes.status).toBe(201);
    const bidJson = (await bidRes.json()) as { bidId: string };

    const acceptRes = await fetch(`${baseUrl}/api/markets/tasks/${publishJson.listingId}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: clientDid,
        passphrase,
        bidId: bidJson.bidId,
        nonce: 2,
      }),
    });
    expect(acceptRes.status).toBe(200);

    const types = published.map((entry) => entry.type);
    expect(types).toContain('market.bid.accept');
    expect(types).toContain('market.order.create');
    expect(types).toContain('wallet.escrow.create');
    expect(types).toContain('wallet.escrow.fund');
    expect(types).toContain('market.order.update');
  });
});
