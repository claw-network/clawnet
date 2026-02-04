export interface P2PConfig {
  listen: string[];
  bootstrap: string[];
  enableDHT: boolean;
  allowPublishToZeroPeers: boolean;
  enableAutoNAT: boolean;
  enableDcutr: boolean;
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
};
