import { describe, expect, it } from 'vitest';
import { generateKeypair } from '@clawnet/core/crypto';
import {
  CONTENT_TYPE,
  RequestType,
  ResponseType,
  decodeP2PEnvelopeBytes,
  decodeRequestMessageBytes,
  decodeResponseMessageBytes,
  encodeP2PEnvelopeBytes,
  encodeRequestMessageBytes,
  encodeResponseMessageBytes,
  powTicketHashHex,
  signP2PEnvelope,
  verifyP2PEnvelopeSignature,
} from '../src/p2p/index.js';

const sampleRequest = {
  type: RequestType.RangeRequest,
  rangeRequest: {
    from: 'hash123',
    limit: 10,
  },
};

const sampleResponse = {
  type: ResponseType.RangeResponse,
  rangeResponse: {
    events: [new Uint8Array([1, 2, 3])],
    cursor: 'next',
  },
};

const snapshotRequest = {
  type: RequestType.SnapshotRequest,
  snapshotRequest: {
    from: 'snap-0',
  },
};

const snapshotResponse = {
  type: ResponseType.SnapshotResponse,
  snapshotResponse: {
    hash: 'snap-1',
    snapshot: new Uint8Array([9, 8, 7]),
    totalBytes: 3,
    chunkIndex: 0,
    chunkCount: 1,
  },
};

describe('p2p codec', () => {
  it('encodes and decodes request messages', () => {
    const bytes = encodeRequestMessageBytes(sampleRequest);
    const decoded = decodeRequestMessageBytes(bytes);
    expect(decoded.type).toBe(sampleRequest.type);
    expect(decoded.rangeRequest).toEqual(sampleRequest.rangeRequest);
  });

  it('encodes and decodes response messages', () => {
    const bytes = encodeResponseMessageBytes(sampleResponse);
    const decoded = decodeResponseMessageBytes(bytes);
    expect(decoded.type).toBe(sampleResponse.type);
    expect(decoded.rangeResponse?.cursor).toBe('next');
    expect(decoded.rangeResponse?.events[0]).toEqual(sampleResponse.rangeResponse.events[0]);
  });

  it('encodes and decodes snapshot messages', () => {
    const reqBytes = encodeRequestMessageBytes(snapshotRequest);
    const decodedReq = decodeRequestMessageBytes(reqBytes);
    expect(decodedReq.type).toBe(snapshotRequest.type);
    expect(decodedReq.snapshotRequest).toEqual(snapshotRequest.snapshotRequest);

    const respBytes = encodeResponseMessageBytes(snapshotResponse);
    const decodedResp = decodeResponseMessageBytes(respBytes);
    expect(decodedResp.type).toBe(snapshotResponse.type);
    expect(decodedResp.snapshotResponse?.hash).toBe('snap-1');
    expect(decodedResp.snapshotResponse?.snapshot).toEqual(snapshotResponse.snapshotResponse.snapshot);
    expect(decodedResp.snapshotResponse?.totalBytes).toBe(3);
    expect(decodedResp.snapshotResponse?.chunkIndex).toBe(0);
    expect(decodedResp.snapshotResponse?.chunkCount).toBe(1);
  });

  it('encodes and decodes envelopes', () => {
    const payload = encodeRequestMessageBytes(sampleRequest);
    const envelope = {
      v: 1,
      topic: '/clawnet/1.0.0/requests',
      sender: 'peerA',
      ts: 1n,
      contentType: CONTENT_TYPE,
      payload,
      sig: '',
    };
    const bytes = encodeP2PEnvelopeBytes(envelope);
    const decoded = decodeP2PEnvelopeBytes(bytes);
    expect(decoded.topic).toBe(envelope.topic);
    expect(decoded.contentType).toBe(CONTENT_TYPE);
    expect(decoded.payload).toEqual(payload);
  });

  it('signs and verifies envelopes', async () => {
    const { privateKey, publicKey } = await generateKeypair();
    const payload = encodeRequestMessageBytes(sampleRequest);
    const envelope = await signP2PEnvelope(
      {
        v: 1,
        topic: '/clawnet/1.0.0/requests',
        sender: 'peerA',
        ts: 1n,
        contentType: CONTENT_TYPE,
        payload,
      },
      privateKey,
    );

    await expect(verifyP2PEnvelopeSignature(envelope, publicKey)).resolves.toBe(true);
  });

  it('computes PoW ticket hash with empty hash/sig', () => {
    const ticket = {
      peer: 'peerA',
      ts: 1n,
      nonce: 'nonce',
      difficulty: 1,
      hash: 'deadbeef',
      sig: 'sig',
    };
    const hex = powTicketHashHex(ticket);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});
