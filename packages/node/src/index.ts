import { readFile, writeFile, stat as fsStat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const PKG_VERSION: string = (require('../package.json') as { version: string }).version;
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { createEd25519PeerId, createFromProtobuf, exportToProtobuf } from '@libp2p/peer-id-factory';
import {
  bytesToUtf8,
  bytesToHex,
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
  resolveRelayConfig,
  resolveStoragePaths,
  saveKeyRecord,
  signBytes,
  signSnapshot,
  SnapshotRecord,
  SnapshotSchedulePolicy,
  SnapshotScheduler,
  SnapshotStore,
  StoragePaths,
  TOPIC_EVENTS,
  TOPIC_MARKETS,
  utf8ToBytes,
} from '@claw-network/core';
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
} from '@claw-network/protocol';
import { P2PSync, P2PSyncConfig } from './p2p/sync.js';
import { ApiServer, ApiServerConfig } from './api/server.js';
import { type ChainConfig, ContractProvider } from './services/index.js';
import { WalletService } from './services/wallet-service.js';
import { IdentityService } from './services/identity-service.js';
import { ReputationService } from './services/reputation-service.js';
import { ContractsService } from './services/contracts-service.js';
import { DaoService } from './services/dao-service.js';
import { StakingService } from './services/staking-service.js';
import { MessagingService } from './services/messaging-service.js';
import { MessageStore } from './services/message-store.js';
import { RelayService } from './services/relay-service.js';
import { RelayRewardService } from './services/relay-reward-service.js';
import { RelayScorer } from '@claw-network/core';
import { IndexerStore, EventIndexer, IndexerQuery, type EventIndexerConfig } from './indexer/index.js';
import { ApiKeyStore } from './api/api-key-store.js';
import { TotpStore } from './api/totp-store.js';

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
      snapshot: import('@claw-network/core').SnapshotRecord,
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
  /** On-chain configuration. When provided, enables chain read/write via ContractProvider + WalletService. */
  chain?: ChainConfig;
  /** Optional overrides for the event indexer polling behaviour. */
  indexer?: EventIndexerConfig;
  /** Network type override (mainnet|testnet|devnet). Overrides config.yaml value. */
  network?: 'mainnet' | 'testnet' | 'devnet';
  /** URL of a faucet endpoint to claim initial Tokens from on first startup. */
  faucetUrl?: string;
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
  private contractProvider?: ContractProvider;
  private indexerStore?: IndexerStore;
  private eventIndexer?: EventIndexer;
  private indexerQuery?: IndexerQuery;
  private walletService?: WalletService;
  private identityService?: IdentityService;
  private reputationService?: ReputationService;
  private contractsService?: ContractsService;
  private daoService?: DaoService;
  private stakingService?: StakingService;
  private messagingService?: MessagingService;
  private messageStore?: MessageStore;
  private relayService?: RelayService;
  private relayRewardService?: RelayRewardService;
  private relayScorer?: RelayScorer;
  private apiKeyStore?: ApiKeyStore;
  private totpStore?: TotpStore;
  private peerId?: PeerIdWithPrivateKey;
  private peerPrivateKey?: Uint8Array;
  private startedAt?: number;
  private persistedConfig?: NodeConfig;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private cachedDid?: string;

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

    // Cache DID for synchronous access
    this.cachedDid = (await this.resolveLocalDid()) ?? undefined;

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
        // ── On-chain infrastructure (optional) ─────────────────────────
        if (this.config.chain) {
          const storagePaths = resolveStoragePaths(this.config.dataDir);
          const dbPath = join(storagePaths.root, 'indexer.sqlite');

          this.contractProvider = new ContractProvider(this.config.chain);
          this.indexerStore = new IndexerStore(dbPath);
          this.indexerQuery = new IndexerQuery(this.indexerStore.database);
          this.walletService = new WalletService(this.contractProvider, this.indexerQuery);
          this.identityService = new IdentityService(this.contractProvider, this.indexerQuery);
          this.reputationService = new ReputationService(this.contractProvider, this.indexerQuery);
          this.contractsService = new ContractsService(this.contractProvider, this.indexerQuery);
          this.daoService = new DaoService(this.contractProvider, this.indexerQuery);
          this.stakingService = new StakingService(this.contractProvider);

          // RelayRewardService — needs chain + relay + DID
          // Will be finalized after relayService is created below
          this.eventIndexer = new EventIndexer(
            this.contractProvider,
            this.indexerStore,
            this.config.indexer,
          );
          // Start indexer in background (non-blocking).
          void this.eventIndexer.start();
        }

        // ── API Key store ────────────────────────────────────────────
        {
          const storagePaths2 = resolveStoragePaths(this.config.dataDir);
          const apiKeysDbPath = join(storagePaths2.root, 'api-keys.sqlite');
          this.apiKeyStore = new ApiKeyStore(apiKeysDbPath);
          this.totpStore = new TotpStore(apiKeysDbPath);
        }

        // ── Messaging service (P2P direct messaging) ─────────────────
        if (this.p2p && this.cachedDid) {
          const storagePaths3 = resolveStoragePaths(this.config.dataDir);
          const msgDbPath = join(storagePaths3.root, 'messages.sqlite');
          this.messageStore = new MessageStore(msgDbPath);
          this.messagingService = new MessagingService(this.p2p, this.messageStore, this.cachedDid, storagePaths3.root);
          await this.messagingService.start();

          // Wire peer:connect to messaging announce + outbox flush
          this.p2p.onPeerConnect((peerId: string) => {
            void this.messagingService?.onPeerConnected(peerId);
          });
        }

        // ── Relay service (circuit-relay statistics & access control) ──
        {
          const relayConfig = this.config.p2p?.relay;
          this.relayService = new RelayService(relayConfig);
          this.relayService.start();

          // Initialize RelayRewardService if chain is available
          if (this.contractProvider && this.cachedDid) {
            this.relayRewardService = new RelayRewardService({
              contracts: this.contractProvider,
              relayService: this.relayService,
              relayDid: this.cachedDid,
            });
          }

          // F2: Advertise as relay in DHT if relay is enabled
          if (this.p2p && resolveRelayConfig({ ...DEFAULT_P2P_CONFIG, ...this.config.p2p }).enabled) {
            void this.p2p.advertiseAsRelay();

            // F5: Register relay-info protocol so probes can query our load
            const effectiveMaxCircuits = this.config.p2p?.relay?.maxCircuits ?? 64;
            void this.p2p.registerRelayInfoProtocol(() => {
              const stats = this.relayService!.getStats();
              return {
                activeCircuits: stats.activeCircuits,
                maxCircuits: effectiveMaxCircuits,
                uptimeSeconds: stats.uptimeSeconds,
              };
            });
          }

          // F12: Register relay-migration protocol to handle incoming notices
          if (this.p2p) {
            void this.p2p.registerRelayMigrationProtocol();
            // F5: Create relay scorer for quality assessment
            this.relayScorer = new RelayScorer(this.p2p);
          }

          // Feed P2P listen addresses into relay health diagnostics
          if (this.p2p) {
            const addrs = this.p2p.getMultiaddrs();
            const publicAddrs = addrs.filter(a => !a.includes('/127.0.0.1/') && !a.includes('/::1/'));
            const natStatus = publicAddrs.length > 0 ? 'public' as const : 'private' as const;
            this.relayService.updateNatStatus(natStatus, addrs);
          }
        }

        const apiConfig: ApiServerConfig = {
          host: this.config.api?.host ?? '127.0.0.1',
          port: this.config.api?.port ?? 9528,
          dataDir: paths.root,
          network: this.config.network ?? persisted.network,
        };
        this.apiServer = new ApiServer(apiConfig, {
          publishEvent: (envelope) => this.publishEvent(envelope as EventEnvelope),
          eventStore: this.eventStore,
          contractStore: this.contractStore,
          reputationStore: this.reputationStore,
          daoStore: this.daoStore,
          marketStore: this.marketSearchStore,
          infoContentStore: this.infoContentStore,
          walletService: this.walletService,
          identityService: this.identityService,
          reputationService: this.reputationService,
          contractsService: this.contractsService,
          daoService: this.daoService,
          searchMarkets: (query) => {
            if (!this.marketSearchStore) {
              throw new Error('market search unavailable');
            }
            return this.marketSearchStore.search(query);
          },
          getNodeStatus: () => this.buildNodeStatus(),
          getNodePeers: () => this.buildNodePeers(),
          getNodeConfig: () => this.buildNodeConfig(),
          apiKeyStore: this.apiKeyStore,
          messagingService: this.messagingService,
          relayService: this.relayService,
          relayRewardService: this.relayRewardService,
          stakingService: this.stakingService,
          p2pNode: this.p2p,
          relayScorer: this.relayScorer,
          indexerQuery: this.indexerQuery,
          snapshotStore: this.snapshotStore,
          takeSnapshot: () => this.forceSnapshot(),
          totpStore: this.totpStore,
        });
        await this.apiServer.start();
      }

      // ── Auto-claim from faucet on first startup ────────────────────
      void this.tryFaucetAutoClaim();
    } catch (error) {
      console.error('[clawnetd] Startup failed:', (error as Error)?.message ?? error);
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
      async () => this.relayService?.stop(),
      async () => this.messagingService?.stop(),
      async () => this.apiServer?.stop(),
      async () => this.eventIndexer?.stop(),
      async () => this.contractProvider?.destroy(),
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

    // Synchronous cleanup (SQLite)
    try { this.indexerStore?.close(); } catch { /* ignore */ }
    try { this.apiKeyStore?.close(); } catch { /* ignore */ }
    try { this.messageStore?.close(); } catch { /* ignore */ }

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
    this.contractProvider = undefined;
    this.indexerStore = undefined;
    this.apiKeyStore = undefined;
    this.eventIndexer = undefined;
    this.indexerQuery = undefined;
    this.walletService = undefined;
    this.identityService = undefined;
    this.reputationService = undefined;
    this.contractsService = undefined;
    this.daoService = undefined;
    this.messagingService = undefined;
    this.messageStore = undefined;
    this.peerId = undefined;
    this.peerPrivateKey = undefined;
    this.stopping = undefined;
  }

  // ── Faucet auto-claim ───────────────────────────────────────────────────

  /**
   * Attempt to claim initial Tokens from a public faucet on first startup.
   * Non-blocking — failures are logged and swallowed.
   */
  private async tryFaucetAutoClaim(): Promise<void> {
    const faucetUrl = this.config.faucetUrl ?? process.env.CLAW_FAUCET_URL;
    if (!faucetUrl || !this.cachedDid || !this.peerPrivateKey) return;
    if (this.config.network === 'mainnet') return;

    const paths = resolveStoragePaths(this.config.dataDir);
    const markerPath = join(paths.root, 'faucet-claimed');

    // Skip if already claimed
    try {
      await fsStat(markerPath);
      return; // marker exists
    } catch {
      // marker doesn't exist — proceed
    }

    // Skip if balance > 0
    if (this.walletService) {
      try {
        const address = await this.walletService.resolveDidToAddress(this.cachedDid);
        if (address) {
          const result = await this.walletService.getBalance(address);
          if (result && Number(result.balance) > 0) {
            await writeFile(markerPath, new Date().toISOString(), 'utf-8');
            return;
          }
        }
      } catch {
        // Can't check balance — try claiming anyway
      }
    }

    try {
      const timestamp = Date.now();
      const message = utf8ToBytes(`faucet:claim:${this.cachedDid}:${timestamp}`);
      const sigBytes = await signBytes(message, this.peerPrivateKey);
      const signature = bytesToHex(sigBytes);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const url = faucetUrl.replace(/\/+$/, '') + '/api/v1/faucet';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did: this.cachedDid, signature, timestamp }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        const data = (await res.json()) as { data?: { amount?: number } };
        const amount = data?.data?.amount ?? '?';
        console.log(`[clawnetd] Claimed ${amount} Token from faucet`);
        await writeFile(markerPath, new Date().toISOString(), 'utf-8');
      } else {
        const text = await res.text().catch(() => '');
        console.warn(`[clawnetd] Faucet claim failed (${res.status}): ${text.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn(`[clawnetd] Faucet auto-claim failed: ${(err as Error).message}`);
    }
  }

  getPeerId(): string | null {
    if (!this.peerId) {
      return null;
    }
    return this.peerId.toString();
  }

  /** Return the node's DID (synchronous, cached after start). */
  getDid(): string | null {
    return this.cachedDid ?? null;
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
    // In chain-enabled mode, expose indexed chain height (authoritative for API clients).
    // Fall back to event log length for pure P2P/off-chain mode.
    const blockHeight =
      this.indexerStore?.lastIndexedBlock ??
      (this.eventStore ? await this.eventStore.getLogLength() : 0);
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
      version: process.env.CLAWNET_VERSION ?? PKG_VERSION,
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
      chainEnabled: Boolean(this.config.chain),
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
    return this.config.network ?? this.persistedConfig?.network ?? 'devnet';
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
   * Persistent connection watchdog with two phases:
   *
   *   Phase 1 (0–60 s): Aggressive mesh amplification every 5 s.
   *                       Discovers peers via DHT random-walk + peerStore dial.
   *   Phase 2 (60 s+):   Every 30 s, check connection count. If any known peer
   *                       has disconnected, re-dial it. If connections drop to 0,
   *                       re-dial bootstrap peers and run a DHT walk.
   *
   * Additionally, a `peer:disconnect` handler triggers an immediate re-dial
   * attempt (with a short delay to let transient disconnects settle), so the
   * node doesn't have to wait for the next 30 s watchdog tick.
   */
  private startMeshAmplifier(): void {
    let attempts = 0;
    const aggressiveAttempts = 12; // 12 × 5 s = 60 s
    const aggressiveIntervalMs = 5_000;
    const watchdogIntervalMs = 30_000;
    const reconnectDelayMs = 5_000; // delay before re-dial after disconnect
    let reconnectTimer: NodeJS.Timeout | undefined;

    // ── Reactive reconnect on peer:disconnect ─────────────────────────
    this.p2p?.onPeerDisconnect((peerId: string) => {
      // Debounce: if a reconnect is already scheduled, don't stack another
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void reconnectPeer(peerId);
      }, reconnectDelayMs);
    });

    const reconnectPeer = async (peerId: string) => {
      const currentConns = new Set(this.p2p?.getConnections() ?? []);
      if (currentConns.has(peerId)) return; // already reconnected

      console.log(`[mesh] peer ${peerId.slice(0, 16)}… disconnected — attempting re-dial`);
      try {
        const ok = await this.p2p?.dialPeer(peerId) ?? false;
        if (ok) {
          console.log(`[mesh] re-dialled ${peerId.slice(0, 16)}… successfully`);
          return;
        }
      } catch { /* best-effort */ }

      // If direct re-dial failed, try bootstrap + DHT walk as fallback
      try {
        const bootstrapCount = await this.p2p?.reconnectBootstrap() ?? 0;
        const dhtCount = await this.p2p?.amplifyMesh() ?? 0;
        if (bootstrapCount > 0 || dhtCount > 0) {
          console.log(`[mesh] fallback reconnect: bootstrap=${bootstrapCount}, dht=${dhtCount}`);
        } else {
          console.log(`[mesh] re-dial failed for ${peerId.slice(0, 16)}… — watchdog will keep retrying`);
        }
      } catch { /* best-effort */ }
    };

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
      if (attempts === aggressiveAttempts) {
        // Transition from aggressive phase to watchdog phase
        if (this.meshAmplifierTimer) {
          clearInterval(this.meshAmplifierTimer);
        }
        const conns = this.p2p?.getConnections().length ?? 0;
        console.log(`[mesh] aggressive phase complete — ${conns} peer connection(s), switching to watchdog`);
        this.meshAmplifierTimer = setInterval(() => void watchdog(), watchdogIntervalMs);
      }
    };

    const watchdog = async () => {
      const currentConns = new Set(this.p2p?.getConnections() ?? []);
      const knownPeers = this.p2p?.getKnownPeers() ?? new Set();

      // Find peers that were previously connected but are now missing
      const missingPeers = [...knownPeers].filter((p) => !currentConns.has(p));

      if (missingPeers.length === 0) return; // mesh is fully healthy

      console.log(`[mesh] watchdog: ${missingPeers.length} known peer(s) missing (connected=${currentConns.size}, known=${knownPeers.size})`);

      // Try to re-dial each missing peer directly
      let recovered = 0;
      for (const peerId of missingPeers) {
        try {
          const ok = await this.p2p?.dialPeer(peerId) ?? false;
          if (ok) {
            recovered++;
            console.log(`[mesh] re-dialled ${peerId.slice(0, 16)}…`);
          }
        } catch { /* best-effort */ }
      }

      // If direct re-dial didn't recover all, try bootstrap + DHT
      if (recovered < missingPeers.length) {
        try {
          const bootstrapCount = await this.p2p?.reconnectBootstrap() ?? 0;
          if (bootstrapCount > 0) {
            console.log(`[mesh] reconnected to ${bootstrapCount} bootstrap peer(s)`);
          }
          const n = await this.p2p?.amplifyMesh() ?? 0;
          if (n > 0) {
            console.log(`[mesh] +${n} additional peer(s) via DHT walk`);
          }
          if (bootstrapCount === 0 && n === 0 && recovered === 0) {
            console.log(`[mesh] reconnect failed — will retry in ${watchdogIntervalMs / 1000}s`);
          }
        } catch {
          // best-effort reconnect
        }
      }
    };

    // First attempt immediately, then every 5 s for the aggressive phase
    void amplify();
    this.meshAmplifierTimer = setInterval(() => void amplify(), aggressiveIntervalMs);
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

  /**
   * Force-create a snapshot regardless of scheduler policy.
   * Used by the console snapshot API.
   */
  private async forceSnapshot(): Promise<SnapshotRecord | null> {
    if (!this.snapshotStore || !this.eventStore) {
      return null;
    }
    if (!this.config.snapshotBuilder) {
      return null;
    }
    const lastSnapshot = await this.snapshotStore.loadLatestSnapshot();
    const base = await this.config.snapshotBuilder({
      eventStore: this.eventStore,
      snapshotStore: this.snapshotStore,
      lastSnapshot,
    });
    if (!base) {
      return null;
    }
    if (!this.peerPrivateKey || !this.peerId) {
      return null;
    }
    const signed = await signSnapshot(base, this.peerId.toString(), this.peerPrivateKey);
    await this.snapshotStore.saveSnapshot(signed);
    return signed;
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
      throw new Error(
        'CLAW_PASSPHRASE is required. Without it the node cannot create an identity (DID) ' +
        'and will be unable to sign transactions, join markets, or operate a wallet. ' +
        'Set it via --passphrase <str> or the CLAW_PASSPHRASE environment variable.',
      );
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
export { ApiKeyStore } from './api/api-key-store.js';
export type { ApiKeyRecord, ApiKeySummary } from './api/api-key-store.js';
export { getApiKeyAuth } from './api/auth.js';
export type { ApiKeyAuth } from './api/auth.js';
export type { NetworkType } from './api/types.js';
