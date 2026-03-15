/**
 * Tests for HttpClient — error handling, timeout, headers, query params.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { HttpClient, ClawNetError } from '../src/http.js';
import { createMockServer, type MockServer } from './helpers/mock-server.js';

let mock: MockServer;

afterEach(async () => {
  if (mock) await mock.close();
});

describe('HttpClient', () => {
  it('GET with JSON response', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/test', 200, { ok: true });
    const client = new HttpClient({ baseUrl: mock.baseUrl });

    const result = await client.get<{ ok: boolean }>('/api/test');
    expect(result).toEqual({ ok: true });
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe('GET');
  });

  it('POST with JSON body', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/submit', 201, { id: '123' });
    const client = new HttpClient({ baseUrl: mock.baseUrl });

    const result = await client.post<{ id: string }>('/api/submit', { name: 'test' });
    expect(result).toEqual({ id: '123' });
    expect(mock.requests[0].body).toEqual({ name: 'test' });
    expect(mock.requests[0].headers['content-type']).toBe('application/json');
  });

  it('appends query parameters', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/search', 200, { items: [] });
    const client = new HttpClient({ baseUrl: mock.baseUrl });

    await client.get('/api/search', { q: 'hello', limit: 10 });
    expect(mock.requests[0].url).toContain('q=hello');
    expect(mock.requests[0].url).toContain('limit=10');
  });

  it('skips undefined query params', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/search', 200, { items: [] });
    const client = new HttpClient({ baseUrl: mock.baseUrl });

    await client.get('/api/search', { q: 'hello', limit: undefined });
    expect(mock.requests[0].url).toContain('q=hello');
    expect(mock.requests[0].url).not.toContain('limit');
  });

  it('includes api key header when configured', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/test', 200, {});
    const client = new HttpClient({ baseUrl: mock.baseUrl, apiKey: 'secret-key' });

    await client.get('/api/test');
    expect(mock.requests[0].headers['x-api-key']).toBe('secret-key');
  });

  it('throws ClawNetError on 4xx', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/missing', 404, {
      error: { code: 'NOT_FOUND', message: 'resource not found' },
    });
    const client = new HttpClient({ baseUrl: mock.baseUrl });

    await expect(client.get('/api/missing')).rejects.toThrow(ClawNetError);
    try {
      await client.get('/api/missing');
    } catch (e) {
      const err = e as ClawNetError;
      expect(err.status).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe('resource not found');
    }
  });

  it('throws ClawNetError on 5xx', async () => {
    mock = await createMockServer();
    mock.addRoute('POST', '/api/fail', 500, {
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    });
    const client = new HttpClient({ baseUrl: mock.baseUrl });

    await expect(client.post('/api/fail', {})).rejects.toThrow(ClawNetError);
  });

  it('DELETE method works', async () => {
    mock = await createMockServer();
    mock.addRoute('DELETE', '/api/item', 200, { deleted: true });
    const client = new HttpClient({ baseUrl: mock.baseUrl });

    const result = await client.delete<{ deleted: boolean }>('/api/item');
    expect(result).toEqual({ deleted: true });
    expect(mock.requests[0].method).toBe('DELETE');
  });

  it('PUT method works', async () => {
    mock = await createMockServer();
    mock.addRoute('PUT', '/api/item', 200, { updated: true });
    const client = new HttpClient({ baseUrl: mock.baseUrl });

    const result = await client.put<{ updated: boolean }>('/api/item', { data: 1 });
    expect(result).toEqual({ updated: true });
    expect(mock.requests[0].method).toBe('PUT');
  });

  it('strips trailing slashes from base URL', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/test', 200, { ok: true });
    const client = new HttpClient({ baseUrl: mock.baseUrl + '///' });

    await client.get('/api/test');
    expect(mock.requests).toHaveLength(1);
  });

  it('merges extra headers from RequestOptions', async () => {
    mock = await createMockServer();
    mock.addRoute('GET', '/api/test', 200, {});
    const client = new HttpClient({ baseUrl: mock.baseUrl });

    await client.get('/api/test', undefined, {
      headers: { 'x-custom': 'value' },
    });
    expect(mock.requests[0].headers['x-custom']).toBe('value');
  });
});
