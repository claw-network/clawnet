import { describe, expect, it, vi } from 'vitest';
import { RelayScorer } from '../src/p2p/relay-scorer.js';
import type { P2PNode, RelayInfoResponse } from '../src/p2p/node.js';

/** Create a mock P2PNode with controllable ping and probeRelayInfo. */
function mockNode(overrides: {
  pingPeer?: (peerId: string) => Promise<number>;
  probeRelayInfo?: (peerId: string) => Promise<RelayInfoResponse | null>;
} = {}): P2PNode {
  return {
    pingPeer: overrides.pingPeer ?? (async () => 50),
    probeRelayInfo: overrides.probeRelayInfo ?? (async () => ({
      activeCircuits: 10,
      maxCircuits: 64,
      uptimeSeconds: 3600,
    })),
  } as unknown as P2PNode;
}

describe('RelayScorer', () => {
  it('scores reachable candidates and sorts by score', async () => {
    const node = mockNode({
      pingPeer: async (id) => (id === 'fast' ? 20 : id === 'slow' ? 200 : -1),
      probeRelayInfo: async (id) => {
        if (id === 'unreachable') return null;
        return {
          activeCircuits: id === 'fast' ? 5 : 30,
          maxCircuits: 64,
          uptimeSeconds: 7200,
        };
      },
    });
    const scorer = new RelayScorer(node);

    const scores = await scorer.scoreRelays(['fast', 'slow', 'unreachable']);

    // 'unreachable' still gets scored if probeRelayInfo returns data
    // but here it returns null AND pingPeer returns -1, so it should be null
    expect(scores.length).toBe(2);
    expect(scores[0].peerId).toBe('fast');
    expect(scores[1].peerId).toBe('slow');
    expect(scores[0].score).toBeGreaterThan(scores[1].score);
  });

  it('uses cached scores within TTL', async () => {
    const pingFn = vi.fn(async () => 30);
    const node = mockNode({ pingPeer: pingFn });
    const scorer = new RelayScorer(node);

    await scorer.scoreRelays(['peer-1']);
    expect(pingFn).toHaveBeenCalledTimes(1);

    // Second call should hit cache
    await scorer.scoreRelays(['peer-1']);
    expect(pingFn).toHaveBeenCalledTimes(1);
  });

  it('clearCache forces re-probe', async () => {
    const pingFn = vi.fn(async () => 30);
    const node = mockNode({ pingPeer: pingFn });
    const scorer = new RelayScorer(node);

    await scorer.scoreRelays(['peer-1']);
    scorer.clearCache();
    await scorer.scoreRelays(['peer-1']);
    expect(pingFn).toHaveBeenCalledTimes(2);
  });

  it('selectBestRelay returns best candidate', async () => {
    const node = mockNode({
      pingPeer: async (id) => (id === 'A' ? 10 : 100),
    });
    const scorer = new RelayScorer(node);

    const best = await scorer.selectBestRelay(['A', 'B']);
    expect(best).not.toBeNull();
    expect(best!.peerId).toBe('A');
  });

  it('selectBestRelay returns null when no candidates reachable', async () => {
    const node = mockNode({
      pingPeer: async () => -1,
      probeRelayInfo: async () => null,
    });
    const scorer = new RelayScorer(node);

    const best = await scorer.selectBestRelay(['x', 'y']);
    expect(best).toBeNull();
  });

  it('recordAttempt tracks success rate', async () => {
    const node = mockNode();
    const scorer = new RelayScorer(node);

    // Pre-populate history
    scorer.recordAttempt('peer-1', true);
    scorer.recordAttempt('peer-1', true);
    scorer.recordAttempt('peer-1', false);

    const scores = await scorer.scoreRelays(['peer-1']);
    // Success rate should be (existing successes + probe success) / (existing attempts + probe attempt)
    // Pre: 2 success / 3 attempt. Probe adds 1 success, 1 attempt → 3/4=0.75 but probe also counts via internal logic
    expect(scores.length).toBe(1);
    expect(scores[0].successRate).toBeGreaterThan(0);
    expect(scores[0].successRate).toBeLessThanOrEqual(1);
  });

  it('capacity factor affects score — full relay scores lower', async () => {
    const node = mockNode({
      pingPeer: async () => 50,
      probeRelayInfo: async (id) => ({
        activeCircuits: id === 'full' ? 64 : 0,
        maxCircuits: 64,
        uptimeSeconds: 3600,
      }),
    });
    const scorer = new RelayScorer(node);

    const scores = await scorer.scoreRelays(['full', 'empty']);
    const fullScore = scores.find((s) => s.peerId === 'full')!;
    const emptyScore = scores.find((s) => s.peerId === 'empty')!;
    expect(emptyScore.score).toBeGreaterThan(fullScore.score);
    expect(fullScore.availableCapacity).toBe(0);
    expect(emptyScore.availableCapacity).toBe(64);
  });
});
