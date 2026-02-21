import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { z } from 'zod';
import {
  addressFromDid,
  base64ToBytes,
  bytesToHex,
  bytesToUtf8,
  didFromPublicKey,
  decryptKeyRecord,
  EventEnvelope,
  EventStore,
  eventHashHex,
  hexToBytes,
  keyIdFromPublicKey,
  listKeyRecords,
  loadKeyRecord,
  multibaseDecode,
  publicKeyFromDid,
  resolveStoragePaths,
  utf8ToBytes,
  verifyCapabilityCredential,
} from '@claw-network/core';
import {
  applyContractEvent,
  applyMarketEvent,
  applyWalletEvent,
  applyReputationEvent,
  CapabilityCredential,
  ContractParties,
  ContractStore,
  buildReputationProfile,
  createContractActivateEnvelope,
  createContractCreateEnvelope,
  createContractDisputeOpenEnvelope,
  createContractDisputeResolveEnvelope,
  createContractMilestoneApproveEnvelope,
  createContractMilestoneRejectEnvelope,
  createContractMilestoneSubmitEnvelope,
  createContractSignEnvelope,
  createContractCompleteEnvelope,
  createContractSettlementExecuteEnvelope,
  createCapabilityListingPublishEnvelope,
  createIdentityCapabilityRegisterEnvelope,
  createMarketBidAcceptEnvelope,
  createMarketBidRejectEnvelope,
  createMarketBidSubmitEnvelope,
  createMarketBidWithdrawEnvelope,
  createMarketCapabilityInvokeEnvelope,
  createMarketCapabilityLeasePauseEnvelope,
  createMarketCapabilityLeaseResumeEnvelope,
  createMarketCapabilityLeaseStartEnvelope,
  createMarketCapabilityLeaseTerminateEnvelope,
  createMarketDisputeOpenEnvelope,
  createMarketDisputeResponseEnvelope,
  createMarketDisputeResolveEnvelope,
  createMarketListingRemoveEnvelope,
  createMarketOrderCreateEnvelope,
  createMarketOrderUpdateEnvelope,
  createMarketSubscriptionCancelEnvelope,
  createMarketSubscriptionStartEnvelope,
  createInfoEscrowCreateEnvelope,
  createInfoEscrowFundEnvelope,
  createInfoEscrowReleaseEnvelope,
  createInfoListingPublishEnvelope,
  createInfoOrderCompletionEnvelope,
  createInfoOrderCreateEnvelope,
  createInfoOrderDeliveryEnvelope,
  createInfoOrderPaymentEscrowedEnvelope,
  createInfoOrderReviewEnvelope,
  createReputationRecordEnvelope,
  createReputationState,
  createContractState,
  createMarketState,
  createWalletEscrowCreateEnvelope,
  createWalletEscrowFundEnvelope,
  createWalletEscrowRefundEnvelope,
  createWalletEscrowReleaseEnvelope,
  createWalletTransferEnvelope,
  createWalletMintEnvelope,
  createWalletState,
  generateInfoContentKey,
  getWalletBalance,
  getReputationRecords,
  InfoContentStore,
  isAccessMethodType,
  isCapabilityType,
  isContentFormat,
  isInfoType,
  isListingStatus,
  isListingVisibility,
  isMarketType,
  isTaskType,
  MarketListing,
  MarketSearchStore,
  OrderReview,
  ReputationDimension,
  ReputationAspectKey,
  ReputationLevel,
  ReputationRecord,
  ReputationStore,
  ReputationState,
  SearchQuery,
  SearchResult,
  ServiceContract,
  WalletState,
  createMarketSubmissionReviewEnvelope,
  createMarketSubmissionSubmitEnvelope,
  createTaskListingPublishEnvelope,
  prepareInfoDeliveryRecord,
  DaoStore,
  createDaoProposalCreateEnvelope,
  createDaoProposalAdvanceEnvelope,
  createDaoVoteCastEnvelope,
  createDaoDelegateSetEnvelope,
  createDaoDelegateRevokeEnvelope,
  createDaoTimelockExecuteEnvelope,
  createDaoTimelockCancelEnvelope,
  createDaoTreasuryDepositEnvelope,
  PROPOSAL_THRESHOLDS,
} from '@claw-network/protocol';

const MAX_BODY_BYTES = 1_000_000;

const AmountSchema = z.union([z.number(), z.string()]);
const RatingSchema = z.union([z.number(), z.string()]);

const CapabilityRegisterSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    credential: z.unknown(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const WalletTransferSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    to: z.string().min(1),
    amount: AmountSchema,
    fee: AmountSchema.optional(),
    memo: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const WalletEscrowCreateSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    escrowId: z.string().optional(),
    beneficiary: z.string().min(1),
    amount: AmountSchema,
    releaseRules: z.array(z.record(z.unknown())).min(1),
    resourcePrev: z.union([z.string(), z.null()]).optional(),
    arbiter: z.string().optional(),
    refundRules: z.array(z.record(z.unknown())).optional(),
    expiresAt: z.number().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
    autoFund: z.boolean().optional(),
  })
  .passthrough();

const WalletEscrowActionSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    amount: AmountSchema,
    resourcePrev: z.string().min(1),
    ruleId: z.string().optional(),
    reason: z.string().optional(),
    evidence: z.array(z.record(z.unknown())).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const WalletEscrowExpireSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    action: z.enum(['refund', 'release']).optional(),
    ruleId: z.string().optional(),
    reason: z.string().optional(),
    evidence: z.array(z.record(z.unknown())).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ReputationRecordSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    target: z.string().min(1),
    dimension: z.string().min(1),
    score: z.union([z.number(), z.string()]),
    ref: z.string().min(1),
    comment: z.string().optional(),
    aspects: z.record(z.union([z.number(), z.string()])).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const WalletQuerySchema = z
  .object({
    did: z.string().min(1).optional(),
    address: z.string().min(1).optional(),
  })
  .refine((data) => data.did || data.address, { message: 'missing address' });

export interface ApiServerConfig {
  host: string;
  port: number;
  dataDir?: string;
}

export interface CapabilityRegisterRequest {
  did: string;
  passphrase: string;
  credential: CapabilityCredential;
  nonce: number;
  prev?: string;
  ts?: number;
}

export interface WalletTransferRequest {
  did: string;
  passphrase: string;
  to: string;
  amount: string | number;
  fee?: string | number;
  memo?: string;
  nonce: number;
  prev?: string;
  ts?: number;
}

export interface WalletBalanceQuery {
  did?: string;
  address?: string;
}

export interface WalletHistoryQuery extends WalletBalanceQuery {
  limit?: string;
  offset?: string;
  type?: string;
}

export interface WalletEscrowCreateRequest {
  did: string;
  passphrase: string;
  escrowId?: string;
  beneficiary: string;
  amount: string | number;
  releaseRules: Record<string, unknown>[];
  resourcePrev?: string | null;
  arbiter?: string;
  refundRules?: Record<string, unknown>[];
  expiresAt?: number;
  nonce: number;
  prev?: string;
  ts?: number;
  autoFund?: boolean;
}

export interface WalletEscrowActionRequest {
  did: string;
  passphrase: string;
  amount: string | number;
  resourcePrev: string;
  ruleId?: string;
  reason?: string;
  evidence?: Record<string, unknown>[];
  nonce: number;
  prev?: string;
  ts?: number;
}

export interface WalletEscrowExpireRequest {
  did: string;
  passphrase: string;
  action?: 'refund' | 'release';
  ruleId?: string;
  reason?: string;
  evidence?: Record<string, unknown>[];
  nonce: number;
  prev?: string;
  ts?: number;
}

export interface ReputationRecordRequest {
  did: string;
  passphrase: string;
  target: string;
  dimension: string;
  score: number | string;
  ref: string;
  comment?: string;
  aspects?: Record<ReputationAspectKey, number>;
  nonce: number;
  prev?: string;
  ts?: number;
}

const InfoPublishSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    listingId: z.string().optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    category: z.string().min(1),
    tags: z.array(z.string()).optional(),
    pricing: z.record(z.unknown()),
    visibility: z.string().optional(),
    infoType: z.string().min(1),
    content: z.record(z.unknown()),
    accessMethod: z.record(z.unknown()),
    license: z.record(z.unknown()),
    quality: z.record(z.unknown()).optional(),
    usageRestrictions: z.record(z.unknown()).optional(),
    restrictions: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    expiresAt: z.number().optional(),
    status: z.string().optional(),
    contentKeyHex: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const InfoPurchaseSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    orderId: z.string().optional(),
    escrowId: z.string().optional(),
    quantity: z.number().int().positive().optional(),
    unitPrice: AmountSchema.optional(),
    releaseRules: z.array(z.record(z.unknown())).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const InfoDeliverSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    orderId: z.string().min(1),
    deliveryId: z.string().optional(),
    contentKeyHex: z.string().optional(),
    buyerPublicKeyHex: z.string().optional(),
    accessToken: z.string().optional(),
    accessUrl: z.string().optional(),
    expiresAt: z.number().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const InfoConfirmSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    orderId: z.string().min(1),
    escrowId: z.string().optional(),
    ruleId: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const InfoReviewSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    orderId: z.string().min(1),
    rating: RatingSchema,
    comment: z.string().optional(),
    detailedRatings: z.record(RatingSchema).optional(),
    by: z.enum(['buyer', 'seller']).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ListingRemoveSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const InfoSubscriptionSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    subscriptionId: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const InfoSubscriptionCancelSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const TaskPublishSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    listingId: z.string().optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    category: z.string().min(1),
    tags: z.array(z.string()).optional(),
    pricing: z.record(z.unknown()),
    visibility: z.string().optional(),
    taskType: z.string().min(1),
    task: z.record(z.unknown()),
    timeline: z.record(z.unknown()),
    workerRequirements: z.record(z.unknown()).optional(),
    bidding: z.record(z.unknown()).optional(),
    milestones: z.array(z.record(z.unknown())).optional(),
    restrictions: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    expiresAt: z.number().optional(),
    status: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const TaskBidSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    bidId: z.string().optional(),
    price: AmountSchema,
    timeline: z.number(),
    approach: z.string().min(1),
    milestones: z.array(z.record(z.unknown())).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const TaskBidActionSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    bidId: z.string().min(1),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const TaskAcceptSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    bidId: z.string().min(1),
    orderId: z.string().optional(),
    escrowId: z.string().optional(),
    releaseRules: z.array(z.record(z.unknown())).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const TaskDeliverSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    orderId: z.string().min(1),
    submissionId: z.string().optional(),
    deliverables: z.array(z.record(z.unknown())),
    notes: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const TaskConfirmSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    orderId: z.string().min(1),
    submissionId: z.string().min(1),
    approved: z.boolean(),
    feedback: z.string().min(1),
    rating: RatingSchema.optional(),
    revisionDeadline: z.number().optional(),
    escrowId: z.string().optional(),
    ruleId: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const TaskReviewSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    orderId: z.string().min(1),
    rating: RatingSchema,
    comment: z.string().optional(),
    detailedRatings: z.record(RatingSchema).optional(),
    by: z.enum(['buyer', 'seller']).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const DisputeOpenSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    disputeId: z.string().optional(),
    type: z.string().min(1),
    description: z.string().min(1),
    claimAmount: AmountSchema.optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const DisputeResponseSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    response: z.string().min(1),
    evidence: z.array(z.record(z.unknown())).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const DisputeResolveSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    resolution: z.string().min(1),
    notes: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ContractCreateSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    contractId: z.string().optional(),
    provider: z.string().min(1),
    parties: z.record(z.unknown()).optional(),
    service: z.record(z.unknown()).optional(),
    terms: z.record(z.unknown()),
    payment: z.record(z.unknown()).optional(),
    timeline: z.record(z.unknown()).optional(),
    milestones: z.array(z.record(z.unknown())).optional(),
    attachments: z.array(z.record(z.unknown())).optional(),
    metadata: z.record(z.unknown()).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ContractSignSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ContractFundSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    escrowId: z.string().optional(),
    amount: AmountSchema,
    releaseRules: z.array(z.record(z.unknown())).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ContractMilestoneSubmitSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    submissionId: z.string().optional(),
    deliverables: z.array(z.record(z.unknown())).optional(),
    notes: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ContractMilestoneReviewSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    notes: z.string().optional(),
    rating: RatingSchema.optional(),
    feedback: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ContractCompleteSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ContractDisputeSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    reason: z.string().min(1),
    description: z.string().optional(),
    evidence: z.array(z.record(z.unknown())).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ContractDisputeResolveSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    resolution: z.string().min(1),
    notes: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const ContractSettlementSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    settlement: z.record(z.unknown()),
    notes: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const CapabilityPublishSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    listingId: z.string().optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    category: z.string().min(1),
    tags: z.array(z.string()).optional(),
    pricing: z.record(z.unknown()),
    visibility: z.string().optional(),
    capabilityType: z.string().min(1),
    capability: z.record(z.unknown()),
    performance: z.record(z.unknown()).optional(),
    quota: z.record(z.unknown()),
    access: z.record(z.unknown()),
    sla: z.record(z.unknown()).optional(),
    restrictions: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    expiresAt: z.number().optional(),
    status: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const CapabilityLeaseSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    leaseId: z.string().optional(),
    plan: z.record(z.unknown()),
    credentials: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    expiresAt: z.number().optional(),
    resourcePrev: z.union([z.string(), z.null()]).optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const CapabilityLeaseActionSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const CapabilityInvokeSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    resource: z.string().min(1),
    units: z.number().int().positive().optional(),
    latency: z.number().nonnegative(),
    success: z.boolean(),
    cost: AmountSchema.optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

// DAO Governance Schemas
const DaoProposalCreateSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    proposalId: z.string().min(1).optional(),
    type: z.enum(['parameter_change', 'treasury_spend', 'protocol_upgrade', 'emergency', 'signal']),
    title: z.string().min(1),
    description: z.string().min(1),
    discussionUrl: z.string().optional(),
    actions: z.array(z.record(z.unknown())).min(1),
    discussionPeriod: z.number().nonnegative().optional(),
    votingPeriod: z.number().nonnegative().optional(),
    timelockDelay: z.number().nonnegative().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const DaoProposalAdvanceSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    proposalId: z.string().min(1),
    newStatus: z.string().min(1),
    resourcePrev: z.string().min(1),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const DaoVoteCastSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    proposalId: z.string().min(1),
    option: z.enum(['for', 'against', 'abstain']),
    power: AmountSchema,
    reason: z.string().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const DaoDelegateSetSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    delegate: z.string().min(1),
    scope: z
      .object({
        proposalTypes: z.array(z.string()).optional(),
        topics: z.array(z.string()).optional(),
        all: z.boolean().optional(),
      })
      .optional(),
    percentage: z.number().min(0).max(100).optional(),
    expiresAt: z.number().optional(),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const DaoDelegateRevokeSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    delegate: z.string().min(1),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const DaoTimelockExecuteSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    actionId: z.string().min(1),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const DaoTimelockCancelSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    actionId: z.string().min(1),
    reason: z.string().min(1),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

const DaoTreasuryDepositSchema = z
  .object({
    did: z.string().min(1),
    passphrase: z.string().min(1),
    amount: AmountSchema,
    source: z.string().min(1),
    nonce: z.number().int().positive(),
    prev: z.string().optional(),
    ts: z.number().optional(),
  })
  .passthrough();

export class ApiServer {
  private server?: Server;

  constructor(
    private readonly config: ApiServerConfig,
    private readonly runtime: {
      publishEvent: (envelope: Record<string, unknown>) => Promise<string>;
      eventStore?: EventStore;
      contractStore?: ContractStore;
      reputationStore?: ReputationStore;
      daoStore?: DaoStore;
      marketStore?: MarketSearchStore;
      infoContentStore?: InfoContentStore;
      searchMarkets?: (query: SearchQuery) => SearchResult;
      getNodeStatus?: () => Promise<Record<string, unknown>>;
      getNodePeers?: () => Promise<{ peers: Record<string, unknown>[]; total: number }>;
      getNodeConfig?: () => Promise<Record<string, unknown>>;
    },
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      return;
    }
    this.server = createServer((req, res) => {
      void this.route(req, res);
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(this.config.port, this.config.host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = req.url ? new URL(req.url, `http://${this.config.host}`) : null;
      const method = req.method ?? 'GET';

      if (method === 'GET' && url?.pathname === '/api/node/status') {
        await this.handleNodeStatus(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/node/peers') {
        await this.handleNodePeers(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/node/config') {
        await this.handleNodeConfig(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/identity') {
        await this.handleIdentitySelf(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/identity/capabilities') {
        await this.handleIdentityCapabilities(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname?.startsWith('/api/identity/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length === 3) {
          const did = decodeURIComponent(segments[2]);
          await this.handleIdentityResolve(req, res, did);
          return;
        }
      }

      if (method === 'POST' && url?.pathname === '/api/identity/capabilities') {
        await this.handleCapabilityRegister(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname?.startsWith('/api/reputation/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length === 3) {
          const did = decodeURIComponent(segments[2]);
          await this.handleReputationProfile(req, res, did, url);
          return;
        }
        if (segments.length === 4 && segments[3] === 'reviews') {
          const did = decodeURIComponent(segments[2]);
          await this.handleReputationReviews(req, res, did, url);
          return;
        }
      }

      if (method === 'POST' && url?.pathname === '/api/reputation/record') {
        await this.handleReputationRecord(req, res);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/wallet/balance') {
        await this.handleWalletBalance(req, res, url);
        return;
      }

      if (method === 'GET' && url?.pathname === '/api/wallet/history') {
        await this.handleWalletHistory(req, res, url);
        return;
      }

      if (method === 'POST' && url?.pathname === '/api/wallet/transfer') {
        await this.handleWalletTransfer(req, res);
        return;
      }

      if (method === 'POST' && url?.pathname === '/api/wallet/escrow') {
        await this.handleWalletEscrowCreate(req, res);
        return;
      }

      if (url?.pathname?.startsWith('/api/wallet/escrow/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        const escrowId = segments[3];
        const action = segments[4];
        if (segments.length === 4 && method === 'GET') {
          await this.handleWalletEscrowGet(req, res, escrowId);
          return;
        }
        if (segments.length === 5 && method === 'POST') {
          if (action === 'fund') {
            await this.handleWalletEscrowFund(req, res, escrowId);
            return;
          }
          if (action === 'release') {
            await this.handleWalletEscrowRelease(req, res, escrowId);
            return;
          }
          if (action === 'refund') {
            await this.handleWalletEscrowRefund(req, res, escrowId);
            return;
          }
          if (action === 'expire') {
            await this.handleWalletEscrowExpire(req, res, escrowId);
            return;
          }
        }
      }

      if (url?.pathname === '/api/contracts') {
        if (method === 'GET') {
          await this.handleContractsList(req, res, url);
          return;
        }
        if (method === 'POST') {
          await this.handleContractCreate(req, res);
          return;
        }
      }

      if (url?.pathname?.startsWith('/api/contracts/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        const contractId = decodeURIComponent(segments[2] ?? '');
        const action = segments[3];
        if (segments.length === 3 && method === 'GET') {
          await this.handleContractGet(req, res, contractId);
          return;
        }
        if (action === 'sign' && method === 'POST') {
          await this.handleContractSign(req, res, contractId);
          return;
        }
        if (action === 'fund' && method === 'POST') {
          await this.handleContractFund(req, res, contractId);
          return;
        }
        if (action === 'complete' && method === 'POST') {
          await this.handleContractComplete(req, res, contractId);
          return;
        }
        if (action === 'settlement' && method === 'POST') {
          await this.handleContractSettlementExecute(req, res, contractId);
          return;
        }
        if (action === 'dispute' && method === 'POST') {
          if (segments.length === 4) {
            await this.handleContractDisputeOpen(req, res, contractId);
            return;
          }
          if (segments.length === 5 && segments[4] === 'resolve') {
            await this.handleContractDisputeResolve(req, res, contractId);
            return;
          }
        }
        if (action === 'milestones' && segments.length >= 6) {
          const milestoneId = decodeURIComponent(segments[4] ?? '');
          const milestoneAction = segments[5];
          if (milestoneAction === 'complete' && method === 'POST') {
            await this.handleContractMilestoneSubmit(req, res, contractId, milestoneId);
            return;
          }
          if (milestoneAction === 'approve' && method === 'POST') {
            await this.handleContractMilestoneApprove(req, res, contractId, milestoneId);
            return;
          }
          if (milestoneAction === 'reject' && method === 'POST') {
            await this.handleContractMilestoneReject(req, res, contractId, milestoneId);
            return;
          }
        }
      }

      if (method === 'GET' && url?.pathname === '/api/markets/search') {
        await this.handleMarketSearch(req, res, url);
        return;
      }

      if (url?.pathname?.startsWith('/api/markets/orders/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length === 5 && segments[4] === 'dispute' && method === 'POST') {
          const orderId = decodeURIComponent(segments[3] ?? '');
          await this.handleMarketDisputeOpen(req, res, orderId);
          return;
        }
      }

      if (url?.pathname?.startsWith('/api/markets/disputes/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length === 5 && method === 'POST') {
          const disputeId = decodeURIComponent(segments[3] ?? '');
          const action = segments[4];
          if (action === 'respond') {
            await this.handleMarketDisputeResponse(req, res, disputeId);
            return;
          }
          if (action === 'resolve') {
            await this.handleMarketDisputeResolve(req, res, disputeId);
            return;
          }
        }
      }

      if (url?.pathname === '/api/markets/info') {
        if (method === 'GET') {
          await this.handleInfoMarketSearch(req, res, url);
          return;
        }
        if (method === 'POST') {
          await this.handleInfoMarketPublish(req, res);
          return;
        }
      }

      if (url?.pathname?.startsWith('/api/markets/info/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length >= 4 && segments[3] === 'orders' && segments.length === 6) {
          const orderId = decodeURIComponent(segments[4] ?? '');
          const action = segments[5];
          if (method === 'GET' && action === 'delivery') {
            await this.handleInfoMarketDelivery(req, res, orderId);
            return;
          }
        }

        if (segments.length >= 6 && segments[3] === 'subscriptions') {
          const subscriptionId = decodeURIComponent(segments[4] ?? '');
          const action = segments[5];
          if (action === 'cancel' && method === 'POST') {
            await this.handleInfoMarketSubscriptionCancel(req, res, subscriptionId);
            return;
          }
        }

        if (segments.length >= 4) {
          const listingId = decodeURIComponent(segments[3] ?? '');
          const action = segments[4];
          if (!action && method === 'GET') {
            await this.handleInfoMarketGet(req, res, listingId);
            return;
          }
          if (action === 'content' && method === 'GET') {
            await this.handleInfoMarketContent(req, res, listingId);
            return;
          }
          if (action === 'purchase' && method === 'POST') {
            await this.handleInfoMarketPurchase(req, res, listingId);
            return;
          }
          if (action === 'subscribe' && method === 'POST') {
            await this.handleInfoMarketSubscribe(req, res, listingId);
            return;
          }
          if (action === 'deliver' && method === 'POST') {
            await this.handleInfoMarketDeliver(req, res, listingId);
            return;
          }
          if (action === 'confirm' && method === 'POST') {
            await this.handleInfoMarketConfirm(req, res, listingId);
            return;
          }
          if (action === 'review' && method === 'POST') {
            await this.handleInfoMarketReview(req, res, listingId);
            return;
          }
          if (action === 'remove' && method === 'POST') {
            await this.handleInfoMarketRemove(req, res, listingId);
            return;
          }
        }
      }

      if (url?.pathname === '/api/markets/tasks') {
        if (method === 'GET') {
          await this.handleTaskMarketSearch(req, res, url);
          return;
        }
        if (method === 'POST') {
          await this.handleTaskMarketPublish(req, res);
          return;
        }
      }

      if (url?.pathname?.startsWith('/api/markets/tasks/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length >= 4) {
          const taskId = decodeURIComponent(segments[3] ?? '');
          const action = segments[4];
          if (!action && method === 'GET') {
            await this.handleTaskMarketGet(req, res, taskId);
            return;
          }
          if (action === 'bids') {
            if (method === 'GET') {
              await this.handleTaskMarketBids(req, res, taskId, url);
              return;
            }
            if (method === 'POST') {
              await this.handleTaskMarketBidSubmit(req, res, taskId);
              return;
            }
          }
          if (action === 'accept' && method === 'POST') {
            await this.handleTaskMarketAccept(req, res, taskId);
            return;
          }
          if (action === 'reject' && method === 'POST') {
            await this.handleTaskMarketReject(req, res, taskId);
            return;
          }
          if (action === 'withdraw' && method === 'POST') {
            await this.handleTaskMarketWithdraw(req, res, taskId);
            return;
          }
          if (action === 'deliver' && method === 'POST') {
            await this.handleTaskMarketDeliver(req, res, taskId);
            return;
          }
          if (action === 'confirm' && method === 'POST') {
            await this.handleTaskMarketConfirm(req, res, taskId);
            return;
          }
          if (action === 'review' && method === 'POST') {
            await this.handleTaskMarketReview(req, res, taskId);
            return;
          }
          if (action === 'remove' && method === 'POST') {
            await this.handleTaskMarketRemove(req, res, taskId);
            return;
          }
        }
      }

      if (url?.pathname === '/api/markets/capabilities') {
        if (method === 'GET') {
          await this.handleCapabilityMarketSearch(req, res, url);
          return;
        }
        if (method === 'POST') {
          await this.handleCapabilityMarketPublish(req, res);
          return;
        }
      }

      if (url?.pathname?.startsWith('/api/markets/capabilities/')) {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length >= 4) {
          if (segments[3] === 'leases') {
            const leaseId = decodeURIComponent(segments[4] ?? '');
            const action = segments[5];
            if (segments.length === 5 && method === 'GET') {
              await this.handleCapabilityMarketLeaseGet(req, res, leaseId);
              return;
            }
            if (action === 'invoke' && method === 'POST') {
              await this.handleCapabilityMarketInvoke(req, res, leaseId);
              return;
            }
            if (action === 'pause' && method === 'POST') {
              await this.handleCapabilityMarketLeasePause(req, res, leaseId);
              return;
            }
            if (action === 'resume' && method === 'POST') {
              await this.handleCapabilityMarketLeaseResume(req, res, leaseId);
              return;
            }
            if (action === 'terminate' && method === 'POST') {
              await this.handleCapabilityMarketLeaseTerminate(req, res, leaseId);
              return;
            }
          } else {
            const listingId = decodeURIComponent(segments[3] ?? '');
            const action = segments[4];
            if (!action && method === 'GET') {
              await this.handleCapabilityMarketGet(req, res, listingId);
              return;
            }
            if (action === 'lease' && method === 'POST') {
              await this.handleCapabilityMarketLease(req, res, listingId);
              return;
            }
            if (action === 'remove' && method === 'POST') {
              await this.handleCapabilityMarketRemove(req, res, listingId);
              return;
            }
          }
        }
      }

      // ── DAO Governance Routes ──────────────────────────────────────────
      if (url?.pathname?.startsWith('/api/dao')) {
        const segments = (url.pathname ?? '').split('/').filter(Boolean);
        // GET /api/dao/proposals
        if (segments.length === 3 && segments[2] === 'proposals' && method === 'GET') {
          await this.handleDaoListProposals(req, res, url);
          return;
        }
        // POST /api/dao/proposals
        if (segments.length === 3 && segments[2] === 'proposals' && method === 'POST') {
          await this.handleDaoCreateProposal(req, res);
          return;
        }
        // GET /api/dao/proposals/:id
        if (segments.length === 4 && segments[2] === 'proposals' && method === 'GET') {
          await this.handleDaoGetProposal(req, res, decodeURIComponent(segments[3]));
          return;
        }
        // POST /api/dao/proposals/:id/advance
        if (segments.length === 5 && segments[2] === 'proposals' && segments[4] === 'advance' && method === 'POST') {
          await this.handleDaoAdvanceProposal(req, res, decodeURIComponent(segments[3]));
          return;
        }
        // GET /api/dao/proposals/:id/votes
        if (segments.length === 5 && segments[2] === 'proposals' && segments[4] === 'votes' && method === 'GET') {
          await this.handleDaoGetVotes(req, res, decodeURIComponent(segments[3]));
          return;
        }
        // POST /api/dao/vote
        if (segments.length === 3 && segments[2] === 'vote' && method === 'POST') {
          await this.handleDaoVote(req, res);
          return;
        }
        // POST /api/dao/delegate
        if (segments.length === 3 && segments[2] === 'delegate' && method === 'POST') {
          await this.handleDaoDelegateSet(req, res);
          return;
        }
        // POST /api/dao/delegate/revoke
        if (segments.length === 4 && segments[2] === 'delegate' && segments[3] === 'revoke' && method === 'POST') {
          await this.handleDaoDelegateRevoke(req, res);
          return;
        }
        // GET /api/dao/delegations/:did
        if (segments.length === 4 && segments[2] === 'delegations' && method === 'GET') {
          await this.handleDaoGetDelegations(req, res, decodeURIComponent(segments[3]));
          return;
        }
        // GET /api/dao/treasury
        if (segments.length === 3 && segments[2] === 'treasury' && method === 'GET') {
          await this.handleDaoGetTreasury(req, res);
          return;
        }
        // POST /api/dao/treasury/deposit
        if (segments.length === 4 && segments[2] === 'treasury' && segments[3] === 'deposit' && method === 'POST') {
          await this.handleDaoTreasuryDeposit(req, res);
          return;
        }
        // GET /api/dao/timelock
        if (segments.length === 3 && segments[2] === 'timelock' && method === 'GET') {
          await this.handleDaoListTimelock(req, res);
          return;
        }
        // POST /api/dao/timelock/:id/execute
        if (segments.length === 5 && segments[2] === 'timelock' && segments[4] === 'execute' && method === 'POST') {
          await this.handleDaoTimelockExecute(req, res, decodeURIComponent(segments[3]));
          return;
        }
        // POST /api/dao/timelock/:id/cancel
        if (segments.length === 5 && segments[2] === 'timelock' && segments[4] === 'cancel' && method === 'POST') {
          await this.handleDaoTimelockCancel(req, res, decodeURIComponent(segments[3]));
          return;
        }
        // GET /api/dao/params
        if (segments.length === 3 && segments[2] === 'params' && method === 'GET') {
          await this.handleDaoGetParams(req, res);
          return;
        }
      }

      // ── Dev / Testnet Routes (development only) ────────────────────────
      if (process.env.NODE_ENV === 'development') {
        if (method === 'POST' && url?.pathname === '/api/dev/faucet') {
          await this.handleDevFaucet(req, res);
          return;
        }
      }

      sendError(res, 404, 'NOT_FOUND', 'route not found');
    } catch {
      if (!res.headersSent) {
        sendError(res, 500, 'INTERNAL_ERROR', 'unexpected error');
      }
    }
  }

  private async handleNodeStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.runtime.getNodeStatus) {
      sendError(res, 500, 'INTERNAL_ERROR', 'node status unavailable');
      return;
    }
    try {
      const status = await this.runtime.getNodeStatus();
      sendJson(res, 200, status);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'failed to read node status');
    }
  }

  private async handleNodePeers(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.runtime.getNodePeers) {
      sendError(res, 500, 'INTERNAL_ERROR', 'node peers unavailable');
      return;
    }
    try {
      const peers = await this.runtime.getNodePeers();
      sendJson(res, 200, peers);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'failed to read node peers');
    }
  }

  private async handleNodeConfig(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.runtime.getNodeConfig) {
      sendError(res, 500, 'INTERNAL_ERROR', 'node config unavailable');
      return;
    }
    try {
      const config = await this.runtime.getNodeConfig();
      sendJson(res, 200, config);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'failed to read node config');
    }
  }

  private async handleIdentitySelf(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    const identity = await resolveLocalIdentity(this.config.dataDir);
    if (!identity) {
      sendError(res, 404, 'DID_NOT_FOUND', 'local identity not initialized');
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendJson(res, 200, identity);
      return;
    }
    const fromEvents = await buildIdentityView(eventStore, identity.did);
    if (fromEvents) {
      sendJson(res, 200, {
        ...identity,
        ...fromEvents,
        did: identity.did,
        publicKey: identity.publicKey,
      });
      return;
    }
    const capabilities = await buildIdentityCapabilities(eventStore, identity.did);
    sendJson(res, 200, { ...identity, capabilities });
  }

  private async handleIdentityResolve(
    _req: IncomingMessage,
    res: ServerResponse,
    did: string,
  ): Promise<void> {
    try {
      publicKeyFromDid(did);
    } catch {
      sendError(res, 400, 'DID_INVALID', 'invalid did');
      return;
    }
    const local = await resolveLocalIdentity(this.config.dataDir);
    if (local && local.did === did) {
      const eventStore = this.runtime.eventStore;
      if (!eventStore) {
        sendJson(res, 200, local);
        return;
      }
      const fromEvents = await buildIdentityView(eventStore, did);
      if (fromEvents) {
        sendJson(res, 200, {
          ...local,
          ...fromEvents,
          did: local.did,
          publicKey: local.publicKey,
        });
        return;
      }
      const capabilities = await buildIdentityCapabilities(eventStore, did);
      sendJson(res, 200, { ...local, capabilities });
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 404, 'DID_NOT_FOUND', 'did not found');
      return;
    }
    const resolved = await buildIdentityView(eventStore, did);
    if (!resolved) {
      sendError(res, 404, 'DID_NOT_FOUND', 'did not found');
      return;
    }
    sendJson(res, 200, resolved);
  }

  private async handleIdentityCapabilities(
    _req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendJson(res, 200, { capabilities: [] });
      return;
    }
    const capabilities = await buildIdentityCapabilities(eventStore);
    sendJson(res, 200, { capabilities });
  }

  private async handleCapabilityRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, CapabilityRegisterSchema);
    if (!body) {
      return;
    }
    const credential = body.credential as CapabilityCredential | undefined;
    if (!credential) {
      sendError(res, 400, 'INVALID_REQUEST', 'missing credential');
      return;
    }
    if (!(await verifyCapabilityCredential(credential))) {
      sendError(res, 400, 'CAPABILITY_INVALID', 'invalid capability credential');
      return;
    }
    if (credential.credentialSubject?.id !== body.did) {
      sendError(res, 400, 'CAPABILITY_INVALID', 'credential subject mismatch');
      return;
    }

    const subject = credential.credentialSubject;
    if (!subject?.name || !subject?.pricing) {
      sendError(res, 400, 'CAPABILITY_INVALID', 'credential subject incomplete');
      return;
    }

    let privateKey: Uint8Array;
    try {
      const publicKey = publicKeyFromDid(body.did);
      const keyId = keyIdFromPublicKey(publicKey);
      const paths = resolveStoragePaths(this.config.dataDir);
      const record = await loadKeyRecord(paths, keyId);
      privateKey = await decryptKeyRecord(record, body.passphrase);
    } catch {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const envelope = await createIdentityCapabilityRegisterEnvelope({
      did: body.did,
      privateKey,
      name: subject.name,
      pricing: subject.pricing,
      description: subject.description,
      credential,
      ts: body.ts ?? Date.now(),
      nonce: body.nonce,
      prev: body.prev,
    });

    try {
      const hash = await this.runtime.publishEvent(envelope);
      const response: Record<string, unknown> = {
        id: hash,
        name: subject.name,
        pricing: subject.pricing,
        verified: false,
        registeredAt: body.ts ?? Date.now(),
      };
      if (subject.description) {
        response.description = subject.description;
      }
      sendJson(res, 201, response);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleReputationProfile(
    _req: IncomingMessage,
    res: ServerResponse,
    did: string,
    url: URL,
  ): Promise<void> {
    if (!isValidDid(did)) {
      sendError(res, 400, 'DID_INVALID', 'invalid did');
      return;
    }
    const source = parseReputationSource(url.searchParams.get('source'));
    if (source === 'invalid') {
      sendError(res, 400, 'INVALID_REQUEST', 'invalid source');
      return;
    }
    const store = this.runtime.reputationStore;
    if (source !== 'log' && store) {
      const records = await store.getRecords(did);
      if (!records.length) {
        sendError(res, 404, 'REPUTATION_NOT_FOUND', 'reputation not found');
        return;
      }
      const profile = await store.getProfile(did);
      const qualityRecords = records.filter((record) => record.dimension === 'quality');
      const averageRating = computeAverageRating(qualityRecords);
      const levelInfo = mapReputationLevel(profile.level);
      sendJson(res, 200, {
        did,
        score: profile.overallScore,
        level: levelInfo.label,
        levelNumber: levelInfo.levelNumber,
        dimensions: {
          transaction: profile.dimensions.transaction.score,
          delivery: profile.dimensions.fulfillment.score,
          quality: profile.dimensions.quality.score,
          social: profile.dimensions.social.score,
          behavior: profile.dimensions.behavior.score,
        },
        totalTransactions: profile.dimensions.transaction.recordCount,
        successRate: 0,
        averageRating,
        badges: [],
        updatedAt: profile.updatedAt ?? Date.now(),
      });
      return;
    }
    if (source === 'store' && !store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'reputation store unavailable');
      return;
    }

    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await buildReputationState(eventStore);
    const records = getReputationRecords(state, did);
    if (!records.length) {
      sendError(res, 404, 'REPUTATION_NOT_FOUND', 'reputation not found');
      return;
    }
    const profile = buildReputationProfile(state, did);
    const qualityRecords = records.filter((record) => record.dimension === 'quality');
    const averageRating = computeAverageRating(qualityRecords);
    const levelInfo = mapReputationLevel(profile.level);
    sendJson(res, 200, {
      did,
      score: profile.overallScore,
      level: levelInfo.label,
      levelNumber: levelInfo.levelNumber,
      dimensions: {
        transaction: profile.dimensions.transaction.score,
        delivery: profile.dimensions.fulfillment.score,
        quality: profile.dimensions.quality.score,
        social: profile.dimensions.social.score,
        behavior: profile.dimensions.behavior.score,
      },
      totalTransactions: profile.dimensions.transaction.recordCount,
      successRate: 0,
      averageRating,
      badges: [],
      updatedAt: profile.updatedAt ?? Date.now(),
    });
  }

  private async handleReputationReviews(
    _req: IncomingMessage,
    res: ServerResponse,
    did: string,
    url: URL,
  ): Promise<void> {
    if (!isValidDid(did)) {
      sendError(res, 400, 'DID_INVALID', 'invalid did');
      return;
    }
    const source = parseReputationSource(url.searchParams.get('source'));
    if (source === 'invalid') {
      sendError(res, 400, 'INVALID_REQUEST', 'invalid source');
      return;
    }
    const limit = parsePagination(url.searchParams.get('limit'), 20, 100);
    const offset = parsePagination(url.searchParams.get('offset'), 0, 10_000);

    const store = this.runtime.reputationStore;
    if (source !== 'log' && store) {
      const allRecords = await store.getRecords(did);
      if (!allRecords.length) {
        sendError(res, 404, 'REPUTATION_NOT_FOUND', 'reputation not found');
        return;
      }
      const records = allRecords.filter((record) => record.dimension === 'quality');
      const sorted = [...records].sort((a, b) => b.ts - a.ts);
      const sliced = sorted.slice(offset, offset + limit);
      const reviews = sliced.map((record) => ({
        id: record.hash,
        contractId: record.ref,
        reviewer: record.issuer,
        reviewee: record.target,
        rating: ratingFromScore(record.score),
        comment: record.comment,
        aspects: record.aspects,
        createdAt: record.ts,
      }));
      const averageRating = computeAverageRating(records);
      sendJson(res, 200, {
        reviews,
        total: records.length,
        averageRating,
        pagination: {
          total: records.length,
          limit,
          offset,
          hasMore: offset + limit < records.length,
        },
      });
      return;
    }
    if (source === 'store' && !store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'reputation store unavailable');
      return;
    }

    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await buildReputationState(eventStore);
    const allRecords = getReputationRecords(state, did);
    if (!allRecords.length) {
      sendError(res, 404, 'REPUTATION_NOT_FOUND', 'reputation not found');
      return;
    }
    const records = allRecords.filter((record) => record.dimension === 'quality');
    const sorted = [...records].sort((a, b) => b.ts - a.ts);
    const sliced = sorted.slice(offset, offset + limit);
    const reviews = sliced.map((record) => ({
      id: record.hash,
      contractId: record.ref,
      reviewer: record.issuer,
      reviewee: record.target,
      rating: ratingFromScore(record.score),
      comment: record.comment,
      aspects: record.aspects,
      createdAt: record.ts,
    }));
    const averageRating = computeAverageRating(records);
    sendJson(res, 200, {
      reviews,
      total: records.length,
      averageRating,
      pagination: {
        total: records.length,
        limit,
        offset,
        hasMore: offset + limit < records.length,
      },
    });
  }

  private async handleReputationRecord(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, ReputationRecordSchema);
    if (!body) {
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'REPUTATION_INVALID', 'key unavailable');
      return;
    }
    let envelope: Record<string, unknown>;
    try {
      const scoreValue = typeof body.score === 'string' ? Number(body.score) : body.score;
      const aspects = body.aspects
        ? (Object.fromEntries(
            Object.entries(body.aspects).map(([key, value]) => [
              key,
              typeof value === 'number' ? value : Number(value),
            ]),
          ) as Record<ReputationAspectKey, number>)
        : undefined;
      envelope = await createReputationRecordEnvelope({
        issuer: body.did,
        privateKey,
        target: body.target,
        dimension: body.dimension as ReputationDimension,
        score: scoreValue,
        ref: body.ref,
        comment: body.comment,
        aspects,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'REPUTATION_INVALID', (error as Error).message);
      return;
    }
    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        status: 'broadcast',
        timestamp: body.ts ?? Date.now(),
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleWalletBalance(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const query = parseWalletQuery(url, res);
    if (!query) {
      return;
    }
    const resolved = resolveAddressFromQuery(query);
    if (!resolved) {
      sendError(res, 400, 'INVALID_REQUEST', 'missing address');
      return;
    }
    const state = await buildWalletState(eventStore);
    const balance = getWalletBalance(state, resolved);
    const total =
      BigInt(balance.available) +
      BigInt(balance.pending) +
      BigInt(balance.locked.escrow) +
      BigInt(balance.locked.governance);
    sendJson(res, 200, {
      balance: Number(total),
      available: Number(balance.available),
      pending: Number(balance.pending),
      locked: Number(balance.locked.escrow),
    });
  }

  private async handleWalletHistory(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const query = parseWalletQuery(url, res);
    if (!query) {
      return;
    }
    const resolved = resolveAddressFromQuery(query);
    if (!resolved) {
      sendError(res, 400, 'INVALID_REQUEST', 'missing address');
      return;
    }
    const typeFilter = url.searchParams.get('type') ?? 'all';
    const limit = parsePagination(url.searchParams.get('limit'), 20, 100);
    const offset = parsePagination(url.searchParams.get('offset'), 0, 10_000);

    const state = await buildWalletState(eventStore);
    const transactions = buildWalletTransactions(state, resolved).filter((tx) =>
      filterWalletTransaction(typeFilter, resolved, tx),
    );
    const sliced = transactions.slice(offset, offset + limit);
    sendJson(res, 200, {
      transactions: sliced,
      total: transactions.length,
      hasMore: offset + limit < transactions.length,
      pagination: { limit, offset },
    });
  }

  private async handleWalletTransfer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, WalletTransferSchema);
    if (!body) {
      return;
    }
    const to = resolveAddress(body.to);
    if (!to) {
      sendError(res, 400, 'INVALID_REQUEST', 'invalid recipient');
      return;
    }
    const from = addressFromDid(body.did);
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = await createWalletTransferEnvelope({
        issuer: body.did,
        privateKey,
        from,
        to,
        amount: body.amount,
        fee: body.fee ?? 1,
        memo: body.memo,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        from,
        to,
        amount: Number(body.amount),
        status: 'broadcast',
        timestamp: body.ts ?? Date.now(),
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleWalletEscrowCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, WalletEscrowCreateSchema);
    if (!body) {
      return;
    }
    const beneficiary = resolveAddress(body.beneficiary);
    if (!beneficiary) {
      sendError(res, 400, 'INVALID_REQUEST', 'invalid beneficiary');
      return;
    }
    const depositor = addressFromDid(body.did);
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    const escrowId = body.escrowId ?? `escrow-${Date.now()}`;

    let createEnvelope: Record<string, unknown>;
    try {
      createEnvelope = await createWalletEscrowCreateEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        depositor,
        beneficiary,
        amount: body.amount,
        releaseRules: body.releaseRules,
        resourcePrev: body.resourcePrev,
        arbiter: body.arbiter,
        refundRules: body.refundRules,
        expiresAt: body.expiresAt,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const createHash = await this.runtime.publishEvent(createEnvelope);
      if (body.autoFund !== false) {
        const fundEnvelope = await createWalletEscrowFundEnvelope({
          issuer: body.did,
          privateKey,
          escrowId,
          resourcePrev: createHash,
          amount: body.amount,
          ts: body.ts ?? Date.now(),
          nonce: body.nonce + 1,
          prev: createHash,
        });
        await this.runtime.publishEvent(fundEnvelope);
      }
      const total = Number(body.amount);
      sendJson(res, 201, {
        id: escrowId,
        amount: total,
        released: 0,
        remaining: total,
        status: mapEscrowStatus(body.autoFund === false ? 'pending' : 'funded'),
        releaseConditions: body.releaseRules,
        createdAt: body.ts ?? Date.now(),
        expiresAt: body.expiresAt,
        expired: body.expiresAt !== undefined ? (body.ts ?? Date.now()) > body.expiresAt : false,
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleWalletEscrowGet(
    _req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const snapshot = await buildEscrowSnapshot(eventStore, escrowId);
    const escrow = snapshot.escrow;
    if (!escrow) {
      sendError(res, 404, 'ESCROW_NOT_FOUND', 'escrow not found');
      return;
    }
    const state: WalletState = {
      balances: {},
      escrows: { [escrowId]: escrow },
      history: snapshot.history,
    };
    const escrowView = buildEscrowView(state, escrow);
    sendJson(res, 200, {
      id: escrow.escrowId,
      amount: escrowView.amount,
      released: escrowView.released,
      remaining: escrowView.remaining,
      status: escrowView.status,
      releaseConditions: escrowView.releaseConditions,
      createdAt: escrowView.createdAt,
      expiresAt: escrowView.expiresAt,
      expired: escrowView.expired,
    });
  }

  private async handleWalletEscrowFund(
    req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, WalletEscrowActionSchema);
    if (!body) {
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    let envelope: Record<string, unknown>;
    try {
      envelope = await createWalletEscrowFundEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        resourcePrev: body.resourcePrev,
        amount: body.amount,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        amount: Number(body.amount),
        status: 'broadcast',
        timestamp: body.ts ?? Date.now(),
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleWalletEscrowRelease(
    req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, WalletEscrowActionSchema);
    if (!body) {
      return;
    }
    if (!body.ruleId) {
      sendError(res, 400, 'INVALID_REQUEST', 'missing rule id');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    let envelope: Record<string, unknown>;
    try {
      envelope = await createWalletEscrowReleaseEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        resourcePrev: body.resourcePrev,
        amount: body.amount,
        ruleId: body.ruleId,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        amount: Number(body.amount),
        status: 'broadcast',
        timestamp: body.ts ?? Date.now(),
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleWalletEscrowRefund(
    req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, WalletEscrowActionSchema);
    if (!body) {
      return;
    }
    if (!body.reason) {
      sendError(res, 400, 'INVALID_REQUEST', 'missing reason');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    let envelope: Record<string, unknown>;
    try {
      envelope = await createWalletEscrowRefundEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        resourcePrev: body.resourcePrev,
        amount: body.amount,
        reason: body.reason ?? 'refund',
        evidence: body.evidence,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        amount: Number(body.amount),
        status: 'broadcast',
        timestamp: body.ts ?? Date.now(),
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleWalletEscrowExpire(
    req: IncomingMessage,
    res: ServerResponse,
    escrowId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, WalletEscrowExpireSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const snapshot = await buildEscrowSnapshot(eventStore, escrowId);
    const escrow = snapshot.escrow;
    if (!escrow) {
      sendError(res, 404, 'ESCROW_NOT_FOUND', 'escrow not found');
      return;
    }
    if (escrow.expiresAt === undefined) {
      sendError(res, 409, 'ESCROW_NO_EXPIRY', 'escrow has no expiry');
      return;
    }
    const ts = body.ts ?? Date.now();
    if (ts < escrow.expiresAt) {
      sendError(res, 409, 'ESCROW_NOT_EXPIRED', 'escrow has not expired');
      return;
    }
    const remaining = parseBigInt(escrow.balance);
    if (remaining <= 0n) {
      sendError(res, 409, 'ESCROW_SETTLED', 'escrow has no remaining balance');
      return;
    }
    const escrowPrev = snapshot.history[snapshot.history.length - 1]?.hash ?? null;
    if (!escrowPrev) {
      sendError(res, 409, 'ESCROW_NOT_FOUND', 'escrow resource missing');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const action = body.action ?? 'refund';
    let envelope: Record<string, unknown>;
    try {
      if (action === 'release') {
        envelope = await createWalletEscrowReleaseEnvelope({
          issuer: body.did,
          privateKey,
          escrowId,
          resourcePrev: escrowPrev,
          amount: remaining.toString(),
          ruleId: body.ruleId ?? 'expired',
          ts,
          nonce: body.nonce,
          prev: body.prev,
        });
      } else {
        envelope = await createWalletEscrowRefundEnvelope({
          issuer: body.did,
          privateKey,
          escrowId,
          resourcePrev: escrowPrev,
          amount: remaining.toString(),
          reason: body.reason ?? 'expired',
          evidence: body.evidence,
          ts,
          nonce: body.nonce,
          prev: body.prev,
        });
      }
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        amount: Number(remaining),
        action,
        status: 'broadcast',
        timestamp: ts,
        expiresAt: escrow.expiresAt,
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async resolveContractState(
    eventStore: EventStore,
  ): Promise<ReturnType<typeof createContractState>> {
    if (this.runtime.contractStore) {
      return this.runtime.contractStore.getState();
    }
    return buildContractState(eventStore);
  }

  private async handleContractsList(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const role = url.searchParams.get('role') ?? 'all';
    if (role !== 'all' && role !== 'client' && role !== 'provider') {
      sendError(res, 400, 'INVALID_REQUEST', 'invalid role');
      return;
    }
    const status = url.searchParams.get('status') ?? undefined;
    const limit = parsePagination(url.searchParams.get('limit'), 20, 100);
    const offset = parsePagination(url.searchParams.get('offset'), 0, 10_000);

    let localDid: string | undefined;
    if (role !== 'all') {
      const identity = await resolveLocalIdentity(this.config.dataDir);
      if (!identity) {
        sendError(res, 404, 'DID_NOT_FOUND', 'local identity not initialized');
        return;
      }
      localDid = identity.did;
    }

    const state = await this.resolveContractState(eventStore);
    let contracts = Object.values(state.contracts);
    if (status) {
      contracts = contracts.filter((contract) => contract.status === status);
    }
    if (role === 'client' && localDid) {
      contracts = contracts.filter((contract) => contract.parties.client.did === localDid);
    }
    if (role === 'provider' && localDid) {
      contracts = contracts.filter((contract) => contract.parties.provider.did === localDid);
    }

    const sorted = [...contracts].sort((a, b) => b.updatedAt - a.updatedAt);
    const sliced = sorted.slice(offset, offset + limit);
    const views = sliced.map((contract) => buildContractView(contract));
    sendJson(res, 200, {
      contracts: views,
      total: contracts.length,
      pagination: {
        total: contracts.length,
        limit,
        offset,
        hasMore: offset + limit < contracts.length,
      },
    });
  }

  private async handleContractCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, ContractCreateSchema);
    if (!body) {
      return;
    }
    if (!isValidDid(body.did)) {
      sendError(res, 400, 'DID_INVALID', 'invalid did');
      return;
    }
    if (!isValidDid(body.provider)) {
      sendError(res, 400, 'DID_INVALID', 'invalid provider did');
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }

    const state = await this.resolveContractState(eventStore);
    const contractId = body.contractId ?? `contract-${randomUUID()}`;
    if (state.contracts[contractId]) {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract already exists');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const partiesRecord =
      body.parties && typeof body.parties === 'object' && !Array.isArray(body.parties)
        ? (body.parties as Record<string, unknown>)
        : {};
    const clientRecord =
      partiesRecord.client && typeof partiesRecord.client === 'object' && !Array.isArray(partiesRecord.client)
        ? { ...(partiesRecord.client as Record<string, unknown>) }
        : {};
    clientRecord.did = body.did;
    const providerRecord =
      partiesRecord.provider && typeof partiesRecord.provider === 'object' && !Array.isArray(partiesRecord.provider)
        ? { ...(partiesRecord.provider as Record<string, unknown>) }
        : {};
    providerRecord.did = body.provider;
    const parties = {
      ...partiesRecord,
      client: clientRecord,
      provider: providerRecord,
    };

    const milestones = Array.isArray(body.milestones)
      ? body.milestones.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return entry;
        }
        const record = entry as Record<string, unknown>;
        const id =
          typeof record.id === 'string' && record.id.trim().length > 0
            ? record.id
            : `milestone-${index + 1}`;
        return { ...record, id };
      })
      : undefined;

    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createContractCreateEnvelope({
        issuer: body.did,
        privateKey,
        contractId,
        parties: parties as unknown as ContractParties,
        service: (body.service ?? {}) as Record<string, unknown>,
        terms: body.terms as Record<string, unknown>,
        payment: (body.payment ?? { escrowRequired: true }) as Record<string, unknown>,
        timeline: (body.timeline ?? {}) as Record<string, unknown>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        milestones: milestones as any,
        attachments: body.attachments as Record<string, unknown>[] | undefined,
        metadata: body.metadata as Record<string, unknown> | undefined,
        resourcePrev: null,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      await this.runtime.publishEvent(envelope);
      const nextState = applyContractEvent(state, envelope as EventEnvelope);
      const contract = nextState.contracts[contractId];
      if (!contract) {
        sendJson(res, 201, { id: contractId, status: 'draft' });
        return;
      }
      sendJson(res, 201, buildContractView(contract));
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleContractGet(
    _req: IncomingMessage,
    res: ServerResponse,
    contractId: string,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await this.resolveContractState(eventStore);
    const contract = state.contracts[contractId];
    if (!contract) {
      sendError(res, 404, 'CONTRACT_NOT_FOUND', 'contract not found');
      return;
    }
    sendJson(res, 200, buildContractView(contract));
  }

  private async handleContractSign(
    req: IncomingMessage,
    res: ServerResponse,
    contractId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ContractSignSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await this.resolveContractState(eventStore);
    const contract = state.contracts[contractId];
    if (!contract) {
      sendError(res, 404, 'CONTRACT_NOT_FOUND', 'contract not found');
      return;
    }
    if (body.did !== contract.parties.client.did && body.did !== contract.parties.provider.did) {
      sendError(res, 403, 'FORBIDDEN', 'not a party to the contract');
      return;
    }
    if (!['draft', 'negotiating', 'pending_signature'].includes(contract.status)) {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract not signable');
      return;
    }
    const resourcePrev = state.contractEvents[contractId];
    if (!resourcePrev) {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract resource missing');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createContractSignEnvelope({
        issuer: body.did,
        privateKey,
        contractId,
        resourcePrev,
        signer: body.did,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      await this.runtime.publishEvent(envelope);
      const nextState = applyContractEvent(state, envelope as EventEnvelope);
      const updated = nextState.contracts[contractId] ?? contract;
      sendJson(res, 200, buildContractView(updated));
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleContractFund(
    req: IncomingMessage,
    res: ServerResponse,
    contractId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ContractFundSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await this.resolveContractState(eventStore);
    const contract = state.contracts[contractId];
    if (!contract) {
      sendError(res, 404, 'CONTRACT_NOT_FOUND', 'contract not found');
      return;
    }
    if (contract.status !== 'pending_funding') {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract not ready for funding');
      return;
    }
    if (body.did !== contract.parties.client.did) {
      sendError(res, 403, 'FORBIDDEN', 'only client can fund the contract');
      return;
    }
    const resourcePrev = state.contractEvents[contractId];
    if (!resourcePrev) {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract resource missing');
      return;
    }

    const amountValue = parseBigInt(String(body.amount));
    if (amountValue <= 0n) {
      sendError(res, 400, 'INVALID_REQUEST', 'amount must be positive');
      return;
    }

    const walletState = await buildWalletState(eventStore);
    const balance = getWalletBalance(walletState, addressFromDid(body.did));
    const available = parseBigInt(balance.available);
    if (amountValue > available) {
      sendError(res, 402, 'INSUFFICIENT_BALANCE', 'insufficient balance');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const escrowId = body.escrowId ?? contract.escrowId ?? `escrow-${randomUUID()}`;
    const releaseRules = body.releaseRules ?? [{ id: 'milestone_approved' }];
    const ts = body.ts ?? Date.now();

    try {
      const createEnvelope = await createWalletEscrowCreateEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        depositor: addressFromDid(body.did),
        beneficiary: addressFromDid(contract.parties.provider.did),
        amount: body.amount,
        releaseRules,
        resourcePrev: undefined,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
      const createHash = await this.runtime.publishEvent(createEnvelope);
      const fundEnvelope = await createWalletEscrowFundEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        resourcePrev: createHash,
        amount: body.amount,
        ts: ts + 1,
        nonce: body.nonce + 1,
        prev: createHash,
      });
      const fundHash = await this.runtime.publishEvent(fundEnvelope);
      const activateEnvelope = await createContractActivateEnvelope({
        issuer: body.did,
        privateKey,
        contractId,
        resourcePrev,
        escrowId,
        ts: ts + 2,
        nonce: body.nonce + 2,
        prev: fundHash,
      });
      await this.runtime.publishEvent(activateEnvelope);
      const nextState = applyContractEvent(state, activateEnvelope as EventEnvelope);
      const updated = nextState.contracts[contractId] ?? contract;
      sendJson(res, 200, buildContractView(updated));
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
    }
  }

  private async handleContractMilestoneSubmit(
    req: IncomingMessage,
    res: ServerResponse,
    contractId: string,
    milestoneId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ContractMilestoneSubmitSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await this.resolveContractState(eventStore);
    const contract = state.contracts[contractId];
    if (!contract) {
      sendError(res, 404, 'CONTRACT_NOT_FOUND', 'contract not found');
      return;
    }
    if (contract.status !== 'active') {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract not active');
      return;
    }
    if (body.did !== contract.parties.provider.did) {
      sendError(res, 403, 'FORBIDDEN', 'only provider can submit milestones');
      return;
    }
    const milestone = contract.milestones.find((entry) => entry.id === milestoneId);
    if (!milestone) {
      sendError(res, 400, 'CONTRACT_MILESTONE_INVALID', 'milestone not found');
      return;
    }
    if (milestone.status === 'approved') {
      sendError(res, 400, 'CONTRACT_MILESTONE_INVALID', 'milestone already approved');
      return;
    }
    const resourcePrev = state.contractEvents[contractId];
    if (!resourcePrev) {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    const submissionId = body.submissionId ?? `submission-${randomUUID()}`;
    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createContractMilestoneSubmitEnvelope({
        issuer: body.did,
        privateKey,
        contractId,
        resourcePrev,
        milestoneId,
        submissionId,
        notes: body.notes,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      await this.runtime.publishEvent(envelope);
      const nextState = applyContractEvent(state, envelope as EventEnvelope);
      const updated = nextState.contracts[contractId];
      const updatedMilestone = updated?.milestones.find((entry) => entry.id === milestoneId);
      if (!updated || !updatedMilestone) {
        sendJson(res, 200, milestone);
        return;
      }
      let releaseHash: string | null = null;
      let releaseError: string | undefined;
      if (updated.escrowId) {
        const payout = resolveMilestonePaymentAmount(updated, updatedMilestone);
        if (payout !== null && payout > 0n) {
          try {
            const walletState = await buildWalletState(eventStore);
            const escrow = walletState.escrows[updated.escrowId];
            if (escrow && parseBigInt(escrow.balance) >= payout) {
              const escrowPrev = await findLatestEscrowEventHash(eventStore, updated.escrowId);
              if (escrowPrev) {
                const releaseEnvelope = await createWalletEscrowReleaseEnvelope({
                  issuer: body.did,
                  privateKey,
                  escrowId: updated.escrowId,
                  resourcePrev: escrowPrev,
                  amount: payout.toString(),
                  ruleId: 'milestone_approved',
                  ts: ts + 1,
                  nonce: body.nonce + 1,
                  prev: envelope.hash as string,
                });
                releaseHash = await this.runtime.publishEvent(releaseEnvelope);
              }
            }
          } catch (error) {
            releaseError = (error as Error).message;
          }
        }
      }
      const response = { ...(updatedMilestone as Record<string, unknown>) };
      if (releaseHash) {
        response.escrowReleaseHash = releaseHash;
      }
      if (releaseError) {
        response.escrowReleaseError = releaseError;
      }
      sendJson(res, 200, response);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleContractMilestoneApprove(
    req: IncomingMessage,
    res: ServerResponse,
    contractId: string,
    milestoneId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ContractMilestoneReviewSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await this.resolveContractState(eventStore);
    const contract = state.contracts[contractId];
    if (!contract) {
      sendError(res, 404, 'CONTRACT_NOT_FOUND', 'contract not found');
      return;
    }
    if (contract.status !== 'active') {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract not active');
      return;
    }
    if (body.did !== contract.parties.client.did) {
      sendError(res, 403, 'FORBIDDEN', 'only client can approve milestones');
      return;
    }
    const milestone = contract.milestones.find((entry) => entry.id === milestoneId);
    if (!milestone) {
      sendError(res, 400, 'CONTRACT_MILESTONE_INVALID', 'milestone not found');
      return;
    }
    if (milestone.status !== 'submitted') {
      sendError(res, 400, 'CONTRACT_MILESTONE_INVALID', 'milestone not submitted');
      return;
    }
    const resourcePrev = state.contractEvents[contractId];
    if (!resourcePrev) {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    const notes = body.notes ?? body.feedback;
    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createContractMilestoneApproveEnvelope({
        issuer: body.did,
        privateKey,
        contractId,
        resourcePrev,
        milestoneId,
        notes,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      await this.runtime.publishEvent(envelope);
      const nextState = applyContractEvent(state, envelope as EventEnvelope);
      const updated = nextState.contracts[contractId];
      const updatedMilestone = updated?.milestones.find((entry) => entry.id === milestoneId);
      if (!updated || !updatedMilestone) {
        sendJson(res, 200, milestone);
        return;
      }
      sendJson(res, 200, updatedMilestone);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleContractMilestoneReject(
    req: IncomingMessage,
    res: ServerResponse,
    contractId: string,
    milestoneId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ContractMilestoneReviewSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await this.resolveContractState(eventStore);
    const contract = state.contracts[contractId];
    if (!contract) {
      sendError(res, 404, 'CONTRACT_NOT_FOUND', 'contract not found');
      return;
    }
    if (contract.status !== 'active') {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract not active');
      return;
    }
    if (body.did !== contract.parties.client.did) {
      sendError(res, 403, 'FORBIDDEN', 'only client can reject milestones');
      return;
    }
    const milestone = contract.milestones.find((entry) => entry.id === milestoneId);
    if (!milestone) {
      sendError(res, 400, 'CONTRACT_MILESTONE_INVALID', 'milestone not found');
      return;
    }
    if (milestone.status !== 'submitted') {
      sendError(res, 400, 'CONTRACT_MILESTONE_INVALID', 'milestone not submitted');
      return;
    }
    const resourcePrev = state.contractEvents[contractId];
    if (!resourcePrev) {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    const notes = body.notes ?? body.feedback;
    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createContractMilestoneRejectEnvelope({
        issuer: body.did,
        privateKey,
        contractId,
        resourcePrev,
        milestoneId,
        notes,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      await this.runtime.publishEvent(envelope);
      const nextState = applyContractEvent(state, envelope as EventEnvelope);
      const updated = nextState.contracts[contractId];
      const updatedMilestone = updated?.milestones.find((entry) => entry.id === milestoneId);
      if (!updated || !updatedMilestone) {
        sendJson(res, 200, milestone);
        return;
      }
      sendJson(res, 200, updatedMilestone);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleContractComplete(
    req: IncomingMessage,
    res: ServerResponse,
    contractId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ContractCompleteSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await this.resolveContractState(eventStore);
    const contract = state.contracts[contractId];
    if (!contract) {
      sendError(res, 404, 'CONTRACT_NOT_FOUND', 'contract not found');
      return;
    }
    if (contract.status !== 'active') {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract not active');
      return;
    }
    if (body.did !== contract.parties.client.did) {
      sendError(res, 403, 'FORBIDDEN', 'only client can complete contract');
      return;
    }
    const resourcePrev = state.contractEvents[contractId];
    if (!resourcePrev) {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract resource missing');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createContractCompleteEnvelope({
        issuer: body.did,
        privateKey,
        contractId,
        resourcePrev,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      await this.runtime.publishEvent(envelope);
      const nextState = applyContractEvent(state, envelope as EventEnvelope);
      const updated = nextState.contracts[contractId] ?? contract;
      sendJson(res, 200, buildContractView(updated));
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleContractDisputeOpen(
    req: IncomingMessage,
    res: ServerResponse,
    contractId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ContractDisputeSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await this.resolveContractState(eventStore);
    const contract = state.contracts[contractId];
    if (!contract) {
      sendError(res, 404, 'CONTRACT_NOT_FOUND', 'contract not found');
      return;
    }
    if (body.did !== contract.parties.client.did && body.did !== contract.parties.provider.did) {
      sendError(res, 403, 'FORBIDDEN', 'not a party to the contract');
      return;
    }
    if (!['active', 'completed'].includes(contract.status)) {
      sendError(res, 409, 'DISPUTE_NOT_ALLOWED', 'contract not disputable');
      return;
    }
    if (contract.dispute && contract.dispute.status !== 'resolved') {
      sendError(res, 409, 'DISPUTE_NOT_ALLOWED', 'dispute already open');
      return;
    }
    const resourcePrev = state.contractEvents[contractId];
    if (!resourcePrev) {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract resource missing');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createContractDisputeOpenEnvelope({
        issuer: body.did,
        privateKey,
        contractId,
        resourcePrev,
        reason: body.reason,
        description: body.description,
        evidence: body.evidence as Record<string, unknown>[] | undefined,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      await this.runtime.publishEvent(envelope);
      const nextState = applyContractEvent(state, envelope as EventEnvelope);
      const updated = nextState.contracts[contractId] ?? contract;
      const dispute = updated.dispute;
      if (!dispute) {
        sendJson(res, 200, { contractId });
        return;
      }
      sendJson(res, 200, {
        id: `dispute-${contractId}`,
        contractId,
        initiator: dispute.initiator ?? body.did,
        reason: dispute.reason,
        description: dispute.description,
        evidence: dispute.evidence,
        status: dispute.status === 'open' ? 'open' : 'resolved',
        resolution: dispute.resolution
          ? {
            decision: dispute.resolution,
            resolvedAt: dispute.resolvedAt,
          }
          : undefined,
        createdAt: dispute.openedAt,
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleContractDisputeResolve(
    req: IncomingMessage,
    res: ServerResponse,
    contractId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ContractDisputeResolveSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await this.resolveContractState(eventStore);
    const contract = state.contracts[contractId];
    if (!contract) {
      sendError(res, 404, 'CONTRACT_NOT_FOUND', 'contract not found');
      return;
    }
    if (body.did !== contract.parties.client.did && body.did !== contract.parties.provider.did) {
      sendError(res, 403, 'FORBIDDEN', 'not a party to the contract');
      return;
    }
    if (!contract.dispute || contract.dispute.status !== 'open') {
      sendError(res, 409, 'DISPUTE_NOT_ALLOWED', 'dispute not open');
      return;
    }
    const resourcePrev = state.contractEvents[contractId];
    if (!resourcePrev) {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract resource missing');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createContractDisputeResolveEnvelope({
        issuer: body.did,
        privateKey,
        contractId,
        resourcePrev,
        resolution: body.resolution,
        notes: body.notes,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      await this.runtime.publishEvent(envelope);
      const nextState = applyContractEvent(state, envelope as EventEnvelope);
      const updated = nextState.contracts[contractId] ?? contract;
      const dispute = updated.dispute;
      if (!dispute) {
        sendJson(res, 200, { contractId });
        return;
      }
      sendJson(res, 200, {
        id: `dispute-${contractId}`,
        contractId,
        initiator: dispute.initiator,
        reason: dispute.reason,
        description: dispute.description,
        evidence: dispute.evidence,
        status: dispute.status === 'open' ? 'open' : 'resolved',
        resolution: dispute.resolution
          ? {
            decision: dispute.resolution,
            resolvedAt: dispute.resolvedAt,
          }
          : undefined,
        createdAt: dispute.openedAt,
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleContractSettlementExecute(
    req: IncomingMessage,
    res: ServerResponse,
    contractId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ContractSettlementSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await this.resolveContractState(eventStore);
    const contract = state.contracts[contractId];
    if (!contract) {
      sendError(res, 404, 'CONTRACT_NOT_FOUND', 'contract not found');
      return;
    }
    const arbiters = contract.parties.arbiters ?? [];
    const isArbiter = arbiters.some((arbiter) => arbiter.did === body.did);
    const isParty =
      body.did === contract.parties.client.did || body.did === contract.parties.provider.did;
    if (!isParty && !isArbiter) {
      sendError(res, 403, 'FORBIDDEN', 'not authorized to settle contract');
      return;
    }
    const resourcePrev = state.contractEvents[contractId];
    if (!resourcePrev) {
      sendError(res, 409, 'CONTRACT_INVALID_STATE', 'contract resource missing');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createContractSettlementExecuteEnvelope({
        issuer: body.did,
        privateKey,
        contractId,
        resourcePrev,
        settlement: body.settlement,
        notes: body.notes,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      await this.runtime.publishEvent(envelope);
      const nextState = applyContractEvent(state, envelope as EventEnvelope);
      const updated = nextState.contracts[contractId] ?? contract;
      sendJson(res, 200, buildContractView(updated));
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleMarketSearch(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    if (!this.runtime.searchMarkets) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market search unavailable');
      return;
    }
    let query: SearchQuery;
    try {
      query = parseMarketSearchQuery(url.searchParams);
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    try {
      const result = this.runtime.searchMarkets(query);
      sendJson(res, 200, result);
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'failed to search markets');
    }
  }

  private async handleMarketDisputeOpen(
    req: IncomingMessage,
    res: ServerResponse,
    orderId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, DisputeOpenSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const marketState = await buildMarketState(eventStore);
    const order = marketState.orders[orderId];
    if (!order) {
      sendError(res, 404, 'ORDER_NOT_FOUND', 'order not found');
      return;
    }
    if (order.buyer.did !== body.did && order.seller.did !== body.did) {
      sendError(res, 403, 'NOT_ORDER_PARTY', 'not a party to the order');
      return;
    }
    if (order.dispute && order.dispute.status !== 'resolved') {
      sendError(res, 409, 'DISPUTE_ALREADY_OPEN', 'order already has a dispute');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const disputeId = body.disputeId ?? `dispute-${randomUUID()}`;
    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketDisputeOpenEnvelope({
        issuer: body.did,
        privateKey,
        disputeId,
        orderId,
        type: body.type,
        description: body.description,
        claimAmount: body.claimAmount,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 201, { disputeId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleMarketDisputeResponse(
    req: IncomingMessage,
    res: ServerResponse,
    disputeId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, DisputeResponseSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const marketState = await buildMarketState(eventStore);
    const dispute = marketState.disputes[disputeId];
    if (!dispute) {
      sendError(res, 404, 'DISPUTE_NOT_FOUND', 'dispute not found');
      return;
    }
    if (dispute.status !== 'open') {
      sendError(res, 409, 'DISPUTE_INVALID_STATE', 'dispute not open');
      return;
    }
    const order = marketState.orders[dispute.orderId];
    if (!order) {
      sendError(res, 404, 'ORDER_NOT_FOUND', 'order not found');
      return;
    }
    if (order.buyer.did !== body.did && order.seller.did !== body.did) {
      sendError(res, 403, 'NOT_ORDER_PARTY', 'not a party to the order');
      return;
    }

    const resourcePrev = marketState.disputeEvents[disputeId];
    if (!resourcePrev) {
      sendError(res, 409, 'DISPUTE_INVALID_STATE', 'dispute resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketDisputeResponseEnvelope({
        issuer: body.did,
        privateKey,
        disputeId,
        resourcePrev,
        response: body.response,
        evidence: body.evidence as Record<string, unknown>[] | undefined,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { disputeId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleMarketDisputeResolve(
    req: IncomingMessage,
    res: ServerResponse,
    disputeId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, DisputeResolveSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const marketState = await buildMarketState(eventStore);
    const dispute = marketState.disputes[disputeId];
    if (!dispute) {
      sendError(res, 404, 'DISPUTE_NOT_FOUND', 'dispute not found');
      return;
    }
    if (dispute.status === 'resolved') {
      sendError(res, 409, 'DISPUTE_INVALID_STATE', 'dispute already resolved');
      return;
    }
    const order = marketState.orders[dispute.orderId];
    if (!order) {
      sendError(res, 404, 'ORDER_NOT_FOUND', 'order not found');
      return;
    }
    if (order.buyer.did !== body.did && order.seller.did !== body.did) {
      sendError(res, 403, 'NOT_ORDER_PARTY', 'not a party to the order');
      return;
    }

    const resourcePrev = marketState.disputeEvents[disputeId];
    if (!resourcePrev) {
      sendError(res, 409, 'DISPUTE_INVALID_STATE', 'dispute resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketDisputeResolveEnvelope({
        issuer: body.did,
        privateKey,
        disputeId,
        resourcePrev,
        resolution: body.resolution,
        notes: body.notes,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { disputeId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleInfoMarketSearch(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const store = this.runtime.marketStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }
    let query: SearchQuery;
    try {
      query = parseMarketSearchQuery(url.searchParams);
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    const limit = parsePagination(url.searchParams.get('limit'), 0, 1000);
    const offset = parsePagination(url.searchParams.get('offset'), 0, 10_000_000);
    if (limit > 0) {
      query.pageSize = limit;
      query.page = Math.floor(offset / limit) + 1;
    }

    query.markets = ['info'];
    try {
      const result = store.search(query);
      sendJson(res, 200, {
        listings: result.listings,
        total: result.total,
        hasMore: result.page * result.pageSize < result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'failed to search info market');
    }
  }

  private async handleInfoMarketPublish(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, InfoPublishSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.infoContentStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'info content store unavailable');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const listingId = body.listingId ?? `info-${randomUUID()}`;
    const content = body.content as Record<string, unknown>;
    let contentHash = typeof content.hash === 'string' ? content.hash : undefined;
    let contentKeyHex: string | undefined;

    let contentBytes: Uint8Array | null = null;
    if (content.data !== undefined) {
      const encoding = typeof content.encoding === 'string' ? content.encoding : 'utf8';
      const raw = String(content.data ?? '');
      try {
        if (encoding === 'base64') {
          contentBytes = base64ToBytes(raw);
        } else if (encoding === 'hex') {
          contentBytes = hexToBytes(raw);
        } else if (encoding === 'utf8') {
          contentBytes = utf8ToBytes(raw);
        } else {
          sendError(res, 400, 'INVALID_REQUEST', 'unsupported content encoding');
          return;
        }
      } catch (error) {
        sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
        return;
      }
    }

    let contentKey: Uint8Array | null = null;
    if (body.contentKeyHex) {
      try {
        contentKey = hexToBytes(body.contentKeyHex);
      } catch (error) {
        sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
        return;
      }
      if (contentKey.length !== 32) {
        sendError(res, 400, 'INVALID_REQUEST', 'contentKeyHex must be 32 bytes');
        return;
      }
      contentKeyHex = body.contentKeyHex.toLowerCase();
    }

    if (contentBytes) {
      if (!contentKey) {
        contentKey = generateInfoContentKey();
        contentKeyHex = bytesToHex(contentKey);
      }
      const stored = await store.storeEncryptedContent(listingId, contentBytes, contentKey);
      if (contentHash && contentHash !== stored.hash) {
        sendError(res, 400, 'INVALID_REQUEST', 'content hash mismatch');
        return;
      }
      contentHash = stored.hash;
      if (content.size === undefined) {
        content.size = contentBytes.length;
      }
    }

    if (!contentHash) {
      sendError(res, 400, 'INVALID_REQUEST', 'content data or hash required');
      return;
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = await createInfoListingPublishEnvelope({
        issuer: body.did,
        privateKey,
        listingId,
        title: body.title,
        description: body.description,
        category: body.category,
        tags: body.tags ?? [],
        pricing: body.pricing as unknown as MarketListing['pricing'],
        visibility: (body.visibility ?? 'public') as MarketListing['visibility'],
        marketData: {
          infoType: body.infoType,
          content: {
            ...(content as Record<string, unknown>),
            format: (content.format ?? '') as string,
            size: content.size as number | undefined,
            hash: contentHash,
          },
          quality: body.quality as Record<string, unknown> | undefined,
          accessMethod: body.accessMethod as Record<string, unknown>,
          license: body.license as Record<string, unknown>,
          usageRestrictions: body.usageRestrictions as Record<string, unknown> | undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        restrictions: body.restrictions as Record<string, unknown> | undefined,
        metadata: body.metadata as Record<string, unknown> | undefined,
        expiresAt: body.expiresAt,
        status: body.status as MarketListing['status'] | undefined,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 201, {
        listingId,
        txHash: hash,
        contentHash,
        contentKeyHex,
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleInfoMarketGet(
    _req: IncomingMessage,
    res: ServerResponse,
    listingId: string,
  ): Promise<void> {
    const store = this.runtime.marketStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }
    const listing = await store.getListing(listingId);
    if (!listing || listing.marketType !== 'info') {
      sendError(res, 404, 'LISTING_NOT_FOUND', 'listing not found');
      return;
    }
    sendJson(res, 200, listing);
  }

  private async handleInfoMarketContent(
    _req: IncomingMessage,
    res: ServerResponse,
    listingId: string,
  ): Promise<void> {
    const store = this.runtime.infoContentStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'info content store unavailable');
      return;
    }
    const record = await store.getEncryptedContentForListing(listingId);
    if (!record) {
      sendError(res, 404, 'CONTENT_NOT_FOUND', 'content not found');
      return;
    }
    sendJson(res, 200, record);
  }

  private async handleInfoMarketDelivery(
    _req: IncomingMessage,
    res: ServerResponse,
    orderId: string,
  ): Promise<void> {
    const store = this.runtime.infoContentStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'info content store unavailable');
      return;
    }
    const record = await store.getDeliveryForOrder(orderId);
    if (!record) {
      sendError(res, 404, 'DELIVERY_NOT_FOUND', 'delivery not found');
      return;
    }
    sendJson(res, 200, record);
  }

  private async handleInfoMarketPurchase(
    req: IncomingMessage,
    res: ServerResponse,
    listingId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, InfoPurchaseSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.marketStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }
    const listing = await store.getListing(listingId);
    if (!listing || listing.marketType !== 'info') {
      sendError(res, 404, 'LISTING_NOT_FOUND', 'listing not found');
      return;
    }
    if (listing.status !== 'active') {
      sendError(res, 409, 'LISTING_NOT_ACTIVE', 'listing not active');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const orderId = body.orderId ?? `order-${randomUUID()}`;
    const escrowId = body.escrowId ?? `escrow-${randomUUID()}`;
    const ts = body.ts ?? Date.now();

    let orderEnvelope: Record<string, unknown>;
    try {
      orderEnvelope = await createInfoOrderCreateEnvelope({
        issuer: body.did,
        privateKey,
        listing,
        orderId,
        quantity: body.quantity,
        unitPrice: body.unitPrice,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    const pricing = (orderEnvelope.payload as Record<string, unknown>)?.pricing as
      | { total?: string | number }
      | undefined;
    const total = pricing?.total ?? listing.pricing.fixedPrice ?? '0';

    try {
      const orderHash = await this.runtime.publishEvent(orderEnvelope);
      const escrowCreate = await createInfoEscrowCreateEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        buyerDid: body.did,
        sellerDid: listing.seller.did,
        amount: total,
        releaseRules: body.releaseRules ?? [{ id: 'delivery_confirmed' }],
        ts: ts + 1,
        nonce: body.nonce + 1,
        prev: orderHash,
      });
      const escrowCreateHash = await this.runtime.publishEvent(escrowCreate);
      const escrowFund = await createInfoEscrowFundEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        resourcePrev: escrowCreateHash,
        amount: total,
        ts: ts + 2,
        nonce: body.nonce + 2,
        prev: escrowCreateHash,
      });
      const escrowFundHash = await this.runtime.publishEvent(escrowFund);
      const paymentUpdate = await createInfoOrderPaymentEscrowedEnvelope({
        issuer: body.did,
        privateKey,
        orderId,
        resourcePrev: orderHash,
        escrowId,
        ts: ts + 3,
        nonce: body.nonce + 3,
        prev: escrowFundHash,
      });
      const paymentHash = await this.runtime.publishEvent(paymentUpdate);
      sendJson(res, 201, {
        orderId,
        escrowId,
        orderHash,
        escrowCreateHash,
        escrowFundHash,
        paymentHash,
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleInfoMarketSubscribe(
    req: IncomingMessage,
    res: ServerResponse,
    listingId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, InfoSubscriptionSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.marketStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }
    const listing = await store.getListing(listingId);
    if (!listing || listing.marketType !== 'info') {
      sendError(res, 404, 'LISTING_NOT_FOUND', 'listing not found');
      return;
    }
    if (listing.status !== 'active') {
      sendError(res, 409, 'LISTING_NOT_ACTIVE', 'listing not active');
      return;
    }
    if (listing.pricing.type !== 'subscription') {
      sendError(res, 409, 'LISTING_NOT_SUBSCRIPTION', 'listing does not support subscription');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const subscriptionId = body.subscriptionId ?? `subscription-${randomUUID()}`;
    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketSubscriptionStartEnvelope({
        issuer: body.did,
        privateKey,
        subscriptionId,
        listingId,
        buyerDid: body.did,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 201, { subscriptionId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleInfoMarketSubscriptionCancel(
    req: IncomingMessage,
    res: ServerResponse,
    subscriptionId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, InfoSubscriptionCancelSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const subscription = marketState.subscriptions[subscriptionId];
    if (!subscription) {
      sendError(res, 404, 'SUBSCRIPTION_NOT_FOUND', 'subscription not found');
      return;
    }
    if (subscription.buyer.did !== body.did) {
      sendError(res, 403, 'NOT_SUBSCRIBER', 'not the subscriber');
      return;
    }
    if (subscription.status !== 'active') {
      sendError(res, 409, 'SUBSCRIPTION_NOT_ACTIVE', 'subscription not active');
      return;
    }
    const resourcePrev = marketState.subscriptionEvents[subscriptionId];
    if (!resourcePrev) {
      sendError(res, 409, 'SUBSCRIPTION_INVALID_STATE', 'subscription resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketSubscriptionCancelEnvelope({
        issuer: body.did,
        privateKey,
        subscriptionId,
        resourcePrev,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { subscriptionId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleInfoMarketDeliver(
    req: IncomingMessage,
    res: ServerResponse,
    listingId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, InfoDeliverSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.marketStore;
    const contentStore = this.runtime.infoContentStore;
    const eventStore = this.runtime.eventStore;
    if (!store || !contentStore || !eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'info market unavailable');
      return;
    }
    const listing = await store.getListing(listingId);
    if (!listing || listing.marketType !== 'info') {
      sendError(res, 404, 'LISTING_NOT_FOUND', 'listing not found');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const order = marketState.orders[body.orderId];
    if (!order) {
      sendError(res, 404, 'ORDER_NOT_FOUND', 'order not found');
      return;
    }
    if (order.listingId !== listingId) {
      sendError(res, 409, 'ORDER_LISTING_MISMATCH', 'order listing mismatch');
      return;
    }
    if (order.seller.did !== body.did) {
      sendError(res, 403, 'NOT_SELLER', 'not the seller');
      return;
    }

    const contentHash =
      (await contentStore.getListingContentHash(listingId)) ??
      ((listing.marketData as Record<string, unknown>)?.content as Record<string, unknown> | undefined)?.['hash'] ??
      null;
    if (!contentHash || typeof contentHash !== 'string') {
      sendError(res, 404, 'CONTENT_NOT_FOUND', 'content hash not found');
      return;
    }

    if (!body.contentKeyHex) {
      sendError(res, 400, 'INVALID_REQUEST', 'missing contentKeyHex');
      return;
    }
    let contentKey: Uint8Array;
    try {
      contentKey = hexToBytes(body.contentKeyHex);
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }
    if (contentKey.length !== 32) {
      sendError(res, 400, 'INVALID_REQUEST', 'contentKeyHex must be 32 bytes');
      return;
    }

    let buyerPublicKey: Uint8Array | undefined;
    if (body.buyerPublicKeyHex) {
      try {
        buyerPublicKey = hexToBytes(body.buyerPublicKeyHex);
      } catch (error) {
        sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
        return;
      }
      if (buyerPublicKey.length !== 32) {
        sendError(res, 400, 'INVALID_REQUEST', 'buyerPublicKeyHex must be 32 bytes');
        return;
      }
    }

    const deliveryId = body.deliveryId ?? `delivery-${randomUUID()}`;
    const record = await prepareInfoDeliveryRecord({
      store: contentStore,
      deliveryId,
      orderId: body.orderId,
      listingId,
      contentHash,
      buyerPublicKey,
      contentKey,
      accessToken: body.accessToken,
      createdAt: body.ts ?? Date.now(),
      expiresAt: body.expiresAt,
    });

    const resourcePrev = marketState.orderEvents[body.orderId];
    if (!resourcePrev) {
      sendError(res, 409, 'ORDER_INVALID_STATE', 'order resource missing');
      return;
    }

    let updateEnvelope: Record<string, unknown>;
    try {
      updateEnvelope = await createInfoOrderDeliveryEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId,
        resourcePrev,
        deliveryId,
        method: ((listing.marketData as Record<string, unknown>)?.accessMethod as Record<string, unknown> | undefined)?.['type'] as string
          ?? 'download',
        accessUrl: body.accessUrl,
        accessToken: body.accessToken,
        expiresAt: body.expiresAt,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(updateEnvelope);
      sendJson(res, 200, {
        delivery: record,
        orderUpdateHash: hash,
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleInfoMarketConfirm(
    req: IncomingMessage,
    res: ServerResponse,
    _listingId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, InfoConfirmSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const order = marketState.orders[body.orderId];
    if (!order) {
      sendError(res, 404, 'ORDER_NOT_FOUND', 'order not found');
      return;
    }
    const orderPrev = marketState.orderEvents[body.orderId];
    if (!orderPrev) {
      sendError(res, 409, 'ORDER_INVALID_STATE', 'order resource missing');
      return;
    }
    const escrowId = body.escrowId ?? order.payment.escrowId;
    if (!escrowId) {
      sendError(res, 409, 'ESCROW_NOT_FOUND', 'escrow id missing');
      return;
    }

    const escrowPrev = await findLatestEscrowEventHash(eventStore, escrowId);
    if (!escrowPrev) {
      sendError(res, 409, 'ESCROW_NOT_FOUND', 'escrow resource missing');
      return;
    }

    const ts = body.ts ?? Date.now();
    try {
      const releaseEnvelope = await createInfoEscrowReleaseEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        resourcePrev: escrowPrev,
        amount: order.pricing.total,
        ruleId: body.ruleId ?? 'delivery_confirmed',
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
      const releaseHash = await this.runtime.publishEvent(releaseEnvelope);
      const orderUpdate = await createInfoOrderCompletionEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId,
        resourcePrev: orderPrev,
        ts: ts + 1,
        nonce: body.nonce + 1,
        prev: releaseHash,
      });
      const orderHash = await this.runtime.publishEvent(orderUpdate);
      sendJson(res, 200, {
        escrowReleaseHash: releaseHash,
        orderUpdateHash: orderHash,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
    }
  }

  private async handleInfoMarketReview(
    req: IncomingMessage,
    res: ServerResponse,
    _listingId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, InfoReviewSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const order = marketState.orders[body.orderId];
    if (!order) {
      sendError(res, 404, 'ORDER_NOT_FOUND', 'order not found');
      return;
    }
    const orderPrev = marketState.orderEvents[body.orderId];
    if (!orderPrev) {
      sendError(res, 409, 'ORDER_INVALID_STATE', 'order resource missing');
      return;
    }

    const ratingValue = typeof body.rating === 'string' ? Number(body.rating) : body.rating;
    if (!Number.isFinite(ratingValue)) {
      sendError(res, 400, 'INVALID_REQUEST', 'rating must be a number');
      return;
    }

    try {
      const envelope = await createInfoOrderReviewEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId,
        resourcePrev: orderPrev,
        status: order.status,
        review: {
          rating: ratingValue,
          comment: body.comment ?? '',
          detailedRatings: body.detailedRatings as OrderReview['detailedRatings'] | undefined,
          createdAt: body.ts ?? Date.now(),
        },
        by: body.by,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { orderUpdateHash: hash });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
    }
  }

  private async handleInfoMarketRemove(
    req: IncomingMessage,
    res: ServerResponse,
    listingId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ListingRemoveSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.marketStore;
    const eventStore = this.runtime.eventStore;
    if (!store || !eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }

    const listing = await store.getListing(listingId);
    if (!listing || listing.marketType !== 'info') {
      sendError(res, 404, 'LISTING_NOT_FOUND', 'listing not found');
      return;
    }
    if (listing.seller.did !== body.did) {
      sendError(res, 403, 'NOT_SELLER', 'not the seller');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const resourcePrev = marketState.listingEvents[listingId];
    if (!resourcePrev) {
      sendError(res, 409, 'LISTING_INVALID_STATE', 'listing resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketListingRemoveEnvelope({
        issuer: body.did,
        privateKey,
        listingId,
        resourcePrev,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { listingId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleTaskMarketSearch(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const store = this.runtime.marketStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }
    let query: SearchQuery;
    try {
      query = parseMarketSearchQuery(url.searchParams);
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    const limit = parsePagination(url.searchParams.get('limit'), 0, 1000);
    const offset = parsePagination(url.searchParams.get('offset'), 0, 10_000_000);
    if (limit > 0) {
      query.pageSize = limit;
      query.page = Math.floor(offset / limit) + 1;
    }

    query.markets = ['task'];
    try {
      const result = store.search(query);
      sendJson(res, 200, {
        listings: result.listings,
        total: result.total,
        hasMore: result.page * result.pageSize < result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'failed to search task market');
    }
  }

  private async handleTaskMarketPublish(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, TaskPublishSchema);
    if (!body) {
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const listingId = body.listingId ?? `task-${randomUUID()}`;
    let envelope: Record<string, unknown>;
    try {
      envelope = await createTaskListingPublishEnvelope({
        issuer: body.did,
        privateKey,
        listingId,
        title: body.title,
        description: body.description,
        category: body.category,
        tags: body.tags ?? [],
        pricing: body.pricing as unknown as MarketListing['pricing'],
        visibility: (body.visibility ?? 'public') as MarketListing['visibility'],
        marketData: {
          taskType: body.taskType,
          task: body.task as Record<string, unknown>,
          timeline: body.timeline as Record<string, unknown>,
          workerRequirements: body.workerRequirements as Record<string, unknown> | undefined,
          bidding: body.bidding as Record<string, unknown> | undefined,
          milestones: body.milestones as Record<string, unknown>[] | undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        restrictions: body.restrictions as Record<string, unknown> | undefined,
        metadata: body.metadata as Record<string, unknown> | undefined,
        expiresAt: body.expiresAt,
        status: body.status as MarketListing['status'] | undefined,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 201, { listingId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleTaskMarketGet(
    _req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> {
    const store = this.runtime.marketStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }
    const listing = await store.getListing(taskId);
    if (!listing || listing.marketType !== 'task') {
      sendError(res, 404, 'TASK_NOT_FOUND', 'task not found');
      return;
    }
    sendJson(res, 200, listing);
  }

  private async handleTaskMarketBids(
    _req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
    url: URL,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await buildMarketState(eventStore);
    const all = Object.values(state.bids).filter((bid) => bid.taskId === taskId);
    all.sort((a, b) => a.createdAt - b.createdAt);

    const limit = parsePagination(url.searchParams.get('limit'), 20, 1000);
    const offset = parsePagination(url.searchParams.get('offset'), 0, 10_000_000);
    const sliced = all.slice(offset, offset + limit);

    sendJson(res, 200, {
      bids: sliced,
      total: all.length,
      hasMore: offset + limit < all.length,
      limit,
      offset,
    });
  }

  private async handleTaskMarketBidSubmit(
    req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, TaskBidSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.marketStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }
    const listing = await store.getListing(taskId);
    if (!listing || listing.marketType !== 'task') {
      sendError(res, 404, 'TASK_NOT_FOUND', 'task not found');
      return;
    }
    if (listing.status !== 'active') {
      sendError(res, 409, 'TASK_NOT_ACTIVE', 'task not active');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const bidId = body.bidId ?? `bid-${randomUUID()}`;
    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketBidSubmitEnvelope({
        issuer: body.did,
        privateKey,
        bidId,
        taskId,
        proposal: {
          price: body.price,
          timeline: body.timeline,
          approach: body.approach,
          milestones: body.milestones as Record<string, unknown>[] | undefined,
        },
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 201, { bidId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleTaskMarketAccept(
    req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, TaskAcceptSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.marketStore;
    const eventStore = this.runtime.eventStore;
    if (!store || !eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'task market unavailable');
      return;
    }
    const listing = await store.getListing(taskId);
    if (!listing || listing.marketType !== 'task') {
      sendError(res, 404, 'TASK_NOT_FOUND', 'task not found');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const bid = marketState.bids[body.bidId];
    if (!bid || bid.taskId !== taskId) {
      sendError(res, 404, 'BID_NOT_FOUND', 'bid not found');
      return;
    }
    if (bid.status !== 'submitted') {
      sendError(res, 409, 'BID_INVALID_STATE', 'bid not in submitted state');
      return;
    }
    if (listing.seller.did !== body.did) {
      sendError(res, 403, 'NOT_TASK_OWNER', 'not the task owner');
      return;
    }

    const bidPrev = marketState.bidEvents[body.bidId];
    if (!bidPrev) {
      sendError(res, 409, 'BID_INVALID_STATE', 'bid resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const orderId = body.orderId ?? `order-${randomUUID()}`;
    const escrowId = body.escrowId ?? `escrow-${randomUUID()}`;
    const ts = body.ts ?? Date.now();
    const amount = bid.proposal.price;

    try {
      const bidAccept = await createMarketBidAcceptEnvelope({
        issuer: body.did,
        privateKey,
        bidId: body.bidId,
        resourcePrev: bidPrev,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
      const bidAcceptHash = await this.runtime.publishEvent(bidAccept);

      const orderCreate = await createMarketOrderCreateEnvelope({
        issuer: body.did,
        privateKey,
        orderId,
        listingId: taskId,
        marketType: 'task',
        buyerDid: body.did,
        sellerDid: bid.bidder.did,
        sellerName: bid.bidder.name,
        items: [
          {
            listingId: taskId,
            quantity: 1,
            unitPrice: amount,
            itemData: {
              taskType: (listing.marketData as Record<string, unknown>)?.taskType,
            },
          },
        ],
        pricing: {
          subtotal: amount,
          total: amount,
        },
        status: 'accepted',
        ts: ts + 1,
        nonce: body.nonce + 1,
        prev: bidAcceptHash,
      });
      const orderHash = await this.runtime.publishEvent(orderCreate);

      const escrowCreate = await createWalletEscrowCreateEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        depositor: addressFromDid(body.did),
        beneficiary: addressFromDid(bid.bidder.did),
        amount,
        releaseRules: body.releaseRules ?? [{ id: 'task_completed' }],
        ts: ts + 2,
        nonce: body.nonce + 2,
        prev: orderHash,
      });
      const escrowCreateHash = await this.runtime.publishEvent(escrowCreate);

      const escrowFund = await createWalletEscrowFundEnvelope({
        issuer: body.did,
        privateKey,
        escrowId,
        resourcePrev: escrowCreateHash,
        amount,
        ts: ts + 3,
        nonce: body.nonce + 3,
        prev: escrowCreateHash,
      });
      const escrowFundHash = await this.runtime.publishEvent(escrowFund);

      const paymentUpdate = await createMarketOrderUpdateEnvelope({
        issuer: body.did,
        privateKey,
        orderId,
        resourcePrev: orderHash,
        status: 'payment_pending',
        payment: {
          status: 'escrowed',
          escrowId,
        },
        ts: ts + 4,
        nonce: body.nonce + 4,
        prev: escrowFundHash,
      });
      const paymentHash = await this.runtime.publishEvent(paymentUpdate);

      sendJson(res, 200, {
        bidId: body.bidId,
        orderId,
        escrowId,
        bidAcceptHash,
        orderHash,
        escrowCreateHash,
        escrowFundHash,
        paymentHash,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
    }
  }

  private async handleTaskMarketReject(
    req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, TaskBidActionSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.marketStore;
    const eventStore = this.runtime.eventStore;
    if (!store || !eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'task market unavailable');
      return;
    }
    const listing = await store.getListing(taskId);
    if (!listing || listing.marketType !== 'task') {
      sendError(res, 404, 'TASK_NOT_FOUND', 'task not found');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const bid = marketState.bids[body.bidId];
    if (!bid || bid.taskId !== taskId) {
      sendError(res, 404, 'BID_NOT_FOUND', 'bid not found');
      return;
    }
    if (bid.status !== 'submitted') {
      sendError(res, 409, 'BID_INVALID_STATE', 'bid not in submitted state');
      return;
    }
    if (listing.seller.did !== body.did) {
      sendError(res, 403, 'NOT_TASK_OWNER', 'not the task owner');
      return;
    }

    const bidPrev = marketState.bidEvents[body.bidId];
    if (!bidPrev) {
      sendError(res, 409, 'BID_INVALID_STATE', 'bid resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketBidRejectEnvelope({
        issuer: body.did,
        privateKey,
        bidId: body.bidId,
        resourcePrev: bidPrev,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { bidId: body.bidId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleTaskMarketWithdraw(
    req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, TaskBidActionSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.marketStore;
    const eventStore = this.runtime.eventStore;
    if (!store || !eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'task market unavailable');
      return;
    }
    const listing = await store.getListing(taskId);
    if (!listing || listing.marketType !== 'task') {
      sendError(res, 404, 'TASK_NOT_FOUND', 'task not found');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const bid = marketState.bids[body.bidId];
    if (!bid || bid.taskId !== taskId) {
      sendError(res, 404, 'BID_NOT_FOUND', 'bid not found');
      return;
    }
    if (bid.status !== 'submitted') {
      sendError(res, 409, 'BID_INVALID_STATE', 'bid not in submitted state');
      return;
    }
    if (bid.bidder.did !== body.did) {
      sendError(res, 403, 'NOT_BIDDER', 'not the bid owner');
      return;
    }

    const bidPrev = marketState.bidEvents[body.bidId];
    if (!bidPrev) {
      sendError(res, 409, 'BID_INVALID_STATE', 'bid resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketBidWithdrawEnvelope({
        issuer: body.did,
        privateKey,
        bidId: body.bidId,
        resourcePrev: bidPrev,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { bidId: body.bidId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleTaskMarketRemove(
    req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ListingRemoveSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.marketStore;
    const eventStore = this.runtime.eventStore;
    if (!store || !eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }

    const listing = await store.getListing(taskId);
    if (!listing || listing.marketType !== 'task') {
      sendError(res, 404, 'TASK_NOT_FOUND', 'task not found');
      return;
    }
    if (listing.seller.did !== body.did) {
      sendError(res, 403, 'NOT_TASK_OWNER', 'not the task owner');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const resourcePrev = marketState.listingEvents[taskId];
    if (!resourcePrev) {
      sendError(res, 409, 'LISTING_INVALID_STATE', 'listing resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketListingRemoveEnvelope({
        issuer: body.did,
        privateKey,
        listingId: taskId,
        resourcePrev,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { listingId: taskId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleTaskMarketDeliver(
    req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, TaskDeliverSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const order = marketState.orders[body.orderId];
    if (!order) {
      sendError(res, 404, 'ORDER_NOT_FOUND', 'order not found');
      return;
    }
    if (order.listingId !== taskId) {
      sendError(res, 409, 'ORDER_TASK_MISMATCH', 'order task mismatch');
      return;
    }
    if (order.seller.did !== body.did) {
      sendError(res, 403, 'NOT_WORKER', 'not the worker');
      return;
    }
    const orderPrev = marketState.orderEvents[body.orderId];
    if (!orderPrev) {
      sendError(res, 409, 'ORDER_INVALID_STATE', 'order resource missing');
      return;
    }

    const submissionId = body.submissionId ?? `submission-${randomUUID()}`;
    const ts = body.ts ?? Date.now();

    try {
      const submission = await createMarketSubmissionSubmitEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId,
        submissionId,
        deliverables: body.deliverables as Record<string, unknown>[],
        notes: body.notes,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
      const submissionHash = await this.runtime.publishEvent(submission);

      const orderUpdate = await createMarketOrderUpdateEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId,
        resourcePrev: orderPrev,
        status: 'delivered',
        delivery: {
          status: 'delivered',
          method: 'submission',
          tracking: {
            deliveryId: submissionId,
          },
          deliveredAt: ts,
        },
        ts: ts + 1,
        nonce: body.nonce + 1,
        prev: submissionHash,
      });
      const orderUpdateHash = await this.runtime.publishEvent(orderUpdate);

      sendJson(res, 200, {
        submissionId,
        submissionHash,
        orderUpdateHash,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
    }
  }

  private async handleTaskMarketConfirm(
    req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, TaskConfirmSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }
    const feedback = body.feedback?.trim();
    if (!feedback) {
      sendError(res, 400, 'INVALID_REQUEST', 'feedback is required');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const order = marketState.orders[body.orderId];
    if (!order) {
      sendError(res, 404, 'ORDER_NOT_FOUND', 'order not found');
      return;
    }
    if (order.listingId !== taskId) {
      sendError(res, 409, 'ORDER_TASK_MISMATCH', 'order task mismatch');
      return;
    }
    if (order.buyer.did !== body.did) {
      sendError(res, 403, 'NOT_TASK_OWNER', 'not the task owner');
      return;
    }

    const submission = marketState.submissions[body.submissionId];
    if (!submission || submission.orderId !== body.orderId) {
      sendError(res, 404, 'SUBMISSION_NOT_FOUND', 'submission not found');
      return;
    }
    const submissionPrev = marketState.submissionEvents[body.submissionId];
    if (!submissionPrev) {
      sendError(res, 409, 'SUBMISSION_INVALID_STATE', 'submission resource missing');
      return;
    }
    const orderPrev = marketState.orderEvents[body.orderId];
    if (!orderPrev) {
      sendError(res, 409, 'ORDER_INVALID_STATE', 'order resource missing');
      return;
    }

    const ts = body.ts ?? Date.now();
    const ratingValue = typeof body.rating === 'string' ? Number(body.rating) : body.rating;
    if (body.rating !== undefined && !Number.isFinite(ratingValue)) {
      sendError(res, 400, 'INVALID_REQUEST', 'rating must be a number');
      return;
    }

    try {
      const submissionReview = await createMarketSubmissionReviewEnvelope({
        issuer: body.did,
        privateKey,
        submissionId: body.submissionId,
        resourcePrev: submissionPrev,
        approved: body.approved,
        feedback,
        rating: ratingValue,
        revisionDeadline: body.revisionDeadline,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
      const submissionReviewHash = await this.runtime.publishEvent(submissionReview);

      if (body.approved) {
        const escrowId = body.escrowId ?? order.payment.escrowId;
        if (!escrowId) {
          sendError(res, 409, 'ESCROW_NOT_FOUND', 'escrow id missing');
          return;
        }
        const escrowPrev = await findLatestEscrowEventHash(eventStore, escrowId);
        if (!escrowPrev) {
          sendError(res, 409, 'ESCROW_NOT_FOUND', 'escrow resource missing');
          return;
        }
        const releaseEnvelope = await createInfoEscrowReleaseEnvelope({
          issuer: body.did,
          privateKey,
          escrowId,
          resourcePrev: escrowPrev,
          amount: order.pricing.total,
          ruleId: body.ruleId ?? 'task_completed',
          ts: ts + 1,
          nonce: body.nonce + 1,
          prev: submissionReviewHash,
        });
        const releaseHash = await this.runtime.publishEvent(releaseEnvelope);
        const orderUpdate = await createInfoOrderCompletionEnvelope({
          issuer: body.did,
          privateKey,
          orderId: body.orderId,
          resourcePrev: orderPrev,
          ts: ts + 2,
          nonce: body.nonce + 2,
          prev: releaseHash,
        });
        const orderHash = await this.runtime.publishEvent(orderUpdate);
        sendJson(res, 200, {
          submissionReviewHash,
          escrowReleaseHash: releaseHash,
          orderUpdateHash: orderHash,
        });
        return;
      }

      const orderUpdate = await createMarketOrderUpdateEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId,
        resourcePrev: orderPrev,
        status: order.status,
        delivery: {
          status: body.revisionDeadline ? 'revision' : 'rejected',
        },
        ts: ts + 1,
        nonce: body.nonce + 1,
        prev: submissionReviewHash,
      });
      const orderHash = await this.runtime.publishEvent(orderUpdate);
      sendJson(res, 200, {
        submissionReviewHash,
        orderUpdateHash: orderHash,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
    }
  }

  private async handleTaskMarketReview(
    req: IncomingMessage,
    res: ServerResponse,
    taskId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, TaskReviewSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const order = marketState.orders[body.orderId];
    if (!order) {
      sendError(res, 404, 'ORDER_NOT_FOUND', 'order not found');
      return;
    }
    if (order.listingId !== taskId) {
      sendError(res, 409, 'ORDER_TASK_MISMATCH', 'order task mismatch');
      return;
    }
    const orderPrev = marketState.orderEvents[body.orderId];
    if (!orderPrev) {
      sendError(res, 409, 'ORDER_INVALID_STATE', 'order resource missing');
      return;
    }

    const ratingValue = typeof body.rating === 'string' ? Number(body.rating) : body.rating;
    if (!Number.isFinite(ratingValue)) {
      sendError(res, 400, 'INVALID_REQUEST', 'rating must be a number');
      return;
    }

    try {
      const envelope = await createInfoOrderReviewEnvelope({
        issuer: body.did,
        privateKey,
        orderId: body.orderId,
        resourcePrev: orderPrev,
        status: order.status,
        review: {
          rating: ratingValue,
          comment: body.comment ?? '',
          detailedRatings: body.detailedRatings as OrderReview['detailedRatings'] | undefined,
          createdAt: body.ts ?? Date.now(),
        },
        by: body.by,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { orderUpdateHash: hash });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
    }
  }

  private async handleCapabilityMarketSearch(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const store = this.runtime.marketStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }
    let query: SearchQuery;
    try {
      query = parseMarketSearchQuery(url.searchParams);
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    const limit = parsePagination(url.searchParams.get('limit'), 0, 1000);
    const offset = parsePagination(url.searchParams.get('offset'), 0, 10_000_000);
    if (limit > 0) {
      query.pageSize = limit;
      query.page = Math.floor(offset / limit) + 1;
    }

    query.markets = ['capability'];
    try {
      const result = store.search(query);
      sendJson(res, 200, {
        listings: result.listings,
        total: result.total,
        hasMore: result.page * result.pageSize < result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'failed to search capability market');
    }
  }

  private async handleCapabilityMarketPublish(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await parseBody(req, res, CapabilityPublishSchema);
    if (!body) {
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const listingId = body.listingId ?? `capability-${randomUUID()}`;
    let envelope: Record<string, unknown>;
    try {
      envelope = await createCapabilityListingPublishEnvelope({
        issuer: body.did,
        privateKey,
        listingId,
        title: body.title,
        description: body.description,
        category: body.category,
        tags: body.tags ?? [],
        pricing: body.pricing as unknown as MarketListing['pricing'],
        visibility: (body.visibility ?? 'public') as MarketListing['visibility'],
        marketData: {
          capabilityType: body.capabilityType,
          capability: body.capability as Record<string, unknown>,
          performance: body.performance as Record<string, unknown> | undefined,
          quota: body.quota as Record<string, unknown>,
          access: body.access as Record<string, unknown>,
          sla: body.sla as Record<string, unknown> | undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        restrictions: body.restrictions as Record<string, unknown> | undefined,
        metadata: body.metadata as Record<string, unknown> | undefined,
        expiresAt: body.expiresAt,
        status: body.status as MarketListing['status'] | undefined,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 201, { listingId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleCapabilityMarketGet(
    _req: IncomingMessage,
    res: ServerResponse,
    listingId: string,
  ): Promise<void> {
    const store = this.runtime.marketStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }
    const listing = await store.getListing(listingId);
    if (!listing || listing.marketType !== 'capability') {
      sendError(res, 404, 'LISTING_NOT_FOUND', 'listing not found');
      return;
    }
    sendJson(res, 200, listing);
  }

  private async handleCapabilityMarketRemove(
    req: IncomingMessage,
    res: ServerResponse,
    listingId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, ListingRemoveSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.marketStore;
    const eventStore = this.runtime.eventStore;
    if (!store || !eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }
    const listing = await store.getListing(listingId);
    if (!listing || listing.marketType !== 'capability') {
      sendError(res, 404, 'LISTING_NOT_FOUND', 'listing not found');
      return;
    }
    if (listing.seller.did !== body.did) {
      sendError(res, 403, 'NOT_SELLER', 'not the seller');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const resourcePrev = marketState.listingEvents[listingId];
    if (!resourcePrev) {
      sendError(res, 409, 'LISTING_INVALID_STATE', 'listing resource missing');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const ts = body.ts ?? Date.now();
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketListingRemoveEnvelope({
        issuer: body.did,
        privateKey,
        listingId,
        resourcePrev,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { listingId, txHash: hash });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleCapabilityMarketLease(
    req: IncomingMessage,
    res: ServerResponse,
    listingId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, CapabilityLeaseSchema);
    if (!body) {
      return;
    }
    const store = this.runtime.marketStore;
    if (!store) {
      sendError(res, 500, 'INTERNAL_ERROR', 'market store unavailable');
      return;
    }
    const listing = await store.getListing(listingId);
    if (!listing || listing.marketType !== 'capability') {
      sendError(res, 404, 'LISTING_NOT_FOUND', 'listing not found');
      return;
    }
    if (listing.status !== 'active') {
      sendError(res, 409, 'LISTING_NOT_ACTIVE', 'listing not active');
      return;
    }

    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const leaseId = body.leaseId ?? `lease-${randomUUID()}`;
    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketCapabilityLeaseStartEnvelope({
        issuer: body.did,
        privateKey,
        listingId,
        leaseId,
        plan: body.plan as Record<string, unknown>,
        credentials: body.credentials as Record<string, unknown> | undefined,
        metadata: body.metadata as Record<string, unknown> | undefined,
        expiresAt: body.expiresAt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resourcePrev: (body.resourcePrev ?? null) as any,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 201, {
        leaseId,
        txHash: hash,
        credentials: body.credentials ?? null,
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleCapabilityMarketLeaseGet(
    _req: IncomingMessage,
    res: ServerResponse,
    leaseId: string,
  ): Promise<void> {
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const state = await buildMarketState(eventStore);
    const lease = state.leases[leaseId];
    if (!lease) {
      sendError(res, 404, 'LEASE_NOT_FOUND', 'lease not found');
      return;
    }
    const usageIds = state.usageByLease[leaseId] ?? [];
    const records = usageIds
      .map((id) => state.usageRecords[id])
      .filter((entry) => entry);
    const stats = buildCapabilityUsageStats(records);
    sendJson(res, 200, {
      lease,
      usage: records,
      stats,
    });
  }

  private async handleCapabilityMarketInvoke(
    req: IncomingMessage,
    res: ServerResponse,
    leaseId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, CapabilityInvokeSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const lease = marketState.leases[leaseId];
    if (!lease) {
      sendError(res, 404, 'LEASE_NOT_FOUND', 'lease not found');
      return;
    }
    if (lease.status !== 'active') {
      sendError(res, 409, 'LEASE_NOT_ACTIVE', 'lease not active');
      return;
    }
    const ts = body.ts ?? Date.now();
    if (lease.expiresAt !== undefined && ts > lease.expiresAt) {
      sendError(res, 409, 'LEASE_EXPIRED', 'lease expired');
      return;
    }
    if (lease.lessee !== body.did) {
      sendError(res, 403, 'NOT_LEASE_OWNER', 'not the lease owner');
      return;
    }

    const listing = marketState.listings[lease.listingId];
    if (!listing || listing.marketType !== 'capability') {
      sendError(res, 404, 'LISTING_NOT_FOUND', 'listing not found');
      return;
    }

    const units = body.units ?? 1;
    let cost: string | undefined;
    try {
      if (body.cost !== undefined) {
        cost = normalizeTokenAmountValue(body.cost, 'cost');
      } else if (lease.plan.type === 'pay_per_use') {
        cost = resolveUsageCost(listing.pricing, units);
      } else {
        cost = '0';
      }
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = await createMarketCapabilityInvokeEnvelope({
        issuer: body.did,
        privateKey,
        leaseId,
        resource: body.resource,
        units,
        latency: body.latency,
        success: body.success,
        cost,
        ts,
        nonce: body.nonce,
        prev: body.prev,
      });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
      return;
    }

    try {
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        leaseId,
        txHash: hash,
        usage: {
          leaseId,
          resource: body.resource,
          units,
          latency: body.latency,
          success: body.success,
          cost,
          timestamp: ts,
        },
      });
    } catch {
      sendError(res, 500, 'INTERNAL_ERROR', 'publish failed');
    }
  }

  private async handleCapabilityMarketLeasePause(
    req: IncomingMessage,
    res: ServerResponse,
    leaseId: string,
  ): Promise<void> {
    await this.handleCapabilityMarketLeaseUpdate(req, res, leaseId, 'pause');
  }

  private async handleCapabilityMarketLeaseResume(
    req: IncomingMessage,
    res: ServerResponse,
    leaseId: string,
  ): Promise<void> {
    await this.handleCapabilityMarketLeaseUpdate(req, res, leaseId, 'resume');
  }

  private async handleCapabilityMarketLeaseTerminate(
    req: IncomingMessage,
    res: ServerResponse,
    leaseId: string,
  ): Promise<void> {
    await this.handleCapabilityMarketLeaseUpdate(req, res, leaseId, 'terminate');
  }

  private async handleCapabilityMarketLeaseUpdate(
    req: IncomingMessage,
    res: ServerResponse,
    leaseId: string,
    action: 'pause' | 'resume' | 'terminate',
  ): Promise<void> {
    const body = await parseBody(req, res, CapabilityLeaseActionSchema);
    if (!body) {
      return;
    }
    const eventStore = this.runtime.eventStore;
    if (!eventStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
      return;
    }
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'INVALID_REQUEST', 'key unavailable');
      return;
    }

    const marketState = await buildMarketState(eventStore);
    const lease = marketState.leases[leaseId];
    if (!lease) {
      sendError(res, 404, 'LEASE_NOT_FOUND', 'lease not found');
      return;
    }
    if (lease.lessee !== body.did) {
      sendError(res, 403, 'NOT_LEASE_OWNER', 'not the lease owner');
      return;
    }
    if (action === 'resume' && lease.status !== 'paused') {
      sendError(res, 409, 'LEASE_NOT_PAUSED', 'lease not paused');
      return;
    }
    if (action === 'pause' && lease.status !== 'active') {
      sendError(res, 409, 'LEASE_NOT_ACTIVE', 'lease not active');
      return;
    }

    const resourcePrev = marketState.leaseEvents[leaseId];
    if (!resourcePrev) {
      sendError(res, 409, 'LEASE_INVALID_STATE', 'lease resource missing');
      return;
    }

    try {
      let envelope: Record<string, unknown>;
      if (action === 'pause') {
        envelope = await createMarketCapabilityLeasePauseEnvelope({
          issuer: body.did,
          privateKey,
          leaseId,
          resourcePrev,
          ts: body.ts ?? Date.now(),
          nonce: body.nonce,
          prev: body.prev,
        });
      } else if (action === 'resume') {
        envelope = await createMarketCapabilityLeaseResumeEnvelope({
          issuer: body.did,
          privateKey,
          leaseId,
          resourcePrev,
          ts: body.ts ?? Date.now(),
          nonce: body.nonce,
          prev: body.prev,
        });
      } else {
        envelope = await createMarketCapabilityLeaseTerminateEnvelope({
          issuer: body.did,
          privateKey,
          leaseId,
          resourcePrev,
          ts: body.ts ?? Date.now(),
          nonce: body.nonce,
          prev: body.prev,
        });
      }
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { leaseId, txHash: hash, action });
    } catch (error) {
      sendError(res, 400, 'INVALID_REQUEST', (error as Error).message);
    }
  }

  // ── DAO Governance Handlers ────────────────────────────────────────

  private async handleDaoListProposals(
    _req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const daoStore = this.runtime.daoStore;
    if (!daoStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'dao store unavailable');
      return;
    }
    const statusFilter = url.searchParams.get('status') ?? undefined;
    const proposals = await daoStore.listProposals(
      statusFilter as Parameters<typeof daoStore.listProposals>[0],
    );
    sendJson(res, 200, { proposals });
  }

  private async handleDaoCreateProposal(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await parseBody(req, res, DaoProposalCreateSchema);
    if (!body) return;
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'DAO_INVALID', 'key unavailable');
      return;
    }
    try {
      const proposalId = body.proposalId ?? `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const defaults = PROPOSAL_THRESHOLDS[body.type];
      const envelope = await createDaoProposalCreateEnvelope({
        issuer: body.did,
        privateKey,
        proposalId,
        proposalType: body.type,
        title: body.title,
        description: body.description,
        discussionUrl: body.discussionUrl,
        actions: body.actions as unknown as import('@claw-network/protocol').ProposalAction[],
        discussionPeriod: body.discussionPeriod ?? defaults.discussionPeriod,
        votingPeriod: body.votingPeriod ?? defaults.votingPeriod,
        timelockDelay: body.timelockDelay ?? defaults.timelockDelay,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { proposalId, txHash: hash, status: 'broadcast' });
    } catch (error) {
      sendError(res, 400, 'DAO_INVALID', (error as Error).message);
    }
  }

  private async handleDaoGetProposal(
    _req: IncomingMessage,
    res: ServerResponse,
    proposalId: string,
  ): Promise<void> {
    const daoStore = this.runtime.daoStore;
    if (!daoStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'dao store unavailable');
      return;
    }
    const proposal = await daoStore.getProposal(proposalId);
    if (!proposal) {
      sendError(res, 404, 'NOT_FOUND', 'proposal not found');
      return;
    }
    sendJson(res, 200, { proposal });
  }

  private async handleDaoAdvanceProposal(
    req: IncomingMessage,
    res: ServerResponse,
    proposalId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, DaoProposalAdvanceSchema);
    if (!body) return;
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'DAO_INVALID', 'key unavailable');
      return;
    }
    try {
      const envelope = await createDaoProposalAdvanceEnvelope({
        issuer: body.did,
        privateKey,
        proposalId: body.proposalId || proposalId,
        newStatus: body.newStatus,
        resourcePrev: body.resourcePrev,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { proposalId, txHash: hash, newStatus: body.newStatus });
    } catch (error) {
      sendError(res, 400, 'DAO_INVALID', (error as Error).message);
    }
  }

  private async handleDaoGetVotes(
    _req: IncomingMessage,
    res: ServerResponse,
    proposalId: string,
  ): Promise<void> {
    const daoStore = this.runtime.daoStore;
    if (!daoStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'dao store unavailable');
      return;
    }
    const votes = await daoStore.getVotes(proposalId);
    sendJson(res, 200, { proposalId, votes });
  }

  private async handleDaoVote(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, DaoVoteCastSchema);
    if (!body) return;
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'DAO_INVALID', 'key unavailable');
      return;
    }
    try {
      const envelope = await createDaoVoteCastEnvelope({
        issuer: body.did,
        privateKey,
        proposalId: body.proposalId,
        option: body.option,
        power: body.power,
        reason: body.reason,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, {
        txHash: hash,
        proposalId: body.proposalId,
        option: body.option,
        status: 'broadcast',
      });
    } catch (error) {
      sendError(res, 400, 'DAO_INVALID', (error as Error).message);
    }
  }

  private async handleDaoDelegateSet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, DaoDelegateSetSchema);
    if (!body) return;
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'DAO_INVALID', 'key unavailable');
      return;
    }
    try {
      const envelope = await createDaoDelegateSetEnvelope({
        issuer: body.did,
        privateKey,
        delegate: body.delegate,
        scope: (body.scope ?? { all: true }) as import('@claw-network/protocol').DelegationScope,
        percentage: body.percentage ?? 100,
        expiresAt: body.expiresAt,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { txHash: hash, delegate: body.delegate, status: 'broadcast' });
    } catch (error) {
      sendError(res, 400, 'DAO_INVALID', (error as Error).message);
    }
  }

  private async handleDaoDelegateRevoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody(req, res, DaoDelegateRevokeSchema);
    if (!body) return;
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'DAO_INVALID', 'key unavailable');
      return;
    }
    try {
      const envelope = await createDaoDelegateRevokeEnvelope({
        issuer: body.did,
        privateKey,
        delegate: body.delegate,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { txHash: hash, delegate: body.delegate, status: 'revoked' });
    } catch (error) {
      sendError(res, 400, 'DAO_INVALID', (error as Error).message);
    }
  }

  private async handleDaoGetDelegations(
    _req: IncomingMessage,
    res: ServerResponse,
    did: string,
  ): Promise<void> {
    const daoStore = this.runtime.daoStore;
    if (!daoStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'dao store unavailable');
      return;
    }
    const from = await daoStore.getDelegationsFrom(did);
    const to = await daoStore.getDelegationsTo(did);
    sendJson(res, 200, { did, delegatedFrom: from, delegatedTo: to });
  }

  private async handleDaoGetTreasury(
    _req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const daoStore = this.runtime.daoStore;
    if (!daoStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'dao store unavailable');
      return;
    }
    const treasury = await daoStore.getTreasury();
    sendJson(res, 200, { treasury });
  }

  private async handleDaoTreasuryDeposit(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await parseBody(req, res, DaoTreasuryDepositSchema);
    if (!body) return;
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'DAO_INVALID', 'key unavailable');
      return;
    }
    try {
      const envelope = await createDaoTreasuryDepositEnvelope({
        issuer: body.did,
        privateKey,
        amount: body.amount,
        source: body.source,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { txHash: hash, amount: body.amount, status: 'broadcast' });
    } catch (error) {
      sendError(res, 400, 'DAO_INVALID', (error as Error).message);
    }
  }

  private async handleDaoListTimelock(
    _req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const daoStore = this.runtime.daoStore;
    if (!daoStore) {
      sendError(res, 500, 'INTERNAL_ERROR', 'dao store unavailable');
      return;
    }
    const entries = await daoStore.listTimelockEntries();
    sendJson(res, 200, { entries });
  }

  private async handleDaoTimelockExecute(
    req: IncomingMessage,
    res: ServerResponse,
    actionId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, DaoTimelockExecuteSchema);
    if (!body) return;
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'DAO_INVALID', 'key unavailable');
      return;
    }
    try {
      const envelope = await createDaoTimelockExecuteEnvelope({
        issuer: body.did,
        privateKey,
        actionId: body.actionId || actionId,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { txHash: hash, actionId, status: 'executed' });
    } catch (error) {
      sendError(res, 400, 'DAO_INVALID', (error as Error).message);
    }
  }

  private async handleDaoTimelockCancel(
    req: IncomingMessage,
    res: ServerResponse,
    actionId: string,
  ): Promise<void> {
    const body = await parseBody(req, res, DaoTimelockCancelSchema);
    if (!body) return;
    const privateKey = await resolvePrivateKey(this.config.dataDir, body.did, body.passphrase);
    if (!privateKey) {
      sendError(res, 400, 'DAO_INVALID', 'key unavailable');
      return;
    }
    try {
      const envelope = await createDaoTimelockCancelEnvelope({
        issuer: body.did,
        privateKey,
        actionId: body.actionId || actionId,
        reason: body.reason,
        ts: body.ts ?? Date.now(),
        nonce: body.nonce,
        prev: body.prev,
      });
      const hash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { txHash: hash, actionId, status: 'cancelled' });
    } catch (error) {
      sendError(res, 400, 'DAO_INVALID', (error as Error).message);
    }
  }

  private async handleDaoGetParams(
    _req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    sendJson(res, 200, {
      thresholds: PROPOSAL_THRESHOLDS,
    });
  }

  // ── Dev / Testnet Faucet ────────────────────────────────────────────
  private async handleDevFaucet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const FaucetSchema = z.object({
      did: z.string().min(1),
      amount: z.union([z.number(), z.string()]),
    }).passthrough();

    const parsed = await parseBody(req, res, FaucetSchema);
    if (!parsed) return;
    const { did, amount } = parsed;

    try {
      const eventStore = this.runtime.eventStore;
      if (!eventStore) {
        sendError(res, 500, 'INTERNAL_ERROR', 'event store unavailable');
        return;
      }
      // Resolve local identity to sign the mint event
      const paths = resolveStoragePaths(this.config.dataDir);
      const records = await listKeyRecords(paths);
      if (!records.length) {
        sendError(res, 500, 'INTERNAL_ERROR', 'no local identity');
        return;
      }
      const localRecord = records[0];
      if (!localRecord?.publicKey) {
        sendError(res, 500, 'INTERNAL_ERROR', 'no local key');
        return;
      }
      const localPubBytes = multibaseDecode(localRecord.publicKey);
      const localDid = didFromPublicKey(localPubBytes);
      // Need passphrase from env
      const passphrase = process.env.CLAW_PASSPHRASE;
      if (!passphrase) {
        sendError(res, 500, 'INTERNAL_ERROR', 'CLAW_PASSPHRASE not set');
        return;
      }
      const privateKey = await resolvePrivateKey(this.config.dataDir, localDid, passphrase);
      if (!privateKey) {
        sendError(res, 500, 'INTERNAL_ERROR', 'cannot decrypt local key');
        return;
      }
      const toAddress = addressFromDid(did);
      const ts = Date.now();
      const nonce = Math.floor(ts / 1000);
      const envelope = await createWalletMintEnvelope({
        issuer: localDid,
        privateKey,
        to: toAddress,
        amount,
        reason: 'dev-faucet',
        ts,
        nonce,
      });
      const txHash = await this.runtime.publishEvent(envelope);
      sendJson(res, 200, { txHash, did, amount: String(amount), status: 'minted' });
    } catch (err) {
      sendError(res, 400, 'INVALID_REQUEST', (err as Error).message ?? 'faucet error');
    }
  }
}

async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Buffer);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      sendError(res, 413, 'INVALID_REQUEST', 'payload too large');
      return null;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    sendError(res, 400, 'INVALID_REQUEST', 'empty body');
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    sendError(res, 400, 'INVALID_REQUEST', 'invalid json');
    return null;
  }
}

async function parseBody<T>(
  req: IncomingMessage,
  res: ServerResponse,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const raw = await readJsonBody(req, res);
  if (!raw) {
    return null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'invalid request';
    sendError(res, 400, 'INVALID_REQUEST', message);
    return null;
  }
  return parsed.data;
}

function parseWalletQuery(url: URL, res: ServerResponse): WalletBalanceQuery | null {
  const data = {
    did: url.searchParams.get('did') ?? undefined,
    address: url.searchParams.get('address') ?? undefined,
  };
  const parsed = WalletQuerySchema.safeParse(data);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'invalid request';
    sendError(res, 400, 'INVALID_REQUEST', message);
    return null;
  }
  return parsed.data;
}

function mapEscrowStatus(
  status: WalletState['escrows'][string]['status'],
): 'active' | 'released' | 'refunded' | 'disputed' {
  switch (status) {
    case 'released':
      return 'released';
    case 'refunded':
      return 'refunded';
    case 'disputed':
      return 'disputed';
    case 'pending':
    case 'funded':
    case 'releasing':
    default:
      return 'active';
  }
}

function parseBigInt(value: string | undefined): bigint {
  if (!value) {
    return 0n;
  }
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function parseAmountLike(value: unknown): bigint | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return null;
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }
  if (typeof value === 'bigint') {
    return value;
  }
  return null;
}

function resolveMilestonePaymentAmount(
  contract: ServiceContract,
  milestone: Record<string, unknown>,
): bigint | null {
  const milestoneAmount = parseAmountLike(milestone.amount);
  if (milestoneAmount !== null) {
    return milestoneAmount;
  }
  if (milestone.payment && typeof milestone.payment === 'object') {
    const paymentAmount = parseAmountLike(
      (milestone.payment as Record<string, unknown>).amount,
    );
    if (paymentAmount !== null) {
      return paymentAmount;
    }
  }

  const payment = contract.payment as Record<string, unknown>;
  const schedule =
    (payment?.paymentSchedule as Record<string, unknown>[] | undefined) ??
    (payment?.schedule as Record<string, unknown>[] | undefined) ??
    (payment?.milestones as Record<string, unknown>[] | undefined);
  if (Array.isArray(schedule)) {
    for (const entry of schedule) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const entryId = record.milestoneId ?? record.id;
      if (entryId !== milestone.id) {
        continue;
      }
      const scheduledAmount = parseAmountLike(record.amount);
      if (scheduledAmount !== null) {
        return scheduledAmount;
      }
      const percent = parseAmountLike(record.percentage);
      const total = parseAmountLike(
        payment?.totalAmount ?? payment?.total ?? payment?.amount,
      );
      if (percent !== null && total !== null && percent > 0n) {
        return (total * percent) / 100n;
      }
    }
  }

  const total = parseAmountLike(
    payment?.totalAmount ?? payment?.total ?? payment?.amount,
  );
  const percent = parseAmountLike(milestone.percentage);
  if (total !== null && percent !== null && percent > 0n) {
    return (total * percent) / 100n;
  }
  return null;
}

function buildEscrowView(
  state: WalletState,
  escrow: WalletState['escrows'][string],
): {
  amount: number;
  released: number;
  remaining: number;
  status: 'active' | 'released' | 'refunded' | 'disputed';
  releaseConditions: Record<string, unknown>[];
  createdAt: number;
  expiresAt?: number;
  expired: boolean;
} {
  let createdAt = Date.now();
  let totalAmount: bigint | null = null;
  let releaseConditions: Record<string, unknown>[] = [];
  let expiresAt =
    typeof escrow.expiresAt === 'number' && Number.isFinite(escrow.expiresAt)
      ? escrow.expiresAt
      : undefined;

  for (const entry of state.history) {
    if (entry.type !== 'wallet.escrow.create') {
      continue;
    }
    const payload = entry.payload as Record<string, unknown>;
    if (payload.escrowId !== escrow.escrowId) {
      continue;
    }
    createdAt = entry.ts;
    totalAmount = parseBigInt(payload.amount as string | undefined);
    const rules = payload.releaseRules as Record<string, unknown>[] | undefined;
    if (Array.isArray(rules)) {
      releaseConditions = rules;
    }
    if (expiresAt === undefined && typeof payload.expiresAt === 'number') {
      expiresAt = payload.expiresAt;
    }
    break;
  }

  const remaining = parseBigInt(escrow.balance);
  const total = totalAmount ?? remaining;
  const released = total - remaining >= 0n ? total - remaining : 0n;
  const expired = expiresAt !== undefined ? Date.now() > expiresAt : false;

  return {
    amount: Number(total),
    released: Number(released),
    remaining: Number(remaining),
    status: mapEscrowStatus(escrow.status),
    releaseConditions,
    createdAt,
    expiresAt,
    expired,
  };
}

function buildContractView(contract: ServiceContract): Record<string, unknown> {
  const clientDid = contract.parties.client.did;
  const providerDid = contract.parties.provider.did;
  const clientSignedAt = contract.signatures.find((sig) => sig.signer === clientDid)?.signedAt;
  const providerSignedAt = contract.signatures.find((sig) => sig.signer === providerDid)?.signedAt;
  const signedAt =
    clientSignedAt && providerSignedAt ? Math.max(clientSignedAt, providerSignedAt) : undefined;
  return {
    ...contract,
    client: clientDid,
    provider: providerDid,
    signedAt,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

function isValidDid(value: string): boolean {
  if (!value) {
    return false;
  }
  try {
    publicKeyFromDid(value);
    return true;
  } catch {
    return false;
  }
}

function resolveAddress(input: string): string | null {
  if (!input) {
    return null;
  }
  if (input.startsWith('did:claw:')) {
    try {
      return addressFromDid(input);
    } catch {
      return null;
    }
  }
  return input;
}

function resolveAddressFromQuery(query: WalletBalanceQuery): string | null {
  if (query.address) {
    return query.address;
  }
  if (query.did) {
    return resolveAddress(query.did);
  }
  return null;
}

async function resolvePrivateKey(
  dataDir: string | undefined,
  did: string,
  passphrase: string,
): Promise<Uint8Array | null> {
  try {
    const publicKey = publicKeyFromDid(did);
    const keyId = keyIdFromPublicKey(publicKey);
    const paths = resolveStoragePaths(dataDir);
    const record = await loadKeyRecord(paths, keyId);
    return await decryptKeyRecord(record, passphrase);
  } catch {
    return null;
  }
}

function parsePagination(value: string | null, fallback: number, max: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function parseCsv(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const items = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return items.length ? items : undefined;
}

function parseBoolean(value: string | null): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error('invalid boolean value');
}

function parseTokenParam(value: string | null, field: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`${field} must be an integer token amount`);
  }
  return trimmed;
}

function parseNumberParam(value: string | null, field: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a number`);
  }
  return parsed;
}

function normalizeTokenAmountValue(value: string | number, field: string): string {
  let parsed: bigint;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${field} must be an integer`);
    }
    parsed = BigInt(value);
  } else {
    const trimmed = value.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
      throw new Error(`${field} must be an integer`);
    }
    parsed = BigInt(trimmed);
  }
  if (parsed < 0n) {
    throw new Error(`${field} must be >= 0`);
  }
  return parsed.toString();
}

function resolveUsageCost(pricing: MarketListing['pricing'], units: number): string {
  if (!Number.isInteger(units) || units <= 0) {
    throw new Error('units must be a positive integer');
  }
  switch (pricing.type) {
    case 'usage': {
      const pricePerUnit = pricing.usagePrice?.pricePerUnit;
      if (!pricePerUnit) {
        break;
      }
      return (BigInt(pricePerUnit) * BigInt(units)).toString();
    }
    case 'fixed': {
      const fixedPrice = pricing.fixedPrice;
      if (!fixedPrice) {
        break;
      }
      return (BigInt(fixedPrice) * BigInt(units)).toString();
    }
    default:
      break;
  }
  throw new Error('pricing model does not support pay-per-use');
}

function buildCapabilityUsageStats(
  records: Array<{ latency: number; success: boolean; units: number; cost?: string }>,
): {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalUnits: number;
  averageLatency: number;
  p95Latency: number;
  totalCost: string;
} {
  const totalCalls = records.length;
  let successfulCalls = 0;
  let totalUnits = 0;
  let totalLatency = 0;
  let totalCost = 0n;

  const latencies: number[] = [];
  for (const record of records) {
    if (record.success) {
      successfulCalls += 1;
    }
    totalUnits += record.units;
    totalLatency += record.latency;
    latencies.push(record.latency);
    if (record.cost !== undefined) {
      try {
        totalCost += BigInt(record.cost);
      } catch {
        // Ignore invalid cost values.
      }
    }
  }

  latencies.sort((a, b) => a - b);
  const p95Index = latencies.length
    ? Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))
    : 0;
  const averageLatency = totalCalls ? totalLatency / totalCalls : 0;
  const p95Latency = latencies.length ? latencies[p95Index] : 0;

  return {
    totalCalls,
    successfulCalls,
    failedCalls: totalCalls - successfulCalls,
    totalUnits,
    averageLatency,
    p95Latency,
    totalCost: totalCost.toString(),
  };
}

function parseMarketSearchQuery(params: URLSearchParams): SearchQuery {
  const markets = parseCsv(params.get('markets'));
  const tags = parseCsv(params.get('tags'));
  const skills = parseCsv(params.get('skills'));
  const taskTypes = parseCsv(params.get('taskTypes') ?? params.get('taskType'));
  const infoTypes = parseCsv(params.get('infoTypes') ?? params.get('infoType'));
  const contentFormats = parseCsv(params.get('contentFormats') ?? params.get('contentFormat'));
  const accessMethods = parseCsv(params.get('accessMethods') ?? params.get('accessMethod'));
  const capabilityTypeParam = params.get('capabilityType');
  const statuses = parseCsv(params.get('statuses') ?? params.get('status'));
  const visibility = parseCsv(params.get('visibility'));

  const marketTypes = markets?.map((entry) => {
    if (!isMarketType(entry)) {
      throw new Error(`unknown market type: ${entry}`);
    }
    return entry;
  });
  const listingStatuses = statuses?.map((entry) => {
    if (!isListingStatus(entry)) {
      throw new Error(`unknown listing status: ${entry}`);
    }
    return entry;
  });
  const listingVisibility = visibility?.map((entry) => {
    if (!isListingVisibility(entry)) {
      throw new Error(`unknown visibility: ${entry}`);
    }
    return entry;
  });
  const taskTypeValues = taskTypes?.map((entry) => {
    if (!isTaskType(entry)) {
      throw new Error(`unknown task type: ${entry}`);
    }
    return entry;
  });
  const infoTypeValues = infoTypes?.map((entry) => {
    if (!isInfoType(entry)) {
      throw new Error(`unknown info type: ${entry}`);
    }
    return entry;
  });
  const contentFormatValues = contentFormats?.map((entry) => {
    if (!isContentFormat(entry)) {
      throw new Error(`unknown content format: ${entry}`);
    }
    return entry;
  });
  const accessMethodValues = accessMethods?.map((entry) => {
    if (!isAccessMethodType(entry)) {
      throw new Error(`unknown access method: ${entry}`);
    }
    return entry;
  });
  let capabilityType: string | undefined;
  if (capabilityTypeParam) {
    if (!isCapabilityType(capabilityTypeParam)) {
      throw new Error(`unknown capability type: ${capabilityTypeParam}`);
    }
    capabilityType = capabilityTypeParam;
  }

  const page = parsePagination(params.get('page'), 1, 1_000_000);
  const pageSize = parsePagination(params.get('pageSize'), 20, 1000);
  const includeFacets = parseBoolean(params.get('includeFacets'));

  const minPrice = parseTokenParam(params.get('minPrice') ?? params.get('priceMin'), 'minPrice');
  const maxPrice = parseTokenParam(params.get('maxPrice') ?? params.get('priceMax'), 'maxPrice');

  const minReputation = parseNumberParam(params.get('minReputation'), 'minReputation');
  const minRating = parseNumberParam(params.get('minRating'), 'minRating');

  const sort = params.get('sort') ?? undefined;

  const query: SearchQuery = {
    keyword: params.get('keyword') ?? undefined,
    markets: marketTypes,
    category: params.get('category') ?? undefined,
    tags,
    priceRange: minPrice || maxPrice ? { min: minPrice, max: maxPrice } : undefined,
    minReputation,
    minRating,
    skills,
    taskTypes: taskTypeValues,
    capabilityType,
    infoTypes: infoTypeValues,
    contentFormats: contentFormatValues,
    accessMethods: accessMethodValues,
    sort: sort as SearchQuery['sort'],
    page,
    pageSize,
    includeFacets,
    statuses: listingStatuses,
    visibility: listingVisibility,
  };

  return query;
}

type ReputationSource = 'store' | 'log';

function parseReputationSource(value: string | null): ReputationSource | null | 'invalid' {
  if (!value) {
    return null;
  }
  if (value === 'store' || value === 'log') {
    return value;
  }
  return 'invalid';
}

interface IdentityView {
  did: string;
  publicKey: string;
  created: number;
  updated: number;
  displayName?: string;
  avatar?: string;
  bio?: string;
  platformLinks: Array<Record<string, unknown>>;
  capabilities: Array<Record<string, unknown>>;
}

async function resolveLocalIdentity(dataDir?: string): Promise<IdentityView | null> {
  const paths = resolveStoragePaths(dataDir);
  const records = await listKeyRecords(paths);
  if (!records.length) {
    return null;
  }
  const sorted = records
    .map((record) => ({
      record,
      createdAt: Date.parse(record.createdAt ?? ''),
    }))
    .sort((a, b) => {
      const left = Number.isFinite(a.createdAt) ? a.createdAt : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(b.createdAt) ? b.createdAt : Number.MAX_SAFE_INTEGER;
      return left - right;
    });
  const primary = sorted[0]?.record;
  if (!primary?.publicKey) {
    return null;
  }
  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = multibaseDecode(primary.publicKey);
  } catch {
    return null;
  }
  const did = didFromPublicKey(publicKeyBytes);
  const created = Number.isFinite(sorted[0]?.createdAt ?? NaN)
    ? (sorted[0]?.createdAt as number)
    : Date.now();
  return {
    did,
    publicKey: primary.publicKey,
    created,
    updated: created,
    platformLinks: [],
    capabilities: [],
  };
}

async function buildIdentityView(
  eventStore: EventStore,
  did: string,
): Promise<IdentityView | null> {
  let publicKey: string | null = null;
  let createdAt: number | null = null;
  let updatedAt: number | null = null;
  const platformLinks: Array<Record<string, unknown>> = [];
  const capabilities: Array<Record<string, unknown>> = [];

  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      const type = envelope.type as string | undefined;
      const payload = envelope.payload as Record<string, unknown> | undefined;
      if (!payload) {
        continue;
      }
      const payloadDid = payload.did as string | undefined;
      const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
      if (type === 'identity.create' && payloadDid === did) {
        publicKey = (payload.publicKey as string | undefined) ?? publicKey;
        if (createdAt === null) {
          createdAt = ts;
        }
        updatedAt = ts;
        continue;
      }
      if (type === 'identity.update' && payloadDid === did) {
        updatedAt = ts;
        continue;
      }
      if (type === 'identity.platform.link' && payloadDid === did) {
        const platform = payload.platformId as string | undefined;
        const handle = payload.platformUsername as string | undefined;
        if (platform && handle) {
          platformLinks.push({
            platform,
            handle,
            verified: false,
            verifiedAt: ts,
          });
        }
        continue;
      }
      if (type === 'identity.capability.register' && payloadDid === did) {
        const name = payload.name as string | undefined;
        const pricing = payload.pricing as Record<string, unknown> | undefined;
        if (!name || !pricing) {
          continue;
        }
        const capability: Record<string, unknown> = {
          id: typeof envelope.hash === 'string' ? envelope.hash : `cap-${ts}`,
          name,
          pricing,
          verified: false,
          registeredAt: ts,
        };
        if (payload.description) {
          capability.description = payload.description;
        }
        capabilities.push(capability);
        continue;
      }
    }
    if (!next) {
      break;
    }
    cursor = next;
  }

  if (!publicKey) {
    return null;
  }
  const created = createdAt ?? updatedAt ?? Date.now();
  const updated = updatedAt ?? created;
  return {
    did,
    publicKey,
    created,
    updated,
    platformLinks,
    capabilities,
  };
}

async function buildIdentityCapabilities(
  eventStore: EventStore,
  did?: string,
): Promise<Array<Record<string, unknown>>> {
  const capabilities: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope || envelope.type !== 'identity.capability.register') {
        continue;
      }
      const payload = envelope.payload as Record<string, unknown> | undefined;
      if (!payload) {
        continue;
      }
      const payloadDid = payload.did as string | undefined;
      if (did && payloadDid !== did) {
        continue;
      }
      const name = payload.name as string | undefined;
      const pricing = payload.pricing as Record<string, unknown> | undefined;
      if (!name || !pricing) {
        continue;
      }
      const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
      const capability: Record<string, unknown> = {
        id: typeof envelope.hash === 'string' ? envelope.hash : `cap-${ts}`,
        name,
        pricing,
        verified: false,
        registeredAt: ts,
      };
      if (payload.description) {
        capability.description = payload.description;
      }
      capabilities.push(capability);
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return capabilities;
}

async function buildWalletState(eventStore: EventStore): Promise<WalletState> {
  let state = createWalletState();
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      state = applyWalletEvent(state, envelope);
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return state;
}

async function buildEscrowSnapshot(
  eventStore: EventStore,
  escrowId: string,
): Promise<{
  escrow: WalletState['escrows'][string] | null;
  history: WalletState['history'];
}> {
  let escrow: WalletState['escrows'][string] | null = null;
  const history: WalletState['history'] = [];
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      const type = String(envelope.type ?? '');
      if (!type.startsWith('wallet.escrow.')) {
        continue;
      }
      const payload = envelope.payload as Record<string, unknown> | undefined;
      if (!payload || payload.escrowId !== escrowId) {
        continue;
      }
      const ts = typeof envelope.ts === 'number' ? envelope.ts : Date.now();
      const hash =
        typeof envelope.hash === 'string' && envelope.hash.length
          ? envelope.hash
          : eventHashHex(envelope as EventEnvelope);
      history.push({ hash, type, ts, payload });

      if (type === 'wallet.escrow.create') {
        if (!escrow) {
          escrow = {
            escrowId,
            depositor: String(payload.depositor ?? ''),
            beneficiary: String(payload.beneficiary ?? ''),
            balance: '0',
            status: 'pending',
            expiresAt:
              typeof payload.expiresAt === 'number' && Number.isFinite(payload.expiresAt)
                ? payload.expiresAt
                : undefined,
          };
        }
        continue;
      }
      if (!escrow) {
        continue;
      }
      const amount = parseAmountLike(payload.amount);
      if (amount === null) {
        continue;
      }
      const current = parseBigInt(escrow.balance);
      const delta =
        type === 'wallet.escrow.release' || type === 'wallet.escrow.refund' ? -amount : amount;
      const nextBalance = current + delta;
      if (nextBalance < 0n) {
        continue;
      }
      escrow.balance = nextBalance.toString();
      if (type === 'wallet.escrow.fund') {
        escrow.status = 'funded';
      } else if (type === 'wallet.escrow.release') {
        escrow.status = nextBalance === 0n ? 'released' : 'releasing';
      } else if (type === 'wallet.escrow.refund') {
        escrow.status = nextBalance === 0n ? 'refunded' : escrow.status;
      }
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return { escrow, history };
}

async function buildReputationState(eventStore: EventStore): Promise<ReputationState> {
  let state = createReputationState();
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      try {
        state = applyReputationEvent(state, envelope);
      } catch {
        continue;
      }
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return state;
}

async function buildContractState(
  eventStore: EventStore,
): Promise<ReturnType<typeof createContractState>> {
  let state = createContractState();
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      try {
        state = applyContractEvent(state, envelope as EventEnvelope);
      } catch {
        continue;
      }
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return state;
}

async function buildMarketState(eventStore: EventStore): Promise<ReturnType<typeof createMarketState>> {
  let state = createMarketState();
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      try {
        state = applyMarketEvent(state, envelope);
      } catch {
        continue;
      }
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return state;
}

async function findLatestEscrowEventHash(
  eventStore: EventStore,
  escrowId: string,
): Promise<string | null> {
  let cursor: string | null = null;
  let last: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      const type = String(envelope.type ?? '');
      if (!type.startsWith('wallet.escrow.')) {
        continue;
      }
      const payload = envelope.payload as Record<string, unknown> | undefined;
      if (!payload) {
        continue;
      }
      if (payload.escrowId !== escrowId) {
        continue;
      }
      const hash = typeof envelope.hash === 'string' && envelope.hash.length
        ? envelope.hash
        : eventHashHex(envelope);
      last = hash;
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return last;
}

function parseEvent(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    return JSON.parse(bytesToUtf8(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapReputationLevel(level: ReputationLevel): { label: string; levelNumber: number } {
  switch (level) {
    case 'legend':
      return { label: 'Legend', levelNumber: 7 };
    case 'elite':
      return { label: 'Master', levelNumber: 6 };
    case 'expert':
      return { label: 'Expert', levelNumber: 5 };
    case 'trusted':
      return { label: 'Advanced', levelNumber: 4 };
    case 'newcomer':
      return { label: 'Intermediate', levelNumber: 3 };
    case 'observed':
      return { label: 'Beginner', levelNumber: 2 };
    case 'risky':
    default:
      return { label: 'Newcomer', levelNumber: 1 };
  }
}

function ratingFromScore(score: number): number {
  const rating = Math.round(score / 200);
  return Math.max(1, Math.min(5, rating));
}

function computeAverageRating(records: ReputationRecord[]): number {
  if (!records.length) {
    return 0;
  }
  const total = records.reduce((sum, record) => sum + ratingFromScore(record.score), 0);
  return Number((total / records.length).toFixed(2));
}

function buildWalletTransactions(
  state: WalletState,
  address: string,
): Array<Record<string, unknown>> {
  const transactions: Array<Record<string, unknown>> = [];
  for (const entry of state.history) {
    if (entry.type === 'wallet.transfer') {
      const payload = entry.payload as {
        from: string;
        to: string;
        amount: string;
        memo?: string;
      };
      transactions.push({
        txHash: entry.hash,
        type: 'transfer',
        from: payload.from,
        to: payload.to,
        amount: Number(payload.amount),
        status: 'confirmed',
        memo: payload.memo,
        timestamp: entry.ts,
      });
      continue;
    }
    if (entry.type === 'wallet.escrow.fund') {
      const payload = entry.payload as { escrowId: string; amount: string };
      const escrow = state.escrows[payload.escrowId];
      transactions.push({
        txHash: entry.hash,
        type: 'escrow_lock',
        from: escrow?.depositor,
        to: escrow?.beneficiary,
        amount: Number(payload.amount),
        status: 'confirmed',
        timestamp: entry.ts,
      });
      continue;
    }
    if (entry.type === 'wallet.escrow.release') {
      const payload = entry.payload as { escrowId: string; amount: string };
      const escrow = state.escrows[payload.escrowId];
      transactions.push({
        txHash: entry.hash,
        type: 'escrow_release',
        from: escrow?.depositor,
        to: escrow?.beneficiary,
        amount: Number(payload.amount),
        status: 'confirmed',
        timestamp: entry.ts,
      });
      continue;
    }
    if (entry.type === 'wallet.escrow.refund') {
      const payload = entry.payload as { escrowId: string; amount: string };
      const escrow = state.escrows[payload.escrowId];
      transactions.push({
        txHash: entry.hash,
        type: 'escrow_release',
        from: escrow?.depositor,
        to: escrow?.depositor,
        amount: Number(payload.amount),
        status: 'confirmed',
        timestamp: entry.ts,
      });
      continue;
    }
  }
  return transactions.filter((tx) => tx.from === address || tx.to === address);
}

function filterWalletTransaction(
  type: string,
  address: string,
  tx: Record<string, unknown>,
): boolean {
  if (type === 'all') {
    return true;
  }
  const from = tx.from as string | undefined;
  const to = tx.to as string | undefined;
  if (type === 'sent') {
    return from === address;
  }
  if (type === 'received') {
    return to === address;
  }
  if (type === 'escrow') {
    return tx.type === 'escrow_lock' || tx.type === 'escrow_release';
  }
  return true;
}
