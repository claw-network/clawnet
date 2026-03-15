/**
 * SSRF guard tests.
 *
 * Tests isPrivateHost, assertPublicResolution, ssrfSafeFetch, ssrfSafeFetchBytes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isPrivateHost, assertPublicResolution, ssrfSafeFetch } from '../../src/services/ssrf-guard.js';
import { resolve4, resolve6 } from 'node:dns/promises';

// Mock DNS at module level — node:dns/promises exports are read-only
vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn().mockResolvedValue(['93.184.216.34']),
  resolve6: vi.fn().mockRejectedValue(new Error('no AAAA')),
}));

const mockResolve4 = resolve4 as ReturnType<typeof vi.fn>;
const mockResolve6 = resolve6 as ReturnType<typeof vi.fn>;

// ── isPrivateHost ──────────────────────────────────────────────

describe('isPrivateHost', () => {
  const privateCases = [
    'localhost',
    '127.0.0.1',
    '127.0.1.1',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.255.255',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    '[::1]',
    'fc00::1',
    'fe80::1',
  ];

  for (const host of privateCases) {
    it(`blocks private host: ${host}`, () => {
      expect(isPrivateHost(host)).toBe(true);
    });
  }

  const publicCases = [
    '8.8.8.8',
    '1.1.1.1',
    '203.0.113.1',
    '2001:db8::1',
    'example.com', // not an IP, not 'localhost'
  ];

  for (const host of publicCases) {
    it(`allows public host: ${host}`, () => {
      expect(isPrivateHost(host)).toBe(false);
    });
  }
});

// ── assertPublicResolution ─────────────────────────────────────

describe('assertPublicResolution', () => {
  beforeEach(() => {
    mockResolve4.mockReset().mockResolvedValue(['93.184.216.34']);
    mockResolve6.mockReset().mockRejectedValue(new Error('no AAAA'));
  });

  it('passes when hostname resolves to public IP', async () => {
    mockResolve4.mockResolvedValue(['93.184.216.34']);
    await expect(assertPublicResolution('example.com')).resolves.toBeUndefined();
  });

  it('throws when hostname resolves to private IP', async () => {
    mockResolve4.mockResolvedValue(['10.0.0.5']);
    await expect(assertPublicResolution('evil.example.com')).rejects.toThrow(/SSRF.*resolves to private/);
  });

  it('throws when hostname resolves to loopback', async () => {
    mockResolve4.mockResolvedValue(['127.0.0.1']);
    await expect(assertPublicResolution('sneaky.example.com')).rejects.toThrow(/SSRF.*resolves to private/);
  });

  it('throws when IPv6 resolves to ULA', async () => {
    mockResolve4.mockRejectedValue(new Error('no A'));
    mockResolve6.mockResolvedValue(['fc00::1']);
    await expect(assertPublicResolution('internal.example.com')).rejects.toThrow(/SSRF.*resolves to private/);
  });

  it('skips resolution for raw IPv4 addresses', async () => {
    await assertPublicResolution('8.8.8.8');
    expect(mockResolve4).not.toHaveBeenCalled();
  });
});

// ── ssrfSafeFetch ──────────────────────────────────────────────

describe('ssrfSafeFetch', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    // Default: resolve to public IP
    mockResolve4.mockReset().mockResolvedValue(['93.184.216.34']);
    mockResolve6.mockReset().mockRejectedValue(new Error('no AAAA'));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('rejects private hostname', async () => {
    await expect(ssrfSafeFetch('http://127.0.0.1/data')).rejects.toThrow(/SSRF.*private/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects unsupported scheme', async () => {
    await expect(ssrfSafeFetch('ftp://example.com/data')).rejects.toThrow(/Unsupported URI scheme/);
  });

  it('blocks redirect responses', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/' } }));
    await expect(ssrfSafeFetch('http://example.com/redirect')).rejects.toThrow(/SSRF.*redirect/);
  });

  it('blocks hostname that resolves to private IP', async () => {
    mockResolve4.mockResolvedValue(['10.0.0.5']);
    await expect(ssrfSafeFetch('http://internal.corp.example.com/data')).rejects.toThrow(/SSRF.*resolves to private/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches successfully for public URLs', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const resp = await ssrfSafeFetch('https://example.com/data');
    expect(resp.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
