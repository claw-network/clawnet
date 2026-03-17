/**
 * Unified Deliverable types for ClawNet markets + service contracts.
 * Spec: docs/implementation/deliverable-spec.md v0.4.0
 */

// ── Deliverable type taxonomy ─────────────────────────────

export const DELIVERABLE_TYPES = [
  'text',
  'data',
  'document',
  'code',
  'model',
  'binary',
  'stream',
  'interactive',
  'composite',
] as const;
export type DeliverableType = (typeof DELIVERABLE_TYPES)[number];

export function isDeliverableType(value: string): value is DeliverableType {
  return (DELIVERABLE_TYPES as readonly string[]).includes(value);
}

/**
 * Migration alias map: legacy type names → unified DeliverableType.
 * Used when ingesting old `TaskDeliverable.type` or service contract types.
 */
export const LEGACY_TYPE_ALIASES: Record<string, DeliverableType> = {
  file: 'binary',
  report: 'document',
  service: 'interactive',
  result: 'data',
  analysis: 'data',
  design: 'document',
  integration: 'code',
  other: 'binary',
};

export function resolveDeliverableType(value: string): DeliverableType {
  if (isDeliverableType(value)) return value;
  const alias = LEGACY_TYPE_ALIASES[value];
  if (alias) return alias;
  throw new Error(`Unknown deliverable type: ${value}`);
}

// ── Content format (MIME types) ───────────────────────────

export const CONTENT_FORMATS = [
  // Text
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  // Structured
  'application/json',
  'application/jsonl',
  'application/xml',
  'application/parquet',
  'application/yaml',
  // Code
  'application/javascript',
  'application/typescript',
  'application/python',
  'application/wasm',
  'application/notebook+json',
  // Binary
  'application/octet-stream',
  'application/zip',
  'application/gzip',
  'application/tar+gzip',
  // Image
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'image/webp',
  // Audio / Video
  'audio/wav',
  'audio/mp3',
  'video/mp4',
  // Model
  'application/x-onnx',
  'application/x-safetensors',
  'application/x-gguf',
  // Stream
  'text/event-stream',
  'application/x-ndjson',
  // Interactive
  'application/vnd.clawnet.endpoint+json',
] as const;

export type ContentFormat = (typeof CONTENT_FORMATS)[number] | string;

// ── Transport variants ────────────────────────────────────

/** Content embedded in P2P event payload (≤ 750 KB raw) */
export interface InlineTransport {
  method: 'inline';
  /** Base64-encoded content (encrypted if encryption is set) */
  data: string;
}

/** Content stored externally; fetch by reference */
export interface ExternalTransport {
  method: 'external';
  /** IPFS CID, HTTP(S) URL, or P2P stream URI */
  uri: string;
  /** Expected BLAKE3 hash of the fetched bytes (encrypted blob) */
  encryptedHash?: string;
}

/**
 * Streaming output — not content-addressed until completed.
 * SECURITY: sessionToken NOT in gossip-visible envelope (see §6.6).
 */
export interface StreamTransport {
  method: 'stream';
  /** Endpoint to connect for the stream */
  endpoint: string;
  /** Protocol: sse | websocket | grpc-stream */
  protocol: 'sse' | 'websocket' | 'grpc-stream';
  /** BLAKE3 hash of the session token — binding verification only */
  tokenHash: string;
  /** After stream completes, the finalized content hash */
  finalHash?: string;
}

/**
 * Interactive service — the deliverable IS an API access.
 * SECURITY: accessToken NOT in gossip-visible envelope (see §6.6).
 */
export interface EndpointTransport {
  method: 'endpoint';
  /** Base URL of the service */
  baseUrl: string;
  /** OpenAPI spec reference (content hash or URL) */
  specRef?: string;
  /** BLAKE3 hash of the access token — binding verification only */
  tokenHash: string;
  /** Lease expiry (ISO 8601) */
  expiresAt: string;
}

export type DeliverableTransport =
  | InlineTransport
  | ExternalTransport
  | StreamTransport
  | EndpointTransport;

// ── Key envelope for encryption ───────────────────────────

export interface DeliverableKeyEnvelope {
  senderPublicKeyHex: string;
  nonceHex: string;
  ciphertextHex: string;
  tagHex: string;
}

// ── Encryption metadata ───────────────────────────────────

export interface DeliverableEncryption {
  /**
   * Algorithm identifier.
   * v1 compatible value matches existing InfoKeyEnvelope.
   */
  algorithm: 'x25519-aes-256-gcm';
  /** Per-recipient key envelopes. Maps recipient DID → envelope. */
  keyEnvelopes: Record<string, DeliverableKeyEnvelope>;
  /** Content encryption nonce (hex) */
  nonce: string;
  /** Content encryption auth tag (hex) — for AES-GCM */
  tag: string;
}

// ── Schema reference (v2) ─────────────────────────────────

export interface DeliverableSchema {
  /** JSON Schema URI or content hash of the schema */
  ref: string;
  /** Schema version */
  version?: string;
}

// ── DeliverableEnvelope ───────────────────────────────────

/**
 * Deliverable envelope — the metadata record for any deliverable.
 * Content is referenced by hash, transmitted separately.
 */
export interface DeliverableEnvelope {
  /**
   * Unique identifier.
   * MUST be deterministic: SHA-256(contextId + producer + nonce + createdAt), hex-encoded.
   */
  id: string;

  /** Cryptographic nonce (hex, 32 bytes) for replay prevention */
  nonce: string;

  /**
   * Business context identifier — the order/contract/lease this delivery belongs to.
   * Maps to: orderId (info/task market), contractId:milestoneIndex (service contract),
   * leaseId (capability market).
   */
  contextId: string;

  /** Deliverable type from unified taxonomy */
  type: DeliverableType;

  /** MIME-type of the content */
  format: ContentFormat;

  /** Human-readable name */
  name: string;

  /** Optional description */
  description?: string;

  // ── Content addressing ──────────────────────────────────

  /** BLAKE3 hash of the plaintext content (hex, 64 chars) */
  contentHash: string;

  /** Content size in bytes (plaintext, before encryption) */
  size: number;

  // ── Provenance ──────────────────────────────────────────

  /** DID of the producer */
  producer: string;

  /** Ed25519 signature over canonical(envelope-without-signature), base58btc */
  signature: string;

  /** ISO 8601 timestamp of creation */
  createdAt: string;

  // ── Encryption ──────────────────────────────────────────

  /** Encryption metadata. Absent = plaintext (rare, must be opt-in) */
  encryption?: DeliverableEncryption;

  // ── Transport ───────────────────────────────────────────

  /** How to obtain the content */
  transport: DeliverableTransport;

  // ── Schema (v2) ─────────────────────────────────────────

  /** Optional schema reference for structural validation */
  schema?: DeliverableSchema;

  // ── Composite ───────────────────────────────────────────

  /** Child deliverable IDs (only for type = 'composite') */
  parts?: string[];

  // ── Legacy ──────────────────────────────────────────────

  /** True when auto-wrapped from old Record<string,unknown>[] format */
  legacy?: boolean;

  /** 'producer' = normal, 'node' = legacy auto-signed by node */
  signedBy?: 'producer' | 'node';
}

// ── Acceptance testing (Phase 3) ──────────────────────────

export const ASSERTION_OPERATORS = ['eq', 'gt', 'lt', 'contains', 'matches'] as const;
export type AssertionOperator = (typeof ASSERTION_OPERATORS)[number];

export interface Assertion {
  /** JSONPath expression to locate the field in the deliverable content */
  field: string;
  /** Comparison operator */
  operator: AssertionOperator;
  /** Expected value to compare against */
  value: unknown;
}

export interface AcceptanceTest {
  id: string;
  name: string;
  type: 'script' | 'assertion' | 'manual';
  /** Content hash of the WASM test script (required when type = 'script') */
  scriptHash?: string;
  /** Declarative assertions (required when type = 'assertion') */
  assertions?: Assertion[];
  /** Whether this test must pass for the delivery to be accepted */
  required: boolean;
}

export interface AssertionTestResult {
  testId: string;
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
  error?: string;
}

export interface AcceptanceTestResult {
  passed: boolean;
  results: AssertionTestResult[];
}

// ── P2P event payload extension ───────────────────────────

/**
 * The `delivery` sub-object added to market.submission.submit
 * and market.order.update payloads.
 */
export interface DeliveryPayload {
  envelope?: DeliverableEnvelope;
  /** Composite submissions: multiple envelopes in one delivery. */
  envelopes?: DeliverableEnvelope[];
  deliverableId?: string;
  verified?: boolean;
  failureReason?: string;
  finalHash?: string;
  size?: number;
  signature?: string;
  request?: { deliverableId: string };
}
