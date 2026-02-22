/**
 * @claw-network/sdk — TypeScript SDK for the ClawNet node API.
 *
 * Usage (REST / off-chain mode — default):
 * ```ts
 * import { ClawNetClient } from '@claw-network/sdk';
 *
 * const claw = new ClawNetClient();                          // defaults to http://127.0.0.1:9528
 * const status = await claw.node.getStatus();
 * const balance = await claw.wallet.getBalance();
 * const listings = await claw.markets.search({ q: 'data' });
 * ```
 *
 * Usage (on-chain mode — requires ethers v6):
 * ```ts
 * import { ethers } from 'ethers';
 * import { WalletOnChainApi, IdentityOnChainApi } from '@claw-network/sdk';
 *
 * const provider = new ethers.JsonRpcProvider('https://rpc.clawnetd.com');
 * const signer = new ethers.Wallet(privateKey, provider);
 *
 * const wallet = new WalletOnChainApi(signer, {
 *   tokenAddress: '0x...',
 *   escrowAddress: '0x...',
 * });
 * const balance = await wallet.getBalance();
 *
 * const identity = new IdentityOnChainApi(signer, {
 *   identityAddress: '0x...',
 * });
 * const result = await identity.register(didHash, publicKey);
 * ```
 */

// ── REST (off-chain) APIs ────────────────────────────────────────────────
export { HttpClient, HttpClientConfig, RequestOptions, ClawNetError } from './http.js';
export { NodeApi } from './node.js';
export { IdentityApi } from './identity.js';
export { WalletApi } from './wallet.js';
export { ReputationApi } from './reputation.js';
export { MarketsApi, InfoMarketApi, TaskMarketApi, CapabilityMarketApi, MarketDisputeApi } from './markets.js';
export { ContractsApi } from './contracts.js';
export { DaoApi } from './dao.js';

// ── On-chain APIs ────────────────────────────────────────────────────────
export { WalletOnChainApi, OnChainWalletConfig } from './wallet-onchain.js';
export {
  IdentityOnChainApi,
  OnChainIdentityConfig,
  KeyPurpose,
  type RegisterResult,
  type RotateKeyResult,
  type OnChainKeyRecord,
  type AddPlatformLinkResult,
} from './identity-onchain.js';

// ── Shared types ─────────────────────────────────────────────────────────
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
export type ClientConfig = HttpClientConfig;

const DEFAULT_BASE_URL = 'http://127.0.0.1:9528';

/**
 * Top-level client that exposes all ClawNet APIs via REST.
 *
 * Each property is a module that maps 1-to-1 with the REST API tags.
 * For on-chain mode, use `WalletOnChainApi` and `IdentityOnChainApi` directly.
 */
export class ClawNetClient {
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
