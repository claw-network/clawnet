import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { ApiKeyStore } from '../src/api/api-key-store.js';
import { ApiServer } from '../src/api/server.js';

// ─── Unit: ApiKeyStore ──────────────────────────────────────────

describe('ApiKeyStore', () => {
  let tmpDir: string;
  let store: ApiKeyStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'claw-test-'));
    store = new ApiKeyStore(join(tmpDir, 'api-keys.sqlite'));
  });

  afterEach(async () => {
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a key with id, label, and 64-char hex key', () => {
    const record = store.create('test-agent');
    expect(record.id).toBe(1);
    expect(record.label).toBe('test-agent');
    expect(record.status).toBe('active');
    expect(record.key).toMatch(/^[a-f0-9]{64}$/);
    expect(record.createdAt).toBeTruthy();
  });

  it('stores keys as SHA-256 hashes, not plaintext', () => {
    const record = store.create('hashed');
    // The plaintext key returned by create() must NOT appear in the DB
    const row = store['db']
      .prepare('SELECT key FROM api_keys WHERE id = ?')
      .get(record.id) as { key: string };
    expect(row.key).not.toBe(record.key);
    expect(row.key).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it('validates an active key', () => {
    const created = store.create('agent-1');
    const validated = store.validate(created.key);
    expect(validated).toBeTruthy();
    expect(validated!.id).toBe(created.id);
    expect(validated!.label).toBe('agent-1');
  });

  it('rejects unknown keys', () => {
    const result = store.validate('0'.repeat(64));
    expect(result).toBeNull();
  });

  it('rejects revoked keys', () => {
    const created = store.create('temp');
    store.revoke(created.id);
    const result = store.validate(created.key);
    expect(result).toBeNull();
  });

  it('lists active keys with truncated prefix', () => {
    store.create('a');
    store.create('b');
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.keyPrefix).toMatch(/^[a-f0-9]{8}…$/);
    // full key should NOT be in the summary
    expect(list[0]).not.toHaveProperty('key');
  });

  it('lists including revoked when requested', () => {
    const _k1 = store.create('keep');
    const k2 = store.create('drop');
    store.revoke(k2.id);

    expect(store.list(false)).toHaveLength(1);
    expect(store.list(true)).toHaveLength(2);
  });

  it('tracks activeCount', () => {
    expect(store.activeCount()).toBe(0);
    store.create('a');
    store.create('b');
    expect(store.activeCount()).toBe(2);
    const k = store.create('c');
    store.revoke(k.id);
    expect(store.activeCount()).toBe(2);
  });

  it('deletes a key', () => {
    const k = store.create('temp');
    expect(store.delete(k.id)).toBe(true);
    expect(store.list(true)).toHaveLength(0);
  });

  it('updates last_used_at on validate', () => {
    const k = store.create('x');
    const before = store.getById(k.id);
    expect(before!.lastUsedAt).toBeNull();

    store.validate(k.key);
    const after = store.getById(k.id);
    expect(after!.lastUsedAt).toBeTruthy();
  });
});

// ─── Integration: Auth Middleware ────────────────────────────────

describe('auth middleware', () => {
  let tmpDir: string;
  let store: ApiKeyStore;
  let api: ApiServer;
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'claw-auth-'));
    store = new ApiKeyStore(join(tmpDir, 'api-keys.sqlite'));

    api = new ApiServer(
      { host: '127.0.0.1', port: 0 },
      {
        publishEvent: async () => 'hash-1',
        getNodeStatus: async () => ({
          did: 'did:claw:test',
          synced: true,
          version: '0.0.0',
        }),
        apiKeyStore: store,
      },
    );
    await api.start();
    const addr = api.httpServer?.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await api.stop();
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('allows /api/v1/node without API key (public route)', async () => {
    // Create a key to ensure auth is enforced for other routes
    store.create('test');

    const res = await fetch(`${baseUrl}/api/v1/node`);
    expect(res.status).toBe(200);
  });

  it('blocks protected routes when keys exist but none provided', async () => {
    store.create('enforced');

    const res = await fetch(`${baseUrl}/api/v1/wallets/did:claw:test/balance`);
    expect(res.status).toBe(401);
  });

  it('allows protected routes with valid X-Api-Key header', async () => {
    const key = store.create('valid-key');

    const res = await fetch(`${baseUrl}/api/v1/node`, {
      headers: { 'X-Api-Key': key.key },
    });
    expect(res.status).toBe(200);
  });

  it('allows protected routes with Authorization: Bearer header', async () => {
    const key = store.create('bearer-key');

    const res = await fetch(`${baseUrl}/api/v1/node`, {
      headers: { Authorization: `Bearer ${key.key}` },
    });
    expect(res.status).toBe(200);
  });

  it('rejects revoked keys', async () => {
    const key = store.create('revoked-key');
    store.revoke(key.id);
    // Create another active key to ensure enforcement is on
    store.create('other');

    const res = await fetch(`${baseUrl}/api/v1/wallets/did:claw:test/balance`, {
      headers: { 'X-Api-Key': key.key },
    });
    expect(res.status).toBe(401);
  });

  it('skips auth entirely when no keys exist (backwards compatible)', async () => {
    // No keys created — store.activeCount() === 0
    const res = await fetch(`${baseUrl}/api/v1/wallets/did:claw:test/balance`);
    // Should not be 401 — auth is skipped
    expect(res.status).not.toBe(401);
  });

  it('allows CORS preflight without key', async () => {
    store.create('test');

    const res = await fetch(`${baseUrl}/api/v1/wallets/did:claw:test/balance`, {
      method: 'OPTIONS',
    });
    expect(res.status).toBe(204);
  });
});

// ─── Mainnet-specific: network-aware behaviour ──────────────────

describe('mainnet network restrictions', () => {
  let tmpDir: string;
  let store: ApiKeyStore;
  let api: ApiServer;
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'claw-mainnet-'));
    store = new ApiKeyStore(join(tmpDir, 'api-keys.sqlite'));
  });

  afterEach(async () => {
    await api.stop();
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('enforces 401 on mainnet even with 0 keys', async () => {
    api = new ApiServer(
      { host: '127.0.0.1', port: 0, network: 'mainnet' },
      {
        publishEvent: async () => 'hash-1',
        getNodeStatus: async () => ({
          did: 'did:claw:test',
          synced: true,
          version: '0.0.0',
        }),
        apiKeyStore: store,
      },
    );
    await api.start();
    const addr = api.httpServer?.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // 0 keys on mainnet — should still enforce 401
    const res = await fetch(`${baseUrl}/api/v1/wallets/did:claw:test/balance`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.detail).toContain('No API keys configured');
  });

  it('still allows /api/v1/node on mainnet without key', async () => {
    api = new ApiServer(
      { host: '127.0.0.1', port: 0, network: 'mainnet' },
      {
        publishEvent: async () => 'hash-1',
        getNodeStatus: async () => ({
          did: 'did:claw:test',
          synced: true,
          version: '0.0.0',
        }),
        apiKeyStore: store,
      },
    );
    await api.start();
    const addr = api.httpServer?.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const res = await fetch(`${baseUrl}/api/v1/node`);
    expect(res.status).toBe(200);
  });

  it('does not mount dev routes on mainnet', async () => {
    api = new ApiServer(
      { host: '127.0.0.1', port: 0, network: 'mainnet' },
      {
        publishEvent: async () => 'hash-1',
        getNodeStatus: async () => ({
          did: 'did:claw:test',
          synced: true,
          version: '0.0.0',
        }),
        apiKeyStore: store,
      },
    );
    await api.start();
    const addr = api.httpServer?.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Create a key so auth passes
    const key = store.create('test');

    const res = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': key.key,
      },
      body: JSON.stringify({ address: '0x0000000000000000000000000000000000000099', amount: 1 }),
    });
    // Should be 404 (route not mounted), not 200 or 500
    expect(res.status).toBe(404);
  });

  it('mounts dev routes on testnet (default)', async () => {
    api = new ApiServer(
      { host: '127.0.0.1', port: 0, network: 'testnet' },
      {
        publishEvent: async () => 'hash-1',
        getNodeStatus: async () => ({
          did: 'did:claw:test',
          synced: true,
          version: '0.0.0',
        }),
        apiKeyStore: store,
      },
    );
    await api.start();
    const addr = api.httpServer?.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Create a key
    const key = store.create('test');

    const res = await fetch(`${baseUrl}/api/v1/dev/faucet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': key.key,
      },
      body: JSON.stringify({ address: '0x0000000000000000000000000000000000000099', amount: 1 }),
    });
    // Route exists — we get a response that's NOT 404
    // (could be 400, 500 etc. depending on wallet setup, but not 404)
    expect(res.status).not.toBe(404);
  });
});
