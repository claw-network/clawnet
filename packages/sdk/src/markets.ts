/**
 * Markets API — unified access to Info, Task, and Capability markets.
 */
import type { HttpClient, RequestOptions } from './http.js';
import type {
  SearchParams,
  SearchResult,
  MarketListing,
  // Info
  InfoPublishParams,
  InfoPublishResponse,
  InfoPurchaseParams,
  InfoPurchaseResponse,
  InfoDeliverParams,
  InfoDeliverResponse,
  InfoConfirmParams,
  InfoConfirmResponse,
  InfoReviewParams,
  InfoReviewResponse,
  // Task
  TaskPublishParams,
  TaskPublishResponse,
  TaskBidParams,
  TaskBidResponse,
  TaskAcceptBidParams,
  TaskDeliverParams,
  TaskConfirmParams,
  TaskReviewParams,
  // Capability
  CapabilityPublishParams,
  CapabilityPublishResponse,
  CapabilityLeaseParams,
  CapabilityLeaseResponse,
  CapabilityLeaseDetail,
  CapabilityInvokeParams,
  CapabilityInvokeResponse,
  CapabilityLeaseActionParams,
  CapabilityLeaseActionResponse,
  // Dispute
  MarketDisputeOpenParams,
  MarketDisputeRespondParams,
  MarketDisputeResolveParams,
  EventFields,
} from './types.js';

// ---------------------------------------------------------------------------
// Helper type for generic action response
// ---------------------------------------------------------------------------
interface TxHashResponse {
  txHash: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Markets API
// ---------------------------------------------------------------------------

export class MarketsApi {
  readonly info: InfoMarketApi;
  readonly tasks: TaskMarketApi;
  readonly capabilities: CapabilityMarketApi;
  readonly disputes: MarketDisputeApi;

  constructor(private readonly http: HttpClient) {
    this.info = new InfoMarketApi(http);
    this.tasks = new TaskMarketApi(http);
    this.capabilities = new CapabilityMarketApi(http);
    this.disputes = new MarketDisputeApi(http);
  }

  /** Full-text cross-market search. */
  async search(params?: SearchParams, opts?: RequestOptions): Promise<SearchResult> {
    return this.http.get<SearchResult>(
      '/api/markets/search',
      params as Record<string, string | number | boolean>,
      opts,
    );
  }
}

// ---------------------------------------------------------------------------
// Info Market
// ---------------------------------------------------------------------------

export class InfoMarketApi {
  constructor(private readonly http: HttpClient) {}

  /** List info listings. */
  async list(params?: { limit?: number; offset?: number; status?: string }, opts?: RequestOptions) {
    return this.http.get<{ listings: MarketListing[]; total: number }>(
      '/api/markets/info',
      params as Record<string, string | number>,
      opts,
    );
  }

  /** Get a single info listing. */
  async get(listingId: string, opts?: RequestOptions): Promise<MarketListing> {
    return this.http.get<MarketListing>(`/api/markets/info/${enc(listingId)}`, undefined, opts);
  }

  /** Publish a new info listing. */
  async publish(params: InfoPublishParams, opts?: RequestOptions): Promise<InfoPublishResponse> {
    return this.http.post<InfoPublishResponse>('/api/markets/info', params, opts);
  }

  /** Get listing content / preview metadata. */
  async getContent(listingId: string, opts?: RequestOptions) {
    return this.http.get<Record<string, unknown>>(`/api/markets/info/${enc(listingId)}/content`, undefined, opts);
  }

  /** Purchase an info listing. */
  async purchase(listingId: string, params: InfoPurchaseParams, opts?: RequestOptions): Promise<InfoPurchaseResponse> {
    return this.http.post<InfoPurchaseResponse>(`/api/markets/info/${enc(listingId)}/purchase`, params, opts);
  }

  /** Deliver purchased content. */
  async deliver(listingId: string, params: InfoDeliverParams, opts?: RequestOptions): Promise<InfoDeliverResponse> {
    return this.http.post<InfoDeliverResponse>(`/api/markets/info/${enc(listingId)}/deliver`, params, opts);
  }

  /** Confirm delivery receipt. */
  async confirm(listingId: string, params: InfoConfirmParams, opts?: RequestOptions): Promise<InfoConfirmResponse> {
    return this.http.post<InfoConfirmResponse>(`/api/markets/info/${enc(listingId)}/confirm`, params, opts);
  }

  /** Leave a review. */
  async review(listingId: string, params: InfoReviewParams, opts?: RequestOptions): Promise<InfoReviewResponse> {
    return this.http.post<InfoReviewResponse>(`/api/markets/info/${enc(listingId)}/review`, params, opts);
  }

  /** Remove a listing. */
  async remove(listingId: string, params: EventFields, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/info/${enc(listingId)}/remove`, params, opts);
  }

  /** Subscribe to a listing. */
  async subscribe(listingId: string, params: EventFields & { resourcePrev?: string | null }, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/info/${enc(listingId)}/subscribe`, params, opts);
  }

  /** Unsubscribe from a listing. */
  async unsubscribe(listingId: string, params: EventFields & { resourcePrev?: string }, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/info/${enc(listingId)}/unsubscribe`, params, opts);
  }

  /** Get delivery record for an order. */
  async getDelivery(orderId: string, opts?: RequestOptions) {
    return this.http.get<Record<string, unknown>>(`/api/markets/info/orders/${enc(orderId)}/delivery`, undefined, opts);
  }
}

// ---------------------------------------------------------------------------
// Task Market
// ---------------------------------------------------------------------------

export class TaskMarketApi {
  constructor(private readonly http: HttpClient) {}

  /** List task listings. */
  async list(params?: { limit?: number; offset?: number; status?: string }, opts?: RequestOptions) {
    return this.http.get<{ listings: MarketListing[]; total: number }>(
      '/api/markets/tasks',
      params as Record<string, string | number>,
      opts,
    );
  }

  /** Get a single task listing. */
  async get(taskId: string, opts?: RequestOptions): Promise<MarketListing> {
    return this.http.get<MarketListing>(`/api/markets/tasks/${enc(taskId)}`, undefined, opts);
  }

  /** Publish a new task listing. */
  async publish(params: TaskPublishParams, opts?: RequestOptions): Promise<TaskPublishResponse> {
    return this.http.post<TaskPublishResponse>('/api/markets/tasks', params, opts);
  }

  /** Get bids for a task. */
  async getBids(taskId: string, opts?: RequestOptions) {
    return this.http.get<{ bids: unknown[]; total: number }>(`/api/markets/tasks/${enc(taskId)}/bids`, undefined, opts);
  }

  /** Submit a bid for a task. */
  async bid(taskId: string, params: TaskBidParams, opts?: RequestOptions): Promise<TaskBidResponse> {
    return this.http.post<TaskBidResponse>(`/api/markets/tasks/${enc(taskId)}/bids`, params, opts);
  }

  /** Accept a bid. */
  async acceptBid(taskId: string, params: TaskAcceptBidParams, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/tasks/${enc(taskId)}/accept`, params, opts);
  }

  /** Reject a bid. */
  async rejectBid(taskId: string, params: EventFields & { bidId: string; resourcePrev?: string }, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/tasks/${enc(taskId)}/reject`, params, opts);
  }

  /** Withdraw own bid. */
  async withdrawBid(taskId: string, params: EventFields & { bidId: string; resourcePrev?: string }, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/tasks/${enc(taskId)}/withdraw`, params, opts);
  }

  /** Deliver task submission. */
  async deliver(taskId: string, params: TaskDeliverParams, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/tasks/${enc(taskId)}/deliver`, params, opts);
  }

  /** Confirm task delivery. */
  async confirm(taskId: string, params: TaskConfirmParams, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/tasks/${enc(taskId)}/confirm`, params, opts);
  }

  /** Leave a review. */
  async review(taskId: string, params: TaskReviewParams, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/tasks/${enc(taskId)}/review`, params, opts);
  }

  /** Remove a task listing. */
  async remove(taskId: string, params: EventFields, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/tasks/${enc(taskId)}/remove`, params, opts);
  }
}

// ---------------------------------------------------------------------------
// Capability Market
// ---------------------------------------------------------------------------

export class CapabilityMarketApi {
  constructor(private readonly http: HttpClient) {}

  /** List capability listings. */
  async list(params?: { limit?: number; offset?: number; status?: string }, opts?: RequestOptions) {
    return this.http.get<{ listings: MarketListing[]; total: number }>(
      '/api/markets/capabilities',
      params as Record<string, string | number>,
      opts,
    );
  }

  /** Get a single capability listing. */
  async get(listingId: string, opts?: RequestOptions): Promise<MarketListing> {
    return this.http.get<MarketListing>(`/api/markets/capabilities/${enc(listingId)}`, undefined, opts);
  }

  /** Publish a new capability listing. */
  async publish(params: CapabilityPublishParams, opts?: RequestOptions): Promise<CapabilityPublishResponse> {
    return this.http.post<CapabilityPublishResponse>('/api/markets/capabilities', params, opts);
  }

  /** Start a lease on a capability. */
  async lease(listingId: string, params: CapabilityLeaseParams, opts?: RequestOptions): Promise<CapabilityLeaseResponse> {
    return this.http.post<CapabilityLeaseResponse>(`/api/markets/capabilities/${enc(listingId)}/lease`, params, opts);
  }

  /** Get lease details. */
  async getLeaseDetail(leaseId: string, opts?: RequestOptions): Promise<CapabilityLeaseDetail> {
    return this.http.get<CapabilityLeaseDetail>(`/api/markets/capabilities/leases/${enc(leaseId)}`, undefined, opts);
  }

  /** Record an invocation on a lease. */
  async invoke(leaseId: string, params: CapabilityInvokeParams, opts?: RequestOptions): Promise<CapabilityInvokeResponse> {
    return this.http.post<CapabilityInvokeResponse>(`/api/markets/capabilities/leases/${enc(leaseId)}/invoke`, params, opts);
  }

  /** Pause a lease. */
  async pauseLease(leaseId: string, params: CapabilityLeaseActionParams, opts?: RequestOptions): Promise<CapabilityLeaseActionResponse> {
    return this.http.post<CapabilityLeaseActionResponse>(`/api/markets/capabilities/leases/${enc(leaseId)}/pause`, params, opts);
  }

  /** Resume a paused lease. */
  async resumeLease(leaseId: string, params: CapabilityLeaseActionParams, opts?: RequestOptions): Promise<CapabilityLeaseActionResponse> {
    return this.http.post<CapabilityLeaseActionResponse>(`/api/markets/capabilities/leases/${enc(leaseId)}/resume`, params, opts);
  }

  /** Terminate a lease. */
  async terminateLease(leaseId: string, params: CapabilityLeaseActionParams, opts?: RequestOptions): Promise<CapabilityLeaseActionResponse> {
    return this.http.post<CapabilityLeaseActionResponse>(`/api/markets/capabilities/leases/${enc(leaseId)}/terminate`, params, opts);
  }

  /** Remove a capability listing. */
  async remove(listingId: string, params: EventFields, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/capabilities/${enc(listingId)}/remove`, params, opts);
  }
}

// ---------------------------------------------------------------------------
// Market Disputes
// ---------------------------------------------------------------------------

export class MarketDisputeApi {
  constructor(private readonly http: HttpClient) {}

  /** Open a market dispute on an order. */
  async open(orderId: string, params: MarketDisputeOpenParams, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/orders/${enc(orderId)}/dispute`, params, opts);
  }

  /** Respond to a dispute. */
  async respond(disputeId: string, params: MarketDisputeRespondParams, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/disputes/${enc(disputeId)}/respond`, params, opts);
  }

  /** Resolve a dispute. */
  async resolve(disputeId: string, params: MarketDisputeResolveParams, opts?: RequestOptions): Promise<TxHashResponse> {
    return this.http.post<TxHashResponse>(`/api/markets/disputes/${enc(disputeId)}/resolve`, params, opts);
  }
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function enc(s: string): string {
  return encodeURIComponent(s);
}
