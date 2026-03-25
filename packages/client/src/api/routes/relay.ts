import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RuntimeContext } from '../types.js';
import { getGlobalLogger } from '../../logger.js';

const logger = getGlobalLogger();
const DID_PATTERN = /^did:claw:z[A-Za-z0-9]{32,}$/;
const MAX_BODY_SIZE = 1_048_576; // 1 MB

// ── Simple in-memory rate limiter ────────────────────────

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(sourceIp: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(sourceIp);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(sourceIp, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count++;
  return bucket.count <= maxPerMinute;
}

// ── Body reading ─────────────────────────────────────────

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxBytes) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ── JSON response helper ─────────────────────────────────

function writeJson(res: ServerResponse, status: number, data: unknown): void {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

/**
 * Handle /relay/* requests. Returns true if the request was handled.
 *
 * Routes:
 *   GET  /relay/info                     — gateway info
 *   GET  /relay/:targetDid/ping          — DID reachability check
 *   ALL  /relay/:targetDid/api/v1/...    — proxy API requests to target
 */
export async function handleRelayRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  ctx: RuntimeContext,
): Promise<boolean> {
  if (!pathname.startsWith('/relay/') && pathname !== '/relay') return false;
  if (!ctx.apiProxyService) return false;

  // Strip /relay prefix
  const subPath = pathname.slice('/relay'.length) || '/';

  // GET /relay/info
  if (subPath === '/info' || subPath === '/info/') {
    if (req.method !== 'GET') {
      writeJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    const selfDid = ctx.identityService.getSelfDid();
    writeJson(res, 200, {
      data: {
        gatewayDid: selfDid,
        gatewayEnabled: true,
      },
    });
    return true;
  }

  // Parse /:targetDid/...
  // subPath starts with '/', e.g. '/did:claw:zXXX/ping'
  const withoutLeadingSlash = subPath.slice(1);
  const firstSlash = withoutLeadingSlash.indexOf('/');
  const targetDid = firstSlash === -1
    ? withoutLeadingSlash
    : withoutLeadingSlash.slice(0, firstSlash);
  const remaining = firstSlash === -1 ? '' : withoutLeadingSlash.slice(firstSlash);

  if (!DID_PATTERN.test(decodeURIComponent(targetDid))) {
    writeJson(res, 400, { error: 'Invalid DID format. Expected did:claw:z...' });
    return true;
  }

  const decodedDid = decodeURIComponent(targetDid);

  // Rate limiting
  const sourceIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
  if (!checkRateLimit(sourceIp, ctx.apiProxyService.config.rateLimitPerMinute)) {
    res.setHeader('Retry-After', '60');
    writeJson(res, 429, { error: 'Rate limit exceeded' });
    return true;
  }

  // GET /:targetDid/ping
  if (remaining === '/ping' || remaining === '/ping/') {
    if (req.method !== 'GET') {
      writeJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const result = await ctx.apiProxyService.ping(decodedDid);
      writeJson(res, 200, { data: result });
    } catch (err) {
      logger.error('[relay] Ping failed for %s: %s', decodedDid, (err as Error).message);
      writeJson(res, 502, { error: 'Ping failed' });
    }
    return true;
  }

  // Proxy: /:targetDid/api/v1/...
  if (!remaining.startsWith('/api/')) {
    writeJson(res, 400, { error: 'Proxy path must start with /api/' });
    return true;
  }

  // ── SSE relay: GET /:targetDid/api/v1/events ──────────
  // This is a long-lived SSE connection — NOT a normal API proxy call.
  if (remaining === '/api/v1/events' || remaining === '/api/v1/events/') {
    if (req.method !== 'GET') {
      writeJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    if (!ctx.eventPushService) {
      writeJson(res, 503, { error: 'Event push service unavailable' });
      return true;
    }
    try {
      await ctx.eventPushService.addGatewayClient(res, decodedDid);
      // Do NOT call res.end() — SSE is a long-lived connection
    } catch (err) {
      if (!res.headersSent) {
        writeJson(res, 502, { error: `Event subscription failed: ${(err as Error).message}` });
      }
    }
    return true;
  }

  // Read request body
  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
    try {
      body = await readBody(req, MAX_BODY_SIZE);
    } catch {
      writeJson(res, 413, { error: 'Request body too large (max 1MB)' });
      return true;
    }
  }

  // Collect headers to forward
  const forwardHeaders: Record<string, string> = {};
  if (req.headers.authorization) {
    forwardHeaders['authorization'] = req.headers.authorization as string;
  }
  if (req.headers['content-type']) {
    forwardHeaders['content-type'] = req.headers['content-type'] as string;
  }
  forwardHeaders['accept'] = (req.headers.accept as string) || 'application/json';

  try {
    const proxyResponse = await ctx.apiProxyService.proxyRequest(
      decodedDid,
      req.method || 'GET',
      remaining,
      forwardHeaders,
      body,
    );

    // Write proxy response back to client
    for (const [key, value] of Object.entries(proxyResponse.headers)) {
      if (key.toLowerCase() === 'transfer-encoding') continue;
      res.setHeader(key, String(value));
    }
    res.writeHead(proxyResponse.status);
    res.end(proxyResponse.bodyBytes ? Buffer.from(proxyResponse.bodyBytes) : '');
  } catch (err) {
    writeJson(res, 504, {
      error: 'Gateway timeout — target node did not respond',
      detail: (err as Error).message,
    });
  }

  return true;
}
