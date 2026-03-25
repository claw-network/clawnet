/**
 * Relay quality scorer — probes candidate relay nodes and ranks them (F5).
 *
 * Uses:
 *   - libp2p ping for latency measurement
 *   - `/clawnet/1.0.0/relay-info` protocol for load information
 *   - Local success rate history
 *
 * Cached scores have a 5-minute TTL to avoid excessive probing.
 */

import type { P2PNode } from './node.js';

// ── Public types ────────────────────────────────────────────────

export interface RelayScore {
  peerId: string;
  latencyMs: number;
  availableCapacity: number;
  maxCapacity: number;
  successRate: number;
  uptimeSeconds: number;
  score: number;
}

// ── Constants ──────────────────────────────────────────────────

const SCORE_CACHE_TTL_MS = 5 * 60_000;   // 5 minutes
const MAX_HISTORY_PER_PEER = 20;
const PROBE_TIMEOUT_MS = 5_000;

// ── Internal cache entry ───────────────────────────────────────

interface CachedScore {
  score: RelayScore;
  cachedAt: number;
}

interface PeerHistory {
  attempts: number;
  successes: number;
}

// ── Scorer Implementation ──────────────────────────────────────

export class RelayScorer {
  private readonly node: P2PNode;
  private cache = new Map<string, CachedScore>();
  private history = new Map<string, PeerHistory>();

  constructor(node: P2PNode) {
    this.node = node;
  }

  /**
   * Score a list of candidate relay peers.
   * Probes each one (or uses cached result) and returns sorted scores (best first).
   */
  async scoreRelays(candidates: string[]): Promise<RelayScore[]> {
    const now = Date.now();
    const results: RelayScore[] = [];

    // Probe candidates in parallel
    const probePromises = candidates.map(async (peerId) => {
      const cached = this.cache.get(peerId);
      if (cached && (now - cached.cachedAt) < SCORE_CACHE_TTL_MS) {
        return cached.score;
      }
      return this.probePeer(peerId);
    });

    const scores = await Promise.allSettled(probePromises);
    for (const result of scores) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Select the best relay from a list of candidates.
   * Returns null if no relay is reachable.
   */
  async selectBestRelay(candidates: string[]): Promise<RelayScore | null> {
    const scores = await this.scoreRelays(candidates);
    return scores.length > 0 ? scores[0] : null;
  }

  /** Record a connection attempt result for success rate tracking. */
  recordAttempt(peerId: string, success: boolean): void {
    const h = this.getOrCreateHistory(peerId);
    h.attempts = Math.min(h.attempts + 1, MAX_HISTORY_PER_PEER);
    if (success) {
      h.successes = Math.min(h.successes + 1, MAX_HISTORY_PER_PEER);
    }
  }

  /** Clear all cached scores. */
  clearCache(): void {
    this.cache.clear();
  }

  private async probePeer(peerId: string): Promise<RelayScore | null> {
    const h = this.getOrCreateHistory(peerId);
    h.attempts++;

    // Probe latency and relay info in parallel
    const [latencyMs, info] = await Promise.all([
      this.node.pingPeer(peerId),
      this.node.probeRelayInfo(peerId, PROBE_TIMEOUT_MS),
    ]);

    if (latencyMs < 0 && !info) {
      // Completely unreachable
      return null;
    }

    h.successes++;
    const successRate = h.attempts > 0 ? h.successes / h.attempts : 0;
    const effectiveLatency = latencyMs > 0 ? latencyMs : 500; // assume 500ms if ping failed
    const maxCapacity = info?.maxCircuits ?? 64;
    const activeCircuits = info?.activeCircuits ?? 0;
    const availableCapacity = Math.max(0, maxCapacity - activeCircuits);
    const uptimeSeconds = info?.uptimeSeconds ?? 0;

    // Score formula: (1 / latencyMs) * 100 * successRate * capacity_factor
    const capacityFactor = maxCapacity > 0 ? Math.min(availableCapacity / maxCapacity, 1.0) : 0;
    const score = (1 / effectiveLatency) * 100 * successRate * capacityFactor;

    const result: RelayScore = {
      peerId,
      latencyMs: latencyMs > 0 ? latencyMs : -1,
      availableCapacity,
      maxCapacity,
      successRate,
      uptimeSeconds,
      score,
    };

    this.cache.set(peerId, { score: result, cachedAt: Date.now() });
    return result;
  }

  private getOrCreateHistory(peerId: string): PeerHistory {
    let h = this.history.get(peerId);
    if (!h) {
      h = { attempts: 0, successes: 0 };
      this.history.set(peerId, h);
    }
    return h;
  }
}
