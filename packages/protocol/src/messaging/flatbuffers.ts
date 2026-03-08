/**
 * Hand-written FlatBuffers encode/decode functions for messaging tables.
 *
 * Field indices MUST match the order in messaging-spec.fbs.
 * Reuses the FlatBufferReader from the p2p module (same package).
 */

import { Builder } from 'flatbuffers';
import { FlatBufferReader, finishBytes } from '../p2p/flatbuffers.js';
import type {
  DeliveryReceipt,
  DidAnnounce,
  DidResolveRequest,
  DidResolveResponse,
  DirectMessage,
  AttachmentMessage,
} from './types.js';
import { ReceiptType } from './types.js';

export { FlatBufferReader, finishBytes };

// ── DirectMessage (10 fields) ────────────────────────────────

export function encodeDirectMessage(builder: Builder, msg: DirectMessage): number {
  const sourceDid = builder.createString(msg.sourceDid);
  const targetDid = msg.targetDid ? builder.createString(msg.targetDid) : 0;
  const topic = builder.createString(msg.topic);
  const payload = builder.createByteVector(msg.payload);
  const idempotencyKey = msg.idempotencyKey ? builder.createString(msg.idempotencyKey) : 0;

  builder.startObject(10);
  builder.addFieldOffset(0, sourceDid, 0);          // source_did
  if (targetDid) builder.addFieldOffset(1, targetDid, 0); // target_did
  builder.addFieldOffset(2, topic, 0);               // topic
  builder.addFieldOffset(3, payload, 0);             // payload
  builder.addFieldInt32(4, msg.ttlSec, 0);           // ttl_sec
  builder.addFieldInt64(5, msg.sentAtMs, 0n);        // sent_at_ms
  builder.addFieldInt8(6, msg.priority, 0);          // priority
  builder.addFieldInt8(7, msg.compressed ? 1 : 0, 0); // compressed (bool = byte)
  builder.addFieldInt8(8, msg.encrypted ? 1 : 0, 0);  // encrypted  (bool = byte)
  if (idempotencyKey) builder.addFieldOffset(9, idempotencyKey, 0); // idempotency_key
  return builder.endObject();
}

export function decodeDirectMessage(reader: FlatBufferReader, table: number): DirectMessage {
  return {
    sourceDid: reader.readStringField(table, 0) ?? '',
    targetDid: reader.readStringField(table, 1) ?? '',
    topic: reader.readStringField(table, 2) ?? '',
    payload: reader.readByteVectorField(table, 3) ?? new Uint8Array(),
    ttlSec: reader.readUint32Field(table, 4, 0),
    sentAtMs: reader.readUint64Field(table, 5, 0n),
    priority: reader.readUint8Field(table, 6, 1),    // default NORMAL=1
    compressed: reader.readUint8Field(table, 7, 0) !== 0,
    encrypted: reader.readUint8Field(table, 8, 0) !== 0,
    idempotencyKey: reader.readStringField(table, 9) ?? '',
  };
}

// ── DeliveryReceipt (5 fields) ───────────────────────────────

export function encodeDeliveryReceipt(builder: Builder, receipt: DeliveryReceipt): number {
  const messageId = builder.createString(receipt.messageId);
  const recipientDid = builder.createString(receipt.recipientDid);
  const senderDid = builder.createString(receipt.senderDid);

  builder.startObject(5);
  builder.addFieldInt8(0, receipt.type, 0);          // type
  builder.addFieldOffset(1, messageId, 0);           // message_id
  builder.addFieldOffset(2, recipientDid, 0);        // recipient_did
  builder.addFieldOffset(3, senderDid, 0);           // sender_did
  builder.addFieldInt64(4, receipt.deliveredAtMs, 0n); // delivered_at_ms
  return builder.endObject();
}

export function decodeDeliveryReceipt(reader: FlatBufferReader, table: number): DeliveryReceipt {
  return {
    type: reader.readUint8Field(table, 0, 0) as ReceiptType,
    messageId: reader.readStringField(table, 1) ?? '',
    recipientDid: reader.readStringField(table, 2) ?? '',
    senderDid: reader.readStringField(table, 3) ?? '',
    deliveredAtMs: reader.readUint64Field(table, 4, 0n),
  };
}

// ── DidAnnounce (1 field) ────────────────────────────────────

export function encodeDidAnnounce(builder: Builder, announce: DidAnnounce): number {
  const did = builder.createString(announce.did);
  builder.startObject(1);
  builder.addFieldOffset(0, did, 0);
  return builder.endObject();
}

export function decodeDidAnnounce(reader: FlatBufferReader, table: number): DidAnnounce {
  return {
    did: reader.readStringField(table, 0) ?? '',
  };
}

// ── DidResolveRequest (1 field) ──────────────────────────────

export function encodeDidResolveRequest(builder: Builder, req: DidResolveRequest): number {
  const did = builder.createString(req.did);
  builder.startObject(1);
  builder.addFieldOffset(0, did, 0);
  return builder.endObject();
}

export function decodeDidResolveRequest(reader: FlatBufferReader, table: number): DidResolveRequest {
  return {
    did: reader.readStringField(table, 0) ?? '',
  };
}

// ── DidResolveResponse (3 fields) ────────────────────────────

export function encodeDidResolveResponse(builder: Builder, resp: DidResolveResponse): number {
  const did = builder.createString(resp.did);
  const peerId = resp.peerId ? builder.createString(resp.peerId) : 0;

  builder.startObject(3);
  builder.addFieldOffset(0, did, 0);                // did
  if (peerId) builder.addFieldOffset(1, peerId, 0); // peer_id
  builder.addFieldInt8(2, resp.found ? 1 : 0, 0);   // found (bool = byte)
  return builder.endObject();
}

export function decodeDidResolveResponse(reader: FlatBufferReader, table: number): DidResolveResponse {
  return {
    did: reader.readStringField(table, 0) ?? '',
    peerId: reader.readStringField(table, 1) ?? '',
    found: reader.readUint8Field(table, 2, 0) !== 0,
  };
}

// ── AttachmentMessage (8 fields) ─────────────────────────────

export function encodeAttachmentMessage(builder: Builder, msg: AttachmentMessage): number {
  const attachmentId = builder.createString(msg.attachmentId);
  const sourceDid = builder.createString(msg.sourceDid);
  const targetDid = msg.targetDid ? builder.createString(msg.targetDid) : 0;
  const contentType = builder.createString(msg.contentType);
  const fileName = msg.fileName ? builder.createString(msg.fileName) : 0;
  const data = builder.createByteVector(msg.data);

  builder.startObject(8);
  builder.addFieldOffset(0, attachmentId, 0);        // attachment_id
  builder.addFieldOffset(1, sourceDid, 0);            // source_did
  if (targetDid) builder.addFieldOffset(2, targetDid, 0); // target_did
  builder.addFieldOffset(3, contentType, 0);          // content_type
  if (fileName) builder.addFieldOffset(4, fileName, 0); // file_name
  builder.addFieldOffset(5, data, 0);                 // data (byte vector)
  builder.addFieldInt32(6, msg.totalSize, 0);         // total_size
  builder.addFieldInt64(7, msg.sentAtMs, 0n);         // sent_at_ms
  return builder.endObject();
}

export function decodeAttachmentMessage(reader: FlatBufferReader, table: number): AttachmentMessage {
  return {
    attachmentId: reader.readStringField(table, 0) ?? '',
    sourceDid: reader.readStringField(table, 1) ?? '',
    targetDid: reader.readStringField(table, 2) ?? '',
    contentType: reader.readStringField(table, 3) ?? '',
    fileName: reader.readStringField(table, 4) ?? '',
    data: reader.readByteVectorField(table, 5) ?? new Uint8Array(),
    totalSize: reader.readUint32Field(table, 6, 0),
    sentAtMs: reader.readUint64Field(table, 7, 0n),
  };
}
