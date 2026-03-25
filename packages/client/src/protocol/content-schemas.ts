// ============================================================
// TelagentContentType Payload Schemas
// ============================================================
// 每种 telagent/* 类型对应的 payload 结构定义。
// ============================================================

/** telagent/identity-card — 与 RFC §4.2 payload 示例对齐 */
export interface IdentityCardPayload {
  did: string;
  publicKey: string;               // 公钥
  reputation: {                    // 嵌套信誉信息
    score: number;
    reviews: number;
  };
  capabilities: string[];          // 能力列表
}

/** telagent/transfer-request */
export interface TransferRequestPayload {
  fromDid: string;         // 发送方 DID
  toDid: string;           // 目标 DID
  amount: number;          // CLAW 代币数量
  currency: string;        // 'CLAW'
  memo?: string;
  requestId: string;       // 防重放
}

/** telagent/transfer-receipt */
export interface TransferReceiptPayload {
  txHash: string;
  fromDid: string;         // 发送方 DID
  toDid: string;           // 接收方 DID
  amount: number;
  status: string;          // 'confirmed' 等
  timestamp: number;       // Unix ms
}

/** telagent/task-listing — RFC 中为 task-listing（非 task-card） */
export interface TaskListingPayload {
  listingId: string;
  title: string;
  pricing: {
    model: string;         // 'fixed' | 'hourly' 等
    basePrice: number;
  };
  deadline?: number;       // Unix ms
  tags?: string[];
}

/** telagent/task-bid */
export interface TaskBidPayload {
  listingId: string;
  bidder: string;          // DID
  amount: number;
  proposal?: string;
}

/** telagent/escrow-created */
export interface EscrowCreatedPayload {
  escrowId: string;
  creator: string;         // DID
  beneficiary: string;     // DID
  amount: number;
  status: 'created';
  txHash?: string;
}

/** telagent/escrow-released */
export interface EscrowReleasedPayload {
  escrowId: string;
  beneficiary: string;     // DID
  amount: number;
  status: 'released';
  txHash?: string;
}

/** telagent/milestone-update */
export interface MilestoneUpdatePayload {
  contractId: string;
  milestoneIndex: number;
  title: string;
  status: 'pending' | 'in-progress' | 'completed' | 'disputed';
  updatedAt: string;       // ISO 8601
}

/** telagent/review-card — 与 RFC §4.2 payload 示例对齐 */
export interface ReviewCardPayload {
  targetDid: string;
  rating: number;          // 1-5
  comment: string;
  txHash: string;
}

/** 所有 payload 的联合类型 */
export type TelagentPayload =
  | IdentityCardPayload
  | TransferRequestPayload
  | TransferReceiptPayload
  | TaskListingPayload
  | TaskBidPayload
  | EscrowCreatedPayload
  | EscrowReleasedPayload
  | MilestoneUpdatePayload
  | ReviewCardPayload;
