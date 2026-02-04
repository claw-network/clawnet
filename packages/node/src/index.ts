import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import {
  createEd25519PeerId,
  createFromProtobuf,
  exportToProtobuf,
} from '@libp2p/peer-id-factory';
import {
  DEFAULT_P2P_CONFIG,
  P2PConfig,
  P2PNode,
} from '@clawtoken/core/p2p';
import {
  EventStore,
  SnapshotStore,
  ensureConfig,
  ensureStorageDirs,
  LevelStore,
  resolveStoragePaths,
} from '@clawtoken/core/storage';
import { P2PSync, P2PSyncConfig } from './p2p/sync.js';

export interface NodeRuntimeConfig {
  dataDir?: string;
  p2p?: Partial<P2PConfig>;
  sync?: Partial<P2PSyncConfig> & {
    rangeIntervalMs?: number;
    snapshotIntervalMs?: number;
    requestRangeOnStart?: boolean;
    requestSnapshotOnStart?: boolean;
  };
}

export class ClawTokenNode {
  private readonly config: NodeRuntimeConfig;
  private p2p?: P2PNode;
  private sync?: P2PSync;
  private eventDb?: LevelStore;
  private eventStore?: EventStore;
  private snapshotStore?: SnapshotStore;
  private rangeTimer?: NodeJS.Timeout;
  private snapshotTimer?: NodeJS.Timeout;
  private peerId?: any;
  private peerPrivateKey?: Uint8Array;

  constructor(config: NodeRuntimeConfig = {}) {
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.p2p) {
      return;
    }

    const paths = resolveStoragePaths(this.config.dataDir);
    await ensureStorageDirs(paths);
    const persisted = await ensureConfig(paths);

    const peerId = await this.loadOrCreatePeerId(paths.keys);
    const privateKey = this.extractPeerPrivateKey(peerId);

    const p2pConfig: Partial<P2PConfig> = {
      ...DEFAULT_P2P_CONFIG,
      ...this.config.p2p,
      listen: this.config.p2p?.listen ?? persisted.p2p?.listen ?? DEFAULT_P2P_CONFIG.listen,
      bootstrap:
        this.config.p2p?.bootstrap ?? persisted.p2p?.bootstrap ?? DEFAULT_P2P_CONFIG.bootstrap,
    };

    this.eventDb = new LevelStore({ path: paths.eventsDb });
    this.eventStore = new EventStore(this.eventDb);
    this.snapshotStore = new SnapshotStore(paths);

    this.p2p = new P2PNode(p2pConfig, peerId);
    await this.p2p.start();

    this.peerId = peerId;
    this.peerPrivateKey = privateKey;

    this.sync = new P2PSync(this.p2p, this.eventStore, this.snapshotStore, {
      peerId: peerId.toString(),
      peerPrivateKey: privateKey,
      resolvePeerPublicKey: (id) => this.p2p?.getPeerPublicKey(id) ?? Promise.resolve(null),
      ...this.config.sync,
    });
    await this.sync.start();

    await this.startSyncLoops();
  }

  async stop(): Promise<void> {
    this.stopSyncLoops();
    await this.sync?.stop();
    await this.p2p?.stop();
    await this.eventDb?.close();
    this.sync = undefined;
    this.p2p = undefined;
    this.eventDb = undefined;
    this.eventStore = undefined;
    this.snapshotStore = undefined;
  }

  getPeerId(): string | null {
    if (!this.peerId) {
      return null;
    }
    return this.peerId.toString();
  }

  private async startSyncLoops(): Promise<void> {
    if (!this.sync || !this.eventStore) {
      return;
    }
    const syncConfig = this.config.sync ?? {};
    const requestSnapshotOnStart = syncConfig.requestSnapshotOnStart ?? true;
    const requestRangeOnStart = syncConfig.requestRangeOnStart ?? true;

    if (requestSnapshotOnStart) {
      const latest = await this.snapshotStore?.loadLatestSnapshot();
      await this.sync.requestSnapshot(latest?.hash ?? '');
    }

    if (requestRangeOnStart) {
      const latestHash = await this.eventStore.getLatestEventHash();
      await this.sync.requestRange(latestHash ?? '');
    }

    if (syncConfig.rangeIntervalMs && syncConfig.rangeIntervalMs > 0) {
      this.rangeTimer = setInterval(() => {
        void this.requestRangeTick();
      }, syncConfig.rangeIntervalMs);
    }

    if (syncConfig.snapshotIntervalMs && syncConfig.snapshotIntervalMs > 0) {
      this.snapshotTimer = setInterval(() => {
        void this.requestSnapshotTick();
      }, syncConfig.snapshotIntervalMs);
    }
  }

  private stopSyncLoops(): void {
    if (this.rangeTimer) {
      clearInterval(this.rangeTimer);
      this.rangeTimer = undefined;
    }
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  private async requestRangeTick(): Promise<void> {
    if (!this.sync || !this.eventStore) {
      return;
    }
    const latestHash = await this.eventStore.getLatestEventHash();
    await this.sync.requestRange(latestHash ?? '');
  }

  private async requestSnapshotTick(): Promise<void> {
    if (!this.sync || !this.snapshotStore) {
      return;
    }
    const latest = await this.snapshotStore.loadLatestSnapshot();
    await this.sync.requestSnapshot(latest?.hash ?? '');
  }

  private async loadOrCreatePeerId(keysDir: string): Promise<any> {
    const path = join(keysDir, 'peer-id.bin');
    try {
      const data = await readFile(path);
      return createFromProtobuf(new Uint8Array(data));
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        throw error;
      }
    }
    const peerId = await createEd25519PeerId();
    const protobuf = exportToProtobuf(peerId);
    await writeFile(path, protobuf);
    return peerId;
  }

  private extractPeerPrivateKey(peerId: any): Uint8Array {
    if (!peerId?.privateKey) {
      throw new Error('PeerId missing private key');
    }
    const privateKey = privateKeyFromProtobuf(peerId.privateKey);
    if (privateKey.type !== 'Ed25519') {
      throw new Error(`Unsupported peer key type ${privateKey.type}`);
    }
    const raw = privateKey.raw;
    if (raw.length === 32) {
      return raw;
    }
    if (raw.length >= 32) {
      return raw.slice(0, 32);
    }
    throw new Error('Invalid peer private key length');
  }
}

export * from './p2p/sync.js';
