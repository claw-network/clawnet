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
import { multiaddr } from '@multiformats/multiaddr';
import { sha256Bytes } from '../crypto/hash.js';
import { P2PConfig, DEFAULT_P2P_CONFIG } from './config.js';

export interface PubsubMessage {
  topic: string;
  data: Uint8Array;
  from?: string;
}

export type MessageHandler = (message: PubsubMessage) => void | Promise<void>;

export class P2PNode {
  private node: any;
  private readonly config: P2PConfig;
  private readonly peerIdOverride?: unknown;

  constructor(config: Partial<P2PConfig> = {}, peerId?: unknown) {
    this.config = { ...DEFAULT_P2P_CONFIG, ...config };
    this.peerIdOverride = peerId;
  }

  async start(): Promise<void> {
    if (this.node) {
      return;
    }

    const pubsub = gossipsub({
      allowPublishToZeroTopicPeers: this.config.allowPublishToZeroPeers,
      msgIdFn: (message: { data: Uint8Array }) => sha256Bytes(message.data),
    });

    const services: any = {
      identify: identify(),
      pubsub,
    };

    if (this.config.enableDHT) {
      services.dht = kadDHT({
        clientMode: false,
      });
    }

    if (this.config.enableAutoNAT) {
      services.autoNAT = autoNAT();
    }

    if (this.config.enableDcutr) {
      services.dcutr = dcutr();
    }

    const options: any = {
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
      options.peerId = this.peerIdOverride;
    }

    this.node = await createLibp2p(options);
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
    const listener = (event: CustomEvent<any>) => {
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
        return publicKey.bytes as Uint8Array;
      }
      if (publicKey.raw) {
        return publicKey.raw as Uint8Array;
      }
      if (publicKey.marshal) {
        return publicKey.marshal() as Uint8Array;
      }
      if (publicKey.toBytes) {
        return publicKey.toBytes() as Uint8Array;
      }
      return null;
    } catch {
      return null;
    }
  }

  private getPubsub(): any {
    if (!this.node?.services?.pubsub) {
      throw new Error('pubsub service not initialized');
    }
    return this.node.services.pubsub;
  }
}
