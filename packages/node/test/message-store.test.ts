import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageStore } from '../src/services/message-store.js';

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
        payload: 'base64data',
      });

      expect(id).toMatch(/^msg_/);

      const messages = store.getInbox();
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe(id);
      expect(messages[0].sourceDid).toBe('did:claw:alice');
      expect(messages[0].topic).toBe('telagent/envelope');
      expect(messages[0].payload).toBe('base64data');
      expect(messages[0].receivedAtMs).toBeGreaterThan(0);
    });

    it('filters by topic', () => {
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'telagent/envelope',
        payload: 'data1',
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'other/topic',
        payload: 'data2',
      });

      const filtered = store.getInbox({ topic: 'telagent/envelope' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].topic).toBe('telagent/envelope');
    });

    it('filters by sinceMs', () => {
      const before = Date.now();
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'old',
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
          payload: `msg${i}`,
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
        payload: 'data',
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
        payload: 'data',
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
        payload: 'data1',
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'data2',
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
        payload: 'pending-data',
      });

      expect(id).toMatch(/^msg_/);

      const entries = store.getOutboxForTarget('did:claw:bob');
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(id);
      expect(entries[0].targetDid).toBe('did:claw:bob');
      expect(entries[0].topic).toBe('telagent/envelope');
      expect(entries[0].payload).toBe('pending-data');
      expect(entries[0].attempts).toBe(0);
    });

    it('records delivery attempts', () => {
      const id = store.addToOutbox({
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'data',
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
        payload: 'data',
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
        payload: 'data',
        ttlSec: 0,
      });

      const cleaned = store.cleanupOutbox();
      expect(cleaned).toBe(1);
    });

    it('does not return expired entries from getOutboxForTarget', () => {
      store.addToOutbox({
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'data',
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
        payload: 'data1',
        idempotencyKey: 'dedup-key-1',
      });

      const id2 = store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'data1-duplicate',
        idempotencyKey: 'dedup-key-1',
      });

      // Same message ID returned
      expect(id2).toBe(id1);

      // Only one message in inbox
      const messages = store.getInbox();
      expect(messages).toHaveLength(1);
      expect(messages[0].payload).toBe('data1');
    });

    it('allows different idempotency keys', () => {
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'msg-a',
        idempotencyKey: 'key-a',
      });

      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'msg-b',
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
        payload: 'same',
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'same',
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
        payload: 'low',
        priority: 0,
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'urgent',
        priority: 3,
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'normal',
        priority: 1,
      });

      const messages = store.getInbox();
      expect(messages).toHaveLength(3);
      expect(messages[0].payload).toBe('urgent');
      expect(messages[0].priority).toBe(3);
      expect(messages[1].payload).toBe('normal');
      expect(messages[2].payload).toBe('low');
    });
  });

  // ── Sequence Numbers ──────────────────────────────────────────

  describe('sequence', () => {
    it('assigns monotonically increasing seq numbers', () => {
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'msg1',
      });
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'msg2',
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
        payload: 'msg1',
      });

      expect(store.currentSeq()).toBe(1);
    });

    it('filters by sinceSeq', () => {
      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'old',
      });

      const seqAfterFirst = store.currentSeq();

      store.addToInbox({
        sourceDid: 'did:claw:alice',
        targetDid: 'did:claw:bob',
        topic: 'test',
        payload: 'new',
      });

      const missed = store.getInbox({ sinceSeq: seqAfterFirst });
      expect(missed).toHaveLength(1);
      expect(missed[0].payload).toBe('new');
    });
  });
});
