/**
 * Tests for IdentityApi.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ClawTokenClient } from '../src/index.js';
import { createMockServer, type MockServer } from './helpers/mock-server.js';

let mock: MockServer;

afterEach(async () => {
  if (mock) await mock.close();
});

describe('IdentityApi', () => {
  it('get returns local identity', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/identity', 200, {
      did: 'did:claw:z6MkLocal',
      publicKey: 'z6MkLocal',
      created: 1700000000000,
      updated: 1700000001000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const id = await client.identity.get();

    expect(id.did).toBe('did:claw:z6MkLocal');
    expect(id.publicKey).toBe('z6MkLocal');
  });

  it('resolve fetches remote identity by DID', async () => {
    mock = await createMockServer();
    const did = 'did:claw:z6MkRemote';
    mock.addRoute('GET', `/api/identity/${encodeURIComponent(did)}`, 200, {
      did,
      publicKey: 'z6MkRemote',
      created: 1700000000000,
      updated: 1700000001000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const id = await client.identity.resolve(did);

    expect(id.did).toBe(did);
  });

  it('resolve with source=store passes query param', async () => {
    mock = await createMockServer();
    const did = 'did:claw:z6MkRemote2';
    mock.addRoute('GET', `/api/identity/${encodeURIComponent(did)}`, 200, {
      did,
      publicKey: 'z6MkRemote2',
      created: 1700000000000,
      updated: 1700000001000,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    await client.identity.resolve(did, 'store');

    expect(mock.requests[0].url).toContain('source=store');
  });

  it('listCapabilities returns capabilities', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/identity/capabilities', 200, {
      capabilities: [
        { type: 'code_review', name: 'Code Review', version: '1.0' },
      ],
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.identity.listCapabilities();

    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0].type).toBe('code_review');
  });

  it('registerCapability posts credential', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/identity/capabilities', 201, {
      type: 'translation',
      name: 'Translation Service',
      version: '2.0',
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.identity.registerCapability({
      did: 'did:claw:z6MkLocal',
      passphrase: 'test',
      nonce: 1,
      credential: { type: 'translation', name: 'Translation Service', version: '2.0' },
    });

    expect(result.type).toBe('translation');
    const body = mock.requests[0].body as Record<string, unknown>;
    expect(body.credential).toBeDefined();
  });
});
