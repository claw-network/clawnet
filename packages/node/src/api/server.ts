/**
 * ClawNet API Server — v1 (modular)
 *
 * Slim orchestrator that mounts route modules on a Router tree.
 * Replaces the old monolithic server.ts.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { Router } from './router.js';
import { cors, errorBoundary, requestLogger } from './middleware.js';
import { apiKeyAuth } from './auth.js';
import type { RuntimeContext, ApiServerConfig } from './types.js';
import type { ApiKeyStore } from './api-key-store.js';

// Route modules
import { nodeRoutes } from './routes/node.js';
import { identityRoutes } from './routes/identities.js';
import { walletRoutes } from './routes/wallets.js';
import { transferRoutes } from './routes/transfers.js';
import { escrowRoutes } from './routes/escrows.js';
import { reputationRoutes } from './routes/reputations.js';
import { contractRoutes } from './routes/contracts.js';
import { daoRoutes } from './routes/dao.js';
import { marketsInfoRoutes } from './routes/markets-info.js';
import { marketsTaskRoutes } from './routes/markets-tasks.js';
import { marketsCapabilityRoutes } from './routes/markets-capabilities.js';
import { marketsDisputeRoutes } from './routes/markets-disputes.js';
import { marketsSearchRoutes } from './routes/markets-search.js';
import { devRoutes } from './routes/dev.js';
import { adminRoutes } from './routes/admin.js';

export { ApiServerConfig } from './types.js';
export type { RuntimeContext } from './types.js';

// ─── Re-export for backward compatibility ──────────────────────
export type { RouteContext, RouteHandler, HttpMethod } from './router.js';

// ─── Build the full route tree ─────────────────────────────────

function buildRouter(ctx: RuntimeContext): Router {
  const api = new Router();

  // Mount all domain routers under /api/v1/
  api.mount('/api/v1/node', nodeRoutes(ctx));
  api.mount('/api/v1/identities', identityRoutes(ctx));
  api.mount('/api/v1/wallets', walletRoutes(ctx));
  api.mount('/api/v1/transfers', transferRoutes(ctx));
  api.mount('/api/v1/escrows', escrowRoutes(ctx));
  api.mount('/api/v1/reputations', reputationRoutes(ctx));
  api.mount('/api/v1/contracts', contractRoutes(ctx));
  api.mount('/api/v1/dao', daoRoutes(ctx));
  api.mount('/api/v1/markets/info', marketsInfoRoutes(ctx));
  api.mount('/api/v1/markets/tasks', marketsTaskRoutes(ctx));
  api.mount('/api/v1/markets/capabilities', marketsCapabilityRoutes(ctx));
  api.mount('/api/v1/markets/disputes', marketsDisputeRoutes(ctx));
  api.mount('/api/v1/markets/search', marketsSearchRoutes(ctx));
  api.mount('/api/v1/dev', devRoutes(ctx));
  api.mount('/api/v1/admin', adminRoutes(ctx));

  return api;
}

// ─── Server Class ──────────────────────────────────────────────

export class ApiServer {
  private server?: Server;
  private router: Router;

  constructor(
    private readonly config: ApiServerConfig,
    private readonly runtime: {
      publishEvent: (envelope: Record<string, unknown>) => Promise<string>;
      eventStore?: import('@claw-network/core').EventStore;
      contractStore?: import('@claw-network/protocol').ContractStore;
      reputationStore?: import('@claw-network/protocol').ReputationStore;
      daoStore?: import('@claw-network/protocol').DaoStore;
      marketStore?: import('@claw-network/protocol').MarketSearchStore;
      infoContentStore?: import('@claw-network/protocol').InfoContentStore;
      walletService?: import('../services/wallet-service.js').WalletService;
      identityService?: import('../services/identity-service.js').IdentityService;
      reputationService?: import('../services/reputation-service.js').ReputationService;
      contractsService?: import('../services/contracts-service.js').ContractsService;
      daoService?: import('../services/dao-service.js').DaoService;
      searchMarkets?: (
        query: import('@claw-network/protocol').SearchQuery,
      ) => import('@claw-network/protocol').SearchResult;
      getNodeStatus?: () => Promise<Record<string, unknown>>;
      getNodePeers?: () => Promise<{ peers: Record<string, unknown>[]; total: number }>;
      getNodeConfig?: () => Promise<Record<string, unknown>>;
      apiKeyStore?: ApiKeyStore;
    },
  ) {
    // Build the RuntimeContext from constructor args
    const ctx: RuntimeContext = {
      config: this.config,
      publishEvent: this.runtime.publishEvent,
      eventStore: this.runtime.eventStore,
      contractStore: this.runtime.contractStore,
      reputationStore: this.runtime.reputationStore,
      daoStore: this.runtime.daoStore,
      marketStore: this.runtime.marketStore,
      infoContentStore: this.runtime.infoContentStore,
      walletService: this.runtime.walletService,
      identityService: this.runtime.identityService,
      reputationService: this.runtime.reputationService,
      contractsService: this.runtime.contractsService,
      daoService: this.runtime.daoService,
      searchMarkets: this.runtime.searchMarkets,
      getNodeStatus: this.runtime.getNodeStatus,
      getNodePeers: this.runtime.getNodePeers,
      getNodeConfig: this.runtime.getNodeConfig,
      apiKeyStore: this.runtime.apiKeyStore,
    };

    this.router = buildRouter(ctx);
  }

  async start(): Promise<void> {
    if (this.server) return;

    // Set up middleware + router as request handler
    const router = this.router;
    const authMiddleware = apiKeyAuth(this.runtime.apiKeyStore);

    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Middleware chain: CORS → auth → error boundary → logger → router
      void cors(req, res, async () => {
        await authMiddleware(req, res, async () => {
          await errorBoundary(req, res, async () => {
            await requestLogger(() => {})(req, res, async () => {
              const matched = await router.handle(req, res);
              if (!matched && !res.headersSent) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not Found', path: req.url }));
              }
            });
          });
        });
      });
    });

    await new Promise<void>((resolve) => {
      this.server?.listen(this.config.port, this.config.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  /** Expose underlying HTTP server for testing. */
  get httpServer(): Server | undefined {
    return this.server;
  }
}
