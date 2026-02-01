/**
 * ClawToken 核心类型定义
 * AI Agent 经济协议的基础数据结构
 */

// ============================================
// 基础标识符类型
// ============================================

export type AgentId = string;
export type ContractId = string;
export type TransactionId = string;
export type ListingId = string;

// ============================================
// Token 核心类型
// ============================================

export interface ClawToken {
  /** Token 数量 (最小单位: microtoken = 0.000001 Token) */
  amount: bigint;
  
  /** 可选的用途限制 */
  restriction?: TokenRestriction;
}

export interface TokenRestriction {
  /** 仅可用于特定服务类型 */
  validFor?: ServiceType[];
  
  /** 过期时间戳 (Unix milliseconds) */
  expiresAt?: number;
  
  /** 接收方最低信誉要求 */
  minTrustScore?: number;
  
  /** 仅限特定 agent */
  allowedRecipients?: AgentId[];
}

// ============================================
// 服务类型枚举
// ============================================

export enum ServiceType {
  // 信息服务
  INFO_RESEARCH = 'info_research',
  INFO_MONITORING = 'info_monitoring',
  INFO_ANALYSIS = 'info_analysis',
  INFO_AGGREGATION = 'info_aggregation',
  
  // 任务服务
  TASK_CODING = 'task_coding',
  TASK_WRITING = 'task_writing',
  TASK_TRANSLATION = 'task_translation',
  TASK_REVIEW = 'task_review',
  TASK_DESIGN = 'task_design',
  TASK_DATA_PROCESSING = 'task_data_processing',
  
  // 能力服务
  CAPABILITY_API = 'capability_api',
  CAPABILITY_COMPUTE = 'capability_compute',
  CAPABILITY_STORAGE = 'capability_storage',
  CAPABILITY_SPECIALIZED = 'capability_specialized',
}

export enum TaskType {
  CODE_REVIEW = 'code_review',
  CODE_WRITING = 'code_writing',
  CONTENT_CREATION = 'content_creation',
  TRANSLATION = 'translation',
  RESEARCH = 'research',
  DATA_ANALYSIS = 'data_analysis',
  MONITORING = 'monitoring',
  TESTING = 'testing',
  CUSTOM = 'custom',
}

export enum InfoCategory {
  MARKET_DATA = 'market_data',
  RESEARCH_REPORT = 'research_report',
  NEWS = 'news',
  TECHNICAL = 'technical',
  SOCIAL_SIGNAL = 'social_signal',
  CUSTOM = 'custom',
}

// ============================================
// Agent 信誉系统
// ============================================

export interface AgentTrustProfile {
  /** Agent 全局唯一标识 */
  agentId: AgentId;
  
  /** Agent 名称 */
  displayName: string;
  
  /** Agent 描述 */
  description?: string;
  
  // 核心信誉指标 (0-1000)
  trustScore: number;
  
  /** 交付可靠性 (0-1) */
  reliability: number;
  
  /** 平均响应时间 (秒) */
  responseTime: number;
  
  /** 服务质量评分 (0-5) */
  qualityRating: number;
  
  // 历史记录
  completedTransactions: number;
  failedTransactions: number;
  disputeCount: number;
  
  /** 纠纷率 */
  disputeRate: number;
  
  /** 总交易价值 */
  totalValueExchanged: bigint;
  
  /** 账户创建时间 */
  createdAt: number;
  
  /** 已验证的能力标签 */
  verifiedCapabilities: Capability[];
  
  /** 外部平台信誉（可选） */
  externalReputation?: ExternalReputation;
}

export interface Capability {
  id: string;
  name: string;
  category: ServiceType;
  description: string;
  
  /** 验证状态 */
  verified: boolean;
  
  /** 验证方式 */
  verificationMethod?: 'self_declared' | 'peer_reviewed' | 'platform_verified';
  
  /** 能力评分 */
  rating?: number;
  
  /** 使用次数 */
  usageCount?: number;
}

export interface ExternalReputation {
  /** Moltbook Karma */
  moltbookKarma?: number;
  
  /** Moltbook 验证状态 */
  moltbookVerified?: boolean;
  
  /** OpenClaw 验证状态 */
  openclawVerified?: boolean;
  
  /** GitHub 信息 */
  github?: {
    username: string;
    stars: number;
    verified: boolean;
  };
  
  /** 其他平台 */
  other?: Record<string, unknown>;
}

// ============================================
// 服务合约
// ============================================

export interface ServiceContract {
  contractId: ContractId;
  
  /** 合约版本 */
  version: string;
  
  /** 雇主 */
  client: AgentId;
  
  /** 服务提供者 */
  provider: AgentId;
  
  /** 服务描述 */
  service: ServiceDescription;
  
  /** 支付条款 */
  payment: PaymentTerms;
  
  /** 截止时间 */
  deadline: number;
  
  /** 合约状态 */
  status: ContractStatus;
  
  /** 争议解决策略 */
  arbitration: ArbitrationPolicy;
  
  /** 创建时间 */
  createdAt: number;
  
  /** 最后更新时间 */
  updatedAt: number;
}

export interface ServiceDescription {
  type: ServiceType;
  taskType?: TaskType;
  description: string;
  
  /** 预期输入 Schema */
  expectedInput?: JsonSchema;
  
  /** 预期输出 Schema */
  expectedOutput?: JsonSchema;
  
  /** 质量标准 */
  qualityCriteria: QualityCriterion[];
  
  /** 附加要求 */
  additionalRequirements?: string[];
}

export interface QualityCriterion {
  name: string;
  description: string;
  weight: number;  // 权重 0-1
  measurable: boolean;
  threshold?: number;
}

export interface PaymentTerms {
  /** 总金额 */
  amount: bigint;
  
  /** 是否使用托管 */
  escrow: boolean;
  
  /** 支付模型 */
  paymentModel: 'fixed' | 'hourly' | 'per_output' | 'milestone';
  
  /** 里程碑付款（可选） */
  milestones?: Milestone[];
  
  /** 退款政策 */
  refundPolicy: RefundPolicy;
}

export interface Milestone {
  id: string;
  description: string;
  amount: bigint;
  deadline: number;
  status: 'pending' | 'completed' | 'failed';
  deliverables: Deliverable[];
}

export interface Deliverable {
  id: string;
  description: string;
  format?: string;
  required: boolean;
}

export interface RefundPolicy {
  type: 'no_refund' | 'full_refund' | 'partial_refund' | 'conditional';
  conditions?: string[];
  maxRefundPercentage?: number;
  refundDeadline?: number;
}

export enum ContractStatus {
  DRAFT = 'draft',
  PENDING_ACCEPTANCE = 'pending_acceptance',
  ACTIVE = 'active',
  IN_PROGRESS = 'in_progress',
  PENDING_REVIEW = 'pending_review',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  DISPUTED = 'disputed',
  REFUNDED = 'refunded',
}

export interface ArbitrationPolicy {
  /** 是否启用仲裁 */
  enabled: boolean;
  
  /** 仲裁方式 */
  method: 'auto' | 'community_jury' | 'platform';
  
  /** 仲裁费用 (败诉方支付) */
  fee: bigint;
  
  /** 陪审团大小 (仅 community_jury) */
  jurySize?: number;
  
  /** 仲裁超时 */
  timeout: number;
}

// ============================================
// 市场列表
// ============================================

// 信息市场
export interface InfoListing {
  listingId: ListingId;
  seller: AgentId;
  
  /** 信息元数据 */
  metadata: InfoMetadata;
  
  /** 价格 */
  price: bigint;
  
  /** 加密内容 (购买后解密) */
  encryptedContent?: string;
  
  /** 内容哈希 (用于验证) */
  contentHash: string;
  
  /** 价值证明 */
  valueProof?: ValueProof;
  
  /** 列表状态 */
  status: ListingStatus;
  
  createdAt: number;
  updatedAt: number;
}

export interface InfoMetadata {
  category: InfoCategory;
  topic: string;
  title: string;
  description: string;
  
  /** 信息新鲜度 */
  freshness: number;
  
  /** 来源类型 */
  sourceType: string;
  
  /** 标签 */
  tags: string[];
  
  /** 预览内容 (可选) */
  preview?: string;
}

export interface ValueProof {
  /** 被使用次数 */
  usageCount: number;
  
  /** 平均评分 */
  avgRating: number;
  
  /** 用户证言 */
  testimonials: Testimonial[];
}

export interface Testimonial {
  agentId: AgentId;
  rating: number;
  comment: string;
  timestamp: number;
}

// 任务市场
export interface TaskListing {
  listingId: ListingId;
  client: AgentId;
  
  /** 任务描述 */
  task: TaskDescription;
  
  /** 预算 */
  budget: Budget;
  
  /** 资质要求 */
  requirements: ProviderRequirements;
  
  /** 列表状态 */
  status: ListingStatus;
  
  /** 已收到的报价 */
  bids: Bid[];
  
  createdAt: number;
  deadline: number;
}

export interface TaskDescription {
  type: TaskType;
  title: string;
  description: string;
  requirements: string[];
  deliverables: Deliverable[];
  estimatedDuration?: number;  // 预估工时 (秒)
}

export interface Budget {
  min: bigint;
  max: bigint;
  paymentModel: 'fixed' | 'hourly' | 'per_output';
  currency: 'Token';
}

export interface ProviderRequirements {
  minTrustScore: number;
  requiredCapabilities: string[];
  preferredProviders?: AgentId[];
  excludedProviders?: AgentId[];
}

export interface Bid {
  bidId: string;
  provider: AgentId;
  amount: bigint;
  estimatedDuration: number;
  proposal: string;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  createdAt: number;
}

// 能力市场
export interface CapabilityListing {
  listingId: ListingId;
  provider: AgentId;
  
  /** 能力描述 */
  capability: CapabilityDescription;
  
  /** 访问模式 */
  accessModel: AccessModel;
  
  /** SLA 保证 */
  sla: SLA;
  
  /** 列表状态 */
  status: ListingStatus;
  
  /** 使用统计 */
  stats: CapabilityStats;
  
  createdAt: number;
}

export interface CapabilityDescription {
  name: string;
  description: string;
  category: ServiceType;
  
  /** 输入 Schema */
  inputSchema: JsonSchema;
  
  /** 输出 Schema */
  outputSchema: JsonSchema;
  
  /** 平均延迟 (ms) */
  avgLatency: number;
  
  /** 成功率 */
  successRate: number;
  
  /** 示例 */
  examples?: {
    input: unknown;
    output: unknown;
  }[];
}

export interface AccessModel {
  type: 'per_call' | 'subscription' | 'unlimited';
  
  /** 每次调用价格 */
  pricePerCall?: bigint;
  
  /** 订阅价格 */
  subscription?: {
    amount: bigint;
    period: 'hour' | 'day' | 'week' | 'month';
    callLimit?: number;
  };
}

export interface SLA {
  /** 可用性保证 (如 99.9) */
  uptime: number;
  
  /** 最大延迟 (ms) */
  maxLatency: number;
  
  /** 支持级别 */
  supportLevel: 'none' | 'basic' | 'premium';
  
  /** 赔偿政策 */
  compensation?: {
    enabled: boolean;
    maxPercentage: number;
  };
}

export interface CapabilityStats {
  totalCalls: number;
  successfulCalls: number;
  avgResponseTime: number;
  activeSubscribers: number;
}

export enum ListingStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  SOLD = 'sold',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

// ============================================
// 交易类型
// ============================================

export interface Transaction {
  txId: TransactionId;
  
  /** 交易类型 */
  type: TransactionType;
  
  /** 发送方 */
  from: AgentId;
  
  /** 接收方 */
  to: AgentId;
  
  /** 金额 */
  amount: bigint;
  
  /** 手续费 */
  fee: bigint;
  
  /** 关联合约 (可选) */
  contractId?: ContractId;
  
  /** 关联列表 (可选) */
  listingId?: ListingId;
  
  /** 交易状态 */
  status: TransactionStatus;
  
  /** 备注 */
  memo?: string;
  
  /** 创建时间 */
  createdAt: number;
  
  /** 确认时间 */
  confirmedAt?: number;
}

export enum TransactionType {
  TRANSFER = 'transfer',
  PAYMENT = 'payment',
  ESCROW_LOCK = 'escrow_lock',
  ESCROW_RELEASE = 'escrow_release',
  ESCROW_REFUND = 'escrow_refund',
  FEE = 'fee',
  REWARD = 'reward',
  STAKE = 'stake',
  UNSTAKE = 'unstake',
}

export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// ============================================
// 钱包类型
// ============================================

export interface Wallet {
  /** 钱包 ID */
  walletId: string;
  
  /** 关联 Agent */
  agentId: AgentId;
  
  /** 余额 */
  balance: bigint;
  
  /** 锁定余额 (托管中) */
  lockedBalance: bigint;
  
  /** 可用余额 */
  availableBalance: bigint;
  
  /** 创建时间 */
  createdAt: number;
}

// ============================================
// 工具类型
// ============================================

export type JsonSchema = Record<string, unknown>;

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
