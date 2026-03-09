/**
 * Relay API — relay statistics, health diagnosis, and access control.
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
}
