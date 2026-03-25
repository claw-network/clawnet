import type { IncomingMessage, ServerResponse } from 'node:http';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

interface RouteDef {
  method: HttpMethod;
  path: string;
  segments: string[];
  handler: RouteHandler;
}

export class Router {
  private readonly routes: RouteDef[] = [];

  get(path: string, handler: RouteHandler): void {
    this.add('GET', path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.add('POST', path, handler);
  }

  put(path: string, handler: RouteHandler): void {
    this.add('PUT', path, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.add('DELETE', path, handler);
  }

  mount(prefix: string, child: Router): void {
    const normalizedPrefix = normalizePath(prefix);
    for (const route of child.routes) {
      const fullPath = joinPaths(normalizedPrefix, route.path);
      this.add(route.method, fullPath, route.handler);
    }
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = req.method as HttpMethod | undefined;
    if (!method || !['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      return false;
    }

    const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = normalizePath(parsedUrl.pathname);
    const body = await parseBody(req);

    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }
      const params = matchPath(pathname, route.segments);
      if (!params) {
        continue;
      }
      await route.handler({
        req,
        res,
        url: parsedUrl,
        params,
        query: parsedUrl.searchParams,
        body,
      });
      return true;
    }

    return false;
  }

  private add(method: HttpMethod, path: string, handler: RouteHandler): void {
    const normalizedPath = normalizePath(path);
    this.routes.push({
      method,
      path: normalizedPath,
      segments: splitPath(normalizedPath),
      handler,
    });
  }
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function normalizePath(path: string): string {
  const normalized = `/${path}`.replace(/\/+/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function joinPaths(prefix: string, path: string): string {
  return normalizePath(`${normalizePath(prefix)}/${normalizePath(path)}`);
}

function matchPath(pathname: string, routeSegments: string[]): Record<string, string> | null {
  const pathSegments = splitPath(pathname);
  if (pathSegments.length !== routeSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < routeSegments.length; i++) {
    const routeSegment = routeSegments[i];
    const pathSegment = pathSegments[i];

    if (routeSegment.startsWith(':')) {
      params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
      continue;
    }

    if (routeSegment !== pathSegment) {
      return null;
    }
  }

  return params;
}

async function parseBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET') {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }

  const rawBuffer = Buffer.concat(chunks);
  if (rawBuffer.length === 0) {
    return undefined;
  }

  // For non-JSON content types skip the expensive string conversion and return
  // the raw buffer immediately.
  const contentType = (req.headers['content-type'] ?? '').toLowerCase();
  const isJson =
    contentType.startsWith('application/json') || contentType.startsWith('text/');
  if (!isJson) {
    return rawBuffer;
  }

  const text = rawBuffer.toString('utf8').trim();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Return raw Buffer for binary content (images, files, etc.)
    return rawBuffer;
  }
}
