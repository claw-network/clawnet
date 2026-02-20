export interface P2PConfig {
  listen: string[];
  bootstrap: string[];
  enableDHT: boolean;
  allowPublishToZeroPeers: boolean;
  enableAutoNAT: boolean;
  enableDcutr: boolean;
  /** Flood-publish to ALL connected peers instead of only mesh peers. Default: true */
  floodPublish?: boolean;
  /** GossipSub mesh degree target (D). Default: 3 (suitable for small networks) */
  meshD?: number;
  /** GossipSub minimum mesh peers (Dlo). Default: 1 */
  meshDlo?: number;
  /** GossipSub maximum mesh peers (Dhi). Default: 5 */
  meshDhi?: number;
  /** GossipSub heartbeat interval in ms. Default: 700 */
  heartbeatInterval?: number;
  connectionManager?: {
    minConnections?: number;
    maxConnections?: number;
    dialTimeout?: number;
  };
  pubsubTopics?: string[];
}

export const DEFAULT_P2P_CONFIG: P2PConfig = {
  listen: ['/ip4/0.0.0.0/tcp/9527'],
  bootstrap: [],
  enableDHT: true,
  allowPublishToZeroPeers: true,
  enableAutoNAT: true,
  enableDcutr: true,
  floodPublish: true,
  meshD: 3,
  meshDlo: 1,
  meshDhi: 5,
  heartbeatInterval: 700,
};
