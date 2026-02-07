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
import { canonicalizeBytes, generateKeypair } from '@clawtoken/core/crypto';
import { didFromPublicKey } from '@clawtoken/core/identity';
import { createReputationRecordEnvelope } from '@clawtoken/protocol';

describe('reputation api', () => {
  let api: ApiServer;
  let baseUrl: string;
  let eventStore: EventStore;
  let tempDir: string;
  let passphrase: string;
  let issuerDid: string;
  let published: Record<string, unknown>[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawtoken-reputation-api-'));
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

  it('returns reputation profile for existing records', async () => {
    const issuerKeys = await generateKeypair();
    const targetKeys = await generateKeypair();
    const issuer = didFromPublicKey(issuerKeys.publicKey);
    const target = didFromPublicKey(targetKeys.publicKey);

    const now = Date.now();
    const envelope = await createReputationRecordEnvelope({
      issuer,
      privateKey: issuerKeys.privateKey,
      target,
      dimension: 'quality',
      score: 800,
      ref: 'contract-1',
      ts: now,
      nonce: 1,
    });
    const bytes = canonicalizeBytes(envelope);
    await eventStore.appendEvent(envelope.hash as string, bytes);

    const res = await fetch(`${baseUrl}/api/reputation/${encodeURIComponent(target)}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      score: number;
      level: string;
      levelNumber: number;
      dimensions: { quality: number; delivery: number };
    };
    expect(json.score).toBe(560);
    expect(json.level).toBe('Advanced');
    expect(json.levelNumber).toBe(4);
    expect(json.dimensions.quality).toBe(800);
    expect(json.dimensions.delivery).toBe(500);
  });

  it('returns reviews derived from quality records', async () => {
    const issuerKeys = await generateKeypair();
    const targetKeys = await generateKeypair();
    const issuer = didFromPublicKey(issuerKeys.publicKey);
    const target = didFromPublicKey(targetKeys.publicKey);

    const envelope = await createReputationRecordEnvelope({
      issuer,
      privateKey: issuerKeys.privateKey,
      target,
      dimension: 'quality',
      score: 900,
      ref: 'contract-2',
      comment: 'great',
      aspects: { quality: 5, communication: 4 },
      ts: 2_000,
      nonce: 1,
    });
    const bytes = canonicalizeBytes(envelope);
    await eventStore.appendEvent(envelope.hash as string, bytes);

    const res = await fetch(`${baseUrl}/api/reputation/${encodeURIComponent(target)}/reviews`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      reviews: Array<{
        rating: number;
        reviewer: string;
        reviewee: string;
        comment?: string;
        aspects?: Record<string, number>;
      }>;
      averageRating: number;
      total: number;
    };
    expect(json.total).toBe(1);
    expect(json.reviews[0]?.rating).toBe(5);
    expect(json.reviews[0]?.reviewer).toBe(issuer);
    expect(json.reviews[0]?.reviewee).toBe(target);
    expect(json.reviews[0]?.comment).toBe('great');
    expect(json.reviews[0]?.aspects?.quality).toBe(5);
    expect(json.averageRating).toBe(5);
  });

  it('returns not found when no reputation records exist', async () => {
    const keypair = await generateKeypair();
    const did = didFromPublicKey(keypair.publicKey);
    const res = await fetch(`${baseUrl}/api/reputation/${encodeURIComponent(did)}`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('REPUTATION_NOT_FOUND');
  });

  it('publishes reputation.record events', async () => {
    const targetKeys = await generateKeypair();
    const target = didFromPublicKey(targetKeys.publicKey);

    const res = await fetch(`${baseUrl}/api/reputation/record`, {
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

    expect(res.status).toBe(200);
    expect(published[0]?.type).toBe('reputation.record');
  });
});
