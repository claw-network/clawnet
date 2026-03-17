/**
 * Composite deliverable tests.
 *
 * Tests computeCompositeHash, validateEnvelopeStructure for composite type,
 * and parseMarketSubmissionSubmitPayload with delivery.envelopes array.
 */

import { describe, it, expect } from 'vitest';
import {
  computeCompositeHash,
  validateEnvelopeStructure,
} from '@claw-network/protocol';
import { parseMarketSubmissionSubmitPayload } from '@claw-network/protocol';
import { blake3Hex, utf8ToBytes } from '@claw-network/core';
import type { DeliverableEnvelope } from '@claw-network/protocol';

// ── Helpers ────────────────────────────────────────────────────

function makeMinimalEnvelope(overrides: Partial<DeliverableEnvelope> = {}): DeliverableEnvelope {
  return {
    id: 'env-' + Math.random().toString(36).slice(2, 8),
    nonce: 'nonce-' + Math.random().toString(36).slice(2, 8),
    contextId: 'order-1',
    type: 'data',
    format: 'application/json',
    name: 'part.json',
    contentHash: blake3Hex(utf8ToBytes('test')),
    size: 4,
    producer: 'did:claw:zTest123',
    signature: 'sig-placeholder',
    createdAt: new Date().toISOString(),
    transport: { method: 'inline', data: '' },
    ...overrides,
  } as unknown as DeliverableEnvelope;
}

function makeCompositeEnvelope(parts: DeliverableEnvelope[]): DeliverableEnvelope {
  const partHashes = parts.map((p) => p.contentHash);
  const compositeHash = computeCompositeHash(partHashes, blake3Hex, utf8ToBytes);
  return {
    ...makeMinimalEnvelope({
      type: 'composite' as never,
      contentHash: compositeHash,
      name: 'composite-delivery',
    }),
    parts,
  } as unknown as DeliverableEnvelope;
}

// ── Tests ──────────────────────────────────────────────────────

describe('computeCompositeHash', () => {
  it('produces a deterministic hash from ordered part hashes', () => {
    const h1 = blake3Hex(utf8ToBytes('part1'));
    const h2 = blake3Hex(utf8ToBytes('part2'));

    const result = computeCompositeHash([h1, h2], blake3Hex, utf8ToBytes);
    expect(result).toBeTypeOf('string');
    expect(result).toHaveLength(64); // BLAKE3 hex

    // Same inputs → same output
    const result2 = computeCompositeHash([h1, h2], blake3Hex, utf8ToBytes);
    expect(result2).toBe(result);

    // Different order → different output
    const reversed = computeCompositeHash([h2, h1], blake3Hex, utf8ToBytes);
    expect(reversed).not.toBe(result);
  });

  it('handles a single part', () => {
    const h = blake3Hex(utf8ToBytes('only'));
    const result = computeCompositeHash([h], blake3Hex, utf8ToBytes);
    expect(result).toHaveLength(64);
    // hash of a single hash string is not the same as the hash itself
    expect(result).not.toBe(h);
  });
});

describe('validateEnvelopeStructure — composite', () => {
  it('passes for a valid composite envelope with parts', () => {
    const parts = [makeMinimalEnvelope(), makeMinimalEnvelope()];
    const composite = makeCompositeEnvelope(parts);
    const result = validateEnvelopeStructure(composite);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails for composite type without parts', () => {
    const envelope = makeMinimalEnvelope({ type: 'composite' as never });
    // No `parts` field
    const result = validateEnvelopeStructure(envelope);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('parts'))).toBe(true);
  });
});

describe('parseMarketSubmissionSubmitPayload — composite envelopes', () => {
  const baseDid = 'did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR';

  it('accepts delivery.envelopes array', () => {
    const env1 = makeMinimalEnvelope();
    const env2 = makeMinimalEnvelope();
    const payload = {
      orderId: 'order-1',
      submissionId: 'sub-1',
      worker: baseDid,
      delivery: {
        envelopes: [env1, env2],
      },
      resourcePrev: null,
    };

    const result = parseMarketSubmissionSubmitPayload(payload as Record<string, unknown>);
    expect(result.delivery).toBeDefined();
    expect(result.delivery!.envelopes).toHaveLength(2);
    // When no single envelope is given, first item becomes envelope
    expect(result.delivery!.envelope).toBeDefined();
  });

  it('accepts delivery with both envelope and envelopes', () => {
    const mainEnv = makeMinimalEnvelope();
    const parts = [makeMinimalEnvelope(), makeMinimalEnvelope()];
    const payload = {
      orderId: 'order-2',
      submissionId: 'sub-2',
      worker: baseDid,
      delivery: {
        envelope: mainEnv,
        envelopes: parts,
      },
      resourcePrev: null,
    };

    const result = parseMarketSubmissionSubmitPayload(payload as Record<string, unknown>);
    expect(result.delivery!.envelope).toBeDefined();
    expect(result.delivery!.envelopes).toHaveLength(2);
  });

  it('still accepts single envelope (backward compat)', () => {
    const env = makeMinimalEnvelope();
    const payload = {
      orderId: 'order-3',
      submissionId: 'sub-3',
      worker: baseDid,
      delivery: { envelope: env },
      resourcePrev: null,
    };

    const result = parseMarketSubmissionSubmitPayload(payload as Record<string, unknown>);
    expect(result.delivery!.envelope).toBeDefined();
    expect(result.delivery!.envelopes).toBeUndefined();
  });

  it('rejects delivery with neither envelope nor envelopes', () => {
    const payload = {
      orderId: 'order-4',
      submissionId: 'sub-4',
      worker: baseDid,
      delivery: {},
      resourcePrev: null,
    };

    expect(() =>
      parseMarketSubmissionSubmitPayload(payload as Record<string, unknown>),
    ).toThrow(/delivery requires envelope or non-empty envelopes/);
  });

  it('rejects legacy-only submission (Phase 3)', () => {
    const payload = {
      orderId: 'order-5',
      submissionId: 'sub-5',
      worker: baseDid,
      deliverables: [{ result: 'data' }],
      resourcePrev: null,
    };

    expect(() =>
      parseMarketSubmissionSubmitPayload(payload as Record<string, unknown>),
    ).toThrow(/delivery\.envelope.*is required/);
  });

  it('rejects submission with neither delivery nor deliverables', () => {
    const payload = {
      orderId: 'order-6',
      submissionId: 'sub-6',
      worker: baseDid,
      resourcePrev: null,
    };

    expect(() =>
      parseMarketSubmissionSubmitPayload(payload as Record<string, unknown>),
    ).toThrow(/delivery\.envelope.*is required/);
  });
});
