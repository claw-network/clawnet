/**
 * Wallet API — balance, transfer, escrow, history.
 */
import type { HttpClient, RequestOptions } from './http.js';
import type {
  Balance,
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

  // -------------------------------------------------------------------------
  // Balance & Transfer
  // -------------------------------------------------------------------------

  /** Get balance for a DID or address. Defaults to this node's wallet. */
  async getBalance(params?: { did?: string; address?: string }, opts?: RequestOptions): Promise<Balance> {
    return this.http.get<Balance>('/api/wallet/balance', params as Record<string, string>, opts);
  }

  /** Transfer tokens to another agent. */
  async transfer(params: TransferParams, opts?: RequestOptions): Promise<TransferResult> {
    return this.http.post<TransferResult>('/api/wallet/transfer', params, opts);
  }

  /** Get transaction history. */
  async getHistory(
    params?: { did?: string; address?: string; limit?: number; offset?: number; type?: 'all' | 'sent' | 'received' | 'escrow' },
    opts?: RequestOptions,
  ): Promise<TransactionHistoryResponse> {
    return this.http.get<TransactionHistoryResponse>(
      '/api/wallet/history',
      params as Record<string, string | number>,
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Escrow
  // -------------------------------------------------------------------------

  /** Create a new escrow account. */
  async createEscrow(params: CreateEscrowParams, opts?: RequestOptions): Promise<Escrow> {
    return this.http.post<Escrow>('/api/wallet/escrow', params, opts);
  }

  /** Get escrow details. */
  async getEscrow(escrowId: string, opts?: RequestOptions): Promise<Escrow> {
    return this.http.get<Escrow>(`/api/wallet/escrow/${encodeURIComponent(escrowId)}`, undefined, opts);
  }

  /** Release escrow funds to beneficiary. */
  async releaseEscrow(escrowId: string, params: EscrowActionParams, opts?: RequestOptions): Promise<TransferResult> {
    return this.http.post<TransferResult>(
      `/api/wallet/escrow/${encodeURIComponent(escrowId)}/release`,
      params,
      opts,
    );
  }

  /** Fund an existing escrow. */
  async fundEscrow(escrowId: string, params: EscrowActionParams, opts?: RequestOptions): Promise<TransferResult> {
    return this.http.post<TransferResult>(
      `/api/wallet/escrow/${encodeURIComponent(escrowId)}/fund`,
      params,
      opts,
    );
  }

  /** Refund escrow funds to depositor. */
  async refundEscrow(escrowId: string, params: EscrowActionParams, opts?: RequestOptions): Promise<TransferResult> {
    return this.http.post<TransferResult>(
      `/api/wallet/escrow/${encodeURIComponent(escrowId)}/refund`,
      params,
      opts,
    );
  }

  /** Expire an escrow (refund or release depending on rules). */
  async expireEscrow(escrowId: string, params: EscrowExpireParams, opts?: RequestOptions): Promise<TransferResult> {
    return this.http.post<TransferResult>(
      `/api/wallet/escrow/${encodeURIComponent(escrowId)}/expire`,
      params,
      opts,
    );
  }
}
