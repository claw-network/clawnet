/**
 * @clawtoken/sdk — TypeScript SDK for the ClawToken node API.
 *
 * Usage:
 * ```ts
 * import { ClawTokenClient } from '@clawtoken/sdk';
 *
 * const claw = new ClawTokenClient();                          // defaults to http://127.0.0.1:9528
 * const status = await claw.node.getStatus();
 * const balance = await claw.wallet.getBalance();
 * const listings = await claw.markets.search({ q: 'data' });
 * ```
 */

export { HttpClient, HttpClientConfig, RequestOptions, ClawTokenError } from './http.js';
export { NodeApi } from './node.js';
export { IdentityApi } from './identity.js';
export { WalletApi } from './wallet.js';
export { ReputationApi } from './reputation.js';
export { MarketsApi, InfoMarketApi, TaskMarketApi, CapabilityMarketApi, MarketDisputeApi } from './markets.js';
export { ContractsApi } from './contracts.js';
export { DaoApi } from './dao.js';
export * from './types.js';

import { HttpClient, type HttpClientConfig } from './http.js';
import { NodeApi } from './node.js';
import { IdentityApi } from './identity.js';
import { WalletApi } from './wallet.js';
import { ReputationApi } from './reputation.js';
import { MarketsApi } from './markets.js';
import { ContractsApi } from './contracts.js';
import { DaoApi } from './dao.js';

/** Configuration for the top-level client. */
export interface ClientConfig extends HttpClientConfig {}

const DEFAULT_BASE_URL = 'http://127.0.0.1:9528';

/**
 * Top-level client that exposes all ClawToken APIs.
 *
 * Each property is a module that maps 1-to-1 with the REST API tags.
 */
export class ClawTokenClient {
  readonly http: HttpClient;
  readonly node: NodeApi;
  readonly identity: IdentityApi;
  readonly wallet: WalletApi;
  readonly reputation: ReputationApi;
  readonly markets: MarketsApi;
  readonly contracts: ContractsApi;
  readonly dao: DaoApi;

  constructor(config?: Partial<ClientConfig>) {
    this.http = new HttpClient({
      baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
      ...config,
    });
    this.node = new NodeApi(this.http);
    this.identity = new IdentityApi(this.http);
    this.wallet = new WalletApi(this.http);
    this.reputation = new ReputationApi(this.http);
    this.markets = new MarketsApi(this.http);
    this.contracts = new ContractsApi(this.http);
    this.dao = new DaoApi(this.http);
  }
}
