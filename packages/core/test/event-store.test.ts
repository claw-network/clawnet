import { describe, expect, it } from 'vitest';
import { canonicalizeBytes } from '../src/crypto/jcs.js';
import { eventHashHex } from '../src/protocol/event-hash.js';
import { EventStore } from '../src/storage/event-store.js';
import { MemoryStore } from '../src/storage/memory.js';

function makeEventBytes(issuer: string, nonce: number): { hash: string; bytes: Uint8Array } {
  const envelope: Record<string, unknown> = {
    v: 1,
    type: 'test.event',
    issuer,
    ts: Date.now(),
    nonce,
    payload: { ok: true },
    sig: '',
    hash: '',
  };
  const hash = eventHashHex(envelope);
  envelope.hash = hash;
  const bytes = canonicalizeBytes(envelope);
  return { hash, bytes };
}

describe('event store log', () => {
  it('appends events and returns ranges by cursor', async () => {
    const store = new EventStore(new MemoryStore());
    const e1 = makeEventBytes('did:claw:issuer1', 1);
    const e2 = makeEventBytes('did:claw:issuer1', 2);
    const e3 = makeEventBytes('did:claw:issuer1', 3);

    await store.appendEvent(e1.hash, e1.bytes);
    await store.appendEvent(e2.hash, e2.bytes);
    await store.appendEvent(e3.hash, e3.bytes);

    const first = await store.getEventLogRange('', 2);
    expect(first.events).toEqual([e1.bytes, e2.bytes]);
    expect(first.cursor).toBe(e2.hash);

    const next = await store.getEventLogRange(first.cursor, 2);
    expect(next.events).toEqual([e3.bytes]);
    expect(next.cursor).toBe(e3.hash);
  });

  it('starts from beginning when cursor is unknown', async () => {
    const store = new EventStore(new MemoryStore());
    const e1 = makeEventBytes('did:claw:issuer2', 1);
    await store.appendEvent(e1.hash, e1.bytes);
    const range = await store.getEventLogRange('missing', 1);
    expect(range.events.length).toBe(1);
    expect(range.cursor).toBe(e1.hash);
  });
});
