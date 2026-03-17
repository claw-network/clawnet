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

async function readData<T>(res: Response): Promise<T> {
  const payload = (await res.json()) as { data?: T };
  return (payload.data ?? payload) as T;
}

describe('reputation api', () => {
  let api: ApiServer;
  let baseUrl: string;
  let eventStore: EventStore;
  let tempDir: string;
  let passphrase: string;
  let issuerDid: string;
  let published: Record<string, unknown>[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawnet-reputation-api-'));
    passphrase = 'test-passphrase-123';
    const issuerKeys = await generateKeypair();
    issuerDid = didFromPublicKey(issuerKeys.publicKey);
    const record = createKeyRecord(issuerKeys.publicKey, issuerKeys.privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    const paths = resolveStoragePaths(tempDir);
    await saveKeyRecord(paths, record);

    eventStore = new EventStore(new MemoryStore());
    published = [];
    api = new ApiServer(
      { host: '127.0.0.1', port: 0, dataDir: tempDir },
      {
        publishEvent: async (envelope) => {
          published.push(envelope);
          const hash =
            typeof envelope.hash === 'string' && envelope.hash.length > 0
              ? envelope.hash
              : eventHashHex(envelope as EventEnvelope);
          await eventStore.appendEvent(hash, canonicalizeBytes(envelope as EventEnvelope));
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

  it('returns reputation profile for existing records', async () => {
    const issuerKeys = await generateKeypair();
    const targetKeys = await generateKeypair();
    const issuer = didFromPublicKey(issuerKeys.publicKey);
    const target = didFromPublicKey(targetKeys.publicKey);

    const issuerRecord = createKeyRecord(issuerKeys.publicKey, issuerKeys.privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    const paths = resolveStoragePaths(tempDir);
    await saveKeyRecord(paths, issuerRecord);

    const recordRes = await fetch(
      `${baseUrl}/api/v1/reputations/${encodeURIComponent(target)}/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          did: issuer,
          passphrase,
          target,
          dimension: 'quality',
          score: 800,
          ref: 'contract-1',
          nonce: 1,
        }),
      },
    );
    expect(recordRes.status).toBe(201);

    const res = await fetch(`${baseUrl}/api/v1/reputations/${encodeURIComponent(target)}`);
    expect(res.status).toBe(200);
    const json = await readData<{
      score: number;
      level: string;
      dimensions: { quality: number; delivery?: number };
    }>(res);
    expect(json.score).toBeGreaterThan(0);
    expect(typeof json.level).toBe('string');
    expect(json.dimensions).toBeDefined();
  });

  it('returns reviews derived from quality records', async () => {
    const issuerKeys = await generateKeypair();
    const targetKeys = await generateKeypair();
    const issuer = didFromPublicKey(issuerKeys.publicKey);
    const target = didFromPublicKey(targetKeys.publicKey);

    const issuerRecord = createKeyRecord(issuerKeys.publicKey, issuerKeys.privateKey, passphrase, {
      t: 1,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    const paths = resolveStoragePaths(tempDir);
    await saveKeyRecord(paths, issuerRecord);

    const recordRes = await fetch(
      `${baseUrl}/api/v1/reputations/${encodeURIComponent(target)}/reviews`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          did: issuer,
          passphrase,
          target,
          dimension: 'quality',
          score: 900,
          ref: 'contract-2',
          comment: 'great',
          aspects: { quality: 5, communication: 4 },
          nonce: 1,
        }),
      },
    );
    expect(recordRes.status).toBe(201);

    const res = await fetch(`${baseUrl}/api/v1/reputations/${encodeURIComponent(target)}/reviews`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{
        score?: number;
        issuer?: string;
        target?: string;
        comment?: string;
        aspects?: Record<string, number>;
      }>;
      meta?: { pagination?: { total?: number } };
    };
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('returns default profile when no reputation records exist', async () => {
    const keypair = await generateKeypair();
    const did = didFromPublicKey(keypair.publicKey);
    const res = await fetch(`${baseUrl}/api/v1/reputations/${encodeURIComponent(did)}`);
    expect(res.status).toBe(200);
    const json = await readData<{ did: string; score: number }>(res);
    expect(json.did).toBe(did);
    expect(json.score).toBeGreaterThanOrEqual(0);
  });

  it('publishes reputation.record events', async () => {
    const targetKeys = await generateKeypair();
    const target = didFromPublicKey(targetKeys.publicKey);

    const res = await fetch(`${baseUrl}/api/v1/reputations/${encodeURIComponent(target)}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        did: issuerDid,
        passphrase,
        target,
        dimension: 'quality',
        score: 750,
        ref: 'contract-3',
        nonce: 1,
      }),
    });

    expect(res.status).toBe(201);
    expect(published[0]?.type).toBe('reputation.record');
  });
});
