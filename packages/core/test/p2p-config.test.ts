import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_P2P_CONFIG, DEFAULT_P2P_CONFIG } from '../src/p2p/config.js';

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
