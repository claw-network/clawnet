/**
 * Lightweight API client for ClawNet node.
 * No SDK dependency — uses raw fetch to keep the app bundle small.
 */

export interface ApiConfig {
  baseUrl: string;
  apiKey?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(config: ApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  updateConfig(config: Partial<ApiConfig>): void {
    if (config.baseUrl !== undefined) this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    if (config.apiKey !== undefined) this.apiKey = config.apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        let errBody: { code?: string; message?: string } = {};
        try { errBody = await res.json(); } catch { /* ignore */ }
        throw new ApiError(res.status, errBody.code ?? 'UNKNOWN', errBody.message ?? `HTTP ${res.status}`);
      }

      const json = await res.json();
      // Unwrap API envelope { data: T, links?, meta? }
      if (json && typeof json === 'object' && 'data' in json && !('_raw' in json)) {
        return json.data as T;
      }
      return json as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Like request() but returns the full envelope (for paginated endpoints). */
  private async requestFull<T>(method: string, path: string): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { method, headers, signal: controller.signal });
      if (!res.ok) {
        let errBody: { code?: string; message?: string } = {};
        try { errBody = await res.json(); } catch { /* ignore */ }
        throw new ApiError(res.status, errBody.code ?? 'UNKNOWN', errBody.message ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── High-level methods ──

  async getNodeStatus(): Promise<{
    did: string;
    synced: boolean;
    blockHeight: number;
    peers: number;
    network: string;
    version: string;
    uptime: number;
  }> {
    return this.request('GET', '/api/v1/node');
  }

  async getBalance(address: string): Promise<{
    balance: number;
    available: number;
    pending: number;
    locked: number;
  }> {
    const raw = await this.request<Record<string, unknown>>('GET', `/api/v1/wallets/${encodeURIComponent(address)}`);
    return {
      balance: Number(raw.balance ?? 0),
      available: Number(raw.available ?? 0),
      pending: Number(raw.pending ?? 0),
      locked: Number(raw.locked ?? 0),
    };
  }

  async transfer(params: {
    did: string;
    passphrase: string;
    nonce: number;
    to: string;
    amount: number;
    fee?: number;
    memo?: string;
  }): Promise<{
    txHash: string;
    from: string;
    to: string;
    amount: number;
    fee?: number;
    status: string;
    timestamp: number;
  }> {
    return this.request('POST', '/api/v1/transfers', params);
  }

  async getTransactions(
    address: string,
    opts?: { page?: number; per_page?: number; type?: string },
  ): Promise<{
    transactions: Array<{
      txHash: string;
      from: string;
      to: string;
      amount: number;
      fee?: number;
      memo?: string;
      type: string;
      status: string;
      timestamp: number;
    }>;
    total: number;
    hasMore: boolean;
  }> {
    let url = `/api/v1/wallets/${encodeURIComponent(address)}/transactions`;
    if (opts) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    const envelope = await this.requestFull<{
      data: Array<Record<string, unknown>>;
      meta?: { pagination?: { total?: number; page?: number; totalPages?: number } };
      links?: { next?: string | null };
    }>('GET', url);
    const pagination = envelope.meta?.pagination;
    return {
      transactions: (envelope.data ?? []) as any,
      total: pagination?.total ?? 0,
      hasMore: !!envelope.links?.next,
    };
  }

  async createEscrow(params: unknown): Promise<unknown> {
    return this.request('POST', '/api/v1/escrows', params);
  }

  async getEscrow(id: string): Promise<unknown> {
    return this.request('GET', `/api/v1/escrows/${encodeURIComponent(id)}`);
  }
}
