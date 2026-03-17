import { afterEach, describe, expect, it, vi } from 'vitest';
import { metricsRegistry, metricsMiddleware, blockHeight, p2pPeers } from '../src/api/metrics.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function mockReq(method = 'GET', url = '/api/v1/wallet'): IncomingMessage {
  return {
    method,
    url,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

function mockRes(statusCode = 200): ServerResponse {
  return {
    statusCode,
    headersSent: false,
    setHeader() {},
    getHeader() { return undefined; },
    writeHead(s: number) { (this as { statusCode: number }).statusCode = s; },
    end() { (this as { headersSent: boolean }).headersSent = true; },
  } as unknown as ServerResponse;
}

describe('Prometheus metrics', () => {
  afterEach(() => {
    metricsRegistry.resetMetrics();
  });

  it('exports metrics in Prometheus text format', async () => {
    const output = await metricsRegistry.metrics();
    expect(output).toContain('process_cpu');
    expect(output).toContain('clawnet');
  });

  it('metricsMiddleware records request duration and count', async () => {
    const mw = metricsMiddleware();
    const next = vi.fn();
    const req = mockReq('GET', '/api/v1/wallet');
    const res = mockRes(200);

    await mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    const output = await metricsRegistry.metrics();
    expect(output).toContain('clawnet_http_requests_total');
    expect(output).toContain('method="GET"');
    expect(output).toContain('clawnet_http_request_duration_seconds');
  });

  it('normalises path parameters to avoid label cardinality explosion', async () => {
    const mw = metricsMiddleware();
    const next = vi.fn();

    // Numeric ID
    await mw(mockReq('GET', '/api/v1/escrows/123'), mockRes(), next);
    // DID path
    await mw(mockReq('GET', '/api/v1/identities/did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR'), mockRes(), next);
    // EVM address
    await mw(mockReq('GET', '/api/v1/wallets/0xA9b95A4fDCD673f6aE0D2a873E0f4771CA7D0119/balance'), mockRes(), next);

    const output = await metricsRegistry.metrics();
    // Should see normalised routes, not raw IDs
    expect(output).toContain('/api/v1/escrows/:id');
    expect(output).toContain('/api/v1/identities/:did');
    expect(output).toContain('/api/v1/wallets/:id/balance');
    // Should NOT contain raw IDs
    expect(output).not.toContain('123');
    expect(output).not.toContain('zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR');
  });

  it('gauge values can be set and appear in output', async () => {
    blockHeight.set(42);
    p2pPeers.set(5);

    const output = await metricsRegistry.metrics();
    expect(output).toContain('clawnet_block_height{app="clawnet"} 42');
    expect(output).toContain('clawnet_p2p_peers{app="clawnet"} 5');
  });
});
