/**
 * Tests for NodeApi — status, peers, config, waitForSync.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ClawTokenClient } from '../src/index.js';
import { createMockServer, type MockServer } from './helpers/mock-server.js';

let mock: MockServer;

afterEach(async () => {
  if (mock) await mock.close();
});

describe('NodeApi', () => {
  it('getStatus returns node status', async () => {
    mock = await createMockServer();
    const status = {
      did: 'did:claw:z6Mk1234',
      synced: true,
      blockHeight: 42,
      peers: 5,
      network: 'testnet',
      version: '0.3.0',
      uptime: 3600,
    };
    mock.addRoute('GET', '/api/node/status', 200, status);

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.node.getStatus();

    expect(result.did).toBe('did:claw:z6Mk1234');
    expect(result.synced).toBe(true);
    expect(result.blockHeight).toBe(42);
    expect(result.peers).toBe(5);
    expect(result.version).toBe('0.3.0');
  });

  it('getPeers returns peer list', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/node/peers', 200, {
      peers: [
        { peerId: 'peer1', multiaddrs: ['/ip4/1.2.3.4/tcp/9527'], latency: 50 },
        { peerId: 'peer2', multiaddrs: ['/ip4/5.6.7.8/tcp/9527'], latency: 120 },
      ],
      total: 2,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.node.getPeers();

    expect(result.peers).toHaveLength(2);
    expect(result.peers[0].peerId).toBe('peer1');
    expect(result.total).toBe(2);
  });

  it('getConfig returns node config', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/node/config', 200, {
      dataDir: '~/.clawtoken',
      apiPort: 9528,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.node.getConfig();

    expect(result).toHaveProperty('dataDir');
    expect(result).toHaveProperty('apiPort', 9528);
  });

  it('waitForSync resolves when synced', async () => {
    mock = await createMockServer();
    let callCount = 0;
    // Override: first two calls return unsynced, third returns synced
    const origAddRoute = mock.addRoute.bind(mock);
    origAddRoute('GET', '/api/node/status', 200, {
      did: 'did:claw:z6Mk1234',
      synced: false,
      blockHeight: 0,
      peers: 0,
      network: 'testnet',
      version: '0.3.0',
      uptime: 0,
    });

    // Monkey-patch server to flip synced after 2 requests
    const origServer = mock.server;
    const origListeners = origServer.listeners('request');
    origServer.removeAllListeners('request');
    origServer.on('request', (req, res) => {
      callCount++;
      if (callCount >= 3 && req.url?.includes('/api/node/status')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          did: 'did:claw:z6Mk1234',
          synced: true,
          blockHeight: 100,
          peers: 3,
          network: 'testnet',
          version: '0.3.0',
          uptime: 10,
        }));
        return;
      }
      // Forward to original handler
      for (const listener of origListeners) {
        (listener as Function)(req, res);
      }
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    const result = await client.node.waitForSync(10_000, 100);
    expect(result.synced).toBe(true);
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it('waitForSync throws on timeout', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/node/status', 200, {
      did: 'did:claw:z6Mk1234',
      synced: false,
      blockHeight: 0,
      peers: 0,
      network: 'testnet',
      version: '0.3.0',
      uptime: 0,
    });

    const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
    await expect(client.node.waitForSync(300, 100)).rejects.toThrow('did not sync');
  });
});
