/**
 * High-level messaging codec — encode/decode complete FlatBuffers byte arrays.
 *
 * Also provides binary E2E envelope encode/decode (fixed-layout, no FlatBuffers).
 */

import { Builder } from 'flatbuffers';
import type {
  DeliveryReceipt,
  DidAnnounce,
  DidResolveRequest,
  DidResolveResponse,
  DirectMessage,
  E2EEnvelope,
} from './types.js';
import { E2E_HEADER_SIZE } from './types.js';
import {
  FlatBufferReader,
  finishBytes,
  encodeDirectMessage,
  decodeDirectMessage,
  encodeDeliveryReceipt,
  decodeDeliveryReceipt,
  encodeDidAnnounce,
  decodeDidAnnounce,
  encodeDidResolveRequest,
  decodeDidResolveRequest,
  encodeDidResolveResponse,
  decodeDidResolveResponse,
} from './flatbuffers.js';

// ── DirectMessage ────────────────────────────────────────────

export function encodeDirectMessageBytes(msg: DirectMessage): Uint8Array {
  const builder = new Builder(256);
  const root = encodeDirectMessage(builder, msg);
  return finishBytes(builder, root);
}

export function decodeDirectMessageBytes(bytes: Uint8Array): DirectMessage {
  const reader = new FlatBufferReader(bytes);
  return decodeDirectMessage(reader, reader.rootTable());
}

// ── DeliveryReceipt ──────────────────────────────────────────

export function encodeDeliveryReceiptBytes(receipt: DeliveryReceipt): Uint8Array {
  const builder = new Builder(128);
  const root = encodeDeliveryReceipt(builder, receipt);
  return finishBytes(builder, root);
}

export function decodeDeliveryReceiptBytes(bytes: Uint8Array): DeliveryReceipt {
  const reader = new FlatBufferReader(bytes);
  return decodeDeliveryReceipt(reader, reader.rootTable());
}

// ── DidAnnounce ──────────────────────────────────────────────

export function encodeDidAnnounceBytes(announce: DidAnnounce): Uint8Array {
  const builder = new Builder(64);
  const root = encodeDidAnnounce(builder, announce);
  return finishBytes(builder, root);
}

export function decodeDidAnnounceBytes(bytes: Uint8Array): DidAnnounce {
  const reader = new FlatBufferReader(bytes);
  return decodeDidAnnounce(reader, reader.rootTable());
}

// ── DidResolveRequest ────────────────────────────────────────

export function encodeDidResolveRequestBytes(req: DidResolveRequest): Uint8Array {
  const builder = new Builder(64);
  const root = encodeDidResolveRequest(builder, req);
  return finishBytes(builder, root);
}

export function decodeDidResolveRequestBytes(bytes: Uint8Array): DidResolveRequest {
  const reader = new FlatBufferReader(bytes);
  return decodeDidResolveRequest(reader, reader.rootTable());
}

// ── DidResolveResponse ───────────────────────────────────────

export function encodeDidResolveResponseBytes(resp: DidResolveResponse): Uint8Array {
  const builder = new Builder(128);
  const root = encodeDidResolveResponse(builder, resp);
  return finishBytes(builder, root);
}

export function decodeDidResolveResponseBytes(bytes: Uint8Array): DidResolveResponse {
  const reader = new FlatBufferReader(bytes);
  return decodeDidResolveResponse(reader, reader.rootTable());
}

// ── Binary E2E Envelope ──────────────────────────────────────
//
//  Layout: [pk:32][nonce:12][tag:16][ciphertext:...]
//  Total fixed header = 60 bytes.
//  Much smaller than the previous JSON { _e2e:1, pk:hex, n:hex, c:hex, t:hex }.

export function encodeE2EEnvelope(envelope: E2EEnvelope): Uint8Array {
  const total = E2E_HEADER_SIZE + envelope.ciphertext.length;
  const out = new Uint8Array(total);
  out.set(envelope.ephemeralPk, 0);
  out.set(envelope.nonce, 32);
  out.set(envelope.tag, 44);
  out.set(envelope.ciphertext, 60);
  return out;
}

export function decodeE2EEnvelope(bytes: Uint8Array): E2EEnvelope {
  if (bytes.length < E2E_HEADER_SIZE) {
    throw new Error(`E2E envelope too short: ${bytes.length} < ${E2E_HEADER_SIZE}`);
  }
  return {
    ephemeralPk: bytes.subarray(0, 32),
    nonce: bytes.subarray(32, 44),
    tag: bytes.subarray(44, 60),
    ciphertext: bytes.subarray(60),
  };
}
