import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { createEd25519PeerId, createFromProtobuf, exportToProtobuf } from '@libp2p/peer-id-factory';
import {
  bytesToUtf8,
  canonicalizeBytes,
  createKeyRecord,
  DEFAULT_P2P_CONFIG,
  DEFAULT_SNAPSHOT_POLICY,
  didFromPublicKey,
  ensureConfig,
  ensureStorageDirs,
  EventEnvelope,
  eventHashHex,
  EventStore,
  LevelStore,
  listKeyRecords,
  multibaseDecode,
  NodeConfig,
  P2PConfig,
  P2PNode,
  resolveStoragePaths,
  saveKeyRecord,
  signSnapshot,
  SnapshotRecord,
  SnapshotSchedulePolicy,
  SnapshotScheduler,
  SnapshotStore,
  StoragePaths,
  TOPIC_EVENTS,
  TOPIC_MARKETS,
} from '@clawnet/core';
import {
  CONTENT_TYPE,
  encodeP2PEnvelopeBytes,
  InfoContentStore,
  isMarketEventEnvelope,
  MarketSearchStore,
  MemoryContractStore,
  MemoryDaoStore,
  MemoryReputationStore,
  signP2PEnvelope,
} from '@clawnet/protocol';
import { P2PSync, P2PSyncConfig } from './p2p/sync.js';
import { ApiServer, ApiServerConfig } from './api/server.js';

export interface NodeRuntimeConfig {
  dataDir?: string;
  passphrase?: string;
  api?: Partial<ApiServerConfig> & { enabled?: boolean };
  p2p?: Partial<P2PConfig>;
  sync?: Partial<P2PSyncConfig> & {
    rangeIntervalMs?: number;
    snapshotIntervalMs?: number;
    requestRangeOnStart?: boolean;
    requestSnapshotOnStart?: boolean;
    validateSnapshotState?: (
      snapshot: import('@clawnet/core').SnapshotRecord,
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

type PeerIdLike = { toString: () => string };
type PeerIdWithPrivateKey = PeerIdLike & { privateKey?: Uint8Array };

export class ClawNetNode {
  private readonly config: NodeRuntimeConfig;
  private p2p?: P2PNode;
  private sync?: P2PSync;
  private eventDb?: LevelStore;
  private stateDb?: LevelStore;
  private eventStore?: EventStore;
  private snapshotStore?: SnapshotStore;
  private snapshotScheduler?: SnapshotScheduler;
  private contractStore?: MemoryContractStore;
  private reputationStore?: MemoryReputationStore;
  private daoStore?: MemoryDaoStore;
  private marketSearchStore?: MarketSearchStore;
  private infoContentStore?: InfoContentStore;
  private rangeTimer?: NodeJS.Timeout;
  private snapshotTimer?: NodeJS.Timeout;
  private meshAmplifierTimer?: NodeJS.Timeout;
  private apiServer?: ApiServer;
  private peerId?: PeerIdWithPrivateKey;
  private peerPrivateKey?: Uint8Array;
  private startedAt?: number;
  private persistedConfig?: NodeConfig;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;

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
    if (this.starting) {
      return this.starting;
    }
    this.starting = this.startInternal();
    return this.starting;
  }

  private async startInternal(): Promise<void> {
    if (this.p2p) {
      return;
    }

    // Init order: config -> storage -> p2p -> sync -> api
    const paths = resolveStoragePaths(this.config.dataDir);
    await ensureStorageDirs(paths);
    const persisted = await ensureConfig(paths);
    this.persistedConfig = persisted;

    const peerId = await this.loadOrCreatePeerId(paths.keys);
    const privateKey = this.extractPeerPrivateKey(peerId);

    // Auto-create identity key record if none exists and passphrase is available
    await this.ensureIdentityKeyRecord(paths, peerId);

    // Convert PeerId's protobuf private key to PrivateKey object for libp2p v3
    const libp2pPrivateKey = peerId.privateKey
      ? privateKeyFromProtobuf(peerId.privateKey)
      : undefined;

    const p2pConfig: Partial<P2PConfig> = {
      ...DEFAULT_P2P_CONFIG,
      ...this.config.p2p,
      listen: this.config.p2p?.listen ?? persisted.p2p?.listen ?? DEFAULT_P2P_CONFIG.listen,
      bootstrap:
        this.config.p2p?.bootstrap ?? persisted.p2p?.bootstrap ?? DEFAULT_P2P_CONFIG.bootstrap,
    };

    try {
      this.eventDb = new LevelStore({ path: paths.eventsDb });
      this.stateDb = new LevelStore({ path: paths.stateDb });
      this.eventStore = new EventStore(this.eventDb);
      this.snapshotStore = new SnapshotStore(paths);
      await this.initContractStore();
      await this.initReputationStore();
      await this.initDaoStore();
      await this.initMarketSearchStore();
      await this.initInfoContentStore();
      if (this.config.snapshotBuilder) {
        this.snapshotScheduler = new SnapshotScheduler(this.eventStore, this.snapshotStore, {
          ...DEFAULT_SNAPSHOT_POLICY,
          ...(this.config.snapshotPolicy ?? {}),
        });
      }

      this.p2p = new P2PNode(p2pConfig, libp2pPrivateKey, peerId);
      await this.p2p.start();

      this.peerId = peerId;
      this.peerPrivateKey = privateKey;
      if (!this.startedAt) {
        this.startedAt = Date.now();
      }

      const syncOptions = { ...(this.config.sync ?? {}) };
      delete syncOptions.rangeIntervalMs;
      delete syncOptions.snapshotIntervalMs;
      delete syncOptions.requestRangeOnStart;
      delete syncOptions.requestSnapshotOnStart;

      this.sync = new P2PSync(this.p2p, this.eventStore, this.snapshotStore, {
        peerId: peerId.toString(),
        peerPrivateKey: privateKey,
        resolvePeerPublicKey: (id) => this.p2p?.getPeerPublicKey(id) ?? Promise.resolve(null),
        resolveControllerPublicKey: this.config.resolveControllerPublicKey,
        onEventApplied: (envelope) => this.applyEventStores(envelope),
        ...syncOptions,
      });
      await this.sync.start();

      await this.startSyncLoops();

      // Actively discover peers beyond bootstrap to form a full-mesh topology
      this.startMeshAmplifier();

      if (this.config.api?.enabled !== false) {
        const apiConfig: ApiServerConfig = {
          host: this.config.api?.host ?? '127.0.0.1',
          port: this.config.api?.port ?? 9528,
          dataDir: this.config.dataDir,
        };
        this.apiServer = new ApiServer(apiConfig, {
          publishEvent: (envelope) => this.publishEvent(envelope as EventEnvelope),
          eventStore: this.eventStore,
          contractStore: this.contractStore,
          reputationStore: this.reputationStore,
          daoStore: this.daoStore,
          marketStore: this.marketSearchStore,
          infoContentStore: this.infoContentStore,
          searchMarkets: (query) => {
            if (!this.marketSearchStore) {
              throw new Error('market search unavailable');
            }
            return this.marketSearchStore.search(query);
          },
          getNodeStatus: () => this.buildNodeStatus(),
          getNodePeers: () => this.buildNodePeers(),
          getNodeConfig: () => this.buildNodeConfig(),
        });
        await this.apiServer.start();
      }
    } catch (error) {
      await this.stop();
      throw error;
    } finally {
      this.starting = undefined;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) {
      return this.stopping;
    }
    this.stopping = this.stopInternal();
    return this.stopping;
  }

  private async stopInternal(): Promise<void> {
    // Shutdown order: api -> sync -> p2p -> storage
    this.stopSyncLoops();
    this.stopMeshAmplifier();

    const tasks: Array<() => Promise<void>> = [
      async () => this.apiServer?.stop(),
      async () => this.sync?.stop(),
      async () => this.p2p?.stop(),
      async () => this.eventDb?.close(),
      async () => this.stateDb?.close(),
    ];

    for (const task of tasks) {
      try {
        await task();
      } catch {
        // Best-effort shutdown; keep going to release remaining resources.
      }
    }

    this.apiServer = undefined;
    this.sync = undefined;
    this.p2p = undefined;
    this.eventDb = undefined;
    this.stateDb = undefined;
    this.eventStore = undefined;
    this.snapshotStore = undefined;
    this.snapshotScheduler = undefined;
    this.reputationStore = undefined;
    this.marketSearchStore = undefined;
    this.peerId = undefined;
    this.peerPrivateKey = undefined;
    this.stopping = undefined;
  }

  getPeerId(): string | null {
    if (!this.peerId) {
      return null;
    }
    return this.peerId.toString();
  }

  getHealth(): {
    ok: boolean;
    checks: { p2p: boolean; sync: boolean; eventStore: boolean; api: boolean };
  } {
    const p2p = Boolean(this.p2p);
    const sync = Boolean(this.sync);
    const eventStore = Boolean(this.eventStore);
    const apiExpected = this.config.api?.enabled !== false;
    const api = apiExpected ? Boolean(this.apiServer) : true;
    const ok = p2p && sync && eventStore && api;
    return { ok, checks: { p2p, sync, eventStore, api } };
  }

  private async buildNodeStatus(): Promise<Record<string, unknown>> {
    const did = await this.resolveLocalDid();
    const blockHeight = this.eventStore ? await this.eventStore.getLogLength() : 0;
    const peers = this.p2p?.getPeers().length ?? 0;
    const connections = this.p2p?.getConnections().length ?? 0;
    const network = this.resolveNetwork();
    const uptime = this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
    return {
      did: did ?? '',
      peerId: this.p2p?.getPeerId() ?? this.peerId?.toString() ?? '',
      synced: Boolean(this.p2p),
      blockHeight,
      peers,
      connections,
      network,
      version: process.env.CLAWNET_VERSION ?? '0.0.0',
      uptime,
    };
  }

  private async buildNodePeers(): Promise<{ peers: Record<string, unknown>[]; total: number }> {
    const peerIds = this.p2p?.getPeers() ?? [];
    const connectionPeerIds = this.p2p?.getConnections() ?? [];
    const allPeerIds = [...new Set([...peerIds, ...connectionPeerIds])];
    return {
      peers: allPeerIds.map((peerId) => ({
        peerId,
        pubsub: peerIds.includes(peerId),
        connected: connectionPeerIds.includes(peerId),
      })),
      total: allPeerIds.length,
    };
  }

  private async buildNodeConfig(): Promise<Record<string, unknown>> {
    const dataDir = resolveStoragePaths(this.config.dataDir).root;
    const network = this.resolveNetwork();
    const p2pPort = this.resolveP2PPort();
    const apiPort = this.config.api?.port ?? 9528;
    const apiEnabled = this.config.api?.enabled !== false;
    return {
      dataDir,
      network,
      p2pPort,
      apiPort,
      apiEnabled,
    };
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
    await this.applyEventStores(envelope);

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
    if (isMarketEventEnvelope(envelope)) {
      const marketEnvelope = await signP2PEnvelope(
        {
          v: 1,
          topic: TOPIC_MARKETS,
          sender: this.peerId.toString(),
          ts: BigInt(Date.now()),
          contentType: CONTENT_TYPE,
          payload: canonical,
        },
        this.peerPrivateKey,
      );
      const marketBytes = encodeP2PEnvelopeBytes(marketEnvelope);
      await this.p2p.publish(TOPIC_MARKETS, marketBytes);
    }
    return hash;
  }

  private async initReputationStore(): Promise<void> {
    if (!this.eventStore) {
      return;
    }
    const store = new MemoryReputationStore();
    let cursor: string | null = null;
    while (true) {
      const { events, cursor: next } = await this.eventStore.getEventLogRange(cursor, 200);
      if (!events.length) {
        break;
      }
      for (const bytes of events) {
        const envelope = this.parseEventEnvelope(bytes);
        if (!envelope) {
          continue;
        }
        try {
          await store.applyEvent(envelope as EventEnvelope);
        } catch {
          continue;
        }
      }
      if (!next) {
        break;
      }
      cursor = next;
    }
    this.reputationStore = store;
  }

  private async initContractStore(): Promise<void> {
    if (!this.eventStore) {
      return;
    }
    const store = new MemoryContractStore();
    let cursor: string | null = null;
    while (true) {
      const { events, cursor: next } = await this.eventStore.getEventLogRange(cursor, 200);
      if (!events.length) {
        break;
      }
      for (const bytes of events) {
        const envelope = this.parseEventEnvelope(bytes);
        if (!envelope) {
          continue;
        }
        try {
          await store.applyEvent(envelope as EventEnvelope);
        } catch {
          continue;
        }
      }
      if (!next) {
        break;
      }
      cursor = next;
    }
    this.contractStore = store;
  }

  private async initDaoStore(): Promise<void> {
    if (!this.eventStore) {
      return;
    }
    const store = new MemoryDaoStore();
    let cursor: string | null = null;
    while (true) {
      const { events, cursor: next } = await this.eventStore.getEventLogRange(cursor, 200);
      if (!events.length) {
        break;
      }
      for (const bytes of events) {
        const envelope = this.parseEventEnvelope(bytes);
        if (!envelope) {
          continue;
        }
        try {
          await store.applyEvent(envelope as EventEnvelope);
        } catch {
          continue;
        }
      }
      if (!next) {
        break;
      }
      cursor = next;
    }
    this.daoStore = store;
  }

  private async initMarketSearchStore(): Promise<void> {
    if (!this.eventStore || !this.stateDb) {
      return;
    }
    const store = new MarketSearchStore(this.stateDb);
    try {
      await store.loadFromStore();
      await store.syncFromEventLog(this.eventStore);
    } catch {
      await store.rebuildFromEventLog(this.eventStore);
    }
    this.marketSearchStore = store;
  }

  private async initInfoContentStore(): Promise<void> {
    if (!this.eventStore || !this.stateDb) {
      return;
    }
    const store = new InfoContentStore(this.stateDb);
    try {
      await store.loadFromStore();
      await store.syncFromEventLog(this.eventStore);
    } catch {
      await store.rebuildFromEventLog(this.eventStore);
    }
    this.infoContentStore = store;
  }

  private async applyEventStores(envelope: Record<string, unknown>): Promise<void> {
    if (this.contractStore) {
      try {
        await this.contractStore.applyEvent(envelope as EventEnvelope);
      } catch {
        // Ignore malformed events for contract aggregation.
      }
    }
    if (this.reputationStore) {
      try {
        await this.reputationStore.applyEvent(envelope as EventEnvelope);
      } catch {
        // Ignore malformed events for reputation aggregation.
      }
    }
    if (this.daoStore) {
      try {
        await this.daoStore.applyEvent(envelope as EventEnvelope);
      } catch {
        // Ignore malformed events for DAO aggregation.
      }
    }
    if (this.marketSearchStore) {
      try {
        await this.marketSearchStore.applyEvent(envelope as EventEnvelope);
      } catch {
        // Ignore malformed events for market indexing.
      }
    }
    if (this.infoContentStore) {
      try {
        await this.infoContentStore.applyEvent(envelope as EventEnvelope);
      } catch {
        // Ignore malformed events for info content linking.
      }
    }
  }

  private parseEventEnvelope(bytes: Uint8Array): Record<string, unknown> | null {
    try {
      return JSON.parse(bytesToUtf8(bytes)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private resolveNetwork(): string {
    return this.persistedConfig?.network ?? 'devnet';
  }

  private resolveP2PPort(): number {
    const listen =
      this.config.p2p?.listen ?? this.persistedConfig?.p2p?.listen ?? DEFAULT_P2P_CONFIG.listen;
    for (const addr of listen) {
      const match = addr.match(/\/tcp\/(\d+)/);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
    }
    return 9527;
  }

  private async resolveLocalDid(): Promise<string | null> {
    try {
      const paths = resolveStoragePaths(this.config.dataDir);
      const records = await listKeyRecords(paths);
      if (!records.length) {
        return null;
      }
      const sorted = records
        .map((record) => ({ record, createdAt: Date.parse(record.createdAt ?? '') }))
        .sort((a, b) => {
          const left = Number.isFinite(a.createdAt) ? a.createdAt : Number.MAX_SAFE_INTEGER;
          const right = Number.isFinite(b.createdAt) ? b.createdAt : Number.MAX_SAFE_INTEGER;
          return left - right;
        });
      const primary = sorted[0]?.record;
      if (!primary?.publicKey) {
        return null;
      }
      const publicKeyBytes = multibaseDecode(primary.publicKey);
      return didFromPublicKey(publicKeyBytes);
    } catch {
      return null;
    }
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

  /**
   * Periodically run KadDHT random walks to discover peers beyond bootstrap.
   * Runs every 5 s for the first 60 s, then stops because the mesh should
   * have converged by then.
   */
  private startMeshAmplifier(): void {
    let attempts = 0;
    const maxAttempts = 12; // 12 × 5 s = 60 s
    const intervalMs = 5_000;

    const amplify = async () => {
      attempts++;
      try {
        const n = await this.p2p?.amplifyMesh() ?? 0;
        if (n > 0) {
          console.log(`[mesh] +${n} new peer(s) discovered via DHT walk`);
        }
      } catch {
        // best-effort
      }
      if (attempts >= maxAttempts) {
        this.stopMeshAmplifier();
        const conns = this.p2p?.getConnections().length ?? 0;
        console.log(`[mesh] amplification complete — ${conns} peer connection(s)`);
      }
    };

    // First attempt immediately, then every 5 s
    void amplify();
    this.meshAmplifierTimer = setInterval(() => void amplify(), intervalMs);
  }

  private stopMeshAmplifier(): void {
    if (this.meshAmplifierTimer) {
      clearInterval(this.meshAmplifierTimer);
      this.meshAmplifierTimer = undefined;
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

  private async loadOrCreatePeerId(keysDir: string): Promise<PeerIdWithPrivateKey> {
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

  private async ensureIdentityKeyRecord(
    paths: StoragePaths,
    peerId: PeerIdWithPrivateKey,
  ): Promise<void> {
    const passphrase = this.config.passphrase;
    if (!passphrase) {
      return; // No passphrase configured, skip auto-identity creation
    }
    const existing = await listKeyRecords(paths);
    if (existing.length > 0) {
      return; // Identity already exists
    }
    if (!peerId.privateKey) {
      return;
    }
    // Extract Ed25519 key pair from PeerId
    const libp2pKey = privateKeyFromProtobuf(peerId.privateKey);
    const privKeyRaw = libp2pKey.raw.length >= 32 ? libp2pKey.raw.slice(0, 32) : libp2pKey.raw;
    const pubKeyRaw = (libp2pKey.publicKey as { raw: Uint8Array }).raw;
    const record = createKeyRecord(pubKeyRaw, privKeyRaw, passphrase);
    await saveKeyRecord(paths, record);
  }

  private extractPeerPrivateKey(peerId: PeerIdWithPrivateKey): Uint8Array {
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
