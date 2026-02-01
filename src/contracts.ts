/**
 * 服务合约模块
 * 管理 AI Agents 之间的服务协议
 */

import { EventEmitter } from 'events';
import {
  AgentId,
  ContractId,
  ServiceContract,
  ContractStatus,
  ServiceType,
  TaskType,
  PaymentTerms,
  RefundPolicy,
  ArbitrationPolicy,
  QualityCriterion,
  Milestone,
  Deliverable,
  ApiResponse,
} from './types';

// ============================================
// 合约创建选项
// ============================================

export interface CreateContractOptions {
  /** 雇主 */
  client: AgentId;
  
  /** 服务提供者 */
  provider: AgentId;
  
  /** 服务类型 */
  serviceType: ServiceType;
  
  /** 任务类型 (可选) */
  taskType?: TaskType;
  
  /** 服务描述 */
  description: string;
  
  /** 交付物 */
  deliverables: Deliverable[];
  
  /** 质量标准 */
  qualityCriteria?: QualityCriterion[];
  
  /** 支付金额 */
  amount: bigint;
  
  /** 是否托管 */
  escrow?: boolean;
  
  /** 截止时间 */
  deadline: number;
  
  /** 里程碑 (可选) */
  milestones?: Omit<Milestone, 'status'>[];
  
  /** 退款政策 */
  refundPolicy?: RefundPolicy;
}

// ============================================
// 合约事件
// ============================================

export interface ContractEvents {
  created: ServiceContract;
  accepted: ServiceContract;
  started: ServiceContract;
  milestone_completed: { contract: ServiceContract; milestone: Milestone };
  submitted: { contract: ServiceContract; deliverables: unknown[] };
  approved: ServiceContract;
  completed: ServiceContract;
  disputed: { contract: ServiceContract; reason: string };
  cancelled: ServiceContract;
  refunded: { contract: ServiceContract; amount: bigint };
}

// ============================================
// ContractManager 实现
// ============================================

export class ContractManager extends EventEmitter {
  private contracts: Map<ContractId, ServiceContract> = new Map();
  
  /**
   * 创建新合约
   */
  async create(options: CreateContractOptions): Promise<ApiResponse<ServiceContract>> {
    // 验证参数
    if (options.client === options.provider) {
      return {
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Client and provider cannot be the same' },
      };
    }
    
    if (options.amount <= BigInt(0)) {
      return {
        success: false,
        error: { code: 'INVALID_AMOUNT', message: 'Amount must be greater than 0' },
      };
    }
    
    if (options.deadline <= Date.now()) {
      return {
        success: false,
        error: { code: 'INVALID_DEADLINE', message: 'Deadline must be in the future' },
      };
    }
    
    const contractId = this.generateContractId();
    
    // 处理里程碑
    const milestones: Milestone[] = options.milestones?.map(m => ({
      ...m,
      status: 'pending' as const,
    })) ?? [];
    
    // 默认退款政策
    const refundPolicy: RefundPolicy = options.refundPolicy ?? {
      type: 'conditional',
      conditions: ['Provider fails to deliver by deadline', 'Work quality does not meet criteria'],
      maxRefundPercentage: 100,
    };
    
    // 默认仲裁政策
    const arbitration: ArbitrationPolicy = {
      enabled: true,
      method: options.amount > BigInt(1000_000_000) ? 'platform' : 'community_jury',
      fee: options.amount / BigInt(20), // 5%
      jurySize: 5,
      timeout: 7 * 24 * 60 * 60 * 1000, // 7 days
    };
    
    const contract: ServiceContract = {
      contractId,
      version: '1.0.0',
      client: options.client,
      provider: options.provider,
      service: {
        type: options.serviceType,
        taskType: options.taskType,
        description: options.description,
        qualityCriteria: options.qualityCriteria ?? [],
      },
      payment: {
        amount: options.amount,
        escrow: options.escrow ?? true,
        paymentModel: milestones.length > 0 ? 'milestone' : 'fixed',
        milestones,
        refundPolicy,
      },
      deadline: options.deadline,
      status: ContractStatus.PENDING_ACCEPTANCE,
      arbitration,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    this.contracts.set(contractId, contract);
    this.emit('created', contract);
    
    return { success: true, data: contract };
  }
  
  /**
   * Provider 接受合约
   */
  async accept(contractId: ContractId, provider: AgentId): Promise<ApiResponse<ServiceContract>> {
    const contract = this.contracts.get(contractId);
    
    if (!contract) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Contract not found' },
      };
    }
    
    if (contract.provider !== provider) {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Only the provider can accept' },
      };
    }
    
    if (contract.status !== ContractStatus.PENDING_ACCEPTANCE) {
      return {
        success: false,
        error: { code: 'INVALID_STATUS', message: `Cannot accept contract in status: ${contract.status}` },
      };
    }
    
    contract.status = ContractStatus.ACTIVE;
    contract.updatedAt = Date.now();
    
    this.emit('accepted', contract);
    
    return { success: true, data: contract };
  }
  
  /**
   * 开始执行合约
   */
  async start(contractId: ContractId, provider: AgentId): Promise<ApiResponse<ServiceContract>> {
    const contract = this.contracts.get(contractId);
    
    if (!contract) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Contract not found' },
      };
    }
    
    if (contract.provider !== provider) {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Only the provider can start' },
      };
    }
    
    if (contract.status !== ContractStatus.ACTIVE) {
      return {
        success: false,
        error: { code: 'INVALID_STATUS', message: `Cannot start contract in status: ${contract.status}` },
      };
    }
    
    contract.status = ContractStatus.IN_PROGRESS;
    contract.updatedAt = Date.now();
    
    this.emit('started', contract);
    
    return { success: true, data: contract };
  }
  
  /**
   * 完成里程碑
   */
  async completeMilestone(
    contractId: ContractId,
    milestoneId: string,
    provider: AgentId,
    deliverables: unknown[]
  ): Promise<ApiResponse<Milestone>> {
    const contract = this.contracts.get(contractId);
    
    if (!contract) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Contract not found' },
      };
    }
    
    if (contract.provider !== provider) {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Only the provider can complete milestones' },
      };
    }
    
    if (contract.status !== ContractStatus.IN_PROGRESS) {
      return {
        success: false,
        error: { code: 'INVALID_STATUS', message: 'Contract is not in progress' },
      };
    }
    
    const milestone = contract.payment.milestones?.find(m => m.id === milestoneId);
    
    if (!milestone) {
      return {
        success: false,
        error: { code: 'MILESTONE_NOT_FOUND', message: 'Milestone not found' },
      };
    }
    
    if (milestone.status !== 'pending') {
      return {
        success: false,
        error: { code: 'INVALID_STATUS', message: `Milestone status is: ${milestone.status}` },
      };
    }
    
    milestone.status = 'completed';
    contract.updatedAt = Date.now();
    
    this.emit('milestone_completed', { contract, milestone });
    
    return { success: true, data: milestone };
  }
  
  /**
   * 提交工作成果
   */
  async submit(
    contractId: ContractId,
    provider: AgentId,
    deliverables: unknown[]
  ): Promise<ApiResponse<ServiceContract>> {
    const contract = this.contracts.get(contractId);
    
    if (!contract) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Contract not found' },
      };
    }
    
    if (contract.provider !== provider) {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Only the provider can submit' },
      };
    }
    
    if (contract.status !== ContractStatus.IN_PROGRESS) {
      return {
        success: false,
        error: { code: 'INVALID_STATUS', message: 'Contract is not in progress' },
      };
    }
    
    contract.status = ContractStatus.PENDING_REVIEW;
    contract.updatedAt = Date.now();
    
    this.emit('submitted', { contract, deliverables });
    
    return { success: true, data: contract };
  }
  
  /**
   * Client 批准工作成果
   */
  async approve(
    contractId: ContractId,
    client: AgentId,
    rating: number,
    feedback?: string
  ): Promise<ApiResponse<ServiceContract>> {
    const contract = this.contracts.get(contractId);
    
    if (!contract) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Contract not found' },
      };
    }
    
    if (contract.client !== client) {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Only the client can approve' },
      };
    }
    
    if (contract.status !== ContractStatus.PENDING_REVIEW) {
      return {
        success: false,
        error: { code: 'INVALID_STATUS', message: 'Contract is not pending review' },
      };
    }
    
    contract.status = ContractStatus.COMPLETED;
    contract.updatedAt = Date.now();
    
    // TODO: 释放托管资金
    // TODO: 更新双方信誉
    
    this.emit('completed', contract);
    this.emit('approved', contract);
    
    return { success: true, data: contract };
  }
  
  /**
   * 发起争议
   */
  async dispute(
    contractId: ContractId,
    initiator: AgentId,
    reason: string
  ): Promise<ApiResponse<ServiceContract>> {
    const contract = this.contracts.get(contractId);
    
    if (!contract) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Contract not found' },
      };
    }
    
    if (contract.client !== initiator && contract.provider !== initiator) {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Only parties can dispute' },
      };
    }
    
    if (![ContractStatus.IN_PROGRESS, ContractStatus.PENDING_REVIEW].includes(contract.status)) {
      return {
        success: false,
        error: { code: 'INVALID_STATUS', message: 'Cannot dispute in current status' },
      };
    }
    
    contract.status = ContractStatus.DISPUTED;
    contract.updatedAt = Date.now();
    
    this.emit('disputed', { contract, reason });
    
    return { success: true, data: contract };
  }
  
  /**
   * 取消合约 (需双方同意或满足条件)
   */
  async cancel(
    contractId: ContractId,
    initiator: AgentId,
    reason?: string
  ): Promise<ApiResponse<ServiceContract>> {
    const contract = this.contracts.get(contractId);
    
    if (!contract) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Contract not found' },
      };
    }
    
    if (contract.client !== initiator && contract.provider !== initiator) {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Only parties can cancel' },
      };
    }
    
    // 只能取消未开始的合约
    if (![ContractStatus.PENDING_ACCEPTANCE, ContractStatus.ACTIVE].includes(contract.status)) {
      return {
        success: false,
        error: { code: 'INVALID_STATUS', message: 'Cannot cancel in current status' },
      };
    }
    
    contract.status = ContractStatus.CANCELLED;
    contract.updatedAt = Date.now();
    
    // TODO: 如果有托管，退还资金
    
    this.emit('cancelled', contract);
    
    return { success: true, data: contract };
  }
  
  /**
   * 获取合约
   */
  get(contractId: ContractId): ServiceContract | undefined {
    return this.contracts.get(contractId);
  }
  
  /**
   * 获取 Agent 的所有合约
   */
  getByAgent(
    agentId: AgentId,
    role?: 'client' | 'provider',
    status?: ContractStatus[]
  ): ServiceContract[] {
    return Array.from(this.contracts.values()).filter(c => {
      const matchAgent = role
        ? (role === 'client' ? c.client === agentId : c.provider === agentId)
        : (c.client === agentId || c.provider === agentId);
      
      const matchStatus = status ? status.includes(c.status) : true;
      
      return matchAgent && matchStatus;
    });
  }
  
  private generateContractId(): ContractId {
    return `contract_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

// ============================================
// 导出
// ============================================

export const contractManager = new ContractManager();
export default contractManager;
