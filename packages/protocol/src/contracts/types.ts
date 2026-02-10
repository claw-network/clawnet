export type ContractStatus =
  | 'draft'
  | 'negotiating'
  | 'pending_signature'
  | 'pending_funding'
  | 'active'
  | 'completed'
  | 'disputed'
  | 'terminated'
  | 'cancelled'
  | 'paused'
  | 'expired';

export interface ContractParty {
  did: string;
  address?: string;
  name?: string;
  role?: string;
}

export interface ContractParties {
  client: ContractParty;
  provider: ContractParty;
  subcontractors?: ContractParty[];
  auditors?: ContractParty[];
  arbiters?: ContractParty[];
  guarantors?: ContractParty[];
  witnesses?: ContractParty[];
}

export type ContractMilestoneStatus =
  | 'pending'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'revision'
  | 'cancelled';

export interface ContractMilestoneSubmission {
  id: string;
  submittedBy: string;
  submittedAt: number;
  deliverables?: Record<string, unknown>[];
  notes?: string;
  status?: string;
}

export interface ContractMilestoneReview {
  id: string;
  submissionId: string;
  reviewedBy: string;
  reviewedAt: number;
  decision: 'approve' | 'reject' | 'revision_requested';
  comments?: string;
}

export interface ContractMilestone extends Record<string, unknown> {
  id: string;
  status: ContractMilestoneStatus;
  submissions?: ContractMilestoneSubmission[];
  reviews?: ContractMilestoneReview[];
  submittedAt?: number;
  approvedAt?: number;
  rejectedAt?: number;
}

export interface ContractSignature {
  signer: string;
  signature?: string;
  signedAt: number;
}

export interface ContractDispute {
  reason: string;
  description?: string;
  evidence?: Record<string, unknown>[];
  status: 'open' | 'resolved';
  initiator?: string;
  resolvedBy?: string;
  resolution?: string;
  notes?: string;
  openedAt: number;
  resolvedAt?: number;
  prevStatus?: ContractStatus;
}

export interface ServiceContract {
  id: string;
  version: string;
  parties: ContractParties;
  service: Record<string, unknown>;
  terms: Record<string, unknown>;
  payment: Record<string, unknown>;
  timeline: Record<string, unknown>;
  milestones: ContractMilestone[];
  status: ContractStatus;
  signatures: ContractSignature[];
  metadata?: Record<string, unknown>;
  attachments?: Record<string, unknown>[];
  escrowId?: string;
  dispute?: ContractDispute;
  createdAt: number;
  updatedAt: number;
  activatedAt?: number;
  completedAt?: number;
}
