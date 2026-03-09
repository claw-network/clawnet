/**
 * Relay API — relay statistics, health diagnosis, access control,
 * relay discovery, quality scoring, and drain management.
 */
import type { HttpClient, RequestOptions } from './http.js';

// ── Types ───────────────────────────────────────────────────────

export interface RelayPeriodStats {
  periodStart: number;
  periodEnd: number;
  bytesRelayed: number;
  attachmentBytesRelayed: number;
  circuitsServed: number;
  uniquePeersServed: number;
}

export interface RelayStats {
  relayEnabled: boolean;
  totalCircuitsServed: number;
  activeCircuits: number;
  totalBytesRelayed: number;
  totalMessagesRelayed: number;
  totalAttachmentBytesRelayed: number;
  uptimeSeconds: number;
  periodStats: RelayPeriodStats;
}

export interface RelayHealthInfo {
  relayEnabled: boolean;
  natStatus: 'public' | 'private' | 'unknown';
  publicAddresses: string[];
  isReachable: boolean;
  load: {
    activeCircuits: number;
    maxCircuits: number;
    utilizationPercent: number;
  };
  warnings: string[];
}

export interface RelayAccessInfo {
  mode: 'open' | 'whitelist' | 'blacklist';
  list: string[];
}

export interface RelayAccessUpdateParams {
  action?: 'add' | 'remove';
  did?: string;
  mode?: 'open' | 'whitelist' | 'blacklist';
}

/** Relay discovery result (F2). */
export interface RelayDiscoveryInfo {
  relays: string[];
  count: number;
}

/** Relay quality score (F5). */
export interface RelayScore {
  peerId: string;
  latencyMs: number;
  availableCapacity: number;
  maxCapacity: number;
  successRate: number;
  uptimeSeconds: number;
  score: number;
}

/** Relay scoring result (F5). */
export interface RelayScoresInfo {
  scores: RelayScore[];
  count: number;
}

/** Relay peers info (F12). */
export interface RelayPeersInfo {
  peers: string[];
  count: number;
  draining: boolean;
}

/** Relay drain result (F12). */
export interface RelayDrainResult {
  draining: boolean;
}

// ── API class ───────────────────────────────────────────────────

export class RelayApi {
  constructor(private readonly http: HttpClient) {}

  /** Get relay traffic statistics. */
  async getStats(opts?: RequestOptions): Promise<RelayStats> {
    return this.http.get<RelayStats>('/api/v1/relay/stats', undefined, opts);
  }

  /** Get relay self-diagnosis health info. */
  async getHealth(opts?: RequestOptions): Promise<RelayHealthInfo> {
    return this.http.get<RelayHealthInfo>('/api/v1/relay/health', undefined, opts);
  }

  /** Get current relay access control settings. */
  async getAccess(opts?: RequestOptions): Promise<RelayAccessInfo> {
    return this.http.get<RelayAccessInfo>('/api/v1/relay/access', undefined, opts);
  }

  /** Update relay access control settings (add/remove DID, or change mode). */
  async updateAccess(params: RelayAccessUpdateParams, opts?: RequestOptions): Promise<RelayAccessInfo> {
    return this.http.post<RelayAccessInfo>('/api/v1/relay/access', params, opts);
  }

  /** Discover relay nodes via DHT (F2). */
  async discover(opts?: RequestOptions): Promise<RelayDiscoveryInfo> {
    return this.http.get<RelayDiscoveryInfo>('/api/v1/relay/discover', undefined, opts);
  }

  /** Get scored relay candidates (F5). Discovers + probes + scores. */
  async getScores(opts?: RequestOptions): Promise<RelayScoresInfo> {
    return this.http.get<RelayScoresInfo>('/api/v1/relay/scores', undefined, opts);
  }

  /** Get peers using this node as relay (F12). */
  async getPeers(opts?: RequestOptions): Promise<RelayPeersInfo> {
    return this.http.get<RelayPeersInfo>('/api/v1/relay/peers', undefined, opts);
  }

  /** Start or stop graceful relay drain (F12). */
  async setDrain(enable = true, opts?: RequestOptions): Promise<RelayDrainResult> {
    return this.http.post<RelayDrainResult>('/api/v1/relay/drain', { enable }, opts);
  }
}
