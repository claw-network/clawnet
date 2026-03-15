/**
 * Shared SSRF guard — validates URLs, blocks private/loopback hosts,
 * resolves DNS to catch domain-to-private-IP tricks, and blocks redirects.
 *
 * Phase 3: replaces duplicated SSRF logic in deliverables.ts and schema-validator.ts.
 */

import { resolve4, resolve6 } from 'node:dns/promises';

// ── Private IP patterns ─────────────────────────────────────────

const PRIVATE_IP_PATTERNS: RegExp[] = [
  /^10\.\d+\.\d+\.\d+$/,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,          // 172.16.0.0/12
  /^192\.168\.\d+\.\d+$/,                          // 192.168.0.0/16
  /^127\.\d+\.\d+\.\d+$/,                          // 127.0.0.0/8
  /^169\.254\.\d+\.\d+$/,                          // 169.254.0.0/16 (link-local / cloud metadata)
  /^0\.\d+\.\d+\.\d+$/,                            // 0.0.0.0/8
  /^\[?::1\]?$/,                                   // IPv6 loopback
  /^\[?fe80:/i,                                    // IPv6 link-local
  /^\[?fc[0-9a-f]{2}:/i,                           // IPv6 ULA (fc00::/7)
];

/** Check whether a hostname / IP string is private, loopback, or link-local. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || PRIVATE_IP_PATTERNS.some((re) => re.test(h));
}

// ── DNS resolution guard ────────────────────────────────────────

/**
 * Resolve a hostname to its IPs and verify none are private.
 * Throws if any resolved address falls in a private range.
 */
export async function assertPublicResolution(hostname: string): Promise<void> {
  // Skip raw IPs — already checked by isPrivateHost
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith('[')) return;
  if (hostname === 'localhost') return; // already caught by isPrivateHost

  const ips: string[] = [];
  try {
    const v4 = await resolve4(hostname);
    ips.push(...v4);
  } catch { /* no A record — ok */ }
  try {
    const v6 = await resolve6(hostname);
    ips.push(...v6);
  } catch { /* no AAAA record — ok */ }

  for (const ip of ips) {
    if (isPrivateHost(ip)) {
      throw new Error(`SSRF blocked: "${hostname}" resolves to private address ${ip}`);
    }
  }
}

// ── Validated fetch ─────────────────────────────────────────────

export interface SsrfFetchOptions {
  /** Request timeout in ms (default: 30 000). */
  timeoutMs?: number;
  /** Maximum response body size in bytes (default: 50 MB). */
  maxBytes?: number;
  /** Allowed schemes (default: ['https:', 'http:']). */
  allowedSchemes?: string[];
  /** Additional fetch init (headers, method, etc.). Redirect is always overridden. */
  init?: RequestInit;
}

/**
 * Fetch a URL with full SSRF protection:
 * 1. Reject non-http(s) schemes
 * 2. Reject private/loopback hostnames
 * 3. DNS-resolve hostname and reject private IPs
 * 4. Disable redirects (prevent 3xx → private IP bypass)
 */
export async function ssrfSafeFetch(
  uri: string,
  options: SsrfFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 30_000,
    allowedSchemes = ['https:', 'http:'],
    init = {},
  } = options;

  // 1. Parse & validate scheme
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid URI: ${uri}`);
  }

  if (!allowedSchemes.includes(parsed.protocol)) {
    throw new Error(`Unsupported URI scheme: ${parsed.protocol}`);
  }

  // 2. Check hostname against private ranges
  if (isPrivateHost(parsed.hostname)) {
    throw new Error(`SSRF blocked: private/loopback address "${parsed.hostname}"`);
  }

  // 3. DNS resolution check
  await assertPublicResolution(parsed.hostname);

  // 4. Fetch with redirect disabled + timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(uri, {
      ...init,
      signal: controller.signal,
      redirect: 'manual',
    });

    // Block any redirect (could point to private IP)
    if (resp.status >= 300 && resp.status < 400) {
      throw new Error(`SSRF blocked: redirect not allowed (HTTP ${resp.status})`);
    }

    return resp;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience: fetch + read body as Uint8Array with size limit.
 * Includes optional BLAKE3 hash verification.
 */
export async function ssrfSafeFetchBytes(
  uri: string,
  options: SsrfFetchOptions & { expectedHash?: string } = {},
): Promise<Uint8Array> {
  const { maxBytes = 50 * 1024 * 1024, expectedHash, ...rest } = options;

  const resp = await ssrfSafeFetch(uri, rest);

  if (!resp.ok) {
    throw new Error(`External fetch failed: HTTP ${resp.status}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No response body');

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      reader.cancel();
      throw new Error(`External content exceeds size limit (${maxBytes} bytes)`);
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  if (expectedHash) {
    const { blake3Hex } = await import('@claw-network/core');
    const actual = blake3Hex(result);
    if (actual !== expectedHash) {
      throw new Error(`Content hash mismatch: expected ${expectedHash.slice(0, 16)}… got ${actual.slice(0, 16)}…`);
    }
  }

  return result;
}
