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
} from '@clawnet/core';
import { generateKeypair } from '@clawnet/core/crypto';
import { didFromPublicKey } from '@clawnet/core/identity';

describe('node api', () => {
  let api: ApiServer;
  let baseUrl: string;

  beforeEach(async () => {
    api = new ApiServer(
      { host: '127.0.0.1', port: 0 },
      {
        publishEvent: async () => 'hash-1',
        getNodeStatus: async () => ({
          did: 'did:claw:test',
          synced: true,
          blockHeight: 42,
          peers: 3,
          network: 'devnet',
          version: '0.0.0',
          uptime: 10,
        }),
        getNodePeers: async () => ({
          peers: [{ peerId: 'peer-1' }],
          total: 1,
        }),
        getNodeConfig: async () => ({
          dataDir: '/tmp/clawnet',
          network: 'devnet',
          p2pPort: 9527,
          apiPort: 9528,
          apiEnabled: true,
        }),
      },
    );
    await api.start();
    const address = (api as unknown as { server: { address: () => AddressInfo } }).server.address();
    baseUrl = `http://${address.address}:${address.port}`;
  });

  afterEach(async () => {
    await api.stop();
  });

  it('serves node status/peers/config', async () => {
    const statusRes = await fetch(`${baseUrl}/api/node/status`);
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as { blockHeight: number; peers: number };
    expect(status.blockHeight).toBe(42);
    expect(status.peers).toBe(3);

    const peersRes = await fetch(`${baseUrl}/api/node/peers`);
    expect(peersRes.status).toBe(200);
    const peers = (await peersRes.json()) as { total: number };
    expect(peers.total).toBe(1);

    const configRes = await fetch(`${baseUrl}/api/node/config`);
    expect(configRes.status).toBe(200);
    const config = (await configRes.json()) as { apiPort: number };
    expect(config.apiPort).toBe(9528);
  });
});

describe('identity api', () => {
  let api: ApiServer;
  let baseUrl: string;
  let tempDir: string;
  let did: string;
  let publicKeyMb: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawnet-node-api-'));
    const { publicKey, privateKey } = await generateKeypair();
    did = didFromPublicKey(publicKey);
    const record = createKeyRecord(publicKey, privateKey, 'test-passphrase-123', {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    publicKeyMb = record.publicKey;
    const paths = resolveStoragePaths(tempDir);
    await saveKeyRecord(paths, record);

    const eventStore = new EventStore(new MemoryStore());
    api = new ApiServer(
      { host: '127.0.0.1', port: 0, dataDir: tempDir },
      {
        publishEvent: async () => 'hash-1',
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

  it('returns local identity', async () => {
    const res = await fetch(`${baseUrl}/api/identity`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { did: string; publicKey: string };
    expect(json.did).toBe(did);
    expect(json.publicKey).toBe(publicKeyMb);
  });

  it('lists capabilities', async () => {
    const res = await fetch(`${baseUrl}/api/identity/capabilities`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { capabilities: unknown[] };
    expect(json.capabilities).toEqual([]);
  });

  it('rejects invalid did', async () => {
    const res = await fetch(`${baseUrl}/api/identity/not-a-did`);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('DID_INVALID');
  });

  it('returns did not found for unknown did', async () => {
    const other = await generateKeypair();
    const otherDid = didFromPublicKey(other.publicKey);
    const res = await fetch(`${baseUrl}/api/identity/${encodeURIComponent(otherDid)}`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('DID_NOT_FOUND');
  });
});
