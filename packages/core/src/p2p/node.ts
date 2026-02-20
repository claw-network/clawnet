import '../utils/PromiseWithResolvers.js';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { kadDHT } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import { mdns } from '@libp2p/mdns';
import { identify } from '@libp2p/identify';
import { autoNAT } from '@libp2p/autonat';
import { dcutr } from '@libp2p/dcutr';
import { ping } from '@libp2p/ping';
import { multiaddr } from '@multiformats/multiaddr';
import type { Libp2pOptions } from 'libp2p';
import { sha256Bytes } from '../crypto/hash.js';
import { P2PConfig, DEFAULT_P2P_CONFIG } from './config.js';

export interface PubsubMessage {
  topic: string;
  data: Uint8Array;
  from?: string;
}

export type MessageHandler = (message: PubsubMessage) => void | Promise<void>;

type PeerIdLike = { toString: () => string };

type PrivateKeyLike = { raw: Uint8Array; type: string; publicKey: unknown };

type PubsubPeer = { toString: () => string };

type PubsubEventDetail = {
  topic: string;
  data: Uint8Array;
  from?: { toString?: () => string };
};

type PubsubEvent = {
  detail?: PubsubEventDetail;
};

type PubsubListener = (event: PubsubEvent) => void;

type PubsubPublishResult = {
  recipients?: PubsubPeer[];
};

type PubsubService = {
  publish: (topic: string, data: Uint8Array) => Promise<PubsubPublishResult | undefined>;
  subscribe: (topic: string) => void;
  unsubscribe: (topic: string) => void;
  addEventListener: (type: 'message', listener: PubsubListener) => void;
  removeEventListener: (type: 'message', listener: PubsubListener) => void;
  getPeers?: () => PubsubPeer[];
  getSubscribers?: (topic: string) => PubsubPeer[];
};

type PublicKeyLike = {
  bytes?: Uint8Array;
  raw?: Uint8Array;
  marshal?: () => Uint8Array;
  toBytes?: () => Uint8Array;
};

type PeerRecordLike = {
  id?: { publicKey?: PublicKeyLike };
  publicKey?: PublicKeyLike;
};

type PeerStoreLike = {
  get: (peerId: string) => Promise<PeerRecordLike | undefined>;
};

type Libp2pNodeServices = {
  pubsub?: PubsubService;
} & Record<string, unknown>;

type Libp2pNode = {
  peerId?: { toString: () => string };
  stop: () => Promise<void>;
  getMultiaddrs?: () => Array<{ toString: () => string }>;
  getConnections?: () => Array<{ remotePeer?: { toString: () => string }; status?: string }>;
  dial?: (address: unknown) => Promise<unknown>;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  services?: Libp2pNodeServices;
  peerStore?: PeerStoreLike;
};

export class P2PNode {
  private node: Libp2pNode | null = null;
  private readonly config: P2PConfig;
  private readonly privateKeyOverride?: PrivateKeyLike;
  private readonly peerIdOverride?: PeerIdLike;

  constructor(config: Partial<P2PConfig> = {}, privateKey?: PrivateKeyLike, peerId?: PeerIdLike) {
    this.config = { ...DEFAULT_P2P_CONFIG, ...config };
    this.privateKeyOverride = privateKey;
    this.peerIdOverride = peerId;
  }

  async start(): Promise<void> {
    if (this.node) {
      return;
    }

    if (this.config.enableDHT === false) {
      throw new Error('DHT is required by spec and cannot be disabled');
    }

    const pubsub = gossipsub({
      allowPublishToZeroTopicPeers: this.config.allowPublishToZeroPeers,
      msgIdFn: (message: { data: Uint8Array }) => sha256Bytes(message.data),
      // ── Mesh tuning for small networks ──────────────────────────────────
      // floodPublish bypasses mesh and sends to ALL connected peers, which
      // guarantees delivery in networks with sparse GossipSub mesh coverage.
      floodPublish: this.config.floodPublish ?? true,
      D: this.config.meshD ?? 3,       // mesh degree target (default 6 too high for ≤10 nodes)
      Dlo: this.config.meshDlo ?? 1,   // min mesh peers before grafting
      Dhi: this.config.meshDhi ?? 5,   // max mesh peers before pruning
      heartbeatInterval: this.config.heartbeatInterval ?? 700,
    });

    const services: Record<string, unknown> = {
      identify: identify(),
      pubsub,
    };

    if (this.config.enableDHT) {
      services.dht = kadDHT({
        clientMode: false,
      });
      services.ping = ping();
    }

    if (this.config.enableAutoNAT) {
      services.autoNAT = autoNAT();
    }

    if (this.config.enableDcutr) {
      services.dcutr = dcutr();
    }

    const options: Record<string, unknown> = {
      addresses: {
        listen: this.config.listen,
      },
      connectionManager: {
        minConnections: this.config.connectionManager?.minConnections ?? 1,
        maxConnections: this.config.connectionManager?.maxConnections ?? 100,
        // Auto-dial peers discovered via KadDHT every 5 s (default 60 s is too
        // slow for mesh formation in small networks).
        autoDialInterval: 5_000,
      },
      transports: [tcp()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],
      peerDiscovery: [
        // mDNS: discovers all peers on the same LAN / Docker bridge network
        // within seconds via multicast DNS.
        mdns({ interval: 5_000 }),
        // Bootstrap: connects to known seed nodes by multiaddr.
        ...(this.config.bootstrap.length
          ? [
              bootstrap({
                list: this.config.bootstrap,
                timeout: 1000,
              }),
            ]
          : []),
      ],
      services,
    };

    // libp2p v3: pass privateKey (not peerId) for identity
    if (this.privateKeyOverride) {
      options.privateKey = this.privateKeyOverride;
    } else if (this.peerIdOverride) {
      // Fallback for older code paths
      options.peerId = this.peerIdOverride;
    }

    const node = await createLibp2p(options as unknown as Libp2pOptions);
    this.node = node as unknown as Libp2pNode;

    // Log connection events for debugging
    this.node.addEventListener?.('peer:connect', (event: unknown) => {
      const detail = (event as { detail?: { toString?: () => string } })?.detail;
      console.log(`[p2p] peer:connect ${detail?.toString?.() ?? 'unknown'}`);
    });
    this.node.addEventListener?.('peer:disconnect', (event: unknown) => {
      const detail = (event as { detail?: { toString?: () => string } })?.detail;
      console.log(`[p2p] peer:disconnect ${detail?.toString?.() ?? 'unknown'}`);
    });
    this.node.addEventListener?.('peer:discovery', (event: unknown) => {
      const detail = (event as { detail?: { id?: { toString?: () => string } } })?.detail;
      console.log(`[p2p] peer:discovery ${detail?.id?.toString?.() ?? 'unknown'}`);
    });
  }

  async stop(): Promise<void> {
    if (!this.node) {
      return;
    }
    await this.node.stop();
    this.node = null;
  }

  getPeerId(): string | null {
    if (!this.node?.peerId) {
      return null;
    }
    return this.node.peerId.toString();
  }

  getMultiaddrs(): string[] {
    if (!this.node?.getMultiaddrs) {
      return [];
    }
    return this.node.getMultiaddrs().map((addr: { toString: () => string }) => addr.toString());
  }

  async publish(topic: string, data: Uint8Array): Promise<string[]> {
    const pubsub = this.getPubsub();
    const result = await pubsub.publish(topic, data);
    if (result?.recipients) {
      return result.recipients.map((peer: { toString: () => string }) => peer.toString());
    }
    return [];
  }

  async connect(address: string): Promise<void> {
    if (!this.node?.dial) {
      throw new Error('node not started');
    }
    await this.node.dial(multiaddr(address));
  }

  async subscribe(topic: string, handler: MessageHandler): Promise<() => void> {
    const pubsub = this.getPubsub();
    const listener: PubsubListener = (event) => {
      const message = event.detail;
      if (!message || message.topic !== topic) {
        return;
      }
      void handler({
        topic: message.topic,
        data: message.data,
        from: message.from?.toString?.(),
      });
    };

    pubsub.addEventListener('message', listener);
    pubsub.subscribe(topic);

    return () => {
      pubsub.removeEventListener('message', listener);
      pubsub.unsubscribe(topic);
    };
  }

  getPeers(): string[] {
    const pubsub = this.getPubsub();
    return pubsub.getPeers?.().map((peer: { toString: () => string }) => peer.toString()) ?? [];
  }

  getConnections(): string[] {
    if (!this.node?.getConnections) {
      return [];
    }
    return this.node.getConnections()
      .map((c) => c.remotePeer?.toString() ?? '')
      .filter(Boolean);
  }

  getSubscribers(topic: string): string[] {
    const pubsub = this.getPubsub();
    return (
      pubsub.getSubscribers?.(topic)?.map((peer: { toString: () => string }) => peer.toString()) ??
      []
    );
  }

  /**
   * Actively discover peers via KadDHT random walk and dial them.
   * This breaks out of a star topology by querying the bootstrap node's
   * DHT routing table for other peers, then connecting directly.
   * Returns the number of newly dialled peers.
   */
  async amplifyMesh(): Promise<number> {
    if (!this.node) return 0;

    const currentPeers = new Set(this.getConnections());
    const myPeerId = this.getPeerId() ?? '';
    let newPeers = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeAny = this.node as any;

    // ── Approach 1: Enumerate peerStore and dial unknown peers ──────────
    // mDNS / KadDHT populate the peerStore with peers on the local network.
    // Explicitly dialling them ensures a full-mesh topology.
    try {
      const peerStore = nodeAny.peerStore;
      if (peerStore?.all) {
        const allPeers = await peerStore.all();
        for (const peer of allPeers) {
          const pid = peer?.id?.toString?.() ?? '';
          if (!pid || pid === myPeerId || currentPeers.has(pid)) continue;
          try {
            await this.node.dial?.(peer.id);
            newPeers++;
            currentPeers.add(pid);
          } catch {
            // peer may not be reachable yet
          }
        }
      }
    } catch {
      // peerStore enumeration not available in this libp2p version
    }

    // ── Approach 2: KadDHT random walk (fallback) ──────────────────────
    if (newPeers === 0) {
      try {
        const routing = nodeAny.peerRouting ?? nodeAny.services?.dht;
        if (routing?.getClosestPeers) {
          const randomKey = new Uint8Array(32);
          globalThis.crypto.getRandomValues(randomKey);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3_000);
          try {
            for await (const peer of routing.getClosestPeers(randomKey, {
              signal: controller.signal,
            })) {
              const id = peer?.id;
              const pid = id?.toString?.() ?? '';
              if (!pid || pid === myPeerId || currentPeers.has(pid)) continue;
              try {
                await this.node.dial?.(id);
                newPeers++;
                currentPeers.add(pid);
              } catch {
                // dial failure expected for unreachable peers
              }
            }
          } finally {
            clearTimeout(timeout);
          }
        }
      } catch {
        // DHT walk can fail / timeout when node is still bootstrapping
      }
    }

    return newPeers;
  }

  async getPeerPublicKey(peerId: string): Promise<Uint8Array | null> {
    if (!this.node?.peerStore?.get) {
      return null;
    }
    try {
      const record = await this.node.peerStore.get(peerId);
      const publicKey = record?.id?.publicKey ?? record?.publicKey;
      if (!publicKey) {
        return null;
      }
      if (publicKey.bytes) {
        return publicKey.bytes;
      }
      if (publicKey.raw) {
        return publicKey.raw;
      }
      if (publicKey.marshal) {
        return publicKey.marshal();
      }
      if (publicKey.toBytes) {
        return publicKey.toBytes();
      }
      return null;
    } catch {
      return null;
    }
  }

  private getPubsub(): PubsubService {
    const pubsub = this.node?.services?.pubsub;
    if (!pubsub) {
      throw new Error('pubsub service not initialized');
    }
    return pubsub;
  }
}
