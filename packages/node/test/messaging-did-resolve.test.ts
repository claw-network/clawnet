import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessagingService } from '../src/services/messaging-service.js';
import { MessageStore } from '../src/services/message-store.js';
import type { P2PNode, StreamDuplex } from '@claw-network/core';

// ── Helpers ──────────────────────────────────────────────────────

const ALICE_DID = 'did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR';
const BOB_DID = 'did:claw:zHk7Xc4fR2mP9Qa3UjLBvN6wDS8Yt1eK5oAGnE35CrTbf';
const PEER_BOOTSTRAP = '12D3KooWBootstrap';
const PEER_BOB = '12D3KooWBob';

/** Create a fake stream that returns the given JSON as source and captures sink writes. */
function fakeStream(sourceJson: string): StreamDuplex & { written: string[] } {
  const written: string[] = [];
  return {
    source: (async function* () {
      yield Buffer.from(sourceJson, 'utf-8');
    })(),
    sink: async (iter: AsyncIterable<Uint8Array>) => {
      for await (const chunk of iter) {
        written.push(Buffer.from(chunk).toString('utf-8'));
      }
    },
    close: vi.fn(async () => {}),
    written,
  } as unknown as StreamDuplex & { written: string[] };
}

/** Create a mock P2PNode with the methods MessagingService needs. */
function createMockP2P() {
  const protocolHandlers = new Map<string, (incoming: unknown) => void>();

  return {
    handleProtocol: vi.fn(async (proto: string, handler: (incoming: unknown) => void) => {
      protocolHandlers.set(proto, handler);
    }),
    unhandleProtocol: vi.fn(async () => {}),
    onPeerDisconnect: vi.fn(),
    onPeerConnect: vi.fn(),
    getConnections: vi.fn(() => [] as string[]),
    newStream: vi.fn(async () => fakeStream('{}') as StreamDuplex),
    dialPeer: vi.fn(async () => true),
    _protocolHandlers: protocolHandlers,
  } as unknown as P2PNode & {
    _protocolHandlers: Map<string, (incoming: unknown) => void>;
    getConnections: ReturnType<typeof vi.fn>;
    newStream: ReturnType<typeof vi.fn>;
    dialPeer: ReturnType<typeof vi.fn>;
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('DID Resolve Protocol', () => {
  let tmpDir: string;
  let store: MessageStore;
  let p2p: ReturnType<typeof createMockP2P>;
  let service: MessagingService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'claw-resolve-'));
    store = new MessageStore(join(tmpDir, 'messages.sqlite'));
    p2p = createMockP2P();
    service = new MessagingService(p2p as unknown as P2PNode, store, ALICE_DID);
    await service.start();
  });

  afterEach(async () => {
    await service.stop();
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Server-side: handleDidResolve ──────────────────────────────

  describe('handleDidResolve (server)', () => {
    function getResolveHandler() {
      return p2p._protocolHandlers.get('/clawnet/1.0.0/did-resolve');
    }

    it('registers the did-resolve protocol on start', () => {
      expect(getResolveHandler()).toBeDefined();
    });

    it('returns found:true with peerId when DID is known', async () => {
      // Simulate a DID announce so Alice knows about Bob
      const announceHandler = p2p._protocolHandlers.get('/clawnet/1.0.0/did-announce');
      const announceStream = fakeStream(JSON.stringify({ did: BOB_DID }));
      await announceHandler!({
        stream: announceStream,
        connection: { remotePeer: { toString: () => PEER_BOB } },
      });

      // Now resolve Bob's DID
      const resolveHandler = getResolveHandler()!;
      const stream = fakeStream(JSON.stringify({ did: BOB_DID }));
      await resolveHandler({
        stream,
        connection: { remotePeer: { toString: () => PEER_BOOTSTRAP } },
      });

      // Wait for async handler to write response
      await vi.waitFor(() => {
        expect(stream.written.length).toBeGreaterThan(0);
      });

      const resp = JSON.parse(stream.written[0]);
      expect(resp.found).toBe(true);
      expect(resp.peerId).toBe(PEER_BOB);
      expect(resp.did).toBe(BOB_DID);
    });

    it('returns found:false when DID is unknown', async () => {
      const resolveHandler = getResolveHandler()!;
      const stream = fakeStream(JSON.stringify({ did: BOB_DID }));
      await resolveHandler({
        stream,
        connection: { remotePeer: { toString: () => PEER_BOOTSTRAP } },
      });

      await vi.waitFor(() => {
        expect(stream.written.length).toBeGreaterThan(0);
      });

      const resp = JSON.parse(stream.written[0]);
      expect(resp.found).toBe(false);
      expect(resp.did).toBe(BOB_DID);
      expect(resp.peerId).toBeUndefined();
    });

    it('returns found:false for invalid DID format', async () => {
      const resolveHandler = getResolveHandler()!;
      const stream = fakeStream(JSON.stringify({ did: 'invalid-did' }));
      await resolveHandler({
        stream,
        connection: { remotePeer: { toString: () => PEER_BOOTSTRAP } },
      });

      await vi.waitFor(() => {
        expect(stream.written.length).toBeGreaterThan(0);
      });

      const resp = JSON.parse(stream.written[0]);
      expect(resp.found).toBe(false);
    });
  });

  // ── Client-side: send() with DID resolve ───────────────────────

  describe('send() with DID resolve fallback', () => {
    it('resolves unknown DID via peers before outbox', async () => {
      // Setup: bootstrap knows Bob's peerId
      p2p.getConnections.mockReturnValue([PEER_BOOTSTRAP]);
      p2p.newStream.mockImplementation(async (_peerId: string, proto: string) => {
        if (proto === '/clawnet/1.0.0/did-resolve') {
          return fakeStream(JSON.stringify({ did: BOB_DID, peerId: PEER_BOB, found: true }));
        }
        // DM stream — capture but don't fail
        return fakeStream('{}');
      });
      p2p.dialPeer.mockResolvedValue(true);

      const result = await service.send(BOB_DID, 'test/topic', 'hello');

      expect(result.delivered).toBe(true);
      expect(p2p.newStream).toHaveBeenCalledWith(PEER_BOOTSTRAP, '/clawnet/1.0.0/did-resolve');
      expect(p2p.dialPeer).toHaveBeenCalledWith(PEER_BOB);
    });

    it('falls back to outbox when resolve fails', async () => {
      p2p.getConnections.mockReturnValue([PEER_BOOTSTRAP]);
      p2p.newStream.mockImplementation(async (_peerId: string, proto: string) => {
        if (proto === '/clawnet/1.0.0/did-resolve') {
          return fakeStream(JSON.stringify({ did: BOB_DID, found: false }));
        }
        return fakeStream('{}');
      });

      const result = await service.send(BOB_DID, 'test/topic', 'hello');

      expect(result.delivered).toBe(false);
      expect(result.messageId).toMatch(/^msg_/);
    });

    it('falls back to outbox when no peers are connected', async () => {
      p2p.getConnections.mockReturnValue([]);

      const result = await service.send(BOB_DID, 'test/topic', 'hello');

      expect(result.delivered).toBe(false);
      expect(result.messageId).toMatch(/^msg_/);
    });

    it('resolve timeout does not block send', async () => {
      p2p.getConnections.mockReturnValue([PEER_BOOTSTRAP]);
      // Simulate a stream that never provides a response (hangs)
      p2p.newStream.mockImplementation(async (_peerId: string, proto: string) => {
        if (proto === '/clawnet/1.0.0/did-resolve') {
          return {
            source: (async function* () {
              // Never yields — simulates hang
              await new Promise(() => {}); // never resolves
            })(),
            sink: async () => {},
            close: vi.fn(async () => {}),
          };
        }
        return fakeStream('{}');
      });

      // Should complete (fall back to outbox) — not hang forever.
      // The 5s resolve timeout should kick in.
      const result = await service.send(BOB_DID, 'test/topic', 'hello');
      expect(result.delivered).toBe(false);
    }, 15_000); // generous test timeout
  });

  // ── Unregister on stop ─────────────────────────────────────────

  describe('lifecycle', () => {
    it('unregisters did-resolve protocol on stop', async () => {
      await service.stop();
      expect(p2p.unhandleProtocol).toHaveBeenCalledWith('/clawnet/1.0.0/did-resolve');
    });
  });
});
