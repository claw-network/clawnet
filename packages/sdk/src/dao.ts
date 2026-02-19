/**
 * DAO Governance API — proposals, voting, delegation, treasury, timelock.
 */
import type { HttpClient, RequestOptions } from './http.js';
import type {
  DaoProposalListResponse,
  DaoProposalResponse,
  DaoCreateProposalParams,
  DaoAdvanceProposalParams,
  DaoVotesResponse,
  DaoVoteCastParams,
  DaoDelegateSetParams,
  DaoDelegateRevokeParams,
  DaoDelegationsResponse,
  DaoTreasuryResponse,
  DaoTreasuryDepositParams,
  DaoTimelockListResponse,
  DaoTimelockActionParams,
  DaoTimelockCancelParams,
  DaoParamsResponse,
  DaoTxResult,
  DaoProposalStatus,
} from './types.js';

export class DaoApi {
  constructor(private readonly http: HttpClient) {}

  // ── Proposals ──────────────────────────────────────────────────────

  /** List proposals, optionally filtered by status. */
  async listProposals(
    status?: DaoProposalStatus,
    opts?: RequestOptions,
  ): Promise<DaoProposalListResponse> {
    const params = status ? { status } : undefined;
    return this.http.get<DaoProposalListResponse>(
      '/api/dao/proposals',
      params as Record<string, string> | undefined,
      opts,
    );
  }

  /** Get a single proposal by ID. */
  async getProposal(
    proposalId: string,
    opts?: RequestOptions,
  ): Promise<DaoProposalResponse> {
    return this.http.get<DaoProposalResponse>(
      `/api/dao/proposals/${encodeURIComponent(proposalId)}`,
      undefined,
      opts,
    );
  }

  /** Create a new proposal. */
  async createProposal(
    params: DaoCreateProposalParams,
    opts?: RequestOptions,
  ): Promise<DaoTxResult> {
    return this.http.post<DaoTxResult>('/api/dao/proposals', params, opts);
  }

  /** Advance a proposal to a new status. */
  async advanceProposal(
    proposalId: string,
    params: DaoAdvanceProposalParams,
    opts?: RequestOptions,
  ): Promise<DaoTxResult> {
    return this.http.post<DaoTxResult>(
      `/api/dao/proposals/${encodeURIComponent(proposalId)}/advance`,
      params,
      opts,
    );
  }

  // ── Voting ─────────────────────────────────────────────────────────

  /** Get votes for a proposal. */
  async getVotes(
    proposalId: string,
    opts?: RequestOptions,
  ): Promise<DaoVotesResponse> {
    return this.http.get<DaoVotesResponse>(
      `/api/dao/proposals/${encodeURIComponent(proposalId)}/votes`,
      undefined,
      opts,
    );
  }

  /** Cast a vote on a proposal. */
  async vote(params: DaoVoteCastParams, opts?: RequestOptions): Promise<DaoTxResult> {
    return this.http.post<DaoTxResult>('/api/dao/vote', params, opts);
  }

  // ── Delegation ─────────────────────────────────────────────────────

  /** Set delegation to another DID. */
  async delegate(params: DaoDelegateSetParams, opts?: RequestOptions): Promise<DaoTxResult> {
    return this.http.post<DaoTxResult>('/api/dao/delegate', params, opts);
  }

  /** Revoke a delegation. */
  async revokeDelegation(
    params: DaoDelegateRevokeParams,
    opts?: RequestOptions,
  ): Promise<DaoTxResult> {
    return this.http.post<DaoTxResult>('/api/dao/delegate/revoke', params, opts);
  }

  /** Get delegations for a DID. */
  async getDelegations(
    did: string,
    opts?: RequestOptions,
  ): Promise<DaoDelegationsResponse> {
    return this.http.get<DaoDelegationsResponse>(
      `/api/dao/delegations/${encodeURIComponent(did)}`,
      undefined,
      opts,
    );
  }

  // ── Treasury ───────────────────────────────────────────────────────

  /** Get current treasury status. */
  async getTreasury(opts?: RequestOptions): Promise<DaoTreasuryResponse> {
    return this.http.get<DaoTreasuryResponse>('/api/dao/treasury', undefined, opts);
  }

  /** Deposit into the treasury. */
  async deposit(
    params: DaoTreasuryDepositParams,
    opts?: RequestOptions,
  ): Promise<DaoTxResult> {
    return this.http.post<DaoTxResult>('/api/dao/treasury/deposit', params, opts);
  }

  // ── Timelock ───────────────────────────────────────────────────────

  /** List timelock entries. */
  async listTimelock(opts?: RequestOptions): Promise<DaoTimelockListResponse> {
    return this.http.get<DaoTimelockListResponse>('/api/dao/timelock', undefined, opts);
  }

  /** Execute a timelocked action. */
  async executeTimelock(
    actionId: string,
    params: DaoTimelockActionParams,
    opts?: RequestOptions,
  ): Promise<DaoTxResult> {
    return this.http.post<DaoTxResult>(
      `/api/dao/timelock/${encodeURIComponent(actionId)}/execute`,
      params,
      opts,
    );
  }

  /** Cancel a timelocked action. */
  async cancelTimelock(
    actionId: string,
    params: DaoTimelockCancelParams,
    opts?: RequestOptions,
  ): Promise<DaoTxResult> {
    return this.http.post<DaoTxResult>(
      `/api/dao/timelock/${encodeURIComponent(actionId)}/cancel`,
      params,
      opts,
    );
  }

  // ── Params ─────────────────────────────────────────────────────────

  /** Get governance parameters and thresholds. */
  async getParams(opts?: RequestOptions): Promise<DaoParamsResponse> {
    return this.http.get<DaoParamsResponse>('/api/dao/params', undefined, opts);
  }
}
