import type { ProblemDetail } from '@claw-network/client/protocol';
import { TelagentSdkError } from './errors.js';
import type { ApiLinks, ApiListEnvelope, QueryValue } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface RequestOptions {
  authToken?: string;
}

export interface ClientConfig {
  baseUrl: string;
  accessToken?: string;
  fetchImpl: typeof fetch;
  defaultHeaders: Record<string, string>;
}

export class ApiClient {
  protected readonly baseUrl: string;
  protected readonly accessToken?: string;
  protected readonly fetchImpl: typeof fetch;
  protected readonly defaultHeaders: Record<string, string>;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl;
    this.accessToken = config.accessToken;
    this.fetchImpl = config.fetchImpl;
    this.defaultHeaders = config.defaultHeaders;
  }

  // ── Public HTTP methods (used by modules) ─────────────────────────────────

  async requestData<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, QueryValue>,
    options?: RequestOptions,
  ): Promise<{ data: T; links?: ApiLinks }> {
    const response = await this.send(method, path, body, query, options);
    const payload = await this.readPayload(response);
    this.ensureOk(response, payload, path);

    if (!isRecord(payload) || !('data' in payload)) {
      throw new Error(`Unexpected API envelope for ${method} ${path}`);
    }

    return {
      data: payload.data as T,
      links: isRecord(payload.links) ? (payload.links as ApiLinks) : undefined,
    };
  }

  async requestList<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    query?: Record<string, QueryValue>,
    options?: RequestOptions,
  ): Promise<ApiListEnvelope<T>> {
    const response = await this.send(method, path, body, query, options);
    const payload = await this.readPayload(response);
    this.ensureOk(response, payload, path);

    if (!isRecord(payload) || !Array.isArray(payload.data) || !isRecord(payload.meta) || !isRecord(payload.links)) {
      throw new Error(`Unexpected list envelope for ${method} ${path}`);
    }

    return {
      data: payload.data as T[],
      meta: payload.meta as ApiListEnvelope<T>['meta'],
      links: payload.links as ApiLinks,
    };
  }

  async requestNoContent(
    method: 'DELETE' | 'POST',
    path: string,
    body?: unknown,
    query?: Record<string, QueryValue>,
    options?: RequestOptions,
  ): Promise<void> {
    const response = await this.send(method, path, body, query, options);
    if (response.status === 204) {
      return;
    }
    const payload = await this.readPayload(response);
    this.ensureOk(response, payload, path);
  }

  protected async send(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, QueryValue>,
    options?: RequestOptions,
  ): Promise<Response> {
    const headers = this.buildHeaders(options?.authToken);
    const init: RequestInit = {
      method,
      headers,
    };
    if (typeof body !== 'undefined') {
      init.body = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    return this.fetchImpl(this.toUrl(path, query), init);
  }

  protected buildHeaders(authToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
    };
    const token = authToken ?? this.accessToken;
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    return headers;
  }

  protected toUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(path.startsWith('/') ? path.slice(1) : path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === null || typeof value === 'undefined') {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  protected async readPayload(response: Response): Promise<unknown> {
    if (response.status === 204) {
      return undefined;
    }
    const text = await response.text();
    if (!text) {
      return undefined;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error(`Unable to parse JSON response: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  protected ensureOk(response: Response, payload: unknown, path: string): void {
    if (response.ok) {
      return;
    }
    const fallback: ProblemDetail = {
      type: 'https://telagent.dev/errors/internal-error',
      title: response.statusText || 'Request failed',
      status: response.status,
      detail: `Request failed: ${path}`,
      instance: path,
      code: 'INTERNAL_ERROR',
    };
    const problem = this.normalizeProblem(payload, fallback);
    throw new TelagentSdkError(problem);
  }

  protected normalizeProblem(payload: unknown, fallback: ProblemDetail): ProblemDetail {
    if (!isRecord(payload)) {
      return fallback;
    }
    if (
      typeof payload.type !== 'string'
      || typeof payload.title !== 'string'
      || typeof payload.status !== 'number'
    ) {
      return fallback;
    }
    return {
      type: payload.type,
      title: payload.title,
      status: payload.status,
      detail: typeof payload.detail === 'string' ? payload.detail : fallback.detail,
      instance: typeof payload.instance === 'string' ? payload.instance : fallback.instance,
      code: typeof payload.code === 'string' ? payload.code : fallback.code,
    };
  }
}
