import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { P2PNode, StreamDuplex } from '@claw-network/core';
import { encodeHeader as encodeDeliveryHeader } from '@claw-network/core';
import { MessagingService } from '../src/services/messaging-service.js';
import { MessageStore } from '../src/services/message-store.js';

const ALICE_DID = 'did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR';
const BOB_DID = 'did:claw:zHk7Xc4fR2mP9Qa3UjLBvN6wDS8Yt1eK5oAGnE35CrTbf';
const PEER_BOOTSTRAP = '12D3KooWBootstrap';
const PEER_BOB = '12D3KooWBob';

function createMockP2P() {
  return {
    getConnections: vi.fn(() => [] as string[]),
    newStream: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    addPeerAddresses: vi.fn(async () => {}),
  } as unknown as P2PNode & {
    getConnections: ReturnType<typeof vi.fn>;
    newStream: ReturnType<typeof vi.fn>;
    addPeerAddresses: ReturnType<typeof vi.fn>;
  };
}

function registerDid(svc: MessagingService, did: string, peerId: string): void {
  const internal = svc as unknown as {
    didToPeerId: Map<string, string>;
    peerIdToDid: Map<string, string>;
    didPeerUpdatedAt: Map<string, number>;
  };
  internal.didToPeerId.set(did, peerId);
  internal.peerIdToDid.set(peerId, did);
  internal.didPeerUpdatedAt.set(did, Date.now());
}

describe('MessagingService stream resilience', () => {
  let tmpDir: string;
  let store: MessageStore;
  let p2p: ReturnType<typeof createMockP2P>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'claw-streams-'));
    store = new MessageStore(join(tmpDir, 'messages.sqlite'));
    p2p = createMockP2P();
  });

  afterEach(async () => {
    vi.useRealTimers();
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('resolveDidViaPeers returns null when the request write stalls', async () => {
    vi.useFakeTimers();

    const service = new MessagingService(p2p as unknown as P2PNode, store, ALICE_DID);
    p2p.getConnections.mockReturnValue([PEER_BOOTSTRAP]);
    p2p.newStream.mockResolvedValue({
      source: (async function* () {
        yield new Uint8Array(0);
      })(),
      sink: async () => {
        await new Promise(() => {});
      },
      close: vi.fn(async () => {}),
    } as StreamDuplex);

    const internal = service as unknown as {
      resolveDidViaPeers: (did: string) => Promise<{ peerId: string; multiaddrs: string[] } | null>;
    };

    const promise = internal.resolveDidViaPeers(BOB_DID);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;

    expect(result).toBeNull();
  });

  it('requestDeliverableFromPeer accepts slow streams that keep making progress', async () => {
    vi.useFakeTimers();

    const service = new MessagingService(p2p as unknown as P2PNode, store, ALICE_DID);
    registerDid(service, BOB_DID, PEER_BOB);

    const deliverableId = 'deliverable_slow';
    const contentHash = 'abc123';
    const body = new Uint8Array(Buffer.from('slow-but-steady'));
    const header = encodeDeliveryHeader({
      version: 1,
      deliverableId,
      size: body.length,
      contentHash,
    });
    const payload = new Uint8Array(header.length + body.length);
    payload.set(header, 0);
    payload.set(body, header.length);

    const chunks = [
      payload.subarray(0, 6),
      payload.subarray(6, 16),
      payload.subarray(16),
    ];

    p2p.newStream.mockResolvedValue({
      source: (async function* () {
        yield chunks[0];
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        yield chunks[1];
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        yield chunks[2];
      })(),
      sink: async (_iter: AsyncIterable<Uint8Array>) => {},
      close: vi.fn(async () => {}),
    } as StreamDuplex);

    const promise = service.requestDeliverableFromPeer(BOB_DID, deliverableId);
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;

    expect(result).not.toBeNull();
    expect(Buffer.from(result!.bytes)).toEqual(Buffer.from(body));
    expect(result!.contentHash).toBe(contentHash);
  });
});
