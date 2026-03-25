import type { ConversationSummary, Envelope } from '../protocol/index.js';

export interface ProvisionalRetractionRecord {
  envelopeId: string;
  conversationId: string;
  reason: 'REORGED_BACK';
  retractedAtMs: number;
}

export interface StoredEnvelopeRecord {
  envelope: Envelope;
  idempotencySignature: string;
}

export interface EnvelopeCursorKey {
  sentAtMs: number;
  conversationId: string;
  seq: bigint;
  envelopeId: string;
}

export interface DirectConversationParticipantCheckResult {
  allowed: boolean;
  participants: string[];
}

export interface MailboxStore {
  init?(): Promise<void>;
  close?(): Promise<void>;
  nextSequence(conversationId: string): Promise<bigint>;
  saveEnvelope(record: StoredEnvelopeRecord): Promise<void>;
  getEnvelopeRecord(envelopeId: string): Promise<StoredEnvelopeRecord | null>;
  getIdempotencySignature(envelopeId: string): Promise<string | null>;
  getRetraction(envelopeId: string): Promise<ProvisionalRetractionRecord | null>;
  countEnvelopes(conversationId?: string): Promise<number>;
  listEnvelopes(params: {
    conversationId?: string;
    limit: number;
    afterSeq?: bigint;
    afterKey?: EnvelopeCursorKey;
    unread?: boolean;
  }): Promise<Envelope[]>;
  markAsRead?(envelopeIds: string[]): Promise<number>;
  ensureDirectConversationParticipant(params: {
    conversationId: string;
    didHash: string;
    observedAtMs: number;
    maxParticipants?: number;
  }): Promise<DirectConversationParticipantCheckResult>;
  listProvisionalGroupRecords(): Promise<StoredEnvelopeRecord[]>;
  retractEnvelope(params: {
    envelope: Envelope;
    idempotencySignature: string;
    retractedAtMs: number;
    reason: 'REORGED_BACK';
  }): Promise<void>;
  listRetractions(limit: number): Promise<ProvisionalRetractionRecord[]>;
  deleteExpired(nowMs: number): Promise<{ removed: number; remaining: number }>;
  setConversationPrivacy?(params: {
    conversationId: string;
    isPrivate: boolean;
    updatedAtMs: number;
  }): Promise<void>;
  listPrivateConversationIds?(limit?: number): Promise<string[]>;
  upsertConversationSummary?(params: {
    conversationId: string;
    conversationType: 'direct' | 'group';
    peerDid?: string;
    groupId?: string;
    displayName: string;
    lastMessagePreview?: string | null;
    lastMessageAtMs: number;
    updatedAtMs: number;
  }): Promise<void>;
  listConversationSummaries?(params: {
    limit: number;
    afterMs?: number;
  }): Promise<ConversationSummary[]>;
  deleteConversation?(conversationId: string): Promise<void>;
}
