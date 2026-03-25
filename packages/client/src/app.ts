import { ApiServer } from './api/server.js';
import type { RuntimeContext } from './api/types.js';
import type { AppConfig } from './config.js';
import { discoverOrStartClawNet, type ClawNetDiscoveryResult } from './clawnet/discovery.js';
import { ClawNetGatewayService } from './clawnet/gateway-service.js';
import { killClawnetdOnPort } from './clawnet/clawnetd-process.js';
import { NonceManager } from './clawnet/nonce-manager.js';
import { SessionManager } from './clawnet/session-manager.js';
import { verifyPassphrase } from './clawnet/verify-passphrase.js';
import { GroupIndexer } from './indexer/group-indexer.js';
import { AttachmentService } from './services/attachment-service.js';
import { ClawNetTransportService } from './services/clawnet-transport-service.js';
import { ApiProxyService } from './services/api-proxy-service.js';
import { EventPushService } from './services/event-push-service.js';
import { ContractProvider } from './services/contract-provider.js';
import { GroupService } from './services/group-service.js';
import { IdentityAdapterService } from './services/identity-adapter-service.js';
import { KeyLifecycleService } from './services/key-lifecycle-service.js';
import { MessageService } from './services/message-service.js';
import { NodeMonitoringService } from './services/node-monitoring-service.js';
import { OwnerPermissionService } from './services/owner-permission-service.js';
import { ContactService } from './services/contact-service.js';
import { resolvePassphrase as resolvePassphraseFromSources } from './storage/passphrase-resolver.js';
import { savePassphrase } from './storage/passphrase-store.js';
import { SelfProfileStore } from './storage/profile-store.js';
import { PeerProfileRepository } from './storage/peer-profile-repository.js';
import type { TelagentStoragePaths } from './storage/telagent-paths.js';
import { ensureTelagentDirs, resolveTelagentPaths, verifySecretsPermissions } from './storage/telagent-paths.js';
import { GroupRepository } from './storage/group-repository.js';
import type { MailboxStore } from './storage/mailbox-store.js';
import { MessageRepository } from './storage/message-repository.js';
import { ContactRepository } from './storage/contact-repository.js';
import { PostgresMessageRepository } from './storage/postgres-message-repository.js';
import { IdentityCache } from './storage/identity-cache.js';
import { getGlobalLogger } from './logger.js';
import { resolvePeerAvatarUrl } from './utils/avatar-url.js';
import { pushOwnProfileCard } from './utils/push-profile-card.js';

const logger = getGlobalLogger();
const SESSION_RENEW_MS = 23 * 60 * 60 * 1000;
const SESSION_TTL_SECONDS = 24 * 60 * 60;

export class TelagentNode {
  private mailboxCleanupTimer: NodeJS.Timeout | null = null;
  private contracts: ContractProvider | null = null;
  private repo: GroupRepository | null = null;
  private mailboxStore: MailboxStore | null = null;
  private identityService!: IdentityAdapterService;
  private keyLifecycleService: KeyLifecycleService | null = null;
  private groupService: GroupService | null = null;
  private messageService: MessageService | null = null;
  private attachmentService: AttachmentService | null = null;
  private clawnetTransportService: ClawNetTransportService | null = null;
  private apiProxyService: ApiProxyService | null = null;
  private eventPushService: EventPushService | null = null;
  private monitoringService: NodeMonitoringService | null = null;
  private ownerPermissionService: OwnerPermissionService | null = null;
  private indexer: GroupIndexer | null = null;
  private apiServer: ApiServer | null = null;
  private selfProfileStore: SelfProfileStore | null = null;
  private peerProfileRepository: PeerProfileRepository | null = null;

  private paths!: TelagentStoragePaths;
  private managedClawNet?: any;
  private sessionManager!: SessionManager;
  private nonceManager!: NonceManager;
  private clawnetGateway!: ClawNetGatewayService;
  private autoSessionToken?: string;
  private renewTimer?: ReturnType<typeof setInterval>;
  private clawnetApiPort?: number;

  constructor(private readonly config: AppConfig) {}

  async start(): Promise<void> {
    this.paths = resolveTelagentPaths(this.config.paths.root);
    await ensureTelagentDirs(this.paths);
    await verifySecretsPermissions(this.paths);
    logger.info('[telagent] TELAGENT_HOME: %s', this.paths.root);

    const passphrase = await resolvePassphraseFromSources(this.paths);
    const discovery: ClawNetDiscoveryResult = await discoverOrStartClawNet(
      this.config.clawnet.nodeUrl,
      passphrase ?? undefined,
      {
        autoStart: this.config.clawnet.autoStart,
        autoDiscover: this.config.clawnet.autoDiscover,
        killClawnetdOnStart: this.config.clawnet.killClawnetdOnStart,
      },
    );
    this.managedClawNet = discovery.managedNode;
    // Prefer explicit config; fall back to auto-provisioned key from managed node
    const clawnetApiKey = this.config.clawnet.apiKey || discovery.apiKey;
    logger.info('[telagent] ClawNet: %s -> %s key=%s...', discovery.source, discovery.nodeUrl, clawnetApiKey?.slice(0, 8) ?? 'null');

    if (discovery.nodeUrl) {
      try {
        const url = new URL(discovery.nodeUrl);
        const port = url.port
          ? Number.parseInt(url.port, 10)
          : (url.protocol === 'https:' ? 443 : 80);
        if (Number.isInteger(port)) {
          this.clawnetApiPort = port;
        }
      } catch {
        this.clawnetApiPort = undefined;
      }
    }

    if (!discovery.nodeUrl) {
      throw new Error('[telagent] FATAL: ClawNet discovery returned no nodeUrl');
    }

    if (passphrase) {
      const wasJustStarted = discovery.source === 'auto-started' || discovery.source === 'auto-initialized';
      const check = await this.verifyPassphraseWithRetries(
        discovery.nodeUrl,
        passphrase,
        clawnetApiKey,
        wasJustStarted,
      );

      if (!check.valid) {
        if (this.managedClawNet) {
          await this.managedClawNet.stop();
        }
        throw new Error(
          `[telagent] FATAL: Passphrase verification failed - ${check.error}. `
          + 'Ensure TELAGENT_CLAWNET_PASSPHRASE matches the ClawNet Node keystore.',
        );
      }
      if (check.error) {
        logger.warn('[telagent] %s', check.error);
      }
      if (check.did) {
        logger.info('[telagent] Passphrase verified - DID: %s', check.did);
      } else {
        logger.info('[telagent] Passphrase accepted, but ClawNet did not return a DID confirmation yet');
      }
      await savePassphrase(this.paths, passphrase);
    }

    this.sessionManager = new SessionManager();
    this.nonceManager = new NonceManager(
      discovery.managedNode?.getEventStore?.(),
    );
    this.clawnetGateway = new ClawNetGatewayService(
      {
        baseUrl: discovery.nodeUrl,
        apiKey: clawnetApiKey,
        timeoutMs: this.config.clawnet.timeoutMs,
        passphrase: passphrase ?? undefined,
        clawnetDataDir: discovery.clawnetHome,
      },
      this.sessionManager,
      this.nonceManager,
    );

    logger.info('[telagent] Waiting for ClawNet Node to sync...');
    const clawnetClient = this.clawnetGateway.client as unknown as {
      node?: {
        waitForSync?: () => Promise<void>;
      };
    };
    if (clawnetClient.node?.waitForSync) {
      await clawnetClient.node.waitForSync();
    }
    logger.info('[telagent] ClawNet Node synced');

    const identityCache = new IdentityCache(this.paths.cache);
    await identityCache.load();
    this.identityService = new IdentityAdapterService(this.clawnetGateway, {
      identityCache,
    });
    await this.identityService.init();
    logger.info('[telagent] Identity: %s', this.identityService.getSelfDid());

    if (passphrase) {
      const selfDid = this.identityService.getSelfDid();
      const result = await this.sessionManager.unlock({
        passphrase,
        did: selfDid,
        ttlSeconds: SESSION_TTL_SECONDS,
        validatePassphrase: async () => true,
      });
      this.autoSessionToken = result.sessionToken;
      logger.info('[telagent] Auto-session expires: %s', result.expiresAt.toISOString());

      // Ensure our DID is registered on-chain so other nodes can resolve it
      try {
        await this.identityService.ensureRegistered();
        logger.info('[telagent] Identity on-chain registration verified');
      } catch (err) {
        logger.warn('[telagent] Failed to ensure on-chain identity registration: %s', (err as Error).message);
      }

      this.renewTimer = setInterval(async () => {
        try {
          const old = this.autoSessionToken;
          const renew = await this.sessionManager.unlock({
            passphrase,
            did: selfDid,
            ttlSeconds: SESSION_TTL_SECONDS,
            validatePassphrase: async () => true,
          });
          this.autoSessionToken = renew.sessionToken;
          if (old) {
            this.sessionManager.lock(old);
          }
          logger.info('[telagent] Auto-session renewed - expires: %s', renew.expiresAt.toISOString());
        } catch (error) {
          logger.error('[telagent] Auto-session renewal failed: %s', (error as Error).message);
        }
      }, SESSION_RENEW_MS);
      if (this.renewTimer.unref) {
        this.renewTimer.unref();
      }
    }

    logger.info('[telagent] [startup] creating ContractProvider + repos...');
    this.contracts = await ContractProvider.create(this.config.chain);
    this.repo = new GroupRepository(this.paths.groupIndexerDb);
    this.mailboxStore = this.createMailboxStore(this.config);

    this.groupService = new GroupService(
      this.contracts,
      this.identityService,
      this.repo,
    );
    this.keyLifecycleService = new KeyLifecycleService({ keysDir: this.paths.keys });
    await this.keyLifecycleService.loadFromDisk();
    const contactRepository = new ContactRepository(this.paths.contactsDb);
    const contactService = new ContactService(contactRepository);
    this.selfProfileStore = new SelfProfileStore(this.paths);
    this.peerProfileRepository = new PeerProfileRepository(this.paths.peerProfilesDb, this.paths.peerAvatarsDir);
    this.messageService = new MessageService(this.groupService, {
      repository: this.mailboxStore,
      keyLifecycleService: this.keyLifecycleService,
      identityService: this.identityService,
      contactService,
      peerProfileRepository: this.peerProfileRepository,
    });
    this.ownerPermissionService = new OwnerPermissionService({
      mode: this.config.owner.mode,
      interventionScopes: this.config.owner.scopes,
      privateConversations: this.config.owner.privateConversations,
    });
    this.attachmentService = new AttachmentService({ storageDir: this.paths.attachmentsDir });
    this.clawnetTransportService = new ClawNetTransportService(
      this.clawnetGateway,
      { baseUrl: discovery.nodeUrl, apiKey: clawnetApiKey, seqStatePath: this.paths.clawnetSeqFile },
    );

    // API Proxy Service (DID-based remote access)
    if (this.config.apiProxy.enabled || this.config.apiProxy.gatewayEnabled) {
      this.apiProxyService = new ApiProxyService(
        this.config.apiProxy,
        this.clawnetTransportService,
        this.config.port,
      );
    }

    // Event Push Service (real-time SSE for Webapp)
    this.eventPushService = new EventPushService(
      this.clawnetGateway,
      this.apiProxyService ?? undefined,
    );

    this.monitoringService = new NodeMonitoringService({
      thresholds: {
        errorRateWarnRatio: this.config.monitoring.errorRateWarnRatio,
        errorRateCriticalRatio: this.config.monitoring.errorRateCriticalRatio,
        requestP95WarnMs: this.config.monitoring.requestP95WarnMs,
        requestP95CriticalMs: this.config.monitoring.requestP95CriticalMs,
        maintenanceStaleWarnSec: this.config.monitoring.maintenanceStaleWarnSec,
        maintenanceStaleCriticalSec: this.config.monitoring.maintenanceStaleCriticalSec,
      },
    });

    this.indexer = new GroupIndexer(this.contracts, this.repo, {
      finalityDepth: this.config.chain.finalityDepth,
    });

    const runtime: RuntimeContext = {
      config: {
        host: this.config.host,
        port: this.config.port,
        publicUrl: this.config.publicUrl,
        tls: this.config.tls ? {
          certPath: this.config.tls.certPath,
          keyPath: this.config.tls.keyPath,
          httpsPort: this.config.tls.httpsPort,
        } : undefined,
      },
      identityService: this.identityService,
      groupService: this.groupService,
      messageService: this.messageService,
      attachmentService: this.attachmentService,
      monitoringService: this.monitoringService,
      keyLifecycleService: this.keyLifecycleService,
      clawnetGateway: this.clawnetGateway,
      clawnetTransportService: this.clawnetTransportService,
      sessionManager: this.sessionManager,
      nonceManager: this.nonceManager,
      ownerPermissionService: this.ownerPermissionService,
      contactService,
      selfProfileStore: this.selfProfileStore,
      peerProfileRepository: this.peerProfileRepository,
      configuredPassphrase: passphrase ?? undefined,
      apiProxyService: this.apiProxyService ?? undefined,
      eventPushService: this.eventPushService ?? undefined,
    };

    this.apiServer = new ApiServer(runtime);

    logger.info('[telagent] [startup] initializing mailbox store...');
    if (this.mailboxStore.init) {
      await this.mailboxStore.init();
    }
    logger.info('[telagent] [startup] starting indexer...');
    await this.indexer.start();
    logger.info('[telagent] [startup] starting API server...');
    await this.apiServer.start();
    this.clawnetTransportService.startListening({
      onEnvelope: async (raw, sourceDid) => {
        await this.messageService!.ingestFederatedEnvelope(raw, sourceDid);
        // Push real-time event to local SSE clients
        this.eventPushService?.emitLocal({
          type: 'new-envelope',
          sourceDid,
          envelopeId: typeof raw.envelopeId === 'string' ? raw.envelopeId : undefined,
          conversationId: typeof raw.conversationId === 'string' ? raw.conversationId : undefined,
          atMs: Date.now(),
        });
      },
      onReceipt: async (receipt, sourceDid) => {
        this.eventPushService?.emitLocal({
          type: 'receipt',
          sourceDid,
          envelopeId: receipt.envelopeId,
          atMs: receipt.timestampMs,
        });
      },
      onAttachment: async (info, data, _sourceDid) => {
        // Binary attachment received directly via P2P — save immediately, no extra download needed.
        try {
          await this.attachmentService!.saveFile(info.attachmentId, data);
          logger.info('[telagent] Stored relayed attachment %s (%d bytes)', info.attachmentId, data.length);
        } catch (err) {
          logger.warn('[telagent] Failed to store relayed attachment %s: %s', info.attachmentId, (err as Error).message);
        }
      },
      onProfileCard: async (payload, sourceDid) => {
        try {
          logger.info('[profile-card] Received profile card from %s (nickname=%s)', sourceDid, payload.nickname ?? '(none)');
          const peerNodeUrl = typeof payload.nodeUrl === 'string' ? payload.nodeUrl : undefined;
          const peerAvatarUrl = resolvePeerAvatarUrl(
            typeof payload.avatarUrl === 'string' ? payload.avatarUrl : undefined,
            peerNodeUrl,
          );
          // Check before upsert so we know if this is the first time we hear from this peer
          const isFirstSeen = !this.peerProfileRepository!.get(sourceDid as Parameters<PeerProfileRepository['get']>[0]);
          this.peerProfileRepository!.upsert({
            did: sourceDid,
            nickname: typeof payload.nickname === 'string' ? payload.nickname : undefined,
            avatarUrl: peerAvatarUrl,
            nodeUrl: peerNodeUrl,
            receivedAtMs: Date.now(),
          });
          // Update existing contact with the peer's profile data
          try {
            const existing = contactService.getContact(sourceDid);
            if (existing) {
              contactService.updateContact(sourceDid, {
                displayName: typeof payload.nickname === 'string' ? payload.nickname : undefined,
                avatarUrl: peerAvatarUrl,
              });
            }
          } catch {
            // non-critical — contact may not exist yet
          }
          // Notify local SSE clients that a peer's profile is now available.
          this.eventPushService?.emitLocal({ type: 'profile-update', sourceDid, atMs: Date.now() });
          // Reciprocal exchange: reply with our own profile the first time we hear from a peer.
          // This ensures both sides get each other's nickname/avatar without requiring
          // both nodes to independently create a conversation.
          if (isFirstSeen) {
            void pushOwnProfileCard({
              config: this.config,
              selfProfileStore: this.selfProfileStore!,
              identityService: this.identityService,
              clawnetTransportService: this.clawnetTransportService!,
            }, sourceDid).catch((err: Error) =>
              logger.warn('[telagent] Failed to reply profile card to %s: %s', sourceDid, err.message),
            );
          }
        } catch (err) {
          logger.warn('[telagent] Failed to cache peer profile from %s: %s', sourceDid, (err as Error).message);
        }
      },
      // API Proxy callbacks (DID-based remote access)
      onApiProxyRequest: this.apiProxyService
        ? (req, sourceDid) => this.apiProxyService!.handleProxyRequest(req, sourceDid)
        : undefined,
      onApiProxyResponse: this.apiProxyService
        ? (res) => this.apiProxyService!.handleProxyResponse(res)
        : undefined,
      onApiProxyPing: this.apiProxyService
        ? (pingId, sourceDid) => this.apiProxyService!.handlePing(sourceDid, pingId)
        : undefined,
      onApiProxyPong: this.apiProxyService
        ? (pingId) => this.apiProxyService!.handlePong(pingId)
        : undefined,
    });
    logger.info('[telagent] P2P transport listener started');
    this.monitoringService.recordMailboxMaintenance(await this.messageService.runMaintenance());
    this.startMailboxCleaner();

    logger.info('[telagent] Node started on :%d', this.config.port);
  }

  async stop(): Promise<void> {
    logger.info('[telagent] Shutting down...');

    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = undefined;
    }

    this.sessionManager?.lockAll();

    this.stopMailboxCleaner();
    this.apiProxyService?.dispose();
    this.eventPushService?.dispose();
    this.clawnetTransportService?.stopListening();
    await this.apiServer?.stop();
    await this.indexer?.stop();
    this.messageService?.dispose();
    if (this.mailboxStore?.close) {
      await this.mailboxStore.close();
    }
    await this.contracts?.destroy();

    if (this.managedClawNet) {
      await this.managedClawNet.stop();
      this.managedClawNet = undefined;
      logger.info('[telagent] Managed ClawNet Node stopped');
    }

    if (this.config.clawnet.killClawnetdOnStop && this.clawnetApiPort) {
      await killClawnetdOnPort(this.clawnetApiPort);
    }

    logger.info('[telagent] Node stopped');
  }

  getAutoSessionToken(): string {
    if (!this.autoSessionToken) {
      throw new Error('No auto-session available.');
    }
    return this.autoSessionToken;
  }

  private startMailboxCleaner(): void {
    if (this.mailboxCleanupTimer || !this.messageService || !this.monitoringService) {
      return;
    }

    const intervalSec = Number.isFinite(this.config.mailboxCleanupIntervalSec)
      ? Math.max(5, Math.floor(this.config.mailboxCleanupIntervalSec))
      : 60;
    this.mailboxCleanupTimer = setInterval(() => {
      void this.messageService!
        .runMaintenance()
        .then((report) => {
          this.monitoringService!.recordMailboxMaintenance(report);
        })
        .catch(() => {
          // keep cleaner loop alive even when one maintenance tick fails
        });
    }, intervalSec * 1000);
    this.mailboxCleanupTimer.unref();
  }

  private stopMailboxCleaner(): void {
    if (!this.mailboxCleanupTimer) {
      return;
    }
    clearInterval(this.mailboxCleanupTimer);
    this.mailboxCleanupTimer = null;
  }

  private async verifyPassphraseWithRetries(
    nodeUrl: string,
    passphrase: string,
    apiKey: string | undefined,
    wasJustStarted: boolean,
  ): Promise<{ valid: boolean; did?: string; error?: string }> {
    const maxAttempts = wasJustStarted ? 4 : 2;
    let check = await verifyPassphrase(nodeUrl, passphrase, apiKey);

    for (let attempt = 2; attempt <= maxAttempts && this.shouldRetryPassphraseVerification(check); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt - 1)));
      check = await verifyPassphrase(nodeUrl, passphrase, apiKey);
    }

    return check;
  }

  private shouldRetryPassphraseVerification(check: { valid: boolean; did?: string; error?: string }): boolean {
    if (!check.valid) {
      return true;
    }
    return Boolean(check.error && !check.did);
  }

  private createMailboxStore(config: AppConfig): MailboxStore {
    if (config.mailboxStore.backend === 'postgres') {
      if (!config.mailboxStore.postgres) {
        throw new Error('mailbox postgres config is required when backend=postgres');
      }
      return new PostgresMessageRepository({
        connectionString: config.mailboxStore.postgres.connectionString,
        schema: config.mailboxStore.postgres.schema,
        ssl: config.mailboxStore.postgres.ssl,
        maxConnections: config.mailboxStore.postgres.maxConnections,
      });
    }

    return new MessageRepository(config.mailboxStore.sqlitePath);
  }
}
