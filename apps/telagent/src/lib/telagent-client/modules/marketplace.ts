import type { AgentDID } from '@claw-network/client/protocol';
import type { ApiClient, RequestOptions } from '../client.js';

export class MarketplaceModule {
  constructor(private client: ApiClient) {}

  // ── Tasks ──────────────────────────────────────────────────────────────────

  async listTasks(filters?: Record<string, string | number | boolean | null | undefined>): Promise<unknown[]> {
    const envelope = await this.client.requestData<unknown[]>(
      'GET',
      '/api/v1/clawnet/market/tasks',
      undefined,
      filters,
    );
    return envelope.data;
  }

  async publishTask(
    sessionToken: string,
    input: { title: string; description: string; budget: number; tags?: string[] },
  ): Promise<unknown> {
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      '/api/v1/clawnet/market/tasks',
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async bid(
    sessionToken: string,
    taskId: string,
    input: { amount: number; proposal?: string },
  ): Promise<unknown> {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      throw new Error('taskId is required');
    }
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/tasks/${encodeURIComponent(normalizedTaskId)}/bid`,
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async listTaskBids(taskId: string): Promise<unknown[]> {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) {
      throw new Error('taskId is required');
    }
    const envelope = await this.client.requestData<unknown[]>(
      'GET',
      `/api/v1/clawnet/market/tasks/${encodeURIComponent(normalizedTaskId)}/bids`,
    );
    return envelope.data;
  }

  async acceptBid(sessionToken: string, taskId: string, bidId: string): Promise<unknown> {
    const normalizedTaskId = taskId.trim();
    const normalizedBidId = bidId.trim();
    if (!normalizedTaskId) throw new Error('taskId is required');
    if (!normalizedBidId) throw new Error('bidId is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/tasks/${encodeURIComponent(normalizedTaskId)}/accept-bid`,
      { bidId: normalizedBidId },
      undefined,
      options,
    );
    return envelope.data;
  }

  async rejectBid(sessionToken: string, taskId: string, bidId: string): Promise<unknown> {
    const normalizedTaskId = taskId.trim();
    const normalizedBidId = bidId.trim();
    if (!normalizedTaskId) throw new Error('taskId is required');
    if (!normalizedBidId) throw new Error('bidId is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/tasks/${encodeURIComponent(normalizedTaskId)}/reject-bid`,
      { bidId: normalizedBidId },
      undefined,
      options,
    );
    return envelope.data;
  }

  async withdrawBid(sessionToken: string, taskId: string, bidId: string): Promise<unknown> {
    const normalizedTaskId = taskId.trim();
    const normalizedBidId = bidId.trim();
    if (!normalizedTaskId) throw new Error('taskId is required');
    if (!normalizedBidId) throw new Error('bidId is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/tasks/${encodeURIComponent(normalizedTaskId)}/withdraw-bid`,
      { bidId: normalizedBidId },
      undefined,
      options,
    );
    return envelope.data;
  }

  async deliverTask(
    sessionToken: string,
    taskId: string,
    input: {
      content?: string;
      contentHash?: string;
      contentType?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<unknown> {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) throw new Error('taskId is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/tasks/${encodeURIComponent(normalizedTaskId)}/deliver`,
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async confirmTask(sessionToken: string, taskId: string): Promise<unknown> {
    const normalizedTaskId = taskId.trim();
    if (!normalizedTaskId) throw new Error('taskId is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/tasks/${encodeURIComponent(normalizedTaskId)}/confirm`,
      undefined,
      undefined,
      options,
    );
    return envelope.data;
  }

  // ── Markets ────────────────────────────────────────────────────────────────

  async search(input: { q?: string; type?: string } = {}): Promise<unknown[]> {
    const query: Record<string, string | undefined> = {
      q: input.q,
      type: input.type,
    };
    const envelope = await this.client.requestData<unknown[]>(
      'GET',
      '/api/v1/clawnet/markets/search',
      undefined,
      query,
    );
    return envelope.data;
  }

  // ── Info Market ────────────────────────────────────────────────────────────

  async listInfoListings(
    filters?: Record<string, string | number | boolean | null | undefined>,
  ): Promise<unknown[]> {
    const envelope = await this.client.requestData<unknown[]>(
      'GET',
      '/api/v1/clawnet/market/info',
      undefined,
      filters,
    );
    return envelope.data;
  }

  async getInfoListing(id: string): Promise<unknown> {
    const envelope = await this.client.requestData<unknown>(
      'GET',
      `/api/v1/clawnet/market/info/${encodeURIComponent(id)}`,
    );
    return envelope.data;
  }

  async publishInfo(
    sessionToken: string,
    input: { title: string; description: string; price: number; tags?: string[] },
  ): Promise<unknown> {
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      '/api/v1/clawnet/market/info',
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async purchaseInfo(sessionToken: string, id: string): Promise<unknown> {
    const normalizedId = id.trim();
    if (!normalizedId) throw new Error('id is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/info/${encodeURIComponent(normalizedId)}/purchase`,
      undefined,
      undefined,
      options,
    );
    return envelope.data;
  }

  async deliverInfo(
    sessionToken: string,
    id: string,
    input: {
      content?: string;
      contentHash?: string;
      contentType?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<unknown> {
    const normalizedId = id.trim();
    if (!normalizedId) throw new Error('id is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/info/${encodeURIComponent(normalizedId)}/deliver`,
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async confirmInfo(sessionToken: string, id: string): Promise<unknown> {
    const normalizedId = id.trim();
    if (!normalizedId) throw new Error('id is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/info/${encodeURIComponent(normalizedId)}/confirm`,
      undefined,
      undefined,
      options,
    );
    return envelope.data;
  }

  async subscribeInfo(sessionToken: string, id: string): Promise<unknown> {
    const normalizedId = id.trim();
    if (!normalizedId) throw new Error('id is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/info/${encodeURIComponent(normalizedId)}/subscribe`,
      undefined,
      undefined,
      options,
    );
    return envelope.data;
  }

  async unsubscribeInfo(sessionToken: string, id: string): Promise<unknown> {
    const normalizedId = id.trim();
    if (!normalizedId) throw new Error('id is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/info/${encodeURIComponent(normalizedId)}/unsubscribe`,
      undefined,
      undefined,
      options,
    );
    return envelope.data;
  }

  // ── Capability Market ──────────────────────────────────────────────────────

  async listCapabilities(
    filters?: Record<string, string | number | boolean | null | undefined>,
  ): Promise<unknown[]> {
    const envelope = await this.client.requestData<unknown[]>(
      'GET',
      '/api/v1/clawnet/market/capabilities',
      undefined,
      filters,
    );
    return envelope.data;
  }

  async getCapability(id: string): Promise<unknown> {
    const envelope = await this.client.requestData<unknown>(
      'GET',
      `/api/v1/clawnet/market/capabilities/${encodeURIComponent(id)}`,
    );
    return envelope.data;
  }

  async publishCapability(
    sessionToken: string,
    input: {
      title: string;
      description: string;
      pricePerInvocation: number;
      maxConcurrentLeases?: number;
      tags?: string[];
    },
  ): Promise<unknown> {
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      '/api/v1/clawnet/market/capabilities',
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async leaseCapability(
    sessionToken: string,
    id: string,
    input: { maxInvocations?: number; durationSeconds?: number } = {},
  ): Promise<unknown> {
    const normalizedId = id.trim();
    if (!normalizedId) throw new Error('id is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/capabilities/${encodeURIComponent(normalizedId)}/lease`,
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async invokeCapability(
    sessionToken: string,
    leaseId: string,
    input: { payload: Record<string, unknown> },
  ): Promise<unknown> {
    const normalizedId = leaseId.trim();
    if (!normalizedId) throw new Error('leaseId is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/capabilities/${encodeURIComponent(normalizedId)}/invoke`,
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async pauseLease(sessionToken: string, leaseId: string): Promise<unknown> {
    const normalizedId = leaseId.trim();
    if (!normalizedId) throw new Error('leaseId is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/capabilities/${encodeURIComponent(normalizedId)}/pause`,
      undefined,
      undefined,
      options,
    );
    return envelope.data;
  }

  async resumeLease(sessionToken: string, leaseId: string): Promise<unknown> {
    const normalizedId = leaseId.trim();
    if (!normalizedId) throw new Error('leaseId is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/capabilities/${encodeURIComponent(normalizedId)}/resume`,
      undefined,
      undefined,
      options,
    );
    return envelope.data;
  }

  async terminateLease(sessionToken: string, leaseId: string): Promise<unknown> {
    const normalizedId = leaseId.trim();
    if (!normalizedId) throw new Error('leaseId is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/capabilities/${encodeURIComponent(normalizedId)}/terminate`,
      undefined,
      undefined,
      options,
    );
    return envelope.data;
  }

  // ── Disputes ──────────────────────────────────────────────────────────────

  async listDisputes(
    filters?: Record<string, string | number | boolean | null | undefined>,
  ): Promise<unknown[]> {
    const envelope = await this.client.requestData<unknown[]>(
      'GET',
      '/api/v1/clawnet/market/disputes',
      undefined,
      filters,
    );
    return envelope.data;
  }

  async getDispute(disputeId: string): Promise<unknown> {
    const envelope = await this.client.requestData<unknown>(
      'GET',
      `/api/v1/clawnet/market/disputes/${encodeURIComponent(disputeId)}`,
    );
    return envelope.data;
  }

  async openDispute(
    sessionToken: string,
    input: { orderId: string; reason: string; evidence?: string },
  ): Promise<unknown> {
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      '/api/v1/clawnet/market/disputes',
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async respondDispute(
    sessionToken: string,
    disputeId: string,
    input: { response: string; evidence?: string },
  ): Promise<unknown> {
    const normalizedId = disputeId.trim();
    if (!normalizedId) throw new Error('disputeId is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/disputes/${encodeURIComponent(normalizedId)}/respond`,
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  async resolveDispute(
    sessionToken: string,
    disputeId: string,
    input: { outcome: 'refund' | 'release' | 'split'; splitRatio?: number; reason?: string },
  ): Promise<unknown> {
    const normalizedId = disputeId.trim();
    if (!normalizedId) throw new Error('disputeId is required');
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      `/api/v1/clawnet/market/disputes/${encodeURIComponent(normalizedId)}/resolve`,
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  // ── Reputation ──────────────────────────────────────────────────────────────

  async submitReview(
    sessionToken: string,
    input: { targetDid: AgentDID; score: number; comment?: string; orderId?: string },
  ): Promise<unknown> {
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      '/api/v1/clawnet/reputation/review',
      input,
      undefined,
      options,
    );
    return envelope.data;
  }

  // ── Contracts ──────────────────────────────────────────────────────────────

  async createServiceContract(
    sessionToken: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const options: RequestOptions = { authToken: sessionToken };
    const envelope = await this.client.requestData<unknown>(
      'POST',
      '/api/v1/clawnet/contracts',
      payload,
      undefined,
      options,
    );
    return envelope.data;
  }
}
