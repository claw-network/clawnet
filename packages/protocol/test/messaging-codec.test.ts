import { describe, expect, it } from 'vitest';
import {
  ReceiptType,
  encodeDirectMessageBytes,
  decodeDirectMessageBytes,
  encodeDeliveryReceiptBytes,
  decodeDeliveryReceiptBytes,
  encodeDidAnnounceBytes,
  decodeDidAnnounceBytes,
  encodeDidResolveRequestBytes,
  decodeDidResolveRequestBytes,
  encodeDidResolveResponseBytes,
  decodeDidResolveResponseBytes,
  encodeE2EEnvelope,
  decodeE2EEnvelope,
  E2E_HEADER_SIZE,
  encodeAttachmentMessageBytes,
  decodeAttachmentMessageBytes,
} from '../src/messaging/index.js';
import type { DirectMessage, DeliveryReceipt, AttachmentMessage } from '../src/messaging/index.js';

const sampleDm: DirectMessage = {
  sourceDid: 'did:claw:zAlice1234567890abcdefghijklmnop',
  targetDid: 'did:claw:zBob1234567890abcdefghijklmnopqrs',
  topic: 'telagent/envelope',
  payload: new TextEncoder().encode('hello world'),
  ttlSec: 86400,
  sentAtMs: BigInt(Date.now()),
  priority: 1,
  compressed: false,
  encrypted: false,
  idempotencyKey: 'uuid-12345',
};

const sampleReceipt: DeliveryReceipt = {
  type: ReceiptType.Delivered,
  messageId: 'msg_abc123def456',
  recipientDid: 'did:claw:zBob1234567890abcdefghijklmnopqrs',
  senderDid: 'did:claw:zAlice1234567890abcdefghijklmnop',
  deliveredAtMs: BigInt(Date.now()),
};

describe('messaging codec', () => {
  // ── DirectMessage ────────────────────────────────────────

  describe('DirectMessage', () => {
    it('round-trips all fields', () => {
      const bytes = encodeDirectMessageBytes(sampleDm);
      const decoded = decodeDirectMessageBytes(bytes);
      expect(decoded.sourceDid).toBe(sampleDm.sourceDid);
      expect(decoded.targetDid).toBe(sampleDm.targetDid);
      expect(decoded.topic).toBe(sampleDm.topic);
      expect(decoded.payload).toEqual(sampleDm.payload);
      expect(decoded.ttlSec).toBe(sampleDm.ttlSec);
      expect(decoded.sentAtMs).toBe(sampleDm.sentAtMs);
      expect(decoded.priority).toBe(sampleDm.priority);
      expect(decoded.compressed).toBe(false);
      expect(decoded.encrypted).toBe(false);
      expect(decoded.idempotencyKey).toBe(sampleDm.idempotencyKey);
    });

    it('round-trips with compressed + encrypted flags', () => {
      const msg: DirectMessage = {
        ...sampleDm,
        compressed: true,
        encrypted: true,
        priority: 3,
      };
      const decoded = decodeDirectMessageBytes(encodeDirectMessageBytes(msg));
      expect(decoded.compressed).toBe(true);
      expect(decoded.encrypted).toBe(true);
      expect(decoded.priority).toBe(3);
    });

    it('handles empty optional fields', () => {
      const msg: DirectMessage = {
        sourceDid: 'did:claw:zMinimal',
        targetDid: '',
        topic: 'test',
        payload: new Uint8Array(0),
        ttlSec: 0,
        sentAtMs: 0n,
        priority: 0,
        compressed: false,
        encrypted: false,
        idempotencyKey: '',
      };
      const decoded = decodeDirectMessageBytes(encodeDirectMessageBytes(msg));
      expect(decoded.sourceDid).toBe('did:claw:zMinimal');
      expect(decoded.targetDid).toBe('');
      expect(decoded.payload).toEqual(new Uint8Array(0));
      expect(decoded.ttlSec).toBe(0);
      expect(decoded.sentAtMs).toBe(0n);
    });

    it('handles large payloads', () => {
      const largePayload = new Uint8Array(64 * 1024);
      largePayload.fill(0xAB);
      const msg: DirectMessage = { ...sampleDm, payload: largePayload };
      const decoded = decodeDirectMessageBytes(encodeDirectMessageBytes(msg));
      expect(decoded.payload.length).toBe(64 * 1024);
      expect(decoded.payload[0]).toBe(0xAB);
      expect(decoded.payload[65535]).toBe(0xAB);
    });

    it('produces smaller output than equivalent JSON', () => {
      const fbBytes = encodeDirectMessageBytes(sampleDm);
      const jsonStr = JSON.stringify({
        sourceDid: sampleDm.sourceDid,
        targetDid: sampleDm.targetDid,
        topic: sampleDm.topic,
        payload: Buffer.from(sampleDm.payload).toString('base64'),
        ttlSec: sampleDm.ttlSec,
        sentAtMs: Number(sampleDm.sentAtMs),
        priority: sampleDm.priority,
        compressed: sampleDm.compressed,
        encrypted: sampleDm.encrypted,
        idempotencyKey: sampleDm.idempotencyKey,
      });
      const jsonBytes = Buffer.from(jsonStr, 'utf-8');
      expect(fbBytes.length).toBeLessThan(jsonBytes.length);
    });
  });

  // ── DeliveryReceipt ──────────────────────────────────────

  describe('DeliveryReceipt', () => {
    it('round-trips all fields', () => {
      const bytes = encodeDeliveryReceiptBytes(sampleReceipt);
      const decoded = decodeDeliveryReceiptBytes(bytes);
      expect(decoded.type).toBe(ReceiptType.Delivered);
      expect(decoded.messageId).toBe(sampleReceipt.messageId);
      expect(decoded.recipientDid).toBe(sampleReceipt.recipientDid);
      expect(decoded.senderDid).toBe(sampleReceipt.senderDid);
      expect(decoded.deliveredAtMs).toBe(sampleReceipt.deliveredAtMs);
    });
  });

  // ── DidAnnounce ──────────────────────────────────────────

  describe('DidAnnounce', () => {
    it('round-trips', () => {
      const bytes = encodeDidAnnounceBytes({ did: 'did:claw:zAlice123' });
      const decoded = decodeDidAnnounceBytes(bytes);
      expect(decoded.did).toBe('did:claw:zAlice123');
    });
  });

  // ── DidResolveRequest / Response ─────────────────────────

  describe('DidResolve', () => {
    it('round-trips request', () => {
      const bytes = encodeDidResolveRequestBytes({ did: 'did:claw:zBob999' });
      const decoded = decodeDidResolveRequestBytes(bytes);
      expect(decoded.did).toBe('did:claw:zBob999');
    });

    it('round-trips found response', () => {
      const resp = { did: 'did:claw:zBob999', peerId: '12D3KooWAbc', found: true };
      const decoded = decodeDidResolveResponseBytes(encodeDidResolveResponseBytes(resp));
      expect(decoded.did).toBe(resp.did);
      expect(decoded.peerId).toBe(resp.peerId);
      expect(decoded.found).toBe(true);
    });

    it('round-trips not-found response', () => {
      const resp = { did: 'did:claw:zBob999', peerId: '', found: false };
      const decoded = decodeDidResolveResponseBytes(encodeDidResolveResponseBytes(resp));
      expect(decoded.found).toBe(false);
      expect(decoded.peerId).toBe('');
    });
  });

  // ── Binary E2E Envelope ──────────────────────────────────

  describe('E2E Envelope', () => {
    it('round-trips binary layout', () => {
      const pk = new Uint8Array(32);
      pk.fill(0x11);
      const nonce = new Uint8Array(12);
      nonce.fill(0x22);
      const tag = new Uint8Array(16);
      tag.fill(0x33);
      const ciphertext = new Uint8Array([1, 2, 3, 4, 5]);

      const encoded = encodeE2EEnvelope({ ephemeralPk: pk, nonce, tag, ciphertext });
      expect(encoded.length).toBe(E2E_HEADER_SIZE + 5);

      const decoded = decodeE2EEnvelope(encoded);
      expect(decoded.ephemeralPk).toEqual(pk);
      expect(decoded.nonce).toEqual(nonce);
      expect(decoded.tag).toEqual(tag);
      expect(decoded.ciphertext).toEqual(ciphertext);
    });

    it('rejects too-short buffer', () => {
      expect(() => decodeE2EEnvelope(new Uint8Array(59))).toThrow('too short');
    });

    it('handles zero-length ciphertext', () => {
      const encoded = encodeE2EEnvelope({
        ephemeralPk: new Uint8Array(32),
        nonce: new Uint8Array(12),
        tag: new Uint8Array(16),
        ciphertext: new Uint8Array(0),
      });
      expect(encoded.length).toBe(E2E_HEADER_SIZE);
      const decoded = decodeE2EEnvelope(encoded);
      expect(decoded.ciphertext.length).toBe(0);
    });

    it('is much smaller than JSON hex envelope', () => {
      const pk = new Uint8Array(32);
      const nonce = new Uint8Array(12);
      const tag = new Uint8Array(16);
      const ciphertext = new Uint8Array(100); // 100 bytes of encrypted data

      const binarySize = encodeE2EEnvelope({ ephemeralPk: pk, nonce, tag, ciphertext }).length;
      const jsonSize = Buffer.from(JSON.stringify({
        _e2e: 1,
        pk: Buffer.from(pk).toString('hex'),
        n: Buffer.from(nonce).toString('hex'),
        c: Buffer.from(ciphertext).toString('hex'),
        t: Buffer.from(tag).toString('hex'),
      })).length;

      // Binary: 60 + 100 = 160 bytes
      // JSON: ~380+ bytes (hex doubles the byte size + JSON overhead)
      expect(binarySize).toBeLessThan(jsonSize * 0.6);
    });
  });

  // ── AttachmentMessage ────────────────────────────────────

  describe('AttachmentMessage', () => {
    const sampleAttachment: AttachmentMessage = {
      attachmentId: 'sha256:abc123def456',
      sourceDid: 'did:claw:zAlice1234567890abcdefghijklmnop',
      targetDid: 'did:claw:zBob1234567890abcdefghijklmnopqrs',
      contentType: 'image/png',
      fileName: 'photo.png',
      data: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      totalSize: 8,
      sentAtMs: BigInt(Date.now()),
    };

    it('round-trips all fields', () => {
      const bytes = encodeAttachmentMessageBytes(sampleAttachment);
      const decoded = decodeAttachmentMessageBytes(bytes);
      expect(decoded.attachmentId).toBe(sampleAttachment.attachmentId);
      expect(decoded.sourceDid).toBe(sampleAttachment.sourceDid);
      expect(decoded.targetDid).toBe(sampleAttachment.targetDid);
      expect(decoded.contentType).toBe(sampleAttachment.contentType);
      expect(decoded.fileName).toBe(sampleAttachment.fileName);
      expect(decoded.data).toEqual(sampleAttachment.data);
      expect(decoded.totalSize).toBe(sampleAttachment.totalSize);
      expect(decoded.sentAtMs).toBe(sampleAttachment.sentAtMs);
    });

    it('handles empty fileName', () => {
      const msg: AttachmentMessage = { ...sampleAttachment, fileName: '' };
      const decoded = decodeAttachmentMessageBytes(encodeAttachmentMessageBytes(msg));
      expect(decoded.fileName).toBe('');
    });

    it('handles large binary data', () => {
      const largeData = new Uint8Array(1024 * 1024); // 1 MB
      largeData.fill(0xAB);
      const msg: AttachmentMessage = {
        ...sampleAttachment,
        data: largeData,
        totalSize: largeData.length,
      };
      const decoded = decodeAttachmentMessageBytes(encodeAttachmentMessageBytes(msg));
      expect(decoded.data.length).toBe(1024 * 1024);
      expect(decoded.data[0]).toBe(0xAB);
      expect(decoded.data[1048575]).toBe(0xAB);
      expect(decoded.totalSize).toBe(1024 * 1024);
    });

    it('handles various content types', () => {
      for (const ct of ['image/jpeg', 'application/pdf', 'text/plain', 'application/octet-stream']) {
        const msg: AttachmentMessage = { ...sampleAttachment, contentType: ct };
        const decoded = decodeAttachmentMessageBytes(encodeAttachmentMessageBytes(msg));
        expect(decoded.contentType).toBe(ct);
      }
    });
  });
});
