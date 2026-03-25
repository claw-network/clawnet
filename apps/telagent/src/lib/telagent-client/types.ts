import type {
  AgentDID,
  Contact,
  ConversationSummary,
  CreateContactInput,
  CreateConversationInput,
  Envelope,
  GroupChainState,
  GroupMemberRecord,
  GroupRecord,
  OwnerPermissions,
  PeerProfile,
  RedactedEnvelope,
  SelfProfile,
  UpdateContactInput,
} from '@claw-network/client/protocol';

export {
  type AgentDID,
  type Contact,
  type ConversationSummary,
  type CreateContactInput,
  type CreateConversationInput,
  type Envelope,
  type GroupChainState,
  type GroupMemberRecord,
  type GroupRecord,
  type OwnerPermissions,
  type PeerProfile,
  type RedactedEnvelope,
  type SelfProfile,
  type UpdateContactInput,
};

// ── API Envelopes ────────────────────────────────────────────────────────────

export interface ApiLinks {
  self?: string;
  next?: string | null;
  prev?: string | null;
  first?: string | null;
  last?: string | null;
  [key: string]: string | null | undefined;
}

export interface PaginationMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface ApiDataEnvelope<T> {
  data: T;
  links?: ApiLinks;
}

export interface ApiListEnvelope<T> {
  data: T[];
  meta: {
    pagination: PaginationMeta;
  };
  links: ApiLinks;
}

// ── Conversation ─────────────────────────────────────────────────────────────

export interface ConversationListInput {
  page?: number;
  perPage?: number;
  sort?: 'last_message';
}

// ── Groups ───────────────────────────────────────────────────────────────────

export interface CreateGroupInput {
  creatorDid: AgentDID;
  groupId: string;
  groupDomain: string;
  domainProofHash: string;
  initialMlsStateHash: string;
}

export interface InviteMemberInput {
  inviterDid: AgentDID;
  inviteeDid: AgentDID;
  inviteId: string;
  mlsCommitHash: string;
}

export interface AcceptInviteInput {
  inviteeDid: AgentDID;
  mlsWelcomeHash: string;
}

export interface RemoveMemberInput {
  operatorDid: AgentDID;
  memberDid: AgentDID;
  mlsCommitHash: string;
}

export interface GroupMemberListInput {
  view?: 'all' | 'pending' | 'finalized';
  page?: number;
  perPage?: number;
}

// ── Messages ──────────────────────────────────────────────────────────────────

export interface SendMessageInput {
  envelopeId?: string;
  senderDid: AgentDID;
  conversationId: string;
  conversationType: 'direct' | 'group';
  targetDomain?: string;
  targetDid: AgentDID;
  mailboxKeyId: string;
  sealedHeader: string;
  ciphertext: string;
  contentType: 'text' | 'image' | 'file' | 'control';
  attachmentManifestHash?: string;
  epoch?: number;
  ttlSec?: number;
}

export interface PullMessageInput {
  cursor?: string;
  limit?: number;
  conversationId?: string;
}

export interface SendMessageResult {
  envelope: Envelope;
  p2pDelivered: boolean;
}

// ── Attachments ──────────────────────────────────────────────────────────────

export interface InitAttachmentUploadInput {
  filename: string;
  contentType: string;
  sizeBytes: number;
  manifestHash: string;
}

export interface CompleteAttachmentUploadInput {
  objectKey: string;
  manifestHash: string;
  checksum: string;
  fileContentType?: string;
  /** When set, the node will relay the attachment to this DID via ClawNet P2P. */
  targetDid?: string;
}

// ── Session ──────────────────────────────────────────────────────────────────

export type SessionOperationScope = 'transfer' | 'escrow' | 'market' | 'contract' | 'reputation' | 'identity';

export interface UnlockSessionInput {
  passphrase: string;
  ttlSeconds?: number;
  scope?: SessionOperationScope[];
  maxOperations?: number;
}

export interface SessionInfo {
  active: boolean;
  expiresAt: string;
  scope: SessionOperationScope[];
  operationsUsed: number;
  createdAt: string;
}

export interface SessionUnlockResult {
  sessionToken: string;
  expiresAt: string;
  scope: SessionOperationScope[];
  did: string;
  permissions: {
    mode: 'observer' | 'intervener';
    interventionScopes: string[];
  };
}

// ── Wallet ──────────────────────────────────────────────────────────────────

export interface WalletHistoryInput {
  did?: AgentDID;
  limit?: number;
  offset?: number;
}

export interface TransferInput {
  to: AgentDID;
  amount: number;
  memo?: string;
}

export interface CreateEscrowInput {
  beneficiary: AgentDID;
  amount: number;
  releaseRules?: unknown[];
}

// ── Marketplace ─────────────────────────────────────────────────────────────

export interface SearchMarketsInput {
  q?: string;
  type?: string;
}

export interface PublishTaskInput {
  title: string;
  description: string;
  budget: number;
  tags?: string[];
}

export interface BidTaskInput {
  amount: number;
  proposal?: string;
}

export interface ReviewInput {
  targetDid: AgentDID;
  score: number;
  comment?: string;
  orderId?: string;
}

export interface PublishInfoInput {
  title: string;
  description: string;
  price: number;
  tags?: string[];
}

export interface DeliverInput {
  content?: string;
  contentHash?: string;
  contentType?: string;
  metadata?: Record<string, unknown>;
}

export interface PublishCapabilityInput {
  title: string;
  description: string;
  pricePerInvocation: number;
  maxConcurrentLeases?: number;
  tags?: string[];
}

export interface LeaseCapabilityInput {
  maxInvocations?: number;
  durationSeconds?: number;
}

export interface InvokeCapabilityInput {
  payload: Record<string, unknown>;
}

export interface OpenDisputeInput {
  orderId: string;
  reason: string;
  evidence?: string;
}

export interface RespondDisputeInput {
  response: string;
  evidence?: string;
}

export interface ResolveDisputeInput {
  outcome: 'refund' | 'release' | 'split';
  splitRatio?: number;
  reason?: string;
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export type QueryValue = string | number | boolean | null | undefined;

export interface AgentIdentityView {
  did: AgentDID;
  didHash: string;
  controller: string;
  publicKey: string;
  isActive: boolean;
  resolvedAtMs: number;
}

// ── SDK Options ─────────────────────────────────────────────────────────────

export interface TelagentSdkOptions {
  baseUrl: string;
  accessToken?: string;
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}
