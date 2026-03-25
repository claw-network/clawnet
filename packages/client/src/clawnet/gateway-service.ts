// ============================================================
// ClawNetGatewayService
// ============================================================
// 职责：
//   1. 封装 @claw-network/sdk 的 ClawNetClient
//   2. 所有写操作通过 SessionManager 注入 passphrase
//   3. 所有写操作通过 NonceManager 自动管理 nonce
//   4. nonce 冲突自动重试（最多 3 次）
//   5. 只读操作直接透传，不需要 session
// ============================================================

import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { ClawNetClient, ClawNetError } from '@claw-network/sdk';
import { getGlobalLogger } from '../logger.js';
const logger = getGlobalLogger();
import {
  signBytes, utf8ToBytes, bytesToHex,
  resolveStoragePaths, listKeyRecords, decryptKeyRecord,
} from '@claw-network/core';
import { ErrorCodes, TelagentError } from '../protocol/index.js';
import type { SessionManager, OperationScope } from './session-manager.js';
import type { NonceManager } from './nonce-manager.js';

export interface ClawNetGatewayConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  /** ClawNet data directory (for keystore access). Defaults to $CLAWNET_HOME or ~/.clawnet */
  clawnetDataDir?: string;
  /** ClawNet passphrase (for decrypting the Ed25519 keystore). */
  passphrase?: string;
}

export interface IdentityInfo {
  did: string;
  address?: string;
  isActive?: boolean;
  controller?: string;
  activeKey?: string;
  publicKey?: string;
  document?: Record<string, unknown>;
}

export interface BalanceInfo {
  native: string;
  token: string;
  did: string;
  address: string;
}

export interface TransferResult {
  txHash: string;
  nonce?: number;
}

export interface EscrowInfo {
  id: string;
  creator?: string;
  beneficiary: string;
  amount: number;
  status: string;
}

export interface TaskInfo {
  id: string;
  title: string;
  status: string;
  owner: string;
}

export interface BidInfo {
  id: string;
  bidder: string;
  amount: number;
  status: string;
}

export interface ReputationInfo {
  did: string;
  score: number;
  reviewCount: number;
}

export interface InfoListingInfo {
  id: string;
  title: string;
  description: string;
  price: number;
  status: string;
  owner: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface CapabilityInfo {
  id: string;
  title: string;
  description: string;
  pricePerInvocation: number;
  maxConcurrentLeases?: number;
  status: string;
  owner: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface LeaseInfo {
  id: string;
  capabilityId: string;
  status: string;
  consumer: string;
  invocationsUsed: number;
  maxInvocations?: number;
  [key: string]: unknown;
}

export interface DisputeInfo {
  id: string;
  orderId: string;
  status: string;
  reason: string;
  evidence?: string;
  [key: string]: unknown;
}

export class ClawNetGatewayService {
  public readonly client: ClawNetClient;
  private readonly unsafeClient: any;

  constructor(
    private readonly config: ClawNetGatewayConfig,
    private readonly sessionManager: SessionManager,
    private readonly nonceManager: NonceManager,
  ) {
    this.client = new ClawNetClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      timeout: config.timeoutMs ?? 30_000,
    });
    this.unsafeClient = this.client as any;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  async getSelfIdentity(): Promise<IdentityInfo> {
    const result = await this.unsafeClient.identity.get();
    return this.normalizeIdentityInfo(result);
  }

  async resolveIdentity(did: string): Promise<IdentityInfo> {
    try {
      const result = await this.unsafeClient.identity.resolve(did);
      return this.normalizeIdentityInfo(result);
    } catch (error) {
      throw this.wrapClawNetError(error, did);
    }
  }

  /**
   * Register a DID on-chain via the ClawNet node's identity API.
   * This is a signed write operation requiring a session token.
   */
  async registerIdentity(
    sessionToken: string,
    publicKey: string,
    purpose = 'authentication',
  ): Promise<IdentityInfo> {
    return this.executeWithNonceRetry(sessionToken, 'contract', 1,
      async (did, passphrase, nonce) => {
        const result = await this.unsafeClient.http.post('/api/v1/identities', {
          did,
          passphrase,
          nonce,
          publicKey,
          purpose,
        });
        return this.normalizeIdentityInfo(result);
      },
    );
  }

  async getBalance(did?: string): Promise<BalanceInfo> {
    try {
      const result = await this.unsafeClient.wallet.getBalance(did ? { did } : undefined);
      return result as BalanceInfo;
    } catch (err: unknown) {
      // ClawToken contract may not be deployed on this chain — fall back to
      // reporting only the native (ETH) balance via the node's identity info.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('not initialised')) throw err;

      const info = await this.getSelfIdentity();
      return {
        native: '0',
        token: '0',
        did: info.did ?? '',
        address: info.address ?? '',
      };
    }
  }

  async getNonce(did?: string): Promise<{ nonce: number; address: string }> {
    try {
      return await (this.unsafeClient.wallet.getNonce(did ? { did } : undefined) as Promise<{ nonce: number; address: string }>);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('not initialised')) throw err;

      const info = await this.getSelfIdentity();
      return { nonce: 0, address: info.address ?? '' };
    }
  }

  async getEscrow(escrowId: string): Promise<EscrowInfo> {
    const result = await this.unsafeClient.wallet.getEscrow(escrowId);
    return result as EscrowInfo;
  }

  async listTasks(filters?: Record<string, unknown>): Promise<TaskInfo[]> {
    const result = await this.unsafeClient.markets.tasks.list(filters);
    return result as TaskInfo[];
  }

  async listBids(taskId: string): Promise<BidInfo[]> {
    const listBids = this.unsafeClient.markets.tasks.listBids
      ?? this.unsafeClient.markets.tasks.getBids;
    const result = await listBids.call(this.unsafeClient.markets.tasks, taskId);
    return result as BidInfo[];
  }

  async getReputation(did: string): Promise<ReputationInfo> {
    const getter = this.unsafeClient.reputation.get
      ?? this.unsafeClient.reputation.resolve
      ?? this.unsafeClient.reputation.getProfile;
    const result = await getter.call(this.unsafeClient.reputation, did);
    return result as ReputationInfo;
  }

  async healthCheck(): Promise<{ healthy: boolean; did?: string }> {
    try {
      const resp = await fetch(`${this.config.baseUrl}/api/v1/node`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return { healthy: false };
      const body = await resp.json() as { data?: { did?: string } };
      return { healthy: true, did: body?.data?.did };
    } catch {
      return { healthy: false };
    }
  }

  async getAgentProfile(did: string): Promise<{ identity: IdentityInfo | null; reputation: ReputationInfo | null }> {
    const [identity, reputation] = await Promise.allSettled([
      this.resolveIdentity(did),
      this.getReputation(did).catch(() => null),
    ]);
    return {
      identity: identity.status === 'fulfilled' ? identity.value : null,
      reputation: reputation.status === 'fulfilled' ? reputation.value : null,
    };
  }

  async getWalletHistory(did?: string, params?: { limit?: number; offset?: number }): Promise<unknown[]> {
    const result = await this.unsafeClient.wallet.getHistory(did ? { did, ...params } : params);
    return result as unknown[];
  }

  async searchMarkets(params?: { q?: string; type?: string }): Promise<unknown[]> {
    const result = await this.unsafeClient.markets.search(params as any);
    return result as unknown[];
  }

  // ── Info Market ───────────────────────────────────────────────────────────

  async listInfoListings(filters?: Record<string, unknown>): Promise<InfoListingInfo[]> {
    const result = await this.unsafeClient.markets.info.list(filters);
    return result as InfoListingInfo[];
  }

  async getInfoListing(id: string): Promise<InfoListingInfo> {
    const result = await this.unsafeClient.markets.info.get(id);
    return result as InfoListingInfo;
  }

  async publishInfo(
    sessionToken: string,
    params: { title: string; description: string; price: number; tags?: string[] },
  ): Promise<InfoListingInfo> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.info.publish({ did, passphrase, nonce, ...params }),
    );
  }

  async purchaseInfo(sessionToken: string, id: string): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.info.purchase(id, { did, passphrase, nonce }),
    );
  }

  async deliverInfo(
    sessionToken: string,
    id: string,
    deliverable: Record<string, unknown>,
  ): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.info.deliver(id, { did, passphrase, nonce, ...deliverable }),
    );
  }

  async confirmInfo(sessionToken: string, id: string): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.info.confirm(id, { did, passphrase, nonce }),
    );
  }

  async subscribeInfo(sessionToken: string, id: string): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.info.subscribe(id, { did, passphrase, nonce }),
    );
  }

  async unsubscribeInfo(sessionToken: string, id: string): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.info.unsubscribe(id, { did, passphrase, nonce }),
    );
  }

  // ── Capability Market ─────────────────────────────────────────────────────

  async listCapabilities(filters?: Record<string, unknown>): Promise<CapabilityInfo[]> {
    const result = await this.unsafeClient.markets.capabilities.list(filters);
    return result as CapabilityInfo[];
  }

  async getCapability(id: string): Promise<CapabilityInfo> {
    const result = await this.unsafeClient.markets.capabilities.get(id);
    return result as CapabilityInfo;
  }

  async publishCapability(
    sessionToken: string,
    params: { title: string; description: string; pricePerInvocation: number; maxConcurrentLeases?: number; tags?: string[] },
  ): Promise<CapabilityInfo> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.capabilities.publish({ did, passphrase, nonce, ...params }),
    );
  }

  async leaseCapability(
    sessionToken: string,
    id: string,
    params: { maxInvocations?: number; durationSeconds?: number },
  ): Promise<LeaseInfo> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.capabilities.lease(id, { did, passphrase, nonce, ...params }),
    );
  }

  async invokeCapability(
    sessionToken: string,
    leaseId: string,
    params: { payload: Record<string, unknown> },
  ): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.capabilities.invoke(leaseId, { did, passphrase, nonce, ...params }),
    );
  }

  async pauseLease(sessionToken: string, leaseId: string): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.capabilities.pause(leaseId, { did, passphrase, nonce }),
    );
  }

  async resumeLease(sessionToken: string, leaseId: string): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.capabilities.resume(leaseId, { did, passphrase, nonce }),
    );
  }

  async terminateLease(sessionToken: string, leaseId: string): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.capabilities.terminate(leaseId, { did, passphrase, nonce }),
    );
  }

  // ── Task Market (missing ops) ─────────────────────────────────────────────

  async rejectBid(
    sessionToken: string,
    params: { taskId: string; bidId: string },
  ): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.tasks.rejectBid(params.taskId, {
        did, passphrase, nonce, bidId: params.bidId,
      }),
    );
  }

  async withdrawBid(
    sessionToken: string,
    params: { taskId: string; bidId: string },
  ): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.tasks.withdrawBid(params.taskId, {
        did, passphrase, nonce, bidId: params.bidId,
      }),
    );
  }

  async deliverTask(
    sessionToken: string,
    taskId: string,
    deliverable: Record<string, unknown>,
  ): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.tasks.deliver(taskId, { did, passphrase, nonce, ...deliverable }),
    );
  }

  async confirmTask(sessionToken: string, taskId: string): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.tasks.confirm(taskId, { did, passphrase, nonce }),
    );
  }

  // ── Disputes ──────────────────────────────────────────────────────────────

  async listDisputes(filters?: Record<string, unknown>): Promise<DisputeInfo[]> {
    const result = await this.unsafeClient.markets.disputes.list(filters);
    return result as DisputeInfo[];
  }

  async getDispute(id: string): Promise<DisputeInfo> {
    const result = await this.unsafeClient.markets.disputes.get(id);
    return result as DisputeInfo;
  }

  async openDispute(
    sessionToken: string,
    params: { orderId: string; reason: string; evidence?: string },
  ): Promise<DisputeInfo> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.disputes.open({ did, passphrase, nonce, ...params }),
    );
  }

  async respondDispute(
    sessionToken: string,
    disputeId: string,
    params: { response: string; evidence?: string },
  ): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.disputes.respond(disputeId, { did, passphrase, nonce, ...params }),
    );
  }

  async resolveDispute(
    sessionToken: string,
    disputeId: string,
    params: { outcome: 'refund' | 'release' | 'split'; splitRatio?: number; reason?: string },
  ): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.disputes.resolve(disputeId, { did, passphrase, nonce, ...params }),
    );
  }

  // ── Faucet ──────────────────────────────────────────────────────────────

  /**
   * Claim tokens from the ClawNet public faucet.
   * Signs the claim message with the node's Ed25519 private key (decrypted from keystore)
   * and POSTs to the local ClawNet node's POST /api/v1/faucet endpoint.
   * Requires @claw-network/* ≥ 0.6.7.
   */
  async claimFaucet(): Promise<{ did: string; address: string; amount: number; txHash: string | null }> {
    const self = await this.getSelfIdentity();
    const did = self.did;

    // Resolve passphrase — from config or env var
    const passphrase = this.config.passphrase || process.env.TELAGENT_CLAWNET_PASSPHRASE;
    if (!passphrase) {
      throw new TelagentError(
        ErrorCodes.INTERNAL,
        'Cannot sign faucet claim: no passphrase available. Set TELAGENT_CLAWNET_PASSPHRASE.',
      );
    }

    // Resolve ClawNet data dir and load keystore
    const dataDir = this.config.clawnetDataDir
      || process.env.CLAWNET_HOME
      || resolve(homedir(), '.clawnet');
    const paths = resolveStoragePaths(dataDir);
    const records = await listKeyRecords(paths);
    if (records.length === 0) {
      throw new TelagentError(ErrorCodes.INTERNAL, 'No key records found in ClawNet keystore.');
    }

    // Decrypt the first (primary) key record to get the Ed25519 private key
    const privateKey = await decryptKeyRecord(records[0], passphrase);

    // Construct and sign the claim message per PUBLIC_FAUCET.md spec
    const timestamp = Date.now();
    const message = utf8ToBytes(`faucet:claim:${did}:${timestamp}`);
    const sigBytes = await signBytes(message, privateKey);
    const signature = bytesToHex(sigBytes);

    // POST to the public faucet (NOT the local node) — per ClawNet team guidance:
    // local embedded nodes don't hold MINTER_ROLE and cannot serve /api/v1/faucet.
    // The external faucet requires an API key (CLAW_FAUCET_API_KEY) for authentication.
    const faucetBaseUrl = process.env.CLAW_FAUCET_URL ?? 'https://api.clawnetd.com';
    const faucetApiKey = process.env.CLAW_FAUCET_API_KEY;
    const faucetClient = new ClawNetClient({ baseUrl: faucetBaseUrl, apiKey: faucetApiKey }) as any;
    try {
      const result = await faucetClient.faucet.claim({ did, signature, timestamp });
      return result as { did: string; address: string; amount: number; txHash: string | null };
    } catch (err: unknown) {
      // Map ClawNet 409 Conflict → TelagentError(CONFLICT) so the TelAgent API
      // returns proper 409 status instead of 500.
      if (err instanceof ClawNetError && err.status === 409) {
        throw new TelagentError(ErrorCodes.CONFLICT, err.message);
      }
      throw err;
    }
  }

  private wrapClawNetError(error: unknown, context?: string): TelagentError {
    if (error instanceof TelagentError) {
      return error;
    }
    if (error instanceof ClawNetError) {
      if (error.status === 404) {
        return new TelagentError(ErrorCodes.NOT_FOUND, `DID not found${context ? `: ${context}` : ''}`);
      }
      if (error.status === 401 || error.status === 403) {
        return new TelagentError(ErrorCodes.FORBIDDEN, error.message);
      }
      if (error.status >= 500) {
        return new TelagentError(ErrorCodes.INTERNAL, `ClawNet node error: ${error.message}`);
      }
    }
    const msg = error instanceof Error ? error.message : String(error);
    return new TelagentError(ErrorCodes.INTERNAL, msg);
  }

  private normalizeIdentityInfo(raw: unknown): IdentityInfo {
    const source = (raw ?? {}) as Record<string, unknown>;

    const did = this.pickString(source, [
      'did',
      'id',
    ]);
    if (!did) {
      throw new Error('ClawNet identity payload missing did');
    }

    const address = this.pickString(source, [
      'address',
      'walletAddress',
      'evmAddress',
      'owner',
      'controller',
    ]);

    const controller = this.pickString(source, [
      'controller',
      'owner',
      'address',
      'walletAddress',
      'evmAddress',
    ]);

    const activeKey = this.pickString(source, [
      'activeKey',
      'publicKey',
      'key',
    ]);

    const isActive = this.pickBoolean(source, [
      'isActive',
      'active',
      'enabled',
    ]) ?? true;

    return {
      did,
      address,
      isActive,
      controller,
      activeKey,
      publicKey: this.pickString(source, ['publicKey']),
      document: source,
    };
  }

  private pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private pickBoolean(source: Record<string, unknown>, keys: string[]): boolean | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'boolean') {
        return value;
      }
    }
    return undefined;
  }

  async createServiceContract(
    sessionToken: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'contract', 1,
      (did, passphrase, nonce) => this.unsafeClient.contracts.create({ did, passphrase, nonce, ...params }),
    );
  }

  async transfer(
    sessionToken: string,
    params: { to: string; amount: number; memo?: string },
  ): Promise<TransferResult> {
    return this.executeWithNonceRetry(sessionToken, 'transfer', 1,
      (did, passphrase, nonce) => this.unsafeClient.wallet.transfer({ did, passphrase, nonce, ...params }),
    );
  }

  async createEscrow(
    sessionToken: string,
    params: { beneficiary: string; amount: number; releaseRules?: unknown[] },
  ): Promise<EscrowInfo> {
    return this.executeWithNonceRetry(sessionToken, 'escrow', 1,
      (did, passphrase, nonce) => this.unsafeClient.wallet.createEscrow({ did, passphrase, nonce, ...params }),
    );
  }

  async releaseEscrow(
    sessionToken: string,
    params: { escrowId: string },
  ): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'escrow', 1,
      (did, passphrase, nonce) => {
        const releaser = this.unsafeClient.wallet.releaseEscrow;
        try {
          return releaser.call(this.unsafeClient.wallet, {
            did,
            passphrase,
            nonce,
            escrowId: params.escrowId,
          });
        } catch {
          return releaser.call(this.unsafeClient.wallet, params.escrowId, {
            did,
            passphrase,
            nonce,
          });
        }
      },
    );
  }

  async publishTask(
    sessionToken: string,
    params: { title: string; description: string; budget: number; tags?: string[] },
  ): Promise<TaskInfo> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.tasks.publish({ did, passphrase, nonce, ...params }),
    );
  }

  async bid(
    sessionToken: string,
    params: { taskId: string; amount: number; proposal?: string },
  ): Promise<BidInfo> {
    return this.executeWithNonceRetry(sessionToken, 'market', 1,
      (did, passphrase, nonce) => this.unsafeClient.markets.tasks.bid(params.taskId, {
        did,
        passphrase,
        nonce,
        amount: params.amount,
        proposal: params.proposal,
      }),
    );
  }

  async acceptBid(
    sessionToken: string,
    params: { taskId: string; bidId: string },
  ): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'market', 5,
      (did, passphrase, nonce) => this.unsafeClient.markets.tasks.acceptBid(params.taskId, {
        did,
        passphrase,
        nonce,
        bidId: params.bidId,
      }),
    );
  }

  async submitReview(
    sessionToken: string,
    params: { targetDid: string; score: number; comment?: string; orderId?: string },
  ): Promise<unknown> {
    return this.executeWithNonceRetry(sessionToken, 'reputation', 1,
      (did, passphrase, nonce) => {
        const submit = this.unsafeClient.reputation.submit
          ?? this.unsafeClient.reputation.create
          ?? this.unsafeClient.reputation.review;
        return submit.call(this.unsafeClient.reputation, {
          did,
          passphrase,
          nonce,
          ...params,
        });
      },
    );
  }

  private async executeWithNonceRetry<T>(
    sessionToken: string,
    scope: OperationScope,
    nonceCount: number,
    operation: (did: string, passphrase: string, nonce: number) => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    const { did, passphrase } = this.sessionManager.resolvePassphrase(sessionToken, scope);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const nonce = nonceCount === 1
        ? await this.nonceManager.next(did)
        : await this.nonceManager.nextBatch(did, nonceCount);

      try {
        return await operation(did, passphrase, nonce);
      } catch (error) {
        if (this.isNonceConflict(error) && attempt < maxRetries - 1) {
          this.nonceManager.rollback(did, nonce);
          await this.nonceManager.sync(did);
          continue;
        }
        throw error;
      }
    }

    throw new Error('Nonce conflict: max retries exceeded');
  }

  private isNonceConflict(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.includes('nonce')
        || error.message.includes('NONCE')
        || error.message.includes('duplicate event');
    }
    return false;
  }
}
