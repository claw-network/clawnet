/**
 * Node status and management API.
 */
import type { HttpClient, RequestOptions } from './http.js';
import type { NodeStatus, NodePeersResponse, NodeConfig } from './types.js';

export class NodeApi {
  constructor(private readonly http: HttpClient) {}

  /** Get node status (sync state, peers, version, uptime). */
  async getStatus(opts?: RequestOptions): Promise<NodeStatus> {
    return this.http.get<NodeStatus>('/api/node/status', undefined, opts);
  }

  /** List connected peers. */
  async getPeers(opts?: RequestOptions): Promise<NodePeersResponse> {
    return this.http.get<NodePeersResponse>('/api/node/peers', undefined, opts);
  }

  /** Get node configuration. */
  async getConfig(opts?: RequestOptions): Promise<NodeConfig> {
    return this.http.get<NodeConfig>('/api/node/config', undefined, opts);
  }

  /**
   * Wait until the node reports `synced: true`.
   * Polls every `intervalMs` (default 2 000 ms) up to `timeoutMs` (default 60 000 ms).
   */
  async waitForSync(timeoutMs = 60_000, intervalMs = 2_000, opts?: RequestOptions): Promise<NodeStatus> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getStatus(opts);
      if (status.synced) return status;
      await sleep(intervalMs);
    }
    throw new Error(`Node did not sync within ${timeoutMs}ms`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
