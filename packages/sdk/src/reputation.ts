/**
 * Reputation API — profiles, reviews, record.
 */
import type { HttpClient, RequestOptions } from './http.js';
import type {
  Reputation,
  ReviewsResponse,
  RecordReputationParams,
  ReputationRecordResult,
} from './types.js';

export class ReputationApi {
  constructor(private readonly http: HttpClient) {}

  /** Get reputation profile for a DID. */
  async getProfile(did: string, opts?: RequestOptions): Promise<Reputation> {
    return this.http.get<Reputation>(`/api/reputation/${encodeURIComponent(did)}`, undefined, opts);
  }

  /** Get reviews for a DID. */
  async getReviews(
    did: string,
    params?: { source?: 'store' | 'log'; limit?: number; offset?: number },
    opts?: RequestOptions,
  ): Promise<ReviewsResponse> {
    return this.http.get<ReviewsResponse>(
      `/api/reputation/${encodeURIComponent(did)}/reviews`,
      params as Record<string, string | number>,
      opts,
    );
  }

  /** Record a reputation event (rate another agent). */
  async record(params: RecordReputationParams, opts?: RequestOptions): Promise<ReputationRecordResult> {
    return this.http.post<ReputationRecordResult>('/api/reputation/record', params, opts);
  }
}
