import { describe, expect, it } from 'vitest';
import {
  DELIVERABLE_TYPES,
  isDeliverableType,
  resolveDeliverableType,
} from '../src/deliverables/types.js';
import {
  buildUnsignedEnvelope,
  validateEnvelopeStructure,
  computeCompositeHash,
  wrapLegacyDeliverable,
} from '../src/deliverables/envelope.js';
import {
  DELIVERY_AUTH_PROTOCOL,
  isDeliveryAuthRequest,
  isDeliveryAuthPayload,
  isDeliveryAuthResponse,
} from '../src/deliverables/delivery-auth.js';
import type { DeliverableEnvelope } from '../src/deliverables/types.js';

describe('deliverable types', () => {
  it('has 9 deliverable types', () => {
    expect(DELIVERABLE_TYPES).toHaveLength(9);
  });

  it('isDeliverableType validates correctly', () => {
    expect(isDeliverableType('text')).toBe(true);
    expect(isDeliverableType('binary')).toBe(true);
    expect(isDeliverableType('composite')).toBe(true);
    expect(isDeliverableType('unknown')).toBe(false);
    expect(isDeliverableType('')).toBe(false);
  });

  it('resolves legacy aliases', () => {
    expect(resolveDeliverableType('file')).toBe('binary');
    expect(resolveDeliverableType('report')).toBe('document');
    expect(resolveDeliverableType('service')).toBe('interactive');
    expect(resolveDeliverableType('result')).toBe('data');
    expect(resolveDeliverableType('analysis')).toBe('data');
    expect(resolveDeliverableType('design')).toBe('document');
    expect(resolveDeliverableType('integration')).toBe('code');
  });

  it('resolves current types as-is', () => {
    for (const t of DELIVERABLE_TYPES) {
      expect(resolveDeliverableType(t)).toBe(t);
    }
  });

  it('throws on unknown type', () => {
    expect(() => resolveDeliverableType('foobar')).toThrow('Unknown deliverable type');
  });
});

describe('envelope builder', () => {
  const mockComputeId = (ctx: string, _prod: string, _nonce: string, _ts: string) =>
    `mock-id-${ctx}`;

  it('builds an unsigned envelope with all required fields', () => {
    const env = buildUnsignedEnvelope(
      {
        contextId: 'order-1',
        producer: 'did:claw:zTest',
        nonce: 'abc123',
        type: 'text',
        format: 'text/plain',
        name: 'report.txt',
        contentHash: 'deadbeef'.repeat(8),
        size: 1024,
        createdAt: '2026-03-01T00:00:00Z',
        transport: { method: 'inline', data: 'dGVzdA==' },
      },
      mockComputeId,
    );

    expect(env.id).toBe('mock-id-order-1');
    expect(env.nonce).toBe('abc123');
    expect(env.contextId).toBe('order-1');
    expect(env.type).toBe('text');
    expect(env.format).toBe('text/plain');
    expect(env.name).toBe('report.txt');
    expect(env.contentHash).toBe('deadbeef'.repeat(8));
    expect(env.size).toBe(1024);
    expect(env.producer).toBe('did:claw:zTest');
    expect(env.createdAt).toBe('2026-03-01T00:00:00Z');
    expect(env.transport).toEqual({ method: 'inline', data: 'dGVzdA==' });
    // No signature on unsigned envelope
    expect((env as Record<string, unknown>).signature).toBeUndefined();
  });

  it('includes optional fields when provided', () => {
    const env = buildUnsignedEnvelope(
      {
        contextId: 'order-1',
        producer: 'did:claw:zTest',
        nonce: 'abc123',
        type: 'composite',
        format: 'application/json',
        name: 'bundle',
        description: 'A bundle of deliverables',
        contentHash: 'deadbeef'.repeat(8),
        size: 2048,
        createdAt: '2026-03-01T00:00:00Z',
        transport: { method: 'inline', data: 'dGVzdA==' },
        parts: ['id-a', 'id-b'],
      },
      mockComputeId,
    );

    expect(env.description).toBe('A bundle of deliverables');
    expect(env.parts).toEqual(['id-a', 'id-b']);
  });
});

describe('envelope validation', () => {
  const validEnvelope: DeliverableEnvelope = {
    id: 'test-id',
    nonce: 'abc123',
    contextId: 'order-1',
    type: 'text',
    format: 'text/plain',
    name: 'test.txt',
    contentHash: 'deadbeef'.repeat(8),
    size: 100,
    producer: 'did:claw:zTest',
    signature: 'sig123',
    createdAt: '2026-03-01T00:00:00Z',
    transport: { method: 'inline', data: 'dGVzdA==' },
  };

  it('accepts a valid envelope', () => {
    const result = validateEnvelopeStructure(validEnvelope);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing required fields', () => {
    const bad = { ...validEnvelope, id: '', signature: '' };
    const result = validateEnvelopeStructure(bad);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('id is required');
    expect(result.errors).toContain('signature is required');
  });

  it('rejects invalid transport method', () => {
    const bad = {
      ...validEnvelope,
      transport: { method: 'pigeon' } as unknown as DeliverableEnvelope['transport'],
    };
    const result = validateEnvelopeStructure(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('transport.method'))).toBe(true);
  });

  it('rejects composite without parts', () => {
    const bad = { ...validEnvelope, type: 'composite' as const };
    const result = validateEnvelopeStructure(bad);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('composite type requires non-empty parts array');
  });

  it('accepts composite with parts', () => {
    const ok = { ...validEnvelope, type: 'composite' as const, parts: ['a', 'b'] };
    const result = validateEnvelopeStructure(ok);
    expect(result.valid).toBe(true);
  });

  it('validates encryption structure', () => {
    const bad = {
      ...validEnvelope,
      encryption: {
        algorithm: 'aes-128-cbc' as 'x25519-aes-256-gcm',
        keyEnvelopes: {},
        nonce: 'abc',
        tag: 'def',
      },
    };
    const result = validateEnvelopeStructure(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('x25519-aes-256-gcm'))).toBe(true);
  });
});

describe('composite hash', () => {
  const mockBlake3 = (data: Uint8Array) => {
    // Simple mock: just return hex of first 32 bytes
    return Array.from(data.slice(0, 32))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .padEnd(64, '0');
  };
  const mockUtf8 = (s: string) => new TextEncoder().encode(s);

  it('uses declaration order (no sorting)', () => {
    const h1 = computeCompositeHash(['bbb', 'aaa'], mockBlake3, mockUtf8);
    const h2 = computeCompositeHash(['aaa', 'bbb'], mockBlake3, mockUtf8);
    expect(h1).not.toBe(h2);
  });

  it('same order produces same hash', () => {
    const h1 = computeCompositeHash(['aaa', 'bbb'], mockBlake3, mockUtf8);
    const h2 = computeCompositeHash(['aaa', 'bbb'], mockBlake3, mockUtf8);
    expect(h1).toBe(h2);
  });
});

describe('legacy wrapper', () => {
  const mockComputeId = (ctx: string, _prod: string, _nonce: string, _ts: string) =>
    `mock-id-${ctx}`;
  const mockContentHash = (_data: Uint8Array) => 'fakehash'.repeat(8);
  const mockUtf8 = (s: string) => new TextEncoder().encode(s);

  it('wraps a legacy record into an envelope', () => {
    const legacy = { name: 'report.pdf', url: 'https://example.com/report.pdf' };
    const env = wrapLegacyDeliverable(
      legacy,
      'order-1',
      'did:claw:zTest',
      'nonce123',
      '2026-03-01T00:00:00Z',
      mockComputeId,
      mockContentHash,
      mockUtf8,
    );

    expect(env.legacy).toBe(true);
    expect(env.signedBy).toBe('node');
    expect(env.type).toBe('data');
    expect(env.format).toBe('application/json');
    expect(env.name).toBe('report.pdf');
    expect(env.transport.method).toBe('inline');
    expect(env.contextId).toBe('order-1');
  });

  it('uses fallback name when legacy has no name', () => {
    const legacy = { url: 'https://example.com/data.csv' };
    const env = wrapLegacyDeliverable(
      legacy,
      'order-1',
      'did:claw:zTest',
      'nonce123',
      '2026-03-01T00:00:00Z',
      mockComputeId,
      mockContentHash,
      mockUtf8,
    );
    expect(env.name).toBe('legacy-deliverable');
  });
});

// ── Delivery-auth protocol types ──────────────────────────────────

describe('delivery-auth types', () => {
  it('exports DELIVERY_AUTH_PROTOCOL constant', () => {
    expect(DELIVERY_AUTH_PROTOCOL).toBe('/clawnet/1.0.0/delivery-auth');
  });

  it('isDeliveryAuthRequest accepts valid request', () => {
    expect(
      isDeliveryAuthRequest({
        version: 1,
        senderPublicKeyHex: 'abcd',
        nonceHex: '1234',
        ciphertextHex: '5678',
        tagHex: '9abc',
      }),
    ).toBe(true);
  });

  it('isDeliveryAuthRequest rejects wrong version', () => {
    expect(
      isDeliveryAuthRequest({
        version: 2,
        senderPublicKeyHex: 'abcd',
        nonceHex: '1234',
        ciphertextHex: '5678',
        tagHex: '9abc',
      }),
    ).toBe(false);
  });

  it('isDeliveryAuthPayload accepts valid payload', () => {
    expect(
      isDeliveryAuthPayload({
        deliverableId: 'env-1',
        token: 'tok',
        orderId: 'ord-1',
        providerDid: 'did:claw:zP',
      }),
    ).toBe(true);
  });

  it('isDeliveryAuthPayload rejects missing field', () => {
    expect(
      isDeliveryAuthPayload({
        deliverableId: 'env-1',
        token: 'tok',
        orderId: 'ord-1',
        // missing providerDid
      }),
    ).toBe(false);
  });

  it('isDeliveryAuthResponse validates correctly', () => {
    expect(isDeliveryAuthResponse({ accepted: true })).toBe(true);
    expect(isDeliveryAuthResponse({ accepted: false, reason: 'bad' })).toBe(true);
    expect(isDeliveryAuthResponse({ accepted: 'yes' })).toBe(false);
    expect(isDeliveryAuthResponse(null)).toBe(false);
  });
});
