/**
 * Delivery-external: point-to-point content transfer over libp2p streams.
 *
 * Protocol: /clawnet/1.0.0/delivery-external
 *
 * Used when a consumer node needs to fetch the actual content bytes for a
 * deliverable whose transport.method === 'external' and whose transport.uri
 * uses the `p2p://` scheme.
 *
 * Wire format (length-prefixed JSON header + raw bytes):
 *   [4 bytes big-endian: header-length][header-JSON][raw-content-bytes]
 *
 * Request message:
 *   { version: 1, deliverableId: string, requesterDid: string }
 *
 * Response message:
 *   Header: { version: 1, deliverableId: string, size: number, contentHash: string }
 *   Body:   raw content bytes, exactly `size` bytes long.
 *
 * Spec: docs/implementation/deliverable-spec.md §6.7
 */

import { utf8ToBytes, bytesToUtf8 } from '../utils/bytes.js';

// ── Protocol constant ─────────────────────────────────────────────

export const DELIVERY_EXTERNAL_PROTOCOL = '/clawnet/1.0.0/delivery-external';

// ── Wire messages ─────────────────────────────────────────────────

/** Sent by the requester (consumer) to initiate a content pull. */
export interface DeliveryExternalRequest {
  version: 1;
  /** The deliverable ID to fetch. */
  deliverableId: string;
  /** DID of the requesting node (for audit / access control). */
  requesterDid: string;
}

/** Sent by the provider as the response header (followed immediately by raw bytes). */
export interface DeliveryExternalResponseHeader {
  version: 1;
  deliverableId: string;
  /** Content size in bytes. */
  size: number;
  /** BLAKE3 hex hash of the content. */
  contentHash: string;
}

/** Returned to the caller when provider does not have the asset. */
export interface DeliveryExternalNotFound {
  version: 1;
  deliverableId: string;
  error: 'not_found';
}

export type DeliveryExternalResponse = DeliveryExternalResponseHeader | DeliveryExternalNotFound;

// ── Framing helpers ───────────────────────────────────────────────

/** Encode a 4-byte big-endian length prefix + JSON header. */
export function encodeHeader(header: Record<string, unknown>): Uint8Array {
  const json = utf8ToBytes(JSON.stringify(header));
  const buf = new Uint8Array(4 + json.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, json.length, false /* big-endian */);
  buf.set(json, 4);
  return buf;
}

/** Decode the 4-byte length prefix and extract the JSON header bytes. */
export function decodeHeader<T>(data: Uint8Array): { header: T; bodyOffset: number } {
  if (data.length < 4) {
    throw new Error('Delivery-external: buffer too short for length prefix');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerLen = view.getUint32(0, false /* big-endian */);
  if (data.length < 4 + headerLen) {
    throw new Error(`Delivery-external: buffer truncated (expected ${4 + headerLen}, got ${data.length})`);
  }
  const headerJson = data.subarray(4, 4 + headerLen);
  const header = JSON.parse(bytesToUtf8(headerJson)) as T;
  return { header, bodyOffset: 4 + headerLen };
}

// ── Type guards ───────────────────────────────────────────────────

export function isDeliveryExternalRequest(v: unknown): v is DeliveryExternalRequest {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.version === 1 &&
    typeof r.deliverableId === 'string' &&
    typeof r.requesterDid === 'string'
  );
}

export function isDeliveryExternalNotFound(v: unknown): v is DeliveryExternalNotFound {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.version === 1 && r.error === 'not_found';
}
