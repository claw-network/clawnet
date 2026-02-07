import '../utils/PromiseWithResolvers.js';
import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { kadDHT } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
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
  dial?: (address: unknown) => Promise<unknown>;
  services?: Libp2pNodeServices;
  peerStore?: PeerStoreLike;
};

export class P2PNode {
  private node: Libp2pNode | null = null;
  private readonly config: P2PConfig;
  private readonly peerIdOverride?: PeerIdLike;

  constructor(config: Partial<P2PConfig> = {}, peerId?: PeerIdLike) {
    this.config = { ...DEFAULT_P2P_CONFIG, ...config };
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

    const options = {
      addresses: {
        listen: this.config.listen,
      },
      connectionManager: {
        maxConnections: this.config.connectionManager?.maxConnections ?? 100,
      },
      transports: [tcp()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],
      peerDiscovery: this.config.bootstrap.length
        ? [
            bootstrap({
              list: this.config.bootstrap,
              timeout: 1000,
            }),
          ]
        : [],
      services,
    };

    if (this.peerIdOverride) {
      (options as { peerId?: PeerIdLike }).peerId = this.peerIdOverride;
    }

    const node = await createLibp2p(options as unknown as Libp2pOptions);
    this.node = node as unknown as Libp2pNode;
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

  getSubscribers(topic: string): string[] {
    const pubsub = this.getPubsub();
    return (
      pubsub.getSubscribers?.(topic)?.map((peer: { toString: () => string }) => peer.toString()) ??
      []
    );
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
