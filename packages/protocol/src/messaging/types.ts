// ── TypeScript interfaces for messaging FlatBuffers tables ────────────

/** Receipt type discriminator. */
export const enum ReceiptType {
  Delivered = 0,
}

/**
 * Wire format for `/clawnet/1.0.0/dm`.
 *
 * Field order matches the FlatBuffers schema (messaging-spec.fbs)
 * so field indices stay in sync with the hand-written codec.
 */
export interface DirectMessage {
  sourceDid: string;
  targetDid: string;
  topic: string;
  payload: Uint8Array;
  ttlSec: number;
  sentAtMs: bigint;
  priority: number;
  compressed: boolean;
  encrypted: boolean;
  idempotencyKey: string;
}

/** Wire format for `/clawnet/1.0.0/receipt`. */
export interface DeliveryReceipt {
  type: ReceiptType;
  messageId: string;
  recipientDid: string;
  senderDid: string;
  deliveredAtMs: bigint;
}

/** Wire format for `/clawnet/1.0.0/did-announce`. */
export interface DidAnnounce {
  did: string;
}

/** Request for `/clawnet/1.0.0/did-resolve`. */
export interface DidResolveRequest {
  did: string;
}

/** Response for `/clawnet/1.0.0/did-resolve`. */
export interface DidResolveResponse {
  did: string;
  peerId: string;
  found: boolean;
}

/**
 * Binary E2E encryption envelope layout (60-byte fixed header):
 *
 *   [32 bytes: ephemeral X25519 public key]
 *   [12 bytes: AES-256-GCM nonce]
 *   [16 bytes: AES-256-GCM auth tag]
 *   [remaining: ciphertext]
 *
 * Total overhead: 60 bytes (vs ~200+ for the previous hex-encoded JSON).
 */
export const E2E_HEADER_SIZE = 32 + 12 + 16; // 60

export interface E2EEnvelope {
  ephemeralPk: Uint8Array; // 32 bytes
  nonce: Uint8Array;       // 12 bytes
  tag: Uint8Array;         // 16 bytes
  ciphertext: Uint8Array;
}

/**
 * Wire format for `/clawnet/1.0.0/attachment`.
 *
 * Relays binary attachment data between nodes P2P.
 * The receiver stores the data locally so it's always accessible
 * without cross-node HTTP dependency.
 *
 * Field order matches the FlatBuffers schema.
 */
export interface AttachmentMessage {
  attachmentId: string;    // SHA-256 hex of data, or caller-provided ID
  sourceDid: string;
  targetDid: string;
  contentType: string;     // MIME type, e.g. "image/png"
  fileName: string;        // Original filename (optional, may be empty)
  data: Uint8Array;        // Raw binary attachment data
  totalSize: number;       // Total size in bytes (for validation)
  sentAtMs: bigint;
}
