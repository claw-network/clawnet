import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { RelayService } from '../src/services/relay-service.js';

describe('RelayService', () => {
  let service: RelayService;

  beforeEach(() => {
    service = new RelayService({
      enabled: true,
      maxCircuits: 10,
      maxCircuitsPerPeer: 2,
      maxReservationsPerPeerPerMin: 5,
    });
    service.start();
  });

  afterEach(() => {
    service.stop();
  });

  // ── F3: Statistics ──────────────────────────────────────────

  describe('stats (F3)', () => {
    it('returns initial stats', () => {
      const stats = service.getStats();
      expect(stats.relayEnabled).toBe(true);
      expect(stats.totalCircuitsServed).toBe(0);
      expect(stats.activeCircuits).toBe(0);
      expect(stats.totalBytesRelayed).toBe(0);
      expect(stats.totalMessagesRelayed).toBe(0);
      expect(stats.totalAttachmentBytesRelayed).toBe(0);
      expect(stats.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('tracks circuit open/close', () => {
      service.onCircuitOpen('peer-A');
      service.onCircuitOpen('peer-B');
      expect(service.getStats().activeCircuits).toBe(2);
      expect(service.getStats().totalCircuitsServed).toBe(2);

      service.onCircuitClose('peer-A');
      expect(service.getStats().activeCircuits).toBe(1);
      expect(service.getStats().totalCircuitsServed).toBe(2);
    });

    it('tracks bytes relayed', () => {
      service.recordBytesRelayed(1000);
      service.recordBytesRelayed(500, true); // attachment

      const stats = service.getStats();
      expect(stats.totalBytesRelayed).toBe(1500);
      expect(stats.totalAttachmentBytesRelayed).toBe(500);
      expect(stats.periodStats.bytesRelayed).toBe(1500);
      expect(stats.periodStats.attachmentBytesRelayed).toBe(500);
    });

    it('tracks messages relayed', () => {
      service.recordMessageRelayed();
      service.recordMessageRelayed();
      expect(service.getStats().totalMessagesRelayed).toBe(2);
    });

    it('tracks unique peers per period', () => {
      service.onCircuitOpen('peer-A');
      service.onCircuitOpen('peer-A');
      service.onCircuitOpen('peer-B');
      expect(service.getStats().periodStats.uniquePeersServed).toBe(2);
    });
  });

  // ── F3: Period rotation ─────────────────────────────────────

  describe('period rotation (F3)', () => {
    it('rotates period and resets counters', () => {
      service.onCircuitOpen('peer-A');
      service.recordBytesRelayed(1000);
      service.recordBytesRelayed(200, true);

      const snapshot = service.rotatePeriod();
      expect(snapshot.bytesRelayed).toBe(1200);
      expect(snapshot.attachmentBytesRelayed).toBe(200);
      expect(snapshot.circuitsServed).toBe(1);
      expect(snapshot.uniquePeersServed).toBe(1);

      // After rotation, period counters are reset
      const stats = service.getStats();
      expect(stats.periodStats.bytesRelayed).toBe(0);
      expect(stats.periodStats.circuitsServed).toBe(0);
      expect(stats.periodStats.uniquePeersServed).toBe(0);
      // Cumulative counters remain
      expect(stats.totalBytesRelayed).toBe(1200);
    });
  });

  // ── F6: Per-peer rate limiting ──────────────────────────────

  describe('per-peer rate limiting (F6)', () => {
    it('rejects when per-peer concurrent limit exceeded', () => {
      expect(service.onCircuitOpen('peer-A')).toBe(true);
      expect(service.onCircuitOpen('peer-A')).toBe(true);
      // 3rd should be rejected (maxCircuitsPerPeer = 2)
      expect(service.onCircuitOpen('peer-A')).toBe(false);
    });

    it('allows after circuit close', () => {
      service.onCircuitOpen('peer-A');
      service.onCircuitOpen('peer-A');
      expect(service.onCircuitOpen('peer-A')).toBe(false);

      service.onCircuitClose('peer-A');
      expect(service.onCircuitOpen('peer-A')).toBe(true);
    });

    it('rejects when global circuit limit exceeded', () => {
      // maxCircuits = 10, maxCircuitsPerPeer = 2
      for (let i = 0; i < 5; i++) {
        service.onCircuitOpen(`peer-${i}`);
        service.onCircuitOpen(`peer-${i}`);
      }
      expect(service.getStats().activeCircuits).toBe(10);
      // New circuit from any peer should be rejected
      expect(service.onCircuitOpen('peer-new')).toBe(false);
    });

    it('rejects when per-peer rate limit exceeded', () => {
      const fast = new RelayService({
        enabled: true,
        maxCircuits: 100,
        maxCircuitsPerPeer: 100,
        maxReservationsPerPeerPerMin: 3,
      });
      fast.start();

      expect(fast.onCircuitOpen('peer-A')).toBe(true);
      fast.onCircuitClose('peer-A');
      expect(fast.onCircuitOpen('peer-A')).toBe(true);
      fast.onCircuitClose('peer-A');
      expect(fast.onCircuitOpen('peer-A')).toBe(true);
      fast.onCircuitClose('peer-A');
      // 4th within 1 minute → rejected
      expect(fast.onCircuitOpen('peer-A')).toBe(false);
    });
  });

  // ── F7: Access control ──────────────────────────────────────

  describe('access control (F7)', () => {
    it('defaults to open mode', () => {
      const info = service.getAccessInfo();
      expect(info.mode).toBe('open');
      expect(info.list).toEqual([]);
    });

    it('blacklist mode blocks listed peer', () => {
      service.setAccessMode('blacklist');
      service.addToAccessList('peer-bad');
      expect(service.onCircuitOpen('peer-bad')).toBe(false);
      expect(service.onCircuitOpen('peer-good')).toBe(true);
    });

    it('whitelist mode allows only listed peer', () => {
      service.setAccessMode('whitelist');
      service.addToAccessList('peer-vip');
      expect(service.onCircuitOpen('peer-vip')).toBe(true);
      expect(service.onCircuitOpen('peer-other')).toBe(false);
    });

    it('add/remove from access list', () => {
      service.addToAccessList('did:claw:test');
      expect(service.getAccessInfo().list).toContain('did:claw:test');
      // Duplicate add returns false
      expect(service.addToAccessList('did:claw:test')).toBe(false);

      service.removeFromAccessList('did:claw:test');
      expect(service.getAccessInfo().list).not.toContain('did:claw:test');
      // Duplicate remove returns false
      expect(service.removeFromAccessList('did:claw:test')).toBe(false);
    });
  });

  // ── F9: Health / self-diagnosis ─────────────────────────────

  describe('health (F9)', () => {
    it('returns health with warnings for NAT-behind node', () => {
      service.updateNatStatus('private', []);
      const health = service.getHealth();
      expect(health.relayEnabled).toBe(true);
      expect(health.natStatus).toBe('private');
      expect(health.isReachable).toBe(false);
      expect(health.warnings).toContain('Node is behind NAT — cannot serve as effective relay');
      expect(health.warnings).toContain('No public addresses detected');
    });

    it('returns healthy for public node', () => {
      service.updateNatStatus('public', ['/ip4/1.2.3.4/tcp/9527']);
      const health = service.getHealth();
      expect(health.natStatus).toBe('public');
      expect(health.isReachable).toBe(true);
      expect(health.publicAddresses).toEqual(['/ip4/1.2.3.4/tcp/9527']);
      expect(health.warnings).toHaveLength(0);
    });

    it('warns when load is above 90%', () => {
      // Fill 10 circuits (maxCircuits = 10)
      for (let i = 0; i < 5; i++) {
        service.onCircuitOpen(`peer-${i}`);
        service.onCircuitOpen(`peer-${i}`);
      }
      service.updateNatStatus('public', ['/ip4/1.2.3.4/tcp/9527']);
      const health = service.getHealth();
      expect(health.load.utilizationPercent).toBe(100);
      expect(health.warnings).toContain(
        'Relay load above 90% — consider increasing maxCircuits or limiting connections',
      );
    });
  });

  // ── F8: Attachment traffic classification ───────────────────

  describe('attachment traffic classification (F8)', () => {
    it('separates messaging vs attachment bytes', () => {
      service.recordBytesRelayed(1000, false); // messaging
      service.recordBytesRelayed(5000, true);  // attachment
      service.recordBytesRelayed(2000, false); // messaging

      const stats = service.getStats();
      expect(stats.totalBytesRelayed).toBe(8000);
      expect(stats.totalAttachmentBytesRelayed).toBe(5000);
      expect(stats.periodStats.bytesRelayed).toBe(8000);
      expect(stats.periodStats.attachmentBytesRelayed).toBe(5000);
    });
  });

  // ── Cleanup ─────────────────────────────────────────────────

  describe('peer state cleanup', () => {
    it('cleanupPeerState removes stale entries', () => {
      service.onCircuitOpen('peer-A');
      service.onCircuitClose('peer-A');
      // Normally we'd need to wait 5 minutes, but we can test the method exists
      // and doesn't throw
      service.cleanupPeerState();
    });
  });

  // ── F12: Draining mode ──────────────────────────────────────

  describe('draining mode (F12)', () => {
    it('defaults to not draining', () => {
      expect(service.draining).toBe(false);
    });

    it('setDraining enables draining mode', () => {
      service.setDraining(true);
      expect(service.draining).toBe(true);
    });

    it('rejects new circuits when draining', () => {
      service.setDraining(true);
      const accepted = service.onCircuitOpen('peer-new');
      expect(accepted).toBe(false);
      expect(service.getStats().activeCircuits).toBe(0);
    });

    it('setDraining(false) re-enables accepting circuits', () => {
      service.setDraining(true);
      service.setDraining(false);
      const accepted = service.onCircuitOpen('peer-1');
      expect(accepted).toBe(true);
    });
  });

  // ── Phase 2: Active peers tracking ──────────────────────────

  describe('getActivePeers (F12)', () => {
    it('returns empty list initially', () => {
      expect(service.getActivePeers()).toEqual([]);
    });

    it('returns peers with active circuits', () => {
      service.onCircuitOpen('peer-A');
      service.onCircuitOpen('peer-B');
      const active = service.getActivePeers();
      expect(active).toContain('peer-A');
      expect(active).toContain('peer-B');
      expect(active).toHaveLength(2);
    });

    it('excludes peers after circuit close', () => {
      service.onCircuitOpen('peer-A');
      service.onCircuitOpen('peer-B');
      service.onCircuitClose('peer-A');
      const active = service.getActivePeers();
      expect(active).not.toContain('peer-A');
      expect(active).toContain('peer-B');
    });
  });
});
