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
} from '@clawtoken/core';
import { canonicalizeBytes, generateKeypair } from '@clawtoken/core/crypto';
import { didFromPublicKey } from '@clawtoken/core/identity';
import { MarketSearchStore } from '@clawtoken/protocol';
import type { EventEnvelope } from '@clawtoken/core/protocol';

const pricing = {
  type: 'usage',
  usagePrice: {
    unit: 'call',
    pricePerUnit: '2',
  },
  negotiable: false,
  currency: 'TOKEN',
};

const capability = {
  name: 'Echo API',
  version: '1.0.0',
  interface: {
    type: 'openapi',
    openapi: {
      spec: 'openapi: 3.0.0',
      baseUrl: 'https://example.com',
      authentication: {
        type: 'api_key',
        apiKey: { header: 'X-API-Key' },
      },
    },
  },
};

const access = {
  endpoint: 'https://example.com',
  authentication: {
    type: 'api_key',
    apiKey: { header: 'X-API-Key' },
  },
};

const quota = {
  type: 'unlimited',
  rateLimits: [
    { requests: 1000, period: 60_000 },
  ],
};

describe('capability market api', () => {
  let api: ApiServer;
  let baseUrl: string;
  let tempDir: string;
  let providerDid: string;
  let lesseeDid: string;
  let passphrase: string;
  let published: Record<string, unknown>[];
  let eventStore: EventStore;
  let marketStore: MarketSearchStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawtoken-capability-api-'));
    passphrase = 'test-passphrase-123';

    const providerKeys = await generateKeypair();
    providerDid = didFromPublicKey(providerKeys.publicKey);
    const lesseeKeys = await generateKeypair();
    lesseeDid = didFromPublicKey(lesseeKeys.publicKey);

    const paths = resolveStoragePaths(tempDir);
    const providerRecord = createKeyRecord(providerKeys.publicKey, providerKeys.privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    const lesseeRecord = createKeyRecord(lesseeKeys.publicKey, lesseeKeys.privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    await saveKeyRecord(paths, providerRecord);
    await saveKeyRecord(paths, lesseeRecord);

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

  it('publishes capability listing', async () => {
    const res = await fetch(`${baseUrl}/api/markets/capabilities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: providerDid,
        passphrase,
        title: 'Echo API',
        description: 'Simple echo',
        category: 'api',
        tags: ['echo'],
        pricing,
        visibility: 'public',
        capabilityType: 'rest_api',
        capability,
        quota,
        access,
        nonce: 1,
      }),
    });
    expect(res.status).toBe(201);
    expect(published[0]?.type).toBe('market.listing.publish');
  });

  it('leases and invokes capability', async () => {
    const publishRes = await fetch(`${baseUrl}/api/markets/capabilities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: providerDid,
        passphrase,
        title: 'Echo API',
        description: 'Simple echo',
        category: 'api',
        tags: ['echo'],
        pricing,
        visibility: 'public',
        capabilityType: 'rest_api',
        capability,
        quota,
        access,
        nonce: 1,
      }),
    });
    expect(publishRes.status).toBe(201);
    const publishJson = (await publishRes.json()) as { listingId: string };

    const leaseRes = await fetch(`${baseUrl}/api/markets/capabilities/${publishJson.listingId}/lease`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: lesseeDid,
        passphrase,
        plan: { type: 'pay_per_use' },
        nonce: 1,
      }),
    });
    expect(leaseRes.status).toBe(201);
    const leaseJson = (await leaseRes.json()) as { leaseId: string };

    const invokeRes = await fetch(`${baseUrl}/api/markets/capabilities/leases/${leaseJson.leaseId}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: lesseeDid,
        passphrase,
        resource: 'echo',
        units: 1,
        latency: 120,
        success: true,
        nonce: 2,
      }),
    });
    expect(invokeRes.status).toBe(200);
    const types = published.map((entry) => entry.type);
    expect(types).toContain('market.capability.lease.start');
    expect(types).toContain('market.capability.invoke');
  });
});
