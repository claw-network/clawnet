/**
 * Contracts API — create, sign, fund, milestones, disputes, settlement.
 */
import type { HttpClient, RequestOptions } from './http.js';
import type {
  Contract,
  CreateContractParams,
  CreateContractResponse,
  ContractActionParams,
  ContractFundParams,
  MilestoneSubmitParams,
  MilestoneApproveParams,
  MilestoneRejectParams,
  ContractDisputeParams,
  ContractDisputeResolveParams,
  ContractSettlementParams,
} from './types.js';

interface TxHashResponse {
  txHash: string;
  [key: string]: unknown;
}

export class ContractsApi {
  constructor(private readonly http: HttpClient) {}

  /** List contracts (optionally filtered by status or party). */
  async list(
    params?: { status?: string; party?: string; limit?: number; offset?: number },
    opts?: RequestOptions,
  ): Promise<{ contracts: Contract[]; total: number }> {
    return this.http.get<{ contracts: Contract[]; total: number }>(
      '/api/v1/contracts',
      params as Record<string, string | number>,
      opts,
    );
  }

  /** Get contract by ID. */
  async get(contractId: string, opts?: RequestOptions): Promise<Contract> {
    return this.http.get<Contract>(`/api/v1/contracts/${enc(contractId)}`, undefined, opts);
  }

  /** Create a new service contract. */
  async create(
    params: CreateContractParams,
    opts?: RequestOptions,
  ): Promise<CreateContractResponse> {
    return this.http.post<CreateContractResponse>('/api/v1/contracts', params, opts);
  }

  /** Sign a contract. */
  async sign(
    contractId: string,
    params: ContractActionParams,
    opts?: RequestOptions,
  ): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(
      `/api/v1/contracts/${enc(contractId)}/actions/sign`,
      params,
      opts,
    );
  }

  /** Fund a contract (lock escrow). */
  async fund(
    contractId: string,
    params: ContractFundParams,
    opts?: RequestOptions,
  ): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(
      `/api/v1/contracts/${enc(contractId)}/actions/activate`,
      params,
      opts,
    );
  }

  /** Mark contract as completed. */
  async complete(
    contractId: string,
    params: ContractActionParams,
    opts?: RequestOptions,
  ): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(
      `/api/v1/contracts/${enc(contractId)}/actions/complete`,
      params,
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Milestones
  // -------------------------------------------------------------------------

  /** Submit a milestone deliverable. */
  async submitMilestone(
    contractId: string,
    milestoneId: string,
    params: MilestoneSubmitParams,
    opts?: RequestOptions,
  ): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(
      `/api/v1/contracts/${enc(contractId)}/milestones/${enc(milestoneId)}/actions/submit`,
      params,
      opts,
    );
  }

  /** Approve a submitted milestone. */
  async approveMilestone(
    contractId: string,
    milestoneId: string,
    params: MilestoneApproveParams,
    opts?: RequestOptions,
  ): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(
      `/api/v1/contracts/${enc(contractId)}/milestones/${enc(milestoneId)}/actions/approve`,
      params,
      opts,
    );
  }

  /** Reject a submitted milestone. */
  async rejectMilestone(
    contractId: string,
    milestoneId: string,
    params: MilestoneRejectParams,
    opts?: RequestOptions,
  ): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(
      `/api/v1/contracts/${enc(contractId)}/milestones/${enc(milestoneId)}/actions/reject`,
      params,
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Disputes
  // -------------------------------------------------------------------------

  /** Open a dispute on a contract. */
  async openDispute(
    contractId: string,
    params: ContractDisputeParams,
    opts?: RequestOptions,
  ): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(
      `/api/v1/contracts/${enc(contractId)}/actions/dispute`,
      params,
      opts,
    );
  }

  /** Resolve a contract dispute. */
  async resolveDispute(
    contractId: string,
    params: ContractDisputeResolveParams,
    opts?: RequestOptions,
  ): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(
      `/api/v1/contracts/${enc(contractId)}/actions/resolve`,
      params,
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Settlement
  // -------------------------------------------------------------------------

  /** Execute settlement (final payout). */
  async settlement(
    contractId: string,
    params: ContractSettlementParams,
    opts?: RequestOptions,
  ): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(
      `/api/v1/contracts/${enc(contractId)}/actions/terminate`,
      params,
      opts,
    );
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}
