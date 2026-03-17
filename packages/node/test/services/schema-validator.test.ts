/**
 * SchemaValidator unit tests.
 *
 * Tests the SSRF-safe JSON Schema validator used by Layer 2.
 * Mocks HTTP fetch to avoid network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SchemaValidator } from '../../src/services/schema-validator.js';
import type { DeliverableEnvelope } from '@claw-network/protocol';

// Mock DNS at module level — needed because node:dns/promises exports are read-only
vi.mock('node:dns/promises', () => ({
  resolve4: vi.fn().mockResolvedValue(['93.184.216.34']),
  resolve6: vi.fn().mockRejectedValue(new Error('no AAAA')),
}));

// ── Helpers ────────────────────────────────────────────────────

function makeEnvelope(overrides: Partial<DeliverableEnvelope> = {}): DeliverableEnvelope {
  return {
    id: 'test-id',
    nonce: 'test-nonce',
    contextId: 'order-1',
    type: 'data',
    format: 'application/json',
    name: 'data.json',
    contentHash: 'aabbccdd',
    size: 42,
    producer: 'did:claw:zTest',
    signature: 'sig',
    createdAt: new Date().toISOString(),
    transport: { method: 'inline', data: '' },
    ...overrides,
  } as unknown as DeliverableEnvelope;
}

// ── Tests ──────────────────────────────────────────────────────

describe('SchemaValidator', () => {
  let validator: SchemaValidator;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    validator = new SchemaValidator();
    // Mock global fetch to return a JSON Schema without real network
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('passes when no schema.ref is present', async () => {
    const envelope = makeEnvelope();
    const result = await validator.validate(envelope, { answer: 42 });
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes when format is non-JSON, even with schema.ref', async () => {
    const envelope = makeEnvelope({
      format: 'text/plain' as never,
      schema: { ref: 'https://example.com/schema.json' } as never,
    });
    const result = await validator.validate(envelope, 'plain text');
    expect(result.passed).toBe(true);
    // Should NOT have attempted to fetch the schema
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('validates content against a fetched JSON Schema', async () => {
    const schema = {
      type: 'object',
      required: ['name', 'value'],
      properties: {
        name: { type: 'string' },
        value: { type: 'number' },
      },
    };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(schema), { status: 200 }));

    const envelope = makeEnvelope({
      schema: { ref: 'https://example.com/data-schema.json' } as never,
    });
    const result = await validator.validate(envelope, { name: 'test', value: 123 });
    expect(result.passed).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('fails when content violates the JSON Schema', async () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
      },
    };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(schema), { status: 200 }));

    const envelope = makeEnvelope({
      schema: { ref: 'https://example.com/strict-schema.json' } as never,
    });
    // Missing required 'name' field
    const result = await validator.validate(envelope, { value: 42 });
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects SSRF: private/loopback schema URIs', async () => {
    const envelope = makeEnvelope({
      schema: { ref: 'http://127.0.0.1:8080/schema.json' } as never,
    });
    await expect(validator.validate(envelope, {})).rejects.toThrow(/SSRF|private|loopback/i);
  });

  it('rejects non-http(s) scheme in schema.ref', async () => {
    const envelope = makeEnvelope({
      schema: { ref: 'file:///etc/passwd' } as never,
    });
    await expect(validator.validate(envelope, {})).rejects.toThrow(/Unsupported.*scheme/i);
  });

  it('throws when schema fetch returns non-200', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const envelope = makeEnvelope({
      schema: { ref: 'https://example.com/missing.json' } as never,
    });
    await expect(validator.validate(envelope, {})).rejects.toThrow(/HTTP 404/);
  });

  it('caches schemas between calls', async () => {
    const schema = { type: 'object' };
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(schema), { status: 200 }));

    const envelope = makeEnvelope({
      schema: { ref: 'https://example.com/cached-schema.json' } as never,
    });

    await validator.validate(envelope, {});
    await validator.validate(envelope, { extra: true });

    // Fetch should have been called only once (second call uses cache)
    // Note: cache is module-level, so this may or may not be 1 depending on test order.
    // At most 1 fetch per unique URI in this test.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
