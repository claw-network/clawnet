/**
 * HTTP client for ClawNet node API.
 *
 * Wraps fetch with base URL, JSON serialization, and unified error handling.
 */

/** Error returned by the ClawNet node API. */
export class ClawNetError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ClawNetError';
  }
}

/** Options passed to every HTTP request. */
export interface RequestOptions {
  /** Override the default timeout (ms). 0 = no timeout. */
  timeout?: number;
  /** Extra headers merged into the request. */
  headers?: Record<string, string>;
  /** AbortSignal for manual cancellation. */
  signal?: AbortSignal;
}

/** Minimal configuration for the HTTP client. */
export interface HttpClientConfig {
  /** Base URL of the node API, e.g. `http://127.0.0.1:9528`. */
  baseUrl: string;
  /** Optional API key for remote access. */
  apiKey?: string;
  /** Default request timeout in milliseconds (default: 30 000). */
  timeout?: number;
  /** Custom fetch implementation (useful for testing). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Low-level HTTP client that all SDK modules delegate to.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultTimeout: number;
  private readonly _fetch: typeof globalThis.fetch;

  constructor(config: HttpClientConfig) {
    // Strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.defaultTimeout = config.timeout ?? 30_000;
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ---------------------------------------------------------------------------
  // Public helpers
  // ---------------------------------------------------------------------------

  async get<T = unknown>(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    opts?: RequestOptions,
  ): Promise<T> {
    const normalizedPath = this.normalizePath(path, 'GET', undefined);
    const url = this.buildUrl(normalizedPath, query);
    return this.request<T>('GET', url, undefined, opts);
  }

  async post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const normalizedPath = this.normalizePath(path, 'POST', body);
    const url = this.buildUrl(normalizedPath);
    return this.request<T>('POST', url, body, opts);
  }

  async put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const normalizedPath = this.normalizePath(path, 'PUT', body);
    const url = this.buildUrl(normalizedPath);
    return this.request<T>('PUT', url, body, opts);
  }

  async delete<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const normalizedPath = this.normalizePath(path, 'DELETE', body);
    const url = this.buildUrl(normalizedPath);
    return this.request<T>('DELETE', url, body, opts);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const base = `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    if (!query) return base;

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  private normalizePath(path: string, _method: string, _body?: unknown): string {
    return path;
  }

  private async request<T>(
    method: string,
    url: string,
    body: unknown | undefined,
    opts?: RequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...opts?.headers,
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    const timeout = opts?.timeout ?? this.defaultTimeout;
    let controller: AbortController | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (timeout > 0 && !opts?.signal) {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller!.abort(), timeout);
    }

    try {
      const res = await this._fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: opts?.signal ?? controller?.signal,
      });

      // No-content responses
      if (res.status === 204) return undefined as T;

      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        if (!res.ok) {
          throw new ClawNetError(res.status, 'UNKNOWN', text || res.statusText);
        }
        return text as T;
      }

      if (!res.ok) {
        const problem = json as { title?: string; detail?: string; status?: number };
        const err = (json as { error?: { code?: string; message?: string } })?.error;
        throw new ClawNetError(
          res.status,
          err?.code ?? String(problem.status ?? 'UNKNOWN'),
          err?.message ?? problem.detail ?? problem.title ?? res.statusText,
        );
      }

      const envelope = json as {
        data?: unknown;
        meta?: { pagination?: { total?: number; page?: number; perPage?: number } };
      };
      if (Object.prototype.hasOwnProperty.call(envelope, 'data')) {
        if (Array.isArray(envelope.data)) {
          const total = envelope.meta?.pagination?.total ?? envelope.data.length;
          const page = envelope.meta?.pagination?.page ?? 1;
          const pageSize = envelope.meta?.pagination?.perPage ?? envelope.data.length;
          return {
            items: envelope.data,
            listings: envelope.data,
            contracts: envelope.data,
            proposals: envelope.data,
            votes: envelope.data,
            reviews: envelope.data,
            delegations: envelope.data,
            transactions: envelope.data,
            total,
            page,
            pageSize,
            pagination: { total, page, perPage: pageSize },
          } as T;
        }
        return envelope.data as T;
      }

      return json as T;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
}
