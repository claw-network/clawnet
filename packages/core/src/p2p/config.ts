/** Fine-grained circuit-relay-v2 server configuration. */
export interface RelayConfig {
  /** Enable circuit-relay-v2 server. Default: true */
  enabled: boolean;
  /** Maximum simultaneous relay circuits. Default: 64 */
  maxCircuits: number;
  /** Maximum relay bandwidth per circuit (bytes/sec). Default: 1048576 (1 MB/s) */
  maxBandwidthBps: number;
  /** Relay reservation TTL in seconds. Default: 3600 */
  reservationTtlSec: number;
  /** Maximum data per circuit (bytes). Default: 10485760 (10 MB) */
  maxCircuitBytes: number;
  /** Maximum simultaneous relay circuits per peer. Default: 4 */
  maxCircuitsPerPeer: number;
  /** Maximum new reservations per peer per minute. Default: 10 */
  maxReservationsPerPeerPerMin: number;
  /** Access control mode. Default: 'open' */
  accessMode: 'open' | 'whitelist' | 'blacklist';
  /** DID list for whitelist/blacklist mode. Default: [] */
  accessList: string[];
}

export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  enabled: true,
  maxCircuits: 64,
  maxBandwidthBps: 1_048_576,
  reservationTtlSec: 3600,
  maxCircuitBytes: 10_485_760,
  maxCircuitsPerPeer: 4,
  maxReservationsPerPeerPerMin: 10,
  accessMode: 'open',
  accessList: [],
};

export const BOOTSTRAP_RELAY_CONFIG: RelayConfig = {
  ...DEFAULT_RELAY_CONFIG,
  maxCircuits: 256,
  maxBandwidthBps: 10_485_760,
  maxCircuitsPerPeer: 8,
  maxReservationsPerPeerPerMin: 20,
};

export interface P2PConfig {
  listen: string[];
  bootstrap: string[];
  enableDHT: boolean;
  allowPublishToZeroPeers: boolean;
  enableAutoNAT: boolean;
  enableDcutr: boolean;
  /** Enable circuit relay v2 for NAT traversal. Default: true */
  enableCircuitRelay: boolean;
  /** Fine-grained relay server configuration. Overrides enableCircuitRelay when present. */
  relay?: Partial<RelayConfig>;
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
  /** Max inbound yamux streams per connection. Default: 256 */
  yamuxMaxInboundStreams?: number;
  pubsubTopics?: string[];
}

/** Resolve the effective RelayConfig from a P2PConfig. */
export function resolveRelayConfig(config: P2PConfig): RelayConfig {
  const base = config.relay ?? {};
  const enabled = base.enabled ?? config.enableCircuitRelay;
  return { ...DEFAULT_RELAY_CONFIG, ...base, enabled };
}

/**
 * Official devnet bootstrap node.
 * New nodes connect here first to discover the rest of the network via Kademlia DHT.
 * Uses dns4 so the address survives IP changes — only the DNS A record needs updating.
 */
export const BOOTSTRAP_MULTIADDR =
  '/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW';

export const DEFAULT_P2P_CONFIG: P2PConfig = {
  listen: ['/ip4/0.0.0.0/tcp/9527'],
  bootstrap: [BOOTSTRAP_MULTIADDR],
  enableDHT: true,
  allowPublishToZeroPeers: true,
  enableAutoNAT: true,
  enableDcutr: true,
  enableCircuitRelay: true,
  relay: { ...DEFAULT_RELAY_CONFIG },
  floodPublish: true,
  meshD: 3,
  meshDlo: 1,
  meshDhi: 5,
  heartbeatInterval: 700,
  yamuxMaxInboundStreams: 256,
};

/**
 * Hardened config preset for bootstrap/seed nodes that accept many connections.
 * Key differences from DEFAULT_P2P_CONFIG:
 * - floodPublish disabled — prevents O(N) amplification when relaying messages
 * - Higher maxConnections — bootstrap must handle the entire network
 * - Tighter yamux stream limits — caps per-connection resource usage
 * - Higher mesh parameters — better GossipSub propagation with many peers
 */
export const BOOTSTRAP_P2P_CONFIG: P2PConfig = {
  listen: ['/ip4/0.0.0.0/tcp/9527'],
  bootstrap: [],   // bootstrap node has no bootstrap peers
  enableDHT: true,
  allowPublishToZeroPeers: true,
  enableAutoNAT: true,
  enableDcutr: true,
  enableCircuitRelay: true,
  relay: { ...BOOTSTRAP_RELAY_CONFIG },
  floodPublish: false,              // CRITICAL: prevent O(N) flood amplification
  meshD: 6,                         // higher mesh degree for hub topology
  meshDlo: 3,
  meshDhi: 12,
  heartbeatInterval: 700,
  yamuxMaxInboundStreams: 128,      // tighter per-connection limit for many peers
  connectionManager: {
    minConnections: 5,
    maxConnections: 500,            // bootstrap must handle many peers
  },
};
