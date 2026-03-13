import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageStore } from '../src/services/message-store.js';

/** Shorthand: string → Buffer for test payloads. */
const b = (s: string) => Buffer.from(s, 'utf-8');

describe('MessageStore', () => {
  let tmpDir: string;
  let store: MessageStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'claw-msg-'));
    store = new MessageStore(join(tmpDir, 'messages.sqlite'));
  });

  afterEach(async () => {
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Inbox ──────────────────────────────────────────────────────

  describe('inbox', () => {
    it('adds and retrieves a message', () => {
      const id = store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'telagent/envelope',
        payload: b('base64data'),
      });

      expect(id).toMatch(/^msg_/);

      const messages = store.getInbox();
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe(id);
      expect(messages[0].sourceDid).toBe('did:claw:alice');
      expect(messages[0].topic).toBe('telagent/envelope');
      expect(messages[0].payload.toString('utf-8')).toBe('base64data');
      expect(messages[0].receivedAtMs).toBeGreaterThan(0);
    });

    it('filters by topic', () => {
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'telagent/envelope',
        payload: b('data1'),
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'other/topic',
        payload: b('data2'),
      });

      const filtered = store.getInbox({ topic: 'telagent/envelope' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].topic).toBe('telagent/envelope');
    });

    it('filters by wildcard prefix topic', () => {
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'telagent/envelope', payload: b('d1') });
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'telagent/receipt', payload: b('d2') });
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'other/topic', payload: b('d3') });

      const filtered = store.getInbox({ topic: 'telagent/*' });
      expect(filtered).toHaveLength(2);
      expect(filtered.map(m => m.topic).sort()).toEqual(['telagent/envelope', 'telagent/receipt']);
    });

    it('filters by comma-separated topics', () => {
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'telagent/envelope', payload: b('d1') });
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'chat/message', payload: b('d2') });
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'other/topic', payload: b('d3') });

      const filtered = store.getInbox({ topic: 'telagent/envelope,chat/message' });
      expect(filtered).toHaveLength(2);
      expect(filtered.map(m => m.topic).sort()).toEqual(['chat/message', 'telagent/envelope']);
    });

    it('filters by mixed wildcard and exact topics', () => {
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'telagent/envelope', payload: b('d1') });
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'telagent/receipt', payload: b('d2') });
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'chat/message', payload: b('d3') });
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'other/topic', payload: b('d4') });

      const filtered = store.getInbox({ topic: 'telagent/*,chat/message' });
      expect(filtered).toHaveLength(3);
      expect(filtered.map(m => m.topic).sort()).toEqual(['chat/message', 'telagent/envelope', 'telagent/receipt']);
    });

    it('wildcard does not match topics containing SQL LIKE special chars', () => {
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'test%prefix/foo', payload: b('d1') });
      store.addToInbox({ sourceDid: 'did:claw:alice', targetDid: 'did:claw:bob', topic: 'testXprefix/bar', payload: b('d2') });

      // Wildcard 'test%prefix/*' should match only the literal '%' topic, not 'X' via SQL % wildcard
      const filtered = store.getInbox({ topic: 'test%prefix/*' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].topic).toBe('test%prefix/foo');
    });

    it('filters by sinceMs', () => {
      const before = Date.now();
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('old'),
      });

      const messages = store.getInbox({ sinceMs: before - 1 });
      expect(messages).toHaveLength(1);

      const future = store.getInbox({ sinceMs: Date.now() + 10000 });
      expect(future).toHaveLength(0);
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        store.addToInbox({
          sourceDid: 'did:claw:alice',
          targetDid: 'did:claw:bob',
          topic: 'test',
          payload: b(`msg${i}`),
        });
      }

      const limited = store.getInbox({ limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it('consumes and hides a message', () => {
      const id = store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('data'),
      });

      const consumed = store.consumeMessage(id);
      expect(consumed).toBe(true);

      // Should not appear in inbox anymore
      const messages = store.getInbox();
      expect(messages).toHaveLength(0);

      // Consuming again returns false
      expect(store.consumeMessage(id)).toBe(false);
    });

    it('cleans up consumed messages', () => {
      const id = store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('data'),
      });

      store.consumeMessage(id);
      const cleaned = store.cleanupInbox();
      expect(cleaned).toBe(1);
    });

    it('counts unconsumed inbox messages', () => {
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('data1'),
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('data2'),
      });

      expect(store.inboxCount('did:claw:bob')).toBe(2);
      expect(store.inboxCount('did:claw:other')).toBe(0);
    });
  });

  // ── Outbox ─────────────────────────────────────────────────────

  describe('outbox', () => {
    it('adds and retrieves pending messages', () => {
      const id = store.addToOutbox({
        targetDid: 'did:claw:bob',
        topic: 'telagent/envelope',
        payload: b('pending-data'),
      });

      expect(id).toMatch(/^msg_/);

      const entries = store.getOutboxForTarget('did:claw:bob');
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(id);
      expect(entries[0].targetDid).toBe('did:claw:bob');
      expect(entries[0].topic).toBe('telagent/envelope');
      expect(entries[0].payload.toString('utf-8')).toBe('pending-data');
      expect(entries[0].attempts).toBe(0);
    });

    it('records delivery attempts', () => {
      const id = store.addToOutbox({
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('data'),
      });

      store.recordAttempt(id);
      store.recordAttempt(id);

      const entries = store.getOutboxForTarget('did:claw:bob');
      expect(entries[0].attempts).toBe(2);
    });

    it('removes delivered messages', () => {
      const id = store.addToOutbox({
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('data'),
      });

      const removed = store.removeFromOutbox(id);
      expect(removed).toBe(true);

      const entries = store.getOutboxForTarget('did:claw:bob');
      expect(entries).toHaveLength(0);
    });

    it('cleans up expired outbox entries', () => {
      // Add with 0 TTL so it's immediately expired
      store.addToOutbox({
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('data'),
        ttlSec: 0,
      });

      const cleaned = store.cleanupOutbox();
      expect(cleaned).toBe(1);
    });

    it('does not return expired entries from getOutboxForTarget', () => {
      store.addToOutbox({
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('data'),
        ttlSec: 0,
      });

      const entries = store.getOutboxForTarget('did:claw:bob');
      expect(entries).toHaveLength(0);
    });
  });

  // ── Deduplication ──────────────────────────────────────────────

  describe('deduplication', () => {
    it('deduplicates messages with same idempotency key', () => {
      const id1 = store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('data1'),
        idempotencyKey: 'dedup-key-1',
      });

      const id2 = store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('data1-duplicate'),
        idempotencyKey: 'dedup-key-1',
      });

      // Same message ID returned
      expect(id2).toBe(id1);

      // Only one message in inbox
      const messages = store.getInbox();
      expect(messages).toHaveLength(1);
      expect(messages[0].payload.toString('utf-8')).toBe('data1');
    });

    it('allows different idempotency keys', () => {
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('msg-a'),
        idempotencyKey: 'key-a',
      });

      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('msg-b'),
        idempotencyKey: 'key-b',
      });

      const messages = store.getInbox();
      expect(messages).toHaveLength(2);
    });

    it('messages without idempotency key are never deduplicated', () => {
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('same'),
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('same'),
      });

      expect(store.getInbox()).toHaveLength(2);
    });
  });

  // ── Priority Ordering ─────────────────────────────────────────

  describe('priority', () => {
    it('returns higher priority messages first', () => {
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('low'),
        priority: 0,
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('urgent'),
        priority: 3,
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('normal'),
        priority: 1,
      });

      const messages = store.getInbox();
      expect(messages).toHaveLength(3);
      expect(messages[0].payload.toString('utf-8')).toBe('urgent');
      expect(messages[0].priority).toBe(3);
      expect(messages[1].payload.toString('utf-8')).toBe('normal');
      expect(messages[2].payload.toString('utf-8')).toBe('low');
    });
  });

  // ── Sequence Numbers ──────────────────────────────────────────

  describe('sequence', () => {
    it('assigns monotonically increasing seq numbers', () => {
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('msg1'),
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('msg2'),
      });

      // With priority 0 (same), ordering is by received_at_ms ASC
      const messages = store.getInbox();
      expect(messages[0].seq).toBe(1);
      expect(messages[1].seq).toBe(2);
    });

    it('currentSeq returns the latest sequence number', () => {
      expect(store.currentSeq()).toBe(0);

      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('msg1'),
      });

      expect(store.currentSeq()).toBe(1);
    });

    it('filters by sinceSeq', () => {
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('old'),
      });

      const seqAfterFirst = store.currentSeq();

      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: b('new'),
      });

      const missed = store.getInbox({ sinceSeq: seqAfterFirst });
      expect(missed).toHaveLength(1);
      expect(missed[0].payload.toString('utf-8')).toBe('new');
    });
  });

  // ── DID → PeerId Mapping ──────────────────────────────────────

  describe('did peers', () => {
    it('upserts and retrieves DID → PeerId mappings', () => {
      store.upsertDidPeer('did:claw:alice', '12D3KooWAlice');
      store.upsertDidPeer('did:claw:bob', '12D3KooWBob');

      const peers = store.getAllDidPeers();
      expect(peers).toHaveLength(2);
      expect(peers.find((p) => p.did === 'did:claw:alice')?.peerId).toBe('12D3KooWAlice');
      expect(peers.find((p) => p.did === 'did:claw:bob')?.peerId).toBe('12D3KooWBob');
    });

    it('overwrites peerId on upsert for existing DID', () => {
      store.upsertDidPeer('did:claw:alice', '12D3KooWOld');
      store.upsertDidPeer('did:claw:alice', '12D3KooWNew');

      const peers = store.getAllDidPeers();
      expect(peers).toHaveLength(1);
      expect(peers[0].peerId).toBe('12D3KooWNew');
    });

    it('removes a DID mapping', () => {
      store.upsertDidPeer('did:claw:alice', '12D3KooWAlice');
      expect(store.removeDidPeer('did:claw:alice')).toBe(true);
      expect(store.getAllDidPeers()).toHaveLength(0);
      expect(store.removeDidPeer('did:claw:alice')).toBe(false);
    });

    it('persists mappings across store instances', () => {
      const dbPath = join(tmpDir, 'messages.sqlite');
      store.upsertDidPeer('did:claw:alice', '12D3KooWAlice');
      store.close();

      const store2 = new MessageStore(dbPath);
      const peers = store2.getAllDidPeers();
      expect(peers).toHaveLength(1);
      expect(peers[0].did).toBe('did:claw:alice');
      expect(peers[0].peerId).toBe('12D3KooWAlice');
      store2.close();

      // Re-open original store for afterEach cleanup
      store = new MessageStore(dbPath);
    });
  });

  // ── Rate Limiting ─────────────────────────────────────────────

  describe('rate limiting', () => {
    it('records and counts rate events within window', () => {
      store.recordRateEvent('out:did:claw:alice');
      store.recordRateEvent('out:did:claw:alice');
      store.recordRateEvent('out:did:claw:bob');

      const windowStart = Date.now() - 60_000;
      expect(store.countRateEvents('out:did:claw:alice', windowStart)).toBe(2);
      expect(store.countRateEvents('out:did:claw:bob', windowStart)).toBe(1);
      expect(store.countRateEvents('out:did:claw:unknown', windowStart)).toBe(0);
    });

    it('does not count events outside the window', () => {
      store.recordRateEvent('out:test');

      // Count with a window starting in the future — should find nothing
      expect(store.countRateEvents('out:test', Date.now() + 1000)).toBe(0);
    });

    it('prunes old rate events', () => {
      store.recordRateEvent('out:test');

      // Prune with cutoff in the future — should remove the event
      const pruned = store.pruneRateEvents(Date.now() + 1000);
      expect(pruned).toBe(1);
      expect(store.countRateEvents('out:test', 0)).toBe(0);
    });

    it('supports global inbound rate bucket', () => {
      // Simulate global inbound rate limiting bucket
      const globalBucket = 'in:_global';
      for (let i = 0; i < 5; i++) {
        store.recordRateEvent(globalBucket);
      }

      const windowStart = Date.now() - 60_000;
      expect(store.countRateEvents(globalBucket, windowStart)).toBe(5);

      // Per-peer buckets are tracked separately from global
      store.recordRateEvent('in:peer123');
      expect(store.countRateEvents('in:peer123', windowStart)).toBe(1);
      expect(store.countRateEvents(globalBucket, windowStart)).toBe(5);
    });

    it('handles high-volume rate event recording', () => {
      // Simulate burst of 100 events to verify SQLite handles it
      const bucket = 'in:flood-test';
      for (let i = 0; i < 100; i++) {
        store.recordRateEvent(bucket);
      }

      const windowStart = Date.now() - 60_000;
      expect(store.countRateEvents(bucket, windowStart)).toBe(100);

      // Prune should clear all
      const pruned = store.pruneRateEvents(Date.now() + 1000);
      expect(pruned).toBe(100);
    });
  });
});
