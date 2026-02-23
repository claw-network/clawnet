/**
 * Lightweight path-matching router for node:http.
 *
 * Supports:
 * - Method + path pattern matching: GET /api/v1/contracts/:id
 * - Named path params: { id: "abc", idx: "0" }
 * - Middleware chain (CORS, body parsing)
 * - 404 / 405 fallback
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// ─── Types ──────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface RouteContext {
  /** Parsed URL */
  url: URL;
  /** Matched path parameters (e.g. { id: "abc" }) */
  params: Record<string, string>;
  /** Parsed query parameters */
  query: URLSearchParams;
  /** Parsed JSON body (only for methods with body) */
  body: unknown;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
) => Promise<void> | void;

export type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => Promise<void>,
) => Promise<void> | void;

interface RouteEntry {
  method: HttpMethod;
  segments: string[];
  paramNames: string[];
  handler: RouteHandler;
}

// ─── Router ─────────────────────────────────────────────────────

const MAX_BODY_BYTES = 1_000_000;

export class Router {
  private routes: RouteEntry[] = [];
  private middlewares: Middleware[] = [];

  /** Register global middleware. */
  use(mw: Middleware): this {
    this.middlewares.push(mw);
    return this;
  }

  /** Register a route. Pattern supports :param segments. */
  on(method: HttpMethod, pattern: string, handler: RouteHandler): this {
    const segments = pattern.split('/').filter(Boolean);
    const paramNames: string[] = [];
    for (const seg of segments) {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
      }
    }
    this.routes.push({ method, segments, paramNames, handler });
    return this;
  }

  get(pattern: string, handler: RouteHandler): this {
    return this.on('GET', pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): this {
    return this.on('POST', pattern, handler);
  }

  put(pattern: string, handler: RouteHandler): this {
    return this.on('PUT', pattern, handler);
  }

  patch(pattern: string, handler: RouteHandler): this {
    return this.on('PATCH', pattern, handler);
  }

  delete(pattern: string, handler: RouteHandler): this {
    return this.on('DELETE', pattern, handler);
  }

  /** Mount all routes from another router under a prefix. */
  mount(prefix: string, child: Router): this {
    const prefixSegments = prefix.split('/').filter(Boolean);
    for (const route of child.routes) {
      this.routes.push({
        method: route.method,
        segments: [...prefixSegments, ...route.segments],
        paramNames: route.paramNames,
        handler: route.handler,
      });
    }
    return this;
  }

  /** Handle an incoming request. Returns true if matched. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const urlStr = req.url ?? '/';
    const url = new URL(urlStr, `http://${req.headers.host ?? 'localhost'}`);
    const method = (req.method ?? 'GET').toUpperCase() as HttpMethod;
    const reqSegments = url.pathname.split('/').filter(Boolean);

    // Find matching route
    const match = this.matchRoute(method, reqSegments);

    if (!match) {
      // Check if path matches any method (→ 405) or nothing (→ 404)
      const pathMatches = this.findMatchingMethods(reqSegments);
      if (pathMatches.length > 0) {
        // 405 Method Not Allowed
        const { methodNotAllowed } = await import('./response.js');
        methodNotAllowed(res, pathMatches, url.pathname);
        return true;
      }
      return false; // no match at all
    }

    // Build context
    const body = await this.parseBody(req);
    const ctx: RouteContext = {
      url,
      params: match.params,
      query: url.searchParams,
      body,
    };

    // Run middleware chain then handler
    await this.runMiddlewareChain(req, res, () => match.handler(req, res, ctx));

    return true;
  }

  // ─── Internal ───────────────────────────────────────────────

  private matchRoute(
    method: HttpMethod,
    reqSegments: string[],
  ): { handler: RouteHandler; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== reqSegments.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      let paramIdx = 0;

      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(':')) {
          params[route.paramNames[paramIdx++]] = decodeURIComponent(reqSegments[i]);
        } else if (seg !== reqSegments[i]) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  private findMatchingMethods(reqSegments: string[]): string[] {
    const methods = new Set<string>();
    for (const route of this.routes) {
      if (route.segments.length !== reqSegments.length) continue;
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (!seg.startsWith(':') && seg !== reqSegments[i]) {
          matched = false;
          break;
        }
      }
      if (matched) methods.add(route.method);
    }
    return [...methods];
  }

  private async parseBody(req: IncomingMessage): Promise<unknown> {
    const method = req.method ?? 'GET';
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || method === 'DELETE') {
      return undefined;
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
          req.destroy();
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (chunks.length === 0) {
          resolve(undefined);
          return;
        }
        try {
          const text = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(text));
        } catch {
          resolve(undefined);
        }
      });

      req.on('error', reject);
    });
  }

  private async runMiddlewareChain(
    req: IncomingMessage,
    res: ServerResponse,
    final: () => Promise<void> | void,
  ): Promise<void> {
    let idx = 0;
    const mws = this.middlewares;

    const next = async (): Promise<void> => {
      if (idx < mws.length) {
        const mw = mws[idx++];
        await mw(req, res, next);
      } else {
        await final();
      }
    };

    await next();
  }
}
