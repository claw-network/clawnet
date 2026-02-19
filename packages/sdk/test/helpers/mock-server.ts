/**
 * Test helper — mock HTTP server that records requests and returns canned responses.
 *
 * Uses Node's built-in http module so the SDK exercises real fetch over the network.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface MockRoute {
  method: string;
  path: string | RegExp;
  status: number;
  body: unknown;
}

/**
 * Lightweight mock server.
 *
 * ```ts
 * const mock = await createMockServer();
 * mock.addRoute('GET', '/api/node/status', 200, { synced: true });
 * const client = new ClawTokenClient({ baseUrl: mock.baseUrl });
 * await client.node.getStatus();
 * mock.close();
 * ```
 */
export interface MockServer {
  /** e.g. `http://127.0.0.1:12345` */
  baseUrl: string;
  /** The underlying http.Server */
  server: Server;
  /** Add a canned response for a request. */
  addRoute(method: string, path: string | RegExp, status: number, body: unknown): void;
  /** All recorded requests in order. */
  requests: RecordedRequest[];
  /** Clear recorded requests. */
  clearRequests(): void;
  /** Shut down the server. */
  close(): Promise<void>;
}

export async function createMockServer(): Promise<MockServer> {
  const routes: MockRoute[] = [];
  const requests: RecordedRequest[] = [];

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const bodyChunks: Buffer[] = [];
    for await (const chunk of req) bodyChunks.push(chunk as Buffer);
    const rawBody = Buffer.concat(bodyChunks).toString();
    let parsedBody: unknown;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      parsedBody = rawBody;
    }

    const recorded: RecordedRequest = {
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: parsedBody,
    };
    requests.push(recorded);

    // Find matching route (last addRoute wins for same method+path)
    const urlpath = (req.url ?? '/').split('?')[0];
    let matched: MockRoute | undefined;
    for (let i = routes.length - 1; i >= 0; i--) {
      const r = routes[i];
      if (r.method !== req.method) continue;
      if (typeof r.path === 'string' && r.path === urlpath) {
        matched = r;
        break;
      }
      if (r.path instanceof RegExp && r.path.test(urlpath)) {
        matched = r;
        break;
      }
    }

    if (!matched) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `No mock for ${req.method} ${urlpath}` } }));
      return;
    }

    res.writeHead(matched.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(matched.body));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    requests,
    addRoute(method, path, status, body) {
      routes.push({ method, path, status, body });
    },
    clearRequests() {
      requests.length = 0;
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
