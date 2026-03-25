export type AgentDID = string;

export type GroupID = string;
export type InviteID = string;

export type GroupState = 'PENDING_ONCHAIN' | 'ACTIVE' | 'REORGED_BACK';
export type MembershipState = 'PENDING' | 'FINALIZED' | 'REMOVED';

export type ConversationType = 'direct' | 'group';
// ── 基础消息类型 ──────────────────────────────────
export type BaseContentType = 'text' | 'image' | 'file' | 'control';

// ── TelAgent 扩展消息类型（telagent/* 命名空间，与 RFC §4.2 对齐） ──
export type TelagentContentType =
  | 'telagent/identity-card'       // 展示 Identity + Reputation 卡片
  | 'telagent/transfer-request'    // 转账请求
  | 'telagent/transfer-receipt'    // 转账完成回执
  | 'telagent/task-listing'        // 任务发布卡片
  | 'telagent/task-bid'            // 竞标通知
  | 'telagent/escrow-created'      // 托管创建通知
  | 'telagent/escrow-released'     // 托管释放通知
  | 'telagent/milestone-update'    // 里程碑进度更新
  | 'telagent/review-card';        // 评价卡片

// ── 联合类型 ──────────────────────────────────────
export type ContentType = BaseContentType | TelagentContentType;

export interface RouteHint {
  targetDomain?: string;
  targetDid: string;
  mailboxKeyId: string;
}

export interface Envelope {
  envelopeId: string;
  conversationId: string;
  conversationType: ConversationType;
  routeHint: RouteHint;
  sealedHeader: string;
  seq: bigint;
  epoch?: number;
  ciphertext: string;
  contentType: ContentType;
  attachmentManifestHash?: string;
  sentAtMs: number;
  ttlSec: number;
  provisional?: boolean;
  read?: boolean;
}

/** Envelope with sensitive fields replaced by '[redacted]'. Used by Owner view API. */
export type RedactedEnvelope = Omit<Envelope, 'ciphertext' | 'sealedHeader'> & {
  ciphertext: '[redacted]';
  sealedHeader: '[redacted]';
};

export interface GroupRecord {
  groupId: GroupID;
  creatorDid: AgentDID;
  creatorDidHash: string;
  groupDomain: string;
  domainProofHash: string;
  initialMlsStateHash: string;
  state: GroupState;
  createdAtMs: number;
  txHash?: string;
  blockNumber?: number;
}

export interface GroupMemberRecord {
  groupId: GroupID;
  did: AgentDID;
  didHash: string;
  state: MembershipState;
  joinedAtMs: number;
  inviteId?: InviteID;
  txHash?: string;
}

export interface GroupChainState {
  groupId: GroupID;
  state: GroupState;
  pendingTxHash?: string;
  finalizedTxHash?: string;
  blockNumber?: number;
  updatedAtMs: number;
}

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
}

export type InterventionScope =
  | 'send_message'
  | 'manage_contacts'
  | 'manage_groups'
  | 'clawnet_transfer'
  | 'clawnet_escrow'
  | 'clawnet_market'
  | 'clawnet_reputation';

export interface OwnerPermissions {
  mode: 'observer' | 'intervener';
  interventionScopes: InterventionScope[];
  privateConversations: string[];
}

export interface ConversationSummary {
  conversationId: string;
  conversationType: ConversationType;
  peerDid?: AgentDID;
  groupId?: GroupID;
  displayName: string;
  lastMessagePreview?: string | null;
  lastMessageAtMs?: number;
  unreadCount: number;
  private: boolean;
  avatarUrl?: string | null;
}

export interface Contact {
  did: AgentDID;
  displayName: string;
  avatarUrl?: string;
  notes?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface CreateContactInput {
  did: AgentDID;
  displayName: string;
  avatarUrl?: string;
  notes?: string;
}

export interface UpdateContactInput {
  displayName?: string;
  avatarUrl?: string;
  notes?: string;
}

export interface CreateConversationInput {
  conversationId: string;
  conversationType: ConversationType;
  peerDid?: AgentDID;
  groupId?: GroupID;
  displayName: string;
}

// ── Profile & Identity Card ───────────────────────────────────────────────────

/**
 * This node's own displayable profile: nickname and optional avatar.
 * Stored locally and exposed via GET /api/v1/profile (public, no auth).
 */
export interface SelfProfile {
  nickname?: string;
  avatarUrl?: string;
  nodeUrl?: string;
}

/**
 * A remote peer's profile as cached by the local node.
 * Populated when the peer sends a telagent/profile-card P2P message.
 */
export interface PeerProfile {
  did: AgentDID;
  nickname?: string;
  avatarUrl?: string;
  nodeUrl?: string;
  receivedAtMs: number;
}

/**
 * Payload carried in a telagent/profile-card P2P message.
 * Sent by the node when a new direct conversation is created.
 */
export interface ProfileCardPayload {
  did: AgentDID;
  nickname?: string;
  avatarUrl?: string;
  nodeUrl?: string;
}

// ── API Proxy (DID-based Remote Access) ───────────────────────────────────────

/**
 * An API request proxied through ClawNet P2P.
 * Gateway node sends this to the target node via topic 'telagent/api-proxy'.
 */
export interface ApiProxyRequest {
  /** UUID for correlating request with response. */
  requestId: string;
  /** HTTP method: GET, POST, PUT, DELETE. */
  method: string;
  /** Request path including query string, e.g. '/api/v1/conversations?limit=20'. */
  path: string;
  /** HTTP headers to forward (including Authorization). */
  headers: Record<string, string>;
  /** Request body as string (JSON-serialized). Absent for GET/DELETE. */
  body?: string;
}

/**
 * Response to an API proxy request.
 * Target node sends this back to the gateway via topic 'telagent/api-proxy-response'.
 *
 * Wire format (binary): [4-byte BE header length][JSON header][raw body bytes]
 * JSON header = { requestId, status, headers }
 * Body is raw bytes (may be text or binary, determined by content-type header).
 */
export interface ApiProxyResponse {
  /** Must match the requestId from the corresponding ApiProxyRequest. */
  requestId: string;
  /** HTTP status code (200, 401, 404, 500, etc.). */
  status: number;
  /** Response headers. */
  headers: Record<string, string>;
  /** Response body as raw bytes. */
  bodyBytes?: Uint8Array;
}

// ── Event Push (Real-time SSE) ────────────────────────────────────────────────

/**
 * An event notification pushed to Webapp via SSE.
 * Used for both local (direct) and gateway (delegated) connections.
 */
export interface EventNotification {
  type: 'new-envelope' | 'receipt' | 'retraction' | 'conversation-update' | 'profile-update';
  conversationId?: string;
  envelopeId?: string;
  sourceDid?: string;
  atMs: number;
}

/**
 * Request from gateway to target to establish event subscription.
 * Sent via API Proxy: POST /api/v1/events/subscribe
 */
export interface EventSubscribeRequest {
  gatewayDid: string;
  topics: string[];
  expiresInSec: number;
  metadataOnly?: boolean;
}

/**
 * Response from target node with delegation info.
 */
export interface EventSubscribeResponse {
  delegationId: string;
  expiresAtMs: number;
}

/**
 * Request from gateway to revoke a delegation.
 * Sent via API Proxy: POST /api/v1/events/unsubscribe
 */
export interface EventUnsubscribeRequest {
  delegationId: string;
}
