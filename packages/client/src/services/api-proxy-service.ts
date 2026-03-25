import type { ApiProxyRequest, ApiProxyResponse } from '../protocol/index.js';
import type { ClawNetTransportService } from './clawnet-transport-service.js';
import { getGlobalLogger } from '../logger.js';

const logger = getGlobalLogger();
const PING_TIMEOUT_MS = 5_000;

export interface ApiProxyConfig {
  /** Whether this node accepts API proxy requests (target role). */
  enabled: boolean;
  /** Whether this node can relay for other DIDs (gateway role). */
  gatewayEnabled: boolean;
  /** Proxy request timeout in milliseconds. */
  timeoutMs: number;
  /** Gateway-side rate limit: max requests per minute per source IP. */
  rateLimitPerMinute: number;
  /** Maximum request/response body size in bytes. */
  maxBodyBytes: number;
}

interface PendingRequest {
  resolve: (response: ApiProxyResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingPing {
  resolve: (result: { reachable: boolean; latencyMs: number }) => void;
  timer: ReturnType<typeof setTimeout>;
  startMs: number;
}

export class ApiProxyService {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pendingPings = new Map<string, PendingPing>();
  readonly config: ApiProxyConfig;

  constructor(
    config: ApiProxyConfig,
    private readonly transport: ClawNetTransportService,
    private readonly localPort: number,
  ) {
    this.config = config;
  }

  // ── Target role: handle incoming proxy request ─────────

  async handleProxyRequest(
    request: ApiProxyRequest,
    sourceDid: string,
  ): Promise<void> {
    if (!this.config.enabled) {
      await this.transport.sendApiProxyResponse(sourceDid, {
        requestId: request.requestId,
        status: 403,
        headers: { 'content-type': 'application/json' },
        bodyBytes: new TextEncoder().encode(JSON.stringify({ error: 'API proxy not enabled on this node' })),
      });
      return;
    }

    try {
      const url = `http://127.0.0.1:${this.localPort}${request.path}`;
      const fetchInit: RequestInit = {
        method: request.method,
        headers: request.headers,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      };
      if (request.body && request.method !== 'GET' && request.method !== 'HEAD') {
        fetchInit.body = request.body;
      }

      const res = await fetch(url, fetchInit);
      const bodyBuf = await res.arrayBuffer();

      if (bodyBuf.byteLength > this.config.maxBodyBytes) {
        await this.transport.sendApiProxyResponse(sourceDid, {
          requestId: request.requestId,
          status: 413,
          headers: { 'content-type': 'application/json' },
          bodyBytes: new TextEncoder().encode(JSON.stringify({ error: 'Response body exceeds size limit' })),
        });
        return;
      }

      const resHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        resHeaders[key] = value;
      });

      await this.transport.sendApiProxyResponse(sourceDid, {
        requestId: request.requestId,
        status: res.status,
        headers: resHeaders,
        bodyBytes: new Uint8Array(bodyBuf),
      });
    } catch (err) {
      logger.error('[api-proxy] Failed to proxy request %s: %s', request.requestId, (err as Error).message);
      await this.transport.sendApiProxyResponse(sourceDid, {
        requestId: request.requestId,
        status: 504,
        headers: { 'content-type': 'application/json' },
        bodyBytes: new TextEncoder().encode(JSON.stringify({ error: 'Gateway timeout' })),
      }).catch(() => {});
    }
  }

  // ── Gateway role: send proxy request and await response ─

  async proxyRequest(
    targetDid: string,
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<ApiProxyResponse> {
    if (!this.config.gatewayEnabled) {
      throw new Error('Gateway mode not enabled on this node');
    }

    if (body && body.length > this.config.maxBodyBytes) {
      return {
        requestId: '',
        status: 413,
        headers: { 'content-type': 'application/json' },
        bodyBytes: new TextEncoder().encode(JSON.stringify({ error: 'Request body exceeds size limit' })),
      };
    }

    const requestId = crypto.randomUUID();
    const request: ApiProxyRequest = { requestId, method, path, headers, body };

    return new Promise<ApiProxyResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`API proxy request timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });

      this.transport.sendApiProxyRequest(targetDid, request).catch((err) => {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // ── Gateway role: correlate incoming response ───────────

  handleProxyResponse(response: ApiProxyResponse): void {
    const entry = this.pending.get(response.requestId);
    if (!entry) {
      logger.warn('[api-proxy] Received response for unknown request %s', response.requestId);
      return;
    }
    this.pending.delete(response.requestId);
    clearTimeout(entry.timer);
    entry.resolve(response);
  }

  // ── Ping: lightweight reachability check ────────────────

  async ping(targetDid: string): Promise<{ reachable: boolean; latencyMs: number }> {
    const pingId = crypto.randomUUID();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPings.delete(pingId);
        resolve({ reachable: false, latencyMs: -1 });
      }, PING_TIMEOUT_MS);

      this.pendingPings.set(pingId, { resolve, timer, startMs: Date.now() });

      this.transport.sendApiProxyPing(targetDid, pingId).catch(() => {
        this.pendingPings.delete(pingId);
        clearTimeout(timer);
        resolve({ reachable: false, latencyMs: -1 });
      });
    });
  }

  async handlePing(sourceDid: string, pingId: string): Promise<void> {
    if (!this.config.enabled) return;
    await this.transport.sendApiProxyPong(sourceDid, pingId);
  }

  handlePong(pingId: string): void {
    const entry = this.pendingPings.get(pingId);
    if (!entry) return;
    this.pendingPings.delete(pingId);
    clearTimeout(entry.timer);
    entry.resolve({ reachable: true, latencyMs: Date.now() - entry.startMs });
  }

  // ── Cleanup ─────────────────────────────────────────────

  dispose(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('ApiProxyService disposed'));
    }
    this.pending.clear();
    for (const [, entry] of this.pendingPings) {
      clearTimeout(entry.timer);
    }
    this.pendingPings.clear();
  }
}
