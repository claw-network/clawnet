import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_P2P_CONFIG, DEFAULT_P2P_CONFIG, BOOTSTRAP_MULTIADDR } from '../src/p2p/config.js';
import { DEFAULT_CONFIG } from '../src/storage/config.js';

describe('DEFAULT_CONFIG bootstrap', () => {
  it('includes non-empty bootstrap list by default', () => {
    expect(DEFAULT_CONFIG.p2p?.bootstrap).toBeDefined();
    expect(DEFAULT_CONFIG.p2p!.bootstrap!.length).toBeGreaterThan(0);
  });

  it('uses the same bootstrap multiaddr as DEFAULT_P2P_CONFIG', () => {
    expect(DEFAULT_CONFIG.p2p!.bootstrap).toEqual(DEFAULT_P2P_CONFIG.bootstrap);
  });

  it('contains the canonical BOOTSTRAP_MULTIADDR', () => {
    expect(DEFAULT_CONFIG.p2p!.bootstrap).toContain(BOOTSTRAP_MULTIADDR);
  });
});

describe('bootstrap fallback treats empty array as missing', () => {
  it('empty array from config should fallback to DEFAULT_P2P_CONFIG.bootstrap', () => {
    const configBootstrap: string[] = [];
    const persistedBootstrap: string[] = [];

    // Replicate the fixed fallback logic from ClawNetNode.startInternal()
    const resolved =
      (configBootstrap.length ? configBootstrap : undefined)
      ?? (persistedBootstrap.length ? persistedBootstrap : undefined)
      ?? DEFAULT_P2P_CONFIG.bootstrap;

    expect(resolved).toEqual(DEFAULT_P2P_CONFIG.bootstrap);
    expect(resolved.length).toBeGreaterThan(0);
  });

  it('non-empty config bootstrap takes precedence', () => {
    const custom = ['/ip4/1.2.3.4/tcp/9527/p2p/QmTest'];
    const persisted: string[] = [];

    const resolved =
      (custom.length ? custom : undefined)
      ?? (persisted.length ? persisted : undefined)
      ?? DEFAULT_P2P_CONFIG.bootstrap;

    expect(resolved).toEqual(custom);
  });
});

describe('BOOTSTRAP_P2P_CONFIG', () => {
  it('disables floodPublish for amplification protection', () => {
    expect(BOOTSTRAP_P2P_CONFIG.floodPublish).toBe(false);
  });

  it('has higher maxConnections than default', () => {
    const defaultMax = DEFAULT_P2P_CONFIG.connectionManager?.maxConnections ?? 100;
    const bootstrapMax = BOOTSTRAP_P2P_CONFIG.connectionManager?.maxConnections ?? 100;
    expect(bootstrapMax).toBeGreaterThan(defaultMax);
  });

  it('has no bootstrap peers (bootstrap is the root)', () => {
    expect(BOOTSTRAP_P2P_CONFIG.bootstrap).toEqual([]);
  });

  it('has tighter yamux stream limits', () => {
    const defaultStreams = DEFAULT_P2P_CONFIG.yamuxMaxInboundStreams ?? 256;
    const bootstrapStreams = BOOTSTRAP_P2P_CONFIG.yamuxMaxInboundStreams ?? 256;
    expect(bootstrapStreams).toBeLessThanOrEqual(defaultStreams);
  });

  it('has higher mesh parameters for hub topology', () => {
    expect(BOOTSTRAP_P2P_CONFIG.meshD!).toBeGreaterThan(DEFAULT_P2P_CONFIG.meshD!);
    expect(BOOTSTRAP_P2P_CONFIG.meshDhi!).toBeGreaterThan(DEFAULT_P2P_CONFIG.meshDhi!);
  });
});
