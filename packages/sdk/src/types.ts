/**
 * Shared type definitions for the ClawToken SDK.
 *
 * All types mirror the OpenAPI schema defined in docs/api/openapi.yaml.
 */

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export interface Pagination {
  offset: number;
  limit: number;
  total: number;
}

export interface PaginatedList<T> {
  items: T[];
  total: number;
  pagination?: Pagination;
  hasMore?: boolean;
}

/** Base event fields shared by most write endpoints. */
export interface EventFields {
  /** Issuer DID (used for signing). */
  did: string;
  /** Local key passphrase. */
  passphrase: string;
  /** Monotonically-increasing nonce for the issuer. */
  nonce: number;
  /** Previous event hash (optional). */
  prev?: string;
  /** Event timestamp in milliseconds (optional, defaults to now). */
  ts?: number;
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export interface NodeStatus {
  did: string;
  synced: boolean;
  blockHeight: number;
  peers: number;
  network: string;
  version: string;
  uptime: number;
}

export interface PeerInfo {
  peerId: string;
  multiaddrs: string[];
  latency?: number;
  connectedAt?: number;
}

export interface NodePeersResponse {
  peers: PeerInfo[];
  total: number;
  pagination?: Pagination;
}

export interface NodeConfig {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface Identity {
  did: string;
  publicKey: string;
  created: number;
  updated: number;
  [key: string]: unknown;
}

export interface Capability {
  id?: string;
  type: string;
  name: string;
  description?: string;
  version?: string;
  [key: string]: unknown;
}

export interface CapabilityCredential {
  type: string;
  name: string;
  description?: string;
  version?: string;
  [key: string]: unknown;
}

export interface RegisterCapabilityParams extends EventFields {
  credential: CapabilityCredential;
}

export interface CapabilitiesResponse {
  capabilities: Capability[];
  pagination?: Pagination;
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export interface Balance {
  balance: number;
  available: number;
  pending: number;
  locked: number;
}

export interface TransferParams extends EventFields {
  /** Recipient DID or claw address. */
  to: string;
  /** Amount in Token (integer). */
  amount: number;
  /** Fee in Token (integer, optional). */
  fee?: number;
  /** Memo (max 256 chars). */
  memo?: string;
}

export interface TransferResult {
  txHash: string;
  from: string;
  to: string;
  amount: number;
  fee?: number;
  status: string;
  timestamp: number;
}

export interface Transaction {
  txHash: string;
  from: string;
  to: string;
  amount: number;
  fee?: number;
  memo?: string;
  type: string;
  status: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface TransactionHistoryResponse {
  transactions: Transaction[];
  total: number;
  hasMore: boolean;
  pagination?: Pagination;
}

export interface ReleaseRule {
  [key: string]: unknown;
}

export interface CreateEscrowParams extends EventFields {
  escrowId?: string;
  /** Beneficiary DID or claw address. */
  beneficiary: string;
  amount: number;
  releaseRules: ReleaseRule[];
  resourcePrev?: string | null;
  arbiter?: string;
  refundRules?: ReleaseRule[];
  expiresAt?: number;
  autoFund?: boolean;
}

export interface Escrow {
  id: string;
  depositor: string;
  beneficiary: string;
  amount: number;
  funded: number;
  released: number;
  status: string;
  releaseRules: ReleaseRule[];
  refundRules?: ReleaseRule[];
  arbiter?: string;
  expiresAt?: number;
  createdAt: number;
  [key: string]: unknown;
}

export interface EscrowActionParams extends EventFields {
  amount: number;
  resourcePrev: string;
  ruleId?: string;
  reason?: string;
  evidence?: Record<string, unknown>[];
}

export interface EscrowExpireParams extends EventFields {
  action?: 'refund' | 'release';
  ruleId?: string;
  reason?: string;
  evidence?: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Markets — Common
// ---------------------------------------------------------------------------

export type MarketType = 'info' | 'task' | 'capability';
export type ListingStatus = 'draft' | 'active' | 'paused' | 'sold_out' | 'expired' | 'removed';

export interface Pricing {
  model: string;
  basePrice: number;
  currency?: string;
  [key: string]: unknown;
}

export interface SearchParams {
  q?: string;
  type?: MarketType;
  minPrice?: number;
  maxPrice?: number;
  tags?: string;
  status?: ListingStatus;
  seller?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  listings: MarketListing[];
  total: number;
  facets?: Record<string, unknown>;
  pagination?: Pagination;
}

export interface MarketListing {
  id: string;
  type: MarketType;
  seller: string;
  title: string;
  description?: string;
  tags?: string[];
  pricing?: Pricing;
  status: ListingStatus;
  createdAt: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface OrderReview {
  rating: number;
  comment?: string;
  aspects?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Markets — Info
// ---------------------------------------------------------------------------

export interface InfoPublishParams extends EventFields {
  title: string;
  description?: string;
  infoType: string;
  contentFormat: string;
  content?: string;
  tags?: string[];
  pricing: Pricing;
  accessMethod?: { type: string; [key: string]: unknown };
  preview?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: number;
  status?: ListingStatus;
}

export interface InfoPublishResponse {
  listingId: string;
  txHash: string;
}

export interface InfoPurchaseParams extends EventFields {
  orderId?: string;
  resourcePrev?: string | null;
}

export interface InfoPurchaseResponse {
  orderId: string;
  txHash: string;
}

export interface InfoDeliverParams extends EventFields {
  orderId: string;
  deliveryData?: Record<string, unknown>;
  resourcePrev?: string;
}

export interface InfoDeliverResponse {
  txHash: string;
}

export interface InfoConfirmParams extends EventFields {
  orderId: string;
  resourcePrev?: string;
}

export interface InfoConfirmResponse {
  txHash: string;
}

export interface InfoReviewParams extends EventFields {
  orderId: string;
  rating: number;
  comment?: string;
  aspects?: Record<string, number>;
  resourcePrev?: string;
}

export interface InfoReviewResponse {
  txHash: string;
}

// ---------------------------------------------------------------------------
// Markets — Task
// ---------------------------------------------------------------------------

export interface TaskPublishParams extends EventFields {
  title: string;
  description?: string;
  taskType: string;
  tags?: string[];
  pricing: Pricing;
  deadline?: number;
  requirements?: Record<string, unknown>;
  deliverables?: string[];
  bidding?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expiresAt?: number;
  status?: ListingStatus;
}

export interface TaskPublishResponse {
  listingId: string;
  txHash: string;
}

export interface TaskBidParams extends EventFields {
  bidId?: string;
  amount: number;
  message?: string;
  timeline?: number;
  proposal?: Record<string, unknown>;
  resourcePrev?: string | null;
}

export interface TaskBidResponse {
  bidId: string;
  txHash: string;
}

export interface TaskAcceptBidParams extends EventFields {
  bidId: string;
  resourcePrev?: string;
}

export interface TaskDeliverParams extends EventFields {
  submission: Record<string, unknown>;
  message?: string;
  resourcePrev?: string;
}

export interface TaskConfirmParams extends EventFields {
  resourcePrev?: string;
}

export interface TaskReviewParams extends EventFields {
  rating: number;
  comment?: string;
  aspects?: Record<string, number>;
  resourcePrev?: string;
}

// ---------------------------------------------------------------------------
// Markets — Capability
// ---------------------------------------------------------------------------

export interface CapabilityPublishParams extends EventFields {
  title: string;
  description?: string;
  capabilityType: string;
  interfaceType?: string;
  endpoint?: string;
  tags?: string[];
  pricing: Pricing;
  sla?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expiresAt?: number;
  status?: ListingStatus;
}

export interface CapabilityPublishResponse {
  listingId: string;
  txHash: string;
}

export interface CapabilityLeasePlan {
  type: 'pay_per_use' | 'time_based' | 'subscription' | 'credits';
  details?: Record<string, unknown>;
}

export interface CapabilityLeaseParams extends EventFields {
  leaseId?: string;
  plan: CapabilityLeasePlan;
  credentials?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expiresAt?: number;
  resourcePrev?: string | null;
}

export interface CapabilityLeaseResponse {
  leaseId: string;
  txHash: string;
  credentials?: Record<string, unknown>;
}

export interface CapabilityLease {
  id: string;
  listingId: string;
  lessee: string;
  lessor: string;
  plan: CapabilityLeasePlan;
  credentials?: Record<string, unknown>;
  status: string;
  startedAt: number;
  updatedAt?: number;
  expiresAt?: number;
  lastUsedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface CapabilityUsageRecord {
  id: string;
  leaseId: string;
  resource: string;
  units?: number;
  latency?: number;
  success: boolean;
  cost?: string;
  timestamp: number;
}

export interface CapabilityUsageStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalUnits: number;
  averageLatency: number;
  p95Latency: number;
  totalCost: string;
}

export interface CapabilityLeaseDetail {
  lease: CapabilityLease;
  usage: CapabilityUsageRecord[];
  stats: CapabilityUsageStats;
}

export interface CapabilityInvokeParams extends EventFields {
  resource: string;
  units?: number;
  latency: number;
  success: boolean;
  cost?: number | string;
}

export interface CapabilityInvokeResponse {
  leaseId: string;
  txHash: string;
  usage: CapabilityUsageRecord;
}

export interface CapabilityLeaseActionParams extends EventFields {}

export interface CapabilityLeaseActionResponse {
  leaseId: string;
  txHash: string;
  action: string;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export type ContractStatus =
  | 'draft'
  | 'pending_signature'
  | 'pending_funding'
  | 'active'
  | 'completed'
  | 'disputed'
  | 'cancelled';

export interface ContractTerms {
  title: string;
  description?: string;
  deliverables?: string[];
  deadline?: number;
  revisions?: number;
  confidentiality?: boolean;
  ipOwnership?: 'client' | 'provider' | 'shared';
}

export interface PaymentTerms {
  type: 'fixed' | 'hourly' | 'milestone';
  totalAmount: number;
  currency?: string;
  escrowRequired?: boolean;
  paymentSchedule?: { milestoneId: string; amount: number; percentage?: number }[];
}

export interface ContractMilestone {
  id: string;
  title: string;
  description?: string;
  amount?: number;
  percentage?: number;
  deadline?: number;
  status: string;
  deliverables?: string[];
  submittedAt?: number;
  approvedAt?: number;
}

export interface ContractSignature {
  signer: string;
  signature: string;
  signedAt: number;
}

export interface Contract {
  id: string;
  client: string;
  provider: string;
  status: ContractStatus;
  terms: ContractTerms;
  payment: PaymentTerms;
  milestones: ContractMilestone[];
  escrowId?: string;
  signatures: ContractSignature[];
  createdAt: number;
  signedAt?: number;
  completedAt?: number;
  [key: string]: unknown;
}

export interface CreateContractParams extends EventFields {
  provider: string;
  terms: ContractTerms;
  payment: PaymentTerms;
  milestones?: Omit<ContractMilestone, 'status' | 'submittedAt' | 'approvedAt'>[];
  arbiter?: string;
}

export interface CreateContractResponse {
  contractId: string;
  txHash: string;
}

export interface ContractActionParams extends EventFields {
  resourcePrev?: string;
}

export interface ContractFundParams extends EventFields {
  amount: number;
  resourcePrev?: string;
}

export interface MilestoneSubmitParams extends EventFields {
  deliverables?: string[];
  message?: string;
  resourcePrev?: string;
}

export interface MilestoneApproveParams extends EventFields {
  resourcePrev?: string;
}

export interface MilestoneRejectParams extends EventFields {
  reason?: string;
  resourcePrev?: string;
}

export interface ContractDisputeParams extends EventFields {
  reason: string;
  description?: string;
  evidence?: string[];
  resourcePrev?: string;
}

export interface ContractDisputeResolveParams extends EventFields {
  decision: string;
  clientRefund?: number;
  providerPayment?: number;
  resourcePrev?: string;
}

export interface ContractSettlementParams extends EventFields {
  resourcePrev?: string;
}

// ---------------------------------------------------------------------------
// Reputation
// ---------------------------------------------------------------------------

export interface ReputationDimensions {
  transaction?: number;
  delivery?: number;
  quality?: number;
  social?: number;
  behavior?: number;
}

export interface Reputation {
  did: string;
  score: number;
  level: string;
  levelNumber: number;
  dimensions: ReputationDimensions;
  totalTransactions: number;
  successRate: number;
  averageRating: number;
  badges?: string[];
  updatedAt?: number;
}

export interface Review {
  id: string;
  contractId?: string;
  reviewer: string;
  reviewee: string;
  rating: number;
  comment?: string;
  aspects?: Record<string, number>;
  createdAt: number;
}

export interface ReviewsResponse {
  reviews: Review[];
  total: number;
  averageRating: number;
  pagination?: Pagination;
}

export interface RecordReputationParams extends EventFields {
  target: string;
  dimension: 'transaction' | 'fulfillment' | 'quality' | 'social' | 'behavior';
  score: number;
  ref: string;
  comment?: string;
  aspects?: Record<string, number>;
}

export interface ReputationRecordResult {
  txHash: string;
  status: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Markets — Dispute (shared)
// ---------------------------------------------------------------------------

export interface MarketDisputeOpenParams extends EventFields {
  orderId: string;
  reason: string;
  description?: string;
  evidence?: string[];
  resourcePrev?: string;
}

export interface MarketDisputeRespondParams extends EventFields {
  response: string;
  evidence?: string[];
  resourcePrev?: string;
}

export interface MarketDisputeResolveParams extends EventFields {
  decision: string;
  buyerRefund?: number;
  sellerPayment?: number;
  resourcePrev?: string;
}

// ---------------------------------------------------------------------------
// DAO Governance
// ---------------------------------------------------------------------------

export type DaoProposalType =
  | 'parameter_change'
  | 'treasury_spend'
  | 'protocol_upgrade'
  | 'emergency'
  | 'signal';

export type DaoProposalStatus =
  | 'draft'
  | 'discussion'
  | 'voting'
  | 'passed'
  | 'rejected'
  | 'queued'
  | 'executed'
  | 'expired'
  | 'vetoed';

export type DaoVoteOption = 'for' | 'against' | 'abstain';

export interface DaoProposalAction {
  type: string;
  [key: string]: unknown;
}

export interface DaoProposalTimeline {
  createdAt: number;
  discussionEndsAt: number;
  votingStartsAt: number;
  votingEndsAt: number;
  executionDelay: number;
  expiresAt: number;
}

export interface DaoProposalVotes {
  for: string;
  against: string;
  abstain: string;
}

export interface DaoProposal {
  id: string;
  proposer: string;
  type: DaoProposalType;
  title: string;
  description: string;
  discussionUrl?: string;
  actions: DaoProposalAction[];
  timeline: DaoProposalTimeline;
  votes: DaoProposalVotes;
  status: DaoProposalStatus;
  resourcePrev?: string | null;
}

export interface DaoVote {
  voter: string;
  proposalId: string;
  option: DaoVoteOption;
  power: string;
  reason?: string;
  ts: number;
  hash: string;
}

export interface DaoDelegationScope {
  proposalTypes?: DaoProposalType[];
  topics?: string[];
  all?: boolean;
}

export interface DaoDelegation {
  delegator: string;
  delegate: string;
  scope: DaoDelegationScope;
  percentage: number;
  expiresAt?: number;
  revokedAt?: number;
  createdAt: number;
}

export interface DaoTreasuryAllocationPolicy {
  development: number;
  nodeRewards: number;
  ecosystem: number;
  reserve: number;
}

export interface DaoTreasurySpendingLimits {
  perProposal: string;
  perQuarter: string;
  requireMultisig: string;
}

export interface DaoTreasury {
  balance: string;
  allocationPolicy: DaoTreasuryAllocationPolicy;
  spendingLimits: DaoTreasurySpendingLimits;
  totalSpent: string;
  spentThisQuarter: string;
  quarterStart: number;
}

export interface DaoTimelockEntry {
  actionId: string;
  proposalId: string;
  action: DaoProposalAction;
  queuedAt: number;
  executeAfter: number;
  status: 'queued' | 'executed' | 'cancelled';
}

export interface DaoProposalThreshold {
  createThreshold: number;
  passThreshold: number;
  quorum: number;
  discussionPeriod: number;
  votingPeriod: number;
  timelockDelay: number;
}

// ---- DAO Request Params ----

export interface DaoCreateProposalParams extends EventFields {
  proposalId?: string;
  type: DaoProposalType;
  title: string;
  description: string;
  discussionUrl?: string;
  actions: DaoProposalAction[];
  discussionPeriod?: number;
  votingPeriod?: number;
  timelockDelay?: number;
}

export interface DaoAdvanceProposalParams extends EventFields {
  proposalId: string;
  newStatus: string;
  resourcePrev: string;
}

export interface DaoVoteCastParams extends EventFields {
  proposalId: string;
  option: DaoVoteOption;
  power: string | number;
  reason?: string;
}

export interface DaoDelegateSetParams extends EventFields {
  delegate: string;
  scope?: DaoDelegationScope;
  percentage?: number;
  expiresAt?: number;
}

export interface DaoDelegateRevokeParams extends EventFields {
  delegate: string;
}

export interface DaoTreasuryDepositParams extends EventFields {
  amount: string | number;
  source: string;
}

export interface DaoTimelockActionParams extends EventFields {
  actionId: string;
}

export interface DaoTimelockCancelParams extends EventFields {
  actionId: string;
  reason: string;
}

// ---- DAO Response Types ----

export interface DaoProposalListResponse {
  proposals: DaoProposal[];
}

export interface DaoProposalResponse {
  proposal: DaoProposal;
}

export interface DaoVotesResponse {
  proposalId: string;
  votes: DaoVote[];
}

export interface DaoDelegationsResponse {
  did: string;
  delegatedFrom: DaoDelegation[];
  delegatedTo: DaoDelegation[];
}

export interface DaoTreasuryResponse {
  treasury: DaoTreasury;
}

export interface DaoTimelockListResponse {
  entries: DaoTimelockEntry[];
}

export interface DaoParamsResponse {
  thresholds: Record<DaoProposalType, DaoProposalThreshold>;
}

export interface DaoTxResult {
  txHash: string;
  status: string;
  [key: string]: unknown;
}
