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
  TOPIC_EVENTS,
} from '@clawtoken/core/p2p';
import {
  EventStore,
  SnapshotStore,
  SnapshotScheduler,
  DEFAULT_SNAPSHOT_POLICY,
  SnapshotSchedulePolicy,
  SnapshotRecord,
  signSnapshot,
  ensureConfig,
  ensureStorageDirs,
  LevelStore,
  resolveStoragePaths,
} from '@clawtoken/core/storage';
import { canonicalizeBytes } from '@clawtoken/core/crypto';
import { EventEnvelope, eventHashHex } from '@clawtoken/core/protocol';
import { CONTENT_TYPE, encodeP2PEnvelopeBytes, signP2PEnvelope } from '@clawtoken/protocol/p2p';
import { P2PSync, P2PSyncConfig } from './p2p/sync.js';
import { ApiServer, ApiServerConfig } from './api/server.js';

export interface NodeRuntimeConfig {
  dataDir?: string;
  api?: Partial<ApiServerConfig> & { enabled?: boolean };
  p2p?: Partial<P2PConfig>;
  sync?: Partial<P2PSyncConfig> & {
    rangeIntervalMs?: number;
    snapshotIntervalMs?: number;
    requestRangeOnStart?: boolean;
    requestSnapshotOnStart?: boolean;
    validateSnapshotState?: (
      snapshot: import('@clawtoken/core/storage').SnapshotRecord,
      events: Uint8Array[],
    ) => Promise<boolean> | boolean;
  };
  snapshotBuilder?: (context: {
    eventStore: EventStore;
    snapshotStore: SnapshotStore;
    lastSnapshot: SnapshotRecord | null;
  }) => Promise<SnapshotRecord | null>;
  snapshotPolicy?: Partial<SnapshotSchedulePolicy>;
  resolveControllerPublicKey?: (controllerDid: string) => Promise<Uint8Array | null>;
}

export const DEFAULT_SYNC_RUNTIME_CONFIG = {
  rangeIntervalMs: 30_000,
  snapshotIntervalMs: 5 * 60_000,
  requestRangeOnStart: true,
  requestSnapshotOnStart: true,
};

export const DEFAULT_NODE_RUNTIME_CONFIG: NodeRuntimeConfig = {
  sync: { ...DEFAULT_SYNC_RUNTIME_CONFIG },
  api: { host: '127.0.0.1', port: 9528, enabled: true },
};

export class ClawTokenNode {
  private readonly config: NodeRuntimeConfig;
  private p2p?: P2PNode;
  private sync?: P2PSync;
  private eventDb?: LevelStore;
  private eventStore?: EventStore;
  private snapshotStore?: SnapshotStore;
  private snapshotScheduler?: SnapshotScheduler;
  private rangeTimer?: NodeJS.Timeout;
  private snapshotTimer?: NodeJS.Timeout;
  private apiServer?: ApiServer;
  private peerId?: any;
  private peerPrivateKey?: Uint8Array;

  constructor(config: NodeRuntimeConfig = {}) {
    this.config = {
      ...DEFAULT_NODE_RUNTIME_CONFIG,
      ...config,
      sync: {
        ...DEFAULT_SYNC_RUNTIME_CONFIG,
        ...config.sync,
      },
      api: {
        ...DEFAULT_NODE_RUNTIME_CONFIG.api,
        ...config.api,
      },
    };
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
    if (this.config.snapshotBuilder) {
      this.snapshotScheduler = new SnapshotScheduler(
        this.eventStore,
        this.snapshotStore,
        { ...DEFAULT_SNAPSHOT_POLICY, ...(this.config.snapshotPolicy ?? {}) },
      );
    }

    this.p2p = new P2PNode(p2pConfig, peerId);
    await this.p2p.start();

    this.peerId = peerId;
    this.peerPrivateKey = privateKey;

    const {
      rangeIntervalMs,
      snapshotIntervalMs,
      requestRangeOnStart,
      requestSnapshotOnStart,
      ...syncOptions
    } = this.config.sync ?? {};

    this.sync = new P2PSync(this.p2p, this.eventStore, this.snapshotStore, {
      peerId: peerId.toString(),
      peerPrivateKey: privateKey,
      resolvePeerPublicKey: (id) => this.p2p?.getPeerPublicKey(id) ?? Promise.resolve(null),
      resolveControllerPublicKey: this.config.resolveControllerPublicKey,
      ...syncOptions,
    });
    await this.sync.start();

    await this.startSyncLoops();

    if (this.config.api?.enabled !== false) {
      const apiConfig: ApiServerConfig = {
        host: this.config.api?.host ?? '127.0.0.1',
        port: this.config.api?.port ?? 9528,
        dataDir: this.config.dataDir,
      };
      this.apiServer = new ApiServer(apiConfig, {
        publishEvent: (envelope) => this.publishEvent(envelope as EventEnvelope),
        eventStore: this.eventStore,
      });
      await this.apiServer.start();
    }
  }

  async stop(): Promise<void> {
    this.stopSyncLoops();
    await this.apiServer?.stop();
    await this.sync?.stop();
    await this.p2p?.stop();
    await this.eventDb?.close();
    this.sync = undefined;
    this.p2p = undefined;
    this.eventDb = undefined;
    this.eventStore = undefined;
    this.snapshotStore = undefined;
    this.snapshotScheduler = undefined;
  }

  getPeerId(): string | null {
    if (!this.peerId) {
      return null;
    }
    return this.peerId.toString();
  }

  async publishEvent(envelope: EventEnvelope): Promise<string> {
    if (!this.p2p || !this.eventStore || !this.peerId || !this.peerPrivateKey) {
      throw new Error('node not started');
    }
    if (!envelope.sig) {
      throw new Error('event signature missing');
    }
    const hash =
      typeof envelope.hash === 'string' && envelope.hash.length
        ? envelope.hash
        : eventHashHex(envelope);
    const canonical = canonicalizeBytes(envelope);
    await this.eventStore.appendEvent(hash, canonical);

    const p2pEnvelope = await signP2PEnvelope(
      {
        v: 1,
        topic: TOPIC_EVENTS,
        sender: this.peerId.toString(),
        ts: BigInt(Date.now()),
        contentType: CONTENT_TYPE,
        payload: canonical,
      },
      this.peerPrivateKey,
    );
    const bytes = encodeP2PEnvelopeBytes(p2pEnvelope);
    await this.p2p.publish(TOPIC_EVENTS, bytes);
    return hash;
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
    await this.maybeCreateSnapshot();
  }

  private async maybeCreateSnapshot(): Promise<void> {
    if (!this.snapshotScheduler || !this.snapshotStore || !this.eventStore) {
      return;
    }
    if (!this.config.snapshotBuilder) {
      return;
    }
    const should = await this.snapshotScheduler.shouldSnapshot();
    if (!should) {
      return;
    }
    const lastSnapshot = await this.snapshotStore.loadLatestSnapshot();
    const base = await this.config.snapshotBuilder({
      eventStore: this.eventStore,
      snapshotStore: this.snapshotStore,
      lastSnapshot,
    });
    if (!base) {
      return;
    }
    if (!this.peerPrivateKey || !this.peerId) {
      return;
    }
    const signed = await signSnapshot(base, this.peerId.toString(), this.peerPrivateKey);
    await this.snapshotStore.saveSnapshot(signed);
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

export { DEFAULT_P2P_SYNC_CONFIG } from './p2p/sync.js';
export * from './p2p/sync.js';
