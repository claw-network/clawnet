import { describe, expect, it } from 'vitest';
import { EventStore } from '../src/storage/event-store.js';
import { MemoryStore } from '../src/storage/memory.js';

describe('event store log', () => {
  it('appends events and returns ranges by cursor', async () => {
    const store = new EventStore(new MemoryStore());
    const e1 = new Uint8Array([1]);
    const e2 = new Uint8Array([2]);
    const e3 = new Uint8Array([3]);

    await store.appendEvent('h1', e1);
    await store.appendEvent('h2', e2);
    await store.appendEvent('h3', e3);

    const first = await store.getEventLogRange('', 2);
    expect(first.events).toEqual([e1, e2]);
    expect(first.cursor).toBe('h2');

    const next = await store.getEventLogRange(first.cursor, 2);
    expect(next.events).toEqual([e3]);
    expect(next.cursor).toBe('h3');
  });

  it('starts from beginning when cursor is unknown', async () => {
    const store = new EventStore(new MemoryStore());
    await store.appendEvent('h1', new Uint8Array([1]));
    const range = await store.getEventLogRange('missing', 1);
    expect(range.events.length).toBe(1);
    expect(range.cursor).toBe('h1');
  });
});
