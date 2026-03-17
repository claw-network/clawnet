/**
 * Wallet API — balance, transfer, escrow, history.
 */
import type { HttpClient, RequestOptions } from './http.js';
import type {
  Balance,
  NonceResult,
  TransferParams,
  TransferResult,
  TransactionHistoryResponse,
  CreateEscrowParams,
  Escrow,
  EscrowActionParams,
  EscrowExpireParams,
} from './types.js';

export class WalletApi {
  constructor(private readonly http: HttpClient) {}

  private async resolveWalletAddress(
    params?: { did?: string; address?: string },
    opts?: RequestOptions,
  ): Promise<string> {
    if (params?.address) {
      return params.address;
    }
    if (params?.did) {
      return params.did;
    }
    const identity = await this.http.get<Record<string, unknown>>(
      '/api/v1/identities/self',
      undefined,
      opts,
    );
    if (typeof identity.did === 'string' && identity.did.length > 0) {
      return identity.did;
    }
    throw new Error('Unable to resolve wallet address');
  }

  // -------------------------------------------------------------------------
  // Balance & Transfer
  // -------------------------------------------------------------------------

  /** Get balance for a DID or address. Defaults to this node's wallet. */
  async getBalance(
    params?: { did?: string; address?: string },
    opts?: RequestOptions,
  ): Promise<Balance> {
    const target = await this.resolveWalletAddress(params, opts);
    return this.http.get<Balance>(`/api/v1/wallets/${encodeURIComponent(target)}`, undefined, opts);
  }

  /** Get EVM transaction nonce for a DID or address. Defaults to this node's wallet. */
  async getNonce(
    params?: { did?: string; address?: string },
    opts?: RequestOptions,
  ): Promise<NonceResult> {
    const target = await this.resolveWalletAddress(params, opts);
    return this.http.get<NonceResult>(
      `/api/v1/nonce/${encodeURIComponent(target)}`,
      undefined,
      opts,
    );
  }

  /** Transfer tokens to another agent. */
  async transfer(params: TransferParams, opts?: RequestOptions): Promise<TransferResult> {
    return this.http.post<TransferResult>('/api/v1/transfers', params, opts);
  }

  /** Get transaction history. */
  async getHistory(
    params?: {
      did?: string;
      address?: string;
      limit?: number;
      offset?: number;
      type?: 'all' | 'sent' | 'received' | 'escrow';
    },
    opts?: RequestOptions,
  ): Promise<TransactionHistoryResponse> {
    const target = await this.resolveWalletAddress(params, opts);
    const pageSize = params?.limit ?? 20;
    const offset = params?.offset ?? 0;
    const page = Math.floor(offset / pageSize) + 1;
    return this.http.get<TransactionHistoryResponse>(
      `/api/v1/wallets/${encodeURIComponent(target)}/transactions`,
      {
        page,
        per_page: pageSize,
        ...(params?.type ? { type: params.type } : {}),
      } as Record<string, string | number>,
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Escrow
  // -------------------------------------------------------------------------

  /** Create a new escrow account. */
  async createEscrow(params: CreateEscrowParams, opts?: RequestOptions): Promise<Escrow> {
    return this.http.post<Escrow>('/api/v1/escrows', params, opts);
  }

  /** Get escrow details. */
  async getEscrow(escrowId: string, opts?: RequestOptions): Promise<Escrow> {
    return this.http.get<Escrow>(
      `/api/v1/escrows/${encodeURIComponent(escrowId)}`,
      undefined,
      opts,
    );
  }

  /** Release escrow funds to beneficiary. */
  async releaseEscrow(
    escrowId: string,
    params: EscrowActionParams,
    opts?: RequestOptions,
  ): Promise<TransferResult> {
    return this.http.post<TransferResult>(
      `/api/v1/escrows/${encodeURIComponent(escrowId)}/actions/release`,
      params,
      opts,
    );
  }

  /** Fund an existing escrow. */
  async fundEscrow(
    escrowId: string,
    params: EscrowActionParams,
    opts?: RequestOptions,
  ): Promise<TransferResult> {
    return this.http.post<TransferResult>(
      `/api/v1/escrows/${encodeURIComponent(escrowId)}/actions/fund`,
      params,
      opts,
    );
  }

  /** Refund escrow funds to depositor. */
  async refundEscrow(
    escrowId: string,
    params: EscrowActionParams,
    opts?: RequestOptions,
  ): Promise<TransferResult> {
    return this.http.post<TransferResult>(
      `/api/v1/escrows/${encodeURIComponent(escrowId)}/actions/refund`,
      params,
      opts,
    );
  }

  /** Expire an escrow (refund or release depending on rules). */
  async expireEscrow(
    escrowId: string,
    params: EscrowExpireParams,
    opts?: RequestOptions,
  ): Promise<TransferResult> {
    return this.http.post<TransferResult>(
      `/api/v1/escrows/${encodeURIComponent(escrowId)}/actions/expire`,
      params,
      opts,
    );
  }
}
