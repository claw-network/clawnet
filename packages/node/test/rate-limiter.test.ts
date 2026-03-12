import { describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../src/api/middleware.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function mockReq(method = 'GET', url = '/api/v1/wallet', ip = '127.0.0.1'): IncomingMessage {
  return {
    method,
    url,
    headers: {},
    socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;
}

function mockRes(): ServerResponse & { _status?: number; _headers: Record<string, string>; _body: string } {
  const headers: Record<string, string> = {};
  const res = {
    _headers: headers,
    _body: '',
    _status: undefined as number | undefined,
    headersSent: false,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    writeHead(status: number, h?: Record<string, string>) {
      res._status = status;
      if (h) Object.entries(h).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
    },
    end(body?: string) {
      res._body = body ?? '';
      res.headersSent = true;
    },
  } as unknown as ServerResponse & { _status?: number; _headers: Record<string, string>; _body: string };
  return res;
}

describe('createRateLimiter', () => {
  it('allows requests within the limit', async () => {
    const limiter = createRateLimiter({ readLimit: 3, windowMs: 60_000 });
    const next = vi.fn();

    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      await limiter(mockReq(), res, next);
    }
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('blocks requests exceeding the read limit with 429', async () => {
    const limiter = createRateLimiter({ readLimit: 2, windowMs: 60_000 });
    const next = vi.fn();

    // Two allowed
    await limiter(mockReq(), mockRes(), next);
    await limiter(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);

    // Third blocked
    const res = mockRes();
    await limiter(mockReq(), res, next);
    expect(next).toHaveBeenCalledTimes(2); // not called again
    expect(res._body).toContain('Rate limit exceeded');
    expect(res._body).toContain('429');
  });

  it('applies separate limits for read and write', async () => {
    const limiter = createRateLimiter({ readLimit: 5, writeLimit: 2, windowMs: 60_000 });
    const next = vi.fn();

    // 2 writes allowed
    await limiter(mockReq('POST', '/api/v1/events'), mockRes(), next);
    await limiter(mockReq('POST', '/api/v1/events'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);

    // 3rd write blocked
    const res = mockRes();
    await limiter(mockReq('POST', '/api/v1/events'), res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res._body).toContain('write');

    // Reads still allowed
    await limiter(mockReq('GET', '/api/v1/wallet'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('exempts OPTIONS requests', async () => {
    const limiter = createRateLimiter({ readLimit: 1, windowMs: 60_000 });
    const next = vi.fn();

    // Exhaust the read limit
    await limiter(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);

    // OPTIONS should pass even though limit is reached
    await limiter(mockReq('OPTIONS', '/api/v1/wallet'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('exempts GET /api/v1/node', async () => {
    const limiter = createRateLimiter({ readLimit: 1, windowMs: 60_000 });
    const next = vi.fn();

    // Exhaust read limit
    await limiter(mockReq('GET', '/api/v1/wallet'), mockRes(), next);

    // /api/v1/node exempt
    await limiter(mockReq('GET', '/api/v1/node'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('tracks clients by IP independently', async () => {
    const limiter = createRateLimiter({ readLimit: 1, windowMs: 60_000 });
    const next = vi.fn();

    await limiter(mockReq('GET', '/api/v1/wallet', '10.0.0.1'), mockRes(), next);
    await limiter(mockReq('GET', '/api/v1/wallet', '10.0.0.2'), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);

    // Next request from .1 should be blocked, but .2 still has quota... already used
    const res1 = mockRes();
    await limiter(mockReq('GET', '/api/v1/wallet', '10.0.0.1'), res1, next);
    expect(next).toHaveBeenCalledTimes(2); // blocked
  });

  it('sets X-RateLimit-* headers on allowed requests', async () => {
    const limiter = createRateLimiter({ readLimit: 5, windowMs: 60_000 });
    const next = vi.fn();
    const res = mockRes();

    await limiter(mockReq(), res, next);
    expect(res._headers['x-ratelimit-limit']).toBe('5');
    expect(res._headers['x-ratelimit-remaining']).toBe('4');
    expect(res._headers['x-ratelimit-reset']).toBeTruthy();
  });

  it('respects X-Forwarded-For header for client IP', async () => {
    const limiter = createRateLimiter({ readLimit: 1, windowMs: 60_000 });
    const next = vi.fn();

    const req1 = mockReq();
    req1.headers['x-forwarded-for'] = '203.0.113.1';
    await limiter(req1, mockRes(), next);

    // Same forwarded IP → blocked
    const req2 = mockReq();
    req2.headers['x-forwarded-for'] = '203.0.113.1';
    const res2 = mockRes();
    await limiter(req2, res2, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Different forwarded IP → allowed
    const req3 = mockReq();
    req3.headers['x-forwarded-for'] = '203.0.113.2';
    await limiter(req3, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
