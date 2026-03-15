import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { ApiServer } from '../src/api/server.js';
import { RelayService } from '../src/services/relay-service.js';
import type { P2PNode } from '@claw-network/core';

async function readData<T>(res: Response): Promise<T> {
  const payload = (await res.json()) as { data?: T };
  return (payload.data ?? payload) as T;
}

/** Minimal mock P2PNode for relay API tests. */
function mockP2PNode(): P2PNode {
  return {
    discoverRelayNodes: async () => ['relay-peer-1', 'relay-peer-2'],
    drainRelay: async () => {},
    requestRelayConfirmation: async () => null,
  } as unknown as P2PNode;
}

describe('relay api', () => {
  let api: ApiServer;
  let baseUrl: string;
  let relayService: RelayService;

  beforeEach(async () => {
    relayService = new RelayService({
      enabled: true,
      maxCircuits: 64,
      maxCircuitsPerPeer: 4,
      maxReservationsPerPeerPerMin: 10,
    });
    relayService.start();
    relayService.updateNatStatus('public', ['/ip4/1.2.3.4/tcp/9527']);

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
        relayService,
        p2pNode: mockP2PNode(),
        signProof: async () => 'mock-sig-base58',
      },
    );
    await api.start();
    const address = (api as unknown as { server: { address: () => AddressInfo } }).server.address();
    baseUrl = `http://${address.address}:${address.port}`;
  });

  afterEach(async () => {
    relayService.stop();
    await api.stop();
  });

  // ── GET /api/v1/relay/stats ──────────────────────────────────

  describe('GET /api/v1/relay/stats', () => {
    it('returns initial relay stats', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/stats`);
      expect(res.status).toBe(200);
      const stats = await readData<{
        relayEnabled: boolean;
        totalCircuitsServed: number;
        activeCircuits: number;
        totalBytesRelayed: number;
      }>(res);
      expect(stats.relayEnabled).toBe(true);
      expect(stats.totalCircuitsServed).toBe(0);
      expect(stats.activeCircuits).toBe(0);
      expect(stats.totalBytesRelayed).toBe(0);
    });

    it('reflects circuit activity', async () => {
      relayService.onCircuitOpen('peer-A');
      relayService.recordBytesRelayed(5000);
      relayService.recordBytesRelayed(1000, true);

      const res = await fetch(`${baseUrl}/api/v1/relay/stats`);
      const stats = await readData<{
        totalCircuitsServed: number;
        activeCircuits: number;
        totalBytesRelayed: number;
        totalAttachmentBytesRelayed: number;
      }>(res);
      expect(stats.totalCircuitsServed).toBe(1);
      expect(stats.activeCircuits).toBe(1);
      expect(stats.totalBytesRelayed).toBe(6000);
      expect(stats.totalAttachmentBytesRelayed).toBe(1000);
    });
  });

  // ── GET /api/v1/relay/health ─────────────────────────────────

  describe('GET /api/v1/relay/health', () => {
    it('returns healthy status for public node', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/health`);
      expect(res.status).toBe(200);
      const health = await readData<{
        relayEnabled: boolean;
        natStatus: string;
        isReachable: boolean;
        publicAddresses: string[];
        warnings: string[];
      }>(res);
      expect(health.relayEnabled).toBe(true);
      expect(health.natStatus).toBe('public');
      expect(health.isReachable).toBe(true);
      expect(health.publicAddresses).toEqual(['/ip4/1.2.3.4/tcp/9527']);
      expect(health.warnings).toHaveLength(0);
    });

    it('shows warnings for private node', async () => {
      relayService.updateNatStatus('private', []);
      const res = await fetch(`${baseUrl}/api/v1/relay/health`);
      const health = await readData<{ warnings: string[] }>(res);
      expect(health.warnings.length).toBeGreaterThan(0);
    });
  });

  // ── GET/POST /api/v1/relay/access ────────────────────────────

  describe('access control API', () => {
    it('GET /access returns open by default', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/access`);
      expect(res.status).toBe(200);
      const info = await readData<{ mode: string; list: string[] }>(res);
      expect(info.mode).toBe('open');
      expect(info.list).toEqual([]);
    });

    it('POST /access sets mode', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'blacklist' }),
      });
      expect(res.status).toBe(200);
      const info = await readData<{ mode: string }>(res);
      expect(info.mode).toBe('blacklist');
    });

    it('POST /access adds DID to list', async () => {
      await fetch(`${baseUrl}/api/v1/relay/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', did: 'did:claw:zTest123' }),
      });

      const res = await fetch(`${baseUrl}/api/v1/relay/access`);
      const info = await readData<{ list: string[] }>(res);
      expect(info.list).toContain('did:claw:zTest123');
    });

    it('POST /access removes DID from list', async () => {
      relayService.addToAccessList('did:claw:zRemoveMe');

      await fetch(`${baseUrl}/api/v1/relay/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', did: 'did:claw:zRemoveMe' }),
      });

      const res = await fetch(`${baseUrl}/api/v1/relay/access`);
      const info = await readData<{ list: string[] }>(res);
      expect(info.list).not.toContain('did:claw:zRemoveMe');
    });

    it('POST /access rejects invalid mode', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'invalid' }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /access rejects missing action', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: 'did:claw:zTest' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Phase 2: GET /api/v1/relay/peers ─────────────────────────

  describe('GET /api/v1/relay/peers (F12)', () => {
    it('returns empty peer list initially', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/peers`);
      expect(res.status).toBe(200);
      const data = await readData<{ peers: string[]; count: number; draining: boolean }>(res);
      expect(data.peers).toEqual([]);
      expect(data.count).toBe(0);
      expect(data.draining).toBe(false);
    });

    it('returns active relay peers', async () => {
      relayService.onCircuitOpen('peer-X');
      relayService.onCircuitOpen('peer-Y');

      const res = await fetch(`${baseUrl}/api/v1/relay/peers`);
      const data = await readData<{ peers: string[]; count: number }>(res);
      expect(data.count).toBe(2);
      expect(data.peers).toContain('peer-X');
      expect(data.peers).toContain('peer-Y');
    });
  });

  // ── Phase 2: POST /api/v1/relay/drain ────────────────────────

  describe('POST /api/v1/relay/drain (F12)', () => {
    it('enables drain mode', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/drain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: true }),
      });
      expect(res.status).toBe(200);
      const data = await readData<{ draining: boolean }>(res);
      expect(data.draining).toBe(true);
    });

    it('disables drain mode', async () => {
      relayService.setDraining(true);

      const res = await fetch(`${baseUrl}/api/v1/relay/drain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: false }),
      });
      expect(res.status).toBe(200);
      const data = await readData<{ draining: boolean }>(res);
      expect(data.draining).toBe(false);
    });
  });

  // ── Phase 3: GET /api/v1/relay/period-proof (F4) ─────────────

  describe('GET /api/v1/relay/period-proof (F4)', () => {
    it('returns null when no proof generated yet', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/period-proof`);
      expect(res.status).toBe(200);
      const data = await readData<{ proof: null; message: string }>(res);
      expect(data.proof).toBeNull();
      expect(data.message).toContain('No period proof');
    });
  });

  // ── Phase 3: POST /api/v1/relay/period-proof (F4) ────────────

  describe('POST /api/v1/relay/period-proof (F4)', () => {
    it('requires relayDid', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/period-proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('generates proof with relayDid', async () => {
      relayService.recordBytesRelayed(1000, false, 'peer-A');

      const res = await fetch(`${baseUrl}/api/v1/relay/period-proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayDid: 'did:claw:zTestRelay' }),
      });
      expect(res.status).toBe(200);
      const proof = await readData<{
        relayDid: string;
        relaySignature: string;
        bytesRelayed: number;
      }>(res);
      expect(proof.relayDid).toBe('did:claw:zTestRelay');
      expect(proof.relaySignature).toBe('mock-sig-base58');
      expect(proof.bytesRelayed).toBe(1000);
    });
  });

  // ── Phase 3: POST /api/v1/relay/confirm-contribution (F10) ───

  describe('POST /api/v1/relay/confirm-contribution (F10)', () => {
    it('rejects missing fields', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/confirm-contribution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerDid: 'did:claw:zPeer' }),
      });
      expect(res.status).toBe(400);
    });

    it('confirms contribution with valid fields', async () => {
      const res = await fetch(`${baseUrl}/api/v1/relay/confirm-contribution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peerDid: 'did:claw:zPeer',
          bytesConfirmed: 5000,
          circuitsConfirmed: 2,
          signature: 'base58-sig',
        }),
      });
      expect(res.status).toBe(200);
      const data = await readData<{ accepted: boolean; peerDid: string }>(res);
      expect(data.accepted).toBe(true);
      expect(data.peerDid).toBe('did:claw:zPeer');
    });
  });
});
